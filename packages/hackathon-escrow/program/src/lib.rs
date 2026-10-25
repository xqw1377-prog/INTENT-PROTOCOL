//! Hackathon devnet program (Encode Club Solana Hackathon 2026).
//!
//! This is a NEW program. It does not modify, upgrade, or call the immutable
//! TESTNET-R1 settlement program (`ASvnm4pi…`).
//!
//! One intent account freezes the done-criteria before delivery:
//!   - criteria text is stored and hashed on-chain at creation
//!   - the creator also commits sha256(expected submission) — the answer
//!     itself is not stored
//!   - the reward (SOL) is escrowed into a program-owned vault in the same
//!     transaction
//! A deliverer submits bytes. `verify` recomputes sha256(submission) and
//! compares it to the frozen commitment. The deliverer cannot mark their
//! own work passed. `settle` pays the vaulted SOL to that deliverer once.
//!
//! Account layout (little-endian), INTENT_LEN = 632:
//!   0      disc = 1
//!   1      bump
//!   2      status (1 funded, 2 delivered, 3 verified, 4 settled, 5 cancelled)
//!   3      creator pubkey (32)
//!   35     deliverer pubkey (32), zeros until submit
//!   67     vault bump
//!   68     escrow lamports (u64)
//!   76     criteria hash (32) = sha256(criteria utf-8)
//!   108    expected submission hash (32)
//!   140    submission hash (32), zeros until submit
//!   172    verification result hash (32), zeros until verify
//!   204    criteria len (u16)
//!   206    criteria bytes (280)
//!   486    submission len (u16)
//!   488    submission bytes (128)
//!   616    created slot (u64)
//!   624    settled-or-cancelled slot (u64)
//!
//! Registry layout, REGISTRY_LEN = 1026:
//!   0      disc = 1
//!   1      count (u8, max 32)
//!   2      intent pubkeys, oldest first (32 * 32)
//!
//! Instructions:
//!   1 create  [disc][nonce u64][lamports u64][expected hash 32][len u16][criteria]
//!   2 submit  [disc][len u16][submission]
//!   3 verify  [disc]
//!   4 settle  [disc]
//!   5 cancel  [disc]

#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    hash::hash as sha256,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    sysvar::clock::Clock,
    sysvar::rent::Rent,
    sysvar::Sysvar,
};

solana_program::declare_id!("7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F");

pub const INTENT_LEN: usize = 632;
pub const REGISTRY_LEN: usize = 2 + 32 * 32;
pub const REGISTRY_CAP: usize = 32;
pub const CRITERIA_MAX: usize = 280;
pub const SUBMISSION_MAX: usize = 128;
pub const MIN_LAMPORTS: u64 = 10_000_000;
pub const MAX_LAMPORTS: u64 = 500_000_000;

pub const STATUS_FUNDED: u8 = 1;
pub const STATUS_DELIVERED: u8 = 2;
pub const STATUS_VERIFIED: u8 = 3;
pub const STATUS_SETTLED: u8 = 4;
pub const STATUS_CANCELLED: u8 = 5;

const IX_CREATE: u8 = 1;
const IX_SUBMIT: u8 = 2;
const IX_VERIFY: u8 = 3;
const IX_SETTLE: u8 = 4;
const IX_CANCEL: u8 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EscrowError {
    Malformed = 200,
    BadPda = 201,
    BadStatus = 202,
    AmountOutOfRange = 203,
    CriteriaLength = 204,
    SubmissionLength = 205,
    NotCreator = 206,
    VerificationFailed = 207,
    AlreadySettled = 208,
    VaultMismatch = 209,
    DelivererMismatch = 210,
    AccountOwner = 211,
    Arithmetic = 212,
}

impl From<EscrowError> for ProgramError {
    fn from(e: EscrowError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if program_id != &id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (disc, rest) = instruction_data.split_first().ok_or(EscrowError::Malformed)?;
    match *disc {
        IX_CREATE => create(program_id, accounts, rest),
        IX_SUBMIT => submit(program_id, accounts, rest),
        IX_VERIFY => verify(program_id, accounts),
        IX_SETTLE => settle(program_id, accounts),
        IX_CANCEL => cancel(program_id, accounts),
        _ => Err(EscrowError::Malformed.into()),
    }
}

fn create(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 8 + 8 + 32 + 2 {
        return Err(EscrowError::Malformed.into());
    }
    let nonce = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let amount = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let mut expected = [0u8; 32];
    expected.copy_from_slice(&data[16..48]);
    let criteria_len = u16::from_le_bytes(data[48..50].try_into().unwrap()) as usize;
    let criteria = &data[50..];
    if criteria.len() != criteria_len || criteria_len == 0 || criteria_len > CRITERIA_MAX {
        return Err(EscrowError::CriteriaLength.into());
    }
    if amount < MIN_LAMPORTS || amount > MAX_LAMPORTS {
        return Err(EscrowError::AmountOutOfRange.into());
    }

    let iter = &mut accounts.iter();
    let creator = next_account_info(iter)?;
    let intent = next_account_info(iter)?;
    let vault = next_account_info(iter)?;
    let registry = next_account_info(iter)?;
    let system = next_account_info(iter)?;

    if !creator.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if *system.key != solana_program::system_program::ID {
        return Err(EscrowError::Malformed.into());
    }

    let nonce_le = nonce.to_le_bytes();
    let (intent_pda, intent_bump) =
        Pubkey::find_program_address(&[b"intent", creator.key.as_ref(), &nonce_le], program_id);
    if *intent.key != intent_pda {
        return Err(EscrowError::BadPda.into());
    }
    let (vault_pda, vault_bump) =
        Pubkey::find_program_address(&[b"vault", intent.key.as_ref()], program_id);
    if *vault.key != vault_pda {
        return Err(EscrowError::BadPda.into());
    }
    let (registry_pda, registry_bump) = Pubkey::find_program_address(&[b"registry"], program_id);
    if *registry.key != registry_pda {
        return Err(EscrowError::BadPda.into());
    }
    if intent.lamports() > 0 || intent.data_len() > 0 {
        return Err(EscrowError::BadStatus.into());
    }

    let rent = Rent::get()?;
    let intent_rent = rent.minimum_balance(INTENT_LEN);
    let vault_rent = rent.minimum_balance(0);
    let vault_lamports = vault_rent.checked_add(amount).ok_or(EscrowError::Arithmetic)?;

    invoke_signed(
        &system_instruction::create_account(creator.key, intent.key, intent_rent, INTENT_LEN as u64, program_id),
        &[creator.clone(), intent.clone(), system.clone()],
        &[&[b"intent", creator.key.as_ref(), &nonce_le, &[intent_bump]]],
    )?;
    invoke_signed(
        &system_instruction::create_account(creator.key, vault.key, vault_lamports, 0, program_id),
        &[creator.clone(), vault.clone(), system.clone()],
        &[&[b"vault", intent.key.as_ref(), &[vault_bump]]],
    )?;

    if registry.data_len() == 0 {
        let registry_rent = rent.minimum_balance(REGISTRY_LEN);
        invoke_signed(
            &system_instruction::create_account(
                creator.key,
                registry.key,
                registry_rent,
                REGISTRY_LEN as u64,
                program_id,
            ),
            &[creator.clone(), registry.clone(), system.clone()],
            &[&[b"registry", &[registry_bump]]],
        )?;
    } else if registry.owner != program_id || registry.data_len() != REGISTRY_LEN {
        return Err(EscrowError::AccountOwner.into());
    }

    let criteria_hash = sha256(criteria).to_bytes();
    let slot = Clock::get()?.slot;
    {
        let mut raw = intent.data.borrow_mut();
        raw.fill(0);
        raw[0] = 1;
        raw[1] = intent_bump;
        raw[2] = STATUS_FUNDED;
        raw[3..35].copy_from_slice(creator.key.as_ref());
        raw[67] = vault_bump;
        raw[68..76].copy_from_slice(&amount.to_le_bytes());
        raw[76..108].copy_from_slice(&criteria_hash);
        raw[108..140].copy_from_slice(&expected);
        raw[204..206].copy_from_slice(&(criteria_len as u16).to_le_bytes());
        raw[206..206 + criteria_len].copy_from_slice(criteria);
        raw[616..624].copy_from_slice(&slot.to_le_bytes());
    }
    {
        let mut reg = registry.data.borrow_mut();
        if reg[0] != 1 {
            reg.fill(0);
            reg[0] = 1;
        }
        push_registry(&mut reg, intent.key);
    }
    msg!("intent created");
    Ok(())
}

fn submit(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 2 {
        return Err(EscrowError::Malformed.into());
    }
    let len = u16::from_le_bytes(data[0..2].try_into().unwrap()) as usize;
    let submission = &data[2..];
    if submission.len() != len || len == 0 || len > SUBMISSION_MAX {
        return Err(EscrowError::SubmissionLength.into());
    }
    let iter = &mut accounts.iter();
    let deliverer = next_account_info(iter)?;
    let intent = next_account_info(iter)?;
    if !deliverer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if intent.owner != program_id || intent.data_len() != INTENT_LEN {
        return Err(EscrowError::AccountOwner.into());
    }
    let mut raw = intent.data.borrow_mut();
    if raw[0] != 1 {
        return Err(EscrowError::BadStatus.into());
    }
    let status = raw[2];
    if status != STATUS_FUNDED && status != STATUS_DELIVERED {
        return Err(EscrowError::BadStatus.into());
    }
    let digest = sha256(submission).to_bytes();
    raw[2] = STATUS_DELIVERED;
    raw[35..67].copy_from_slice(deliverer.key.as_ref());
    raw[140..172].copy_from_slice(&digest);
    raw[172..204].fill(0);
    raw[486..488].copy_from_slice(&(len as u16).to_le_bytes());
    raw[488..488 + SUBMISSION_MAX].fill(0);
    raw[488..488 + len].copy_from_slice(submission);
    msg!("delivery submitted");
    Ok(())
}

fn verify(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let intent = next_account_info(iter)?;
    if intent.owner != program_id || intent.data_len() != INTENT_LEN {
        return Err(EscrowError::AccountOwner.into());
    }
    let mut raw = intent.data.borrow_mut();
    if raw[0] != 1 || raw[2] != STATUS_DELIVERED {
        return Err(EscrowError::BadStatus.into());
    }
    let sub_len = u16::from_le_bytes(raw[486..488].try_into().unwrap()) as usize;
    if sub_len == 0 || sub_len > SUBMISSION_MAX {
        return Err(EscrowError::SubmissionLength.into());
    }
    let actual = sha256(&raw[488..488 + sub_len]).to_bytes();
    let mut expected = [0u8; 32];
    expected.copy_from_slice(&raw[108..140]);
    let mut recorded = [0u8; 32];
    recorded.copy_from_slice(&raw[140..172]);
    if actual != expected || actual != recorded {
        msg!("verification failed");
        return Err(EscrowError::VerificationFailed.into());
    }
    let mut criteria_hash = [0u8; 32];
    criteria_hash.copy_from_slice(&raw[76..108]);
    let mut preimage = [0u8; 65];
    preimage[..32].copy_from_slice(&criteria_hash);
    preimage[32..64].copy_from_slice(&actual);
    preimage[64] = 1;
    let result = sha256(&preimage).to_bytes();
    raw[2] = STATUS_VERIFIED;
    raw[172..204].copy_from_slice(&result);
    msg!("verification passed");
    Ok(())
}

fn settle(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let intent = next_account_info(iter)?;
    let vault = next_account_info(iter)?;
    let deliverer = next_account_info(iter)?;
    if intent.owner != program_id || intent.data_len() != INTENT_LEN {
        return Err(EscrowError::AccountOwner.into());
    }
    if vault.owner != program_id {
        return Err(EscrowError::AccountOwner.into());
    }
    let (vault_pda, vault_bump_expected) =
        Pubkey::find_program_address(&[b"vault", intent.key.as_ref()], program_id);
    if *vault.key != vault_pda {
        return Err(EscrowError::VaultMismatch.into());
    }

    let (status, amount, stored_deliverer, stored_bump) = {
        let raw = intent.data.borrow();
        if raw[0] != 1 {
            return Err(EscrowError::BadStatus.into());
        }
        if raw[2] == STATUS_SETTLED {
            return Err(EscrowError::AlreadySettled.into());
        }
        if raw[2] != STATUS_VERIFIED {
            return Err(EscrowError::BadStatus.into());
        }
        let mut who = [0u8; 32];
        who.copy_from_slice(&raw[35..67]);
        let amount = u64::from_le_bytes(raw[68..76].try_into().unwrap());
        (raw[2], amount, who, raw[67])
    };
    let _ = status;
    if stored_bump != vault_bump_expected || stored_deliverer != deliverer.key.to_bytes() {
        return Err(EscrowError::DelivererMismatch.into());
    }
    let rent = Rent::get()?.minimum_balance(0);
    let after = vault.lamports().checked_sub(amount).ok_or(EscrowError::Arithmetic)?;
    if after < rent {
        return Err(EscrowError::Arithmetic.into());
    }
    move_lamports(vault, deliverer, amount)?;
    let slot = Clock::get()?.slot;
    {
        let mut raw = intent.data.borrow_mut();
        raw[2] = STATUS_SETTLED;
        raw[624..632].copy_from_slice(&slot.to_le_bytes());
    }
    msg!("settled once");
    Ok(())
}

fn cancel(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let creator = next_account_info(iter)?;
    let intent = next_account_info(iter)?;
    let vault = next_account_info(iter)?;
    if !creator.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if intent.owner != program_id || intent.data_len() != INTENT_LEN || vault.owner != program_id {
        return Err(EscrowError::AccountOwner.into());
    }
    let (vault_pda, vault_bump_expected) =
        Pubkey::find_program_address(&[b"vault", intent.key.as_ref()], program_id);
    if *vault.key != vault_pda {
        return Err(EscrowError::VaultMismatch.into());
    }
    let amount = {
        let raw = intent.data.borrow();
        if raw[0] != 1 {
            return Err(EscrowError::BadStatus.into());
        }
        if raw[3..35] != creator.key.to_bytes() {
            return Err(EscrowError::NotCreator.into());
        }
        if raw[67] != vault_bump_expected {
            return Err(EscrowError::VaultMismatch.into());
        }
        match raw[2] {
            STATUS_FUNDED | STATUS_DELIVERED => {}
            STATUS_SETTLED => return Err(EscrowError::AlreadySettled.into()),
            _ => return Err(EscrowError::BadStatus.into()),
        }
        u64::from_le_bytes(raw[68..76].try_into().unwrap())
    };
    let rent = Rent::get()?.minimum_balance(0);
    let after = vault.lamports().checked_sub(amount).ok_or(EscrowError::Arithmetic)?;
    if after < rent {
        return Err(EscrowError::Arithmetic.into());
    }
    move_lamports(vault, creator, amount)?;
    let slot = Clock::get()?.slot;
    {
        let mut raw = intent.data.borrow_mut();
        raw[2] = STATUS_CANCELLED;
        raw[624..632].copy_from_slice(&slot.to_le_bytes());
    }
    msg!("escrow returned to creator");
    Ok(())
}

fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> ProgramResult {
    let mut src = from.try_borrow_mut_lamports()?;
    let mut dst = to.try_borrow_mut_lamports()?;
    let next_src = (**src).checked_sub(amount).ok_or(EscrowError::Arithmetic)?;
    let next_dst = (**dst).checked_add(amount).ok_or(EscrowError::Arithmetic)?;
    **src = next_src;
    **dst = next_dst;
    Ok(())
}

fn push_registry(data: &mut [u8], intent: &Pubkey) {
    let count = data[1] as usize;
    if count < REGISTRY_CAP {
        let start = 2 + count * 32;
        data[start..start + 32].copy_from_slice(intent.as_ref());
        data[1] = (count + 1) as u8;
    } else {
        data.copy_within(2 + 32..2 + REGISTRY_CAP * 32, 2);
        let start = 2 + (REGISTRY_CAP - 1) * 32;
        data[start..start + 32].copy_from_slice(intent.as_ref());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_sizes_match_the_documented_offsets() {
        assert_eq!(206 + CRITERIA_MAX, 486);
        assert_eq!(488 + SUBMISSION_MAX, 616);
        assert_eq!(624 + 8, INTENT_LEN);
        assert_eq!(2 + REGISTRY_CAP * 32, REGISTRY_LEN);
    }

    #[test]
    fn verification_preimage_is_65_bytes() {
        let criteria = sha256(b"done means the digits 42").to_bytes();
        let submission = sha256(b"42").to_bytes();
        let mut preimage = [0u8; 65];
        preimage[..32].copy_from_slice(&criteria);
        preimage[32..64].copy_from_slice(&submission);
        preimage[64] = 1;
        assert_eq!(sha256(&preimage).to_bytes().len(), 32);
        assert_ne!(sha256(b"42").to_bytes(), sha256(b"41").to_bytes());
    }
}
