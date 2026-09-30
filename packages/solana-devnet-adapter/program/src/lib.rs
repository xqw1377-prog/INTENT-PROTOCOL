//! TESTNET-R1 T2 on-chain program — minimal settlement executor.
//!
//! The chain is a Settlement Adapter ONLY (docs/TESTNET-R1.md §2): this
//! program consumes a settlement ALREADY authorized by the frozen local
//! protocol, re-validates every frozen constant, enforces one release PDA
//! per EconomicReleaseKey (escrow_ref, outcome_receipt_hash), transfers
//! EXACTLY 10 test USDC to the frozen claimant ATA, and materializes the
//! ChainReleaseV1 FACT record. It holds no protocol authority of its own.
//!
//! Frozen inputs (T3 Appendix A, materialized on devnet):
//!   - the single authorized pair for R1: escrow_ref + outcome_receipt_hash
//!   - mint / claimant wallet / claimant ATA / treasury / treasury ATA
//!   - Operator is the ONLY role that may request (Treasury signs the move)
//!   - caps re-enforced ON CHAIN: per-release 10, escrow-total 100,
//!     cycle-cumulative 100 (client guards do not substitute for these)
//!
//! Instruction `release` account order (9 accounts):
//!   0 release_pda      (writable, program-derived; must equal find_program_address(["release", digest]))
//!   1 operator         (signer, == frozen OPERATOR)
//!   2 treasury         (signer, == frozen TREASURY; token source authority + fee payer)
//!   3 claimant_ata     (writable, == frozen CLAIMANT_ATA)
//!   4 treasury_ata     (writable, == frozen TREASURY_ATA)
//!   5 mint             (== frozen MINT)
//!   6 caps_pda         (writable, program-derived from ["caps"])
//!   7 token_program    (== spl_token::ID)
//!   8 system_program   (== system_program::ID)
//!
//! Instruction data: [0u8 discriminator][u16 escrow_len][escrow_ref bytes][32 receipt bytes]
//!
//! ChainReleaseV1 on-chain layout (146 bytes):
//!   [0]     initialized marker = 1
//!   1..33   escrow_ref_hash (sha256 of escrow_ref utf8)
//!   33..65  outcome_receipt_hash raw32
//!   65..97  claimant (utf8, zero-padded to 32)
//!   97..129 mint pubkey
//!   129..137 amount (u64 base units)
//!   137..145 released_at slot (u64)
//!   145     release PDA bump

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    hash::hash as sha256,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    system_instruction,
    sysvar::clock::Clock,
    sysvar::rent::Rent,
    sysvar::Sysvar,
};

// ————————————————— frozen constants (T3 Appendix A) —————————————————

const MINT: &str = "CGLUuUdaeUkMk9GmKwM8EbQMtzRXrpsFsiLnoWwt1Fvh";
const OPERATOR: &str = "673H3SuS1o8cWEGFFpd4ua7roZppZWhKvAGBGgtsvTjN";
const TREASURY: &str = "8QW7mvynD8xPwhW8mp584Yf6nmfwGWWqXtNDn194uvsv";
const CLAIMANT_WALLET: &str = "6ce8Q7hxP5fbFPhKsUUpd7QHLGUYqfMHiNvZFkBAzwo8";
const CLAIMANT_ATA: &str = "4R8BCsiLtAJn4xyWNMQhmbuvTYK3qm2jUgbqDofBBcQy";
const TREASURY_ATA: &str = "B7zaiMDacLZr93ERW882CZ8pK2BrQdj7UP845JpFDEUm";
const CLAIMANT: &[u8; 17] = b"agent:gp-001-demo";

fn pk(s: &str) -> Pubkey {
    use std::str::FromStr;
    Pubkey::from_str(s).expect("frozen constant pubkey must parse")
}

/// The single authorized R1 pair. escrow_ref as bytes; receipt raw 32.
const ESCROW_REF: &[u8] = b"escrow:gp-001-local";
const RECEIPT_RAW32: [u8; 32] = [
    0xda, 0x57, 0x7b, 0x3d, 0x04, 0xbc, 0x53, 0xda,
    0xc6, 0xac, 0xe4, 0xc2, 0x00, 0x67, 0x9a, 0xb3,
    0x6b, 0xc1, 0xfa, 0x21, 0xe8, 0xbe, 0x31, 0xe2,
    0xe5, 0xc7, 0x19, 0x7c, 0xc7, 0x70, 0x63, 0x80,
];
/// sha256:da577b…06380 — GENERATED from the frozen anchor hex, never hand-transcribed.

const ECONOMIC_RELEASE_DOMAIN: &[u8] = b"intent-protocol/testnet-r1/economic-release";

const AMOUNT_BASE: u64 = 10_000_000;       // 10 USDC-test (decimals 6)
const ESCROW_TOTAL_CAP: u64 = 100_000_000; // 100 USDC-test
const CYCLE_CAP: u64 = 100_000_000;        // 100 USDC-test

const RELEASE_DATA_LEN: usize = 146;
const CAPS_DATA_LEN: usize = 9;

// ————————————————— errors —————————————————

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum T2Error {
    MalformedInstruction = 100,
    WrongAuthorizedPair = 101,
    InvalidReleasePda = 102,
    UnauthorizedOperator = 103,
    UnauthorizedTreasury = 104,
    WrongMint = 105,
    WrongDestination = 106,
    WrongSource = 107,
    DuplicateRelease = 108, // one economic release per (escrow_ref, outcome_receipt_hash) — forever
    EscrowTotalCapExceeded = 109,
    CycleCapExceeded = 110,
    CapsPdaInvalid = 111,
}

impl From<T2Error> for ProgramError {
    fn from(e: T2Error) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// ————————————————— entrypoint —————————————————

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.first() != Some(&0u8) {
        return Err(T2Error::MalformedInstruction.into());
    }
    let rest = &instruction_data[1..];
    if rest.len() < 2 {
        return Err(T2Error::MalformedInstruction.into());
    }
    let escrow_len = u16::from_le_bytes([rest[0], rest[1]]) as usize;
    if rest.len() != 2 + escrow_len + 32 {
        return Err(T2Error::MalformedInstruction.into());
    }
    let escrow_ref = &rest[2..2 + escrow_len];
    let receipt: [u8; 32] = rest[2 + escrow_len..].try_into().unwrap();

    // 1. the ONLY authorized settlement pair for R1 (authority input)
    if escrow_ref != ESCROW_REF || receipt != RECEIPT_RAW32 {
        msg!("error: not the frozen authorized pair");
        return Err(T2Error::WrongAuthorizedPair.into());
    }

    // 2. derive the EconomicReleaseDigest + release PDA ON CHAIN
    let mut preimage = Vec::with_capacity(ECONOMIC_RELEASE_DOMAIN.len() + 1 + escrow_ref.len() + 1 + 32);
    preimage.extend_from_slice(ECONOMIC_RELEASE_DOMAIN);
    preimage.push(0x00);
    preimage.extend_from_slice(escrow_ref);
    preimage.push(0x00);
    preimage.extend_from_slice(&receipt);
    let digest = sha256(&preimage);
    let (release_pda_expected, release_bump) =
        Pubkey::find_program_address(&[b"release", digest.as_ref()], program_id);

    // 3. bind accounts
    let account_info_iter = &mut accounts.iter();
    let release_pda_info = next_account_info(account_info_iter)?;
    let operator_info = next_account_info(account_info_iter)?;
    let treasury_info = next_account_info(account_info_iter)?;
    let claimant_ata_info = next_account_info(account_info_iter)?;
    let treasury_ata_info = next_account_info(account_info_iter)?;
    let mint_info = next_account_info(account_info_iter)?;
    let caps_pda_info = next_account_info(account_info_iter)?;
    let token_program_info = next_account_info(account_info_iter)?;
    let system_program_info = next_account_info(account_info_iter)?;

    if *release_pda_info.key != release_pda_expected {
        return Err(T2Error::InvalidReleasePda.into());
    }

    // 4. role separation (re-enforced on chain; client checks are not authority)
    if !operator_info.is_signer || *operator_info.key != pk(OPERATOR) {
        return Err(T2Error::UnauthorizedOperator.into());
    }
    if !treasury_info.is_signer || *treasury_info.key != pk(TREASURY) {
        return Err(T2Error::UnauthorizedTreasury.into());
    }

    // 5. frozen asset + destination + source
    if *mint_info.key != pk(MINT) {
        return Err(T2Error::WrongMint.into());
    }
    if *token_program_info.key != spl_token::ID {
        return Err(T2Error::WrongMint.into()); // token program binding
    }
    if *system_program_info.key != solana_program::system_program::ID {
        return Err(T2Error::MalformedInstruction.into());
    }

    let claimant_ata = spl_token::state::Account::unpack(&claimant_ata_info.data.borrow())?;
    if *claimant_ata_info.key != pk(CLAIMANT_ATA)
        || claimant_ata.mint != pk(MINT)
        || claimant_ata.owner != pk(CLAIMANT_WALLET)
    {
        return Err(T2Error::WrongDestination.into());
    }
    let treasury_ata_acct = spl_token::state::Account::unpack(&treasury_ata_info.data.borrow())?;
    if *treasury_ata_info.key != pk(TREASURY_ATA)
        || treasury_ata_acct.mint != pk(MINT)
        || treasury_ata_acct.owner != pk(TREASURY)
    {
        return Err(T2Error::WrongSource.into());
    }
    // escrow-total cap re-enforced on chain
    if treasury_ata_acct.amount > ESCROW_TOTAL_CAP {
        return Err(T2Error::EscrowTotalCapExceeded.into());
    }

    // 6. caps PDA (cycle-cumulative re-enforced on chain)
    let (caps_pda_expected, caps_bump) = Pubkey::find_program_address(&[b"caps"], program_id);
    if *caps_pda_info.key != caps_pda_expected {
        return Err(T2Error::CapsPdaInvalid.into());
    }
    let mut cycle_released: u64 = 0;
    let caps_initialized = caps_pda_info.data_len() >= CAPS_DATA_LEN && caps_pda_info.data.borrow()[0] == 1;
    if caps_initialized {
        let d = caps_pda_info.data.borrow();
        cycle_released = u64::from_le_bytes(d[1..9].try_into().unwrap());
    }
    if cycle_released.checked_add(AMOUNT_BASE).map_or(true, |v| v > CYCLE_CAP) {
        msg!("error: cycle cumulative cap");
        return Err(T2Error::CycleCapExceeded.into());
    }

    // 7. EXACTLY-ONCE: an existing initialized release PDA is a terminal fact
    if release_pda_info.data_len() >= RELEASE_DATA_LEN && release_pda_info.data.borrow()[0] == 1 {
        msg!("duplicate economic release rejected");
        return Err(T2Error::DuplicateRelease.into());
    }

    // 8. transfer EXACTLY 10 test USDC: treasury ATA -> frozen claimant ATA
    invoke(
        &spl_token::instruction::transfer(
            &spl_token::ID,
            treasury_ata_info.key,
            claimant_ata_info.key,
            treasury_info.key,
            &[],
            AMOUNT_BASE,
        )?,
        &[
            treasury_ata_info.clone(),
            claimant_ata_info.clone(),
            treasury_info.clone(),
        ],
    )?;

    // 9. materialize ChainReleaseV1 (FACT ONLY — never authority) + caps bookkeeping.
    //    Atomicity: any failure before commit rolls the WHOLE transaction back,
    //    including the transfer above — no torn state can survive.
    let rent = Rent::get()?;
    if !caps_initialized {
        invoke_signed(
            &system_instruction::create_account(
                treasury_info.key,
                caps_pda_info.key,
                rent.minimum_balance(CAPS_DATA_LEN),
                CAPS_DATA_LEN as u64,
                program_id,
            ),
            &[treasury_info.clone(), caps_pda_info.clone()],
            &[&[b"caps", &[caps_bump]]],
        )?;
        let mut d = caps_pda_info.try_borrow_mut_data()?;
        d[0] = 1;
        d[1..9].copy_from_slice(&AMOUNT_BASE.to_le_bytes());
    } else {
        let next = cycle_released
            .checked_add(AMOUNT_BASE)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        let mut d = caps_pda_info.try_borrow_mut_data()?;
        d[1..9].copy_from_slice(&next.to_le_bytes());
    }

    invoke_signed(
        &system_instruction::create_account(
            treasury_info.key,
            release_pda_info.key,
            rent.minimum_balance(RELEASE_DATA_LEN),
            RELEASE_DATA_LEN as u64,
            program_id,
        ),
        &[treasury_info.clone(), release_pda_info.clone()],
        &[&[b"release", digest.as_ref(), &[release_bump]]],
    )?;
    {
        let escrow_ref_hash = sha256(escrow_ref);
        let slot = Clock::get()?.slot;
        let mut d = release_pda_info.try_borrow_mut_data()?;
        d[0] = 1;
        d[1..33].copy_from_slice(escrow_ref_hash.as_ref());
        d[33..65].copy_from_slice(&receipt);
        let mut claimant_buf = [0u8; 32];
        claimant_buf[..CLAIMANT.len()].copy_from_slice(CLAIMANT);
        d[65..97].copy_from_slice(&claimant_buf);
        d[97..129].copy_from_slice(mint_info.key.as_ref());
        d[129..137].copy_from_slice(&AMOUNT_BASE.to_le_bytes());
        d[137..145].copy_from_slice(&slot.to_le_bytes());
        d[145] = release_bump;
    }

    msg!("TESTNET-R1 release: 10 USDC-test -> frozen claimant ATA (exactly-once per EconomicReleaseKey)");
    Ok(())
}
