//! TESTNET-R1 T1 Rust golden-vector generator.
//!
//! Implements the frozen formulas independently from the JS side
//! (docs/TESTNET-R1.md §6):
//!
//!   EconomicReleaseDigest = SHA256(
//!       UTF8("intent-protocol/testnet-r1/economic-release") || 0x00
//!       || UTF8(escrow_ref) || 0x00 || outcome_receipt_hash_raw32 )
//!
//!   release PDA = findProgramAddress(
//!       [UTF8("release"), digest], program_id )
//!
//! Official Solana PDA semantics (T1-R1 fix): the bump is appended as the
//! FINAL SEED, then the hash preimage is
//!   seed1 || ... || seedN || bump || program_id || "ProgramDerivedAddress"
//! and bump scans 255→1 until the digest is off the ed25519 curve.
//!
//! Usage: t1-golden-vectors <escrow_ref> <outcome_receipt_hash> <program_id_base58>
//! Prints one JSON line: {"economic_release_digest":..,"release_pda":..,"bump":..}

use num_bigint::BigInt;
use sha2::{Digest, Sha256};
use std::str::FromStr;

const PDA_MARKER: &[u8] = b"ProgramDerivedAddress";

// ————————————————— base58 —————————————————

const B58_ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

fn base58_decode(s: &str) -> Vec<u8> {
    let mut n = BigInt::from(0);
    for ch in s.bytes() {
        let v = B58_ALPHABET.iter().position(|&a| a == ch).expect("invalid base58 char") as u32;
        n = n * 58 + v;
    }
    let mut bytes: Vec<u8> = Vec::new();
    let mut cur = n;
    let zero = BigInt::from(0);
    let base = BigInt::from(256);
    while cur > zero {
        let rem = &cur % &base;
        let digits = rem.to_u64_digits(); // (Sign, limbs); limbs EMPTY when rem == 0
        let limb = if digits.1.is_empty() { 0u64 } else { digits.1[0] };
        bytes.push(limb as u8);
        cur = &cur / &base;
    }
    bytes.reverse();
    for ch in s.bytes() {
        if ch == b'1' {
            bytes.insert(0, 0);
        } else {
            break;
        }
    }
    bytes
}

fn base58_encode(bytes: &[u8]) -> String {
    let mut n = BigInt::from(0);
    for &b in bytes {
        n = n * 256 + b;
    }
    let mut s: Vec<u8> = Vec::new();
    let zero = BigInt::from(0);
    let base = BigInt::from(58);
    let mut cur = n;
    while cur > zero {
        let rem = &cur % &base;
        let digits = rem.to_u64_digits(); // (Sign, limbs); limbs EMPTY when rem == 0
        let limb = if digits.1.is_empty() { 0u64 } else { digits.1[0] };
        s.push(B58_ALPHABET[limb as usize]);
        cur = &cur / &base;
    }
    s.reverse();
    let mut out = String::new();
    for &b in bytes {
        if b == 0 {
            out.push('1');
        } else {
            break;
        }
    }
    out.push_str(&String::from_utf8(s).unwrap());
    out
}

// ————————————————— ed25519 on-curve —————————————————

fn p() -> BigInt {
    BigInt::from_str("57896044618658097711785492504343953926634992332820282019728792003956564819949").unwrap()
}

fn d_const() -> BigInt {
    let p = p();
    let num = &p - 121665u32;
    let den_inv = mod_pow(&BigInt::from(121666u32), &(&p - 2u32), &p);
    (num * den_inv) % p
}

fn mod_pow(base: &BigInt, exp: &BigInt, m: &BigInt) -> BigInt {
    base.modpow(exp, m)
}

/// curve25519-dalek decompress semantics: mask the sign bit, reduce y mod p,
/// then x^2 = (y^2-1)/(d y^2+1) must have a root.
fn is_on_curve(bytes: &[u8]) -> bool {
    assert_eq!(bytes.len(), 32);
    let p = p();
    let mut y = BigInt::from(0);
    for &b in bytes.iter().rev() {
        y = (y << 8) | BigInt::from(b);
    }
    // clear bit 255
    let mask = (BigInt::from(1) << 255u32) - 1u32;
    y &= mask;
    y %= p.clone();
    let yy = (&y * &y) % p.clone();
    let u = (&yy - 1u32) % p.clone();
    let v = (d_const() * &yy + 1u32) % p.clone();
    if v == BigInt::from(0) {
        return u == BigInt::from(0);
    }
    let vinv = mod_pow(&v, &(&p - 2u32), &p);
    let x2 = (u * vinv) % p.clone();
    if x2 == BigInt::from(0) {
        return true;
    }
    // Legendre symbol: x2^((p-1)/2) == 1 => quadratic residue
    let exp = (&p - 1u32) / 2u32;
    mod_pow(&x2, &exp, &p) == BigInt::from(1)
}

fn find_program_address(seeds: &[Vec<u8>], program_id: &[u8]) -> (Vec<u8>, u8) {
    assert_eq!(program_id.len(), 32);
    for bump in (1..=255u8).rev() {
        let mut h = Sha256::new();
        for s in seeds {
            h.update(s);
        }
        h.update([bump]); // bump is the FINAL SEED (official semantics)
        h.update(program_id);
        h.update(PDA_MARKER);
        let candidate = h.finalize();
        if !is_on_curve(&candidate) {
            return (candidate.to_vec(), bump);
        }
    }
    panic!("no PDA found");
}

// ————————————————— main —————————————————

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: {} <escrow_ref> <outcome_receipt_hash> <program_id_base58>", args[0]);
        std::process::exit(2);
    }
    let escrow_ref = &args[1];
    let receipt = &args[2];
    let program_id_b58 = &args[3];

    // receipt: sha256:<64 lowercase hex> -> raw 32 bytes
    assert!(receipt.starts_with("sha256:") && receipt.len() == 7 + 64, "malformed receipt hash");
    let mut raw = [0u8; 32];
    for i in 0..32 {
        let hex_pair = &receipt[7 + i * 2..7 + i * 2 + 2];
        raw[i] = u8::from_str_radix(hex_pair, 16).expect("invalid hex in receipt hash");
    }

    // EconomicReleaseDigest
    let mut h = Sha256::new();
    h.update(b"intent-protocol/testnet-r1/economic-release");
    h.update([0x00]);
    h.update(escrow_ref.as_bytes());
    h.update([0x00]);
    h.update(raw);
    let digest = h.finalize();

    // release PDA
    let program_id = base58_decode(program_id_b58);
    assert_eq!(program_id.len(), 32, "program id must decode to 32 bytes");
    let seeds: Vec<Vec<u8>> = vec![b"release".to_vec(), digest.to_vec()];
    let (address, bump) = find_program_address(&seeds, &program_id);

    println!(
        "{{\"economic_release_digest\":\"{}\",\"release_pda\":\"{}\",\"bump\":{}}}",
        hex::encode_to_string(&digest),
        base58_encode(&address),
        bump
    );
}

// tiny hex helper (no hex crate dependency)
mod hex {
    pub fn encode_to_string(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            s.push_str(&format!("{:02x}", b));
        }
        s
    }
}
