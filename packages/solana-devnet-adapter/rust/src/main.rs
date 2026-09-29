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

/// PDA-CONFORMANCE-ERRATA-1 closer: the authoritative on-curve predicate is
/// curve25519-dalek's CompressedEdwardsY::decompress() — the exact library the
/// Solana validator runtime (agave → solana-program → create_program_address)
/// uses. This is the runtime semantics, not another hand-rolled opinion.
fn is_on_curve_dalek(bytes: &[u8]) -> bool {
    use curve25519_dalek::edwards::CompressedEdwardsY;
    match CompressedEdwardsY::from_slice(bytes) {
        Ok(compressed) => compressed.decompress().is_some(),
        Err(_) => false,
    }
}

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

fn find_program_address(seeds: &[Vec<u8>], program_id: &[u8], curve_check: fn(&[u8]) -> bool) -> (Vec<u8>, u8) {
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
        if !curve_check(&candidate) {
            return (candidate.to_vec(), bump);
        }
    }
    panic!("no PDA found");
}

// ————————————————— main —————————————————

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 3 && args[1] == "--curve-corpus" {
        // PDA-CONFORMANCE corpus mode: for N deterministic digests, our custom
        // num-bigint predicate MUST agree with curve25519-dalek exactly.
        let n: usize = args[2].parse().expect("corpus size");
        let mut mismatches = 0usize;
        for i in 0..n {
            let mut h = Sha256::new();
            h.update([0x51; 1]);
            h.update(i.to_le_bytes());
            h.update(b"intent-protocol/testnet-r1/curve-conformance");
            let digest = h.finalize();
            let custom = is_on_curve(&digest);
            let dalek = is_on_curve_dalek(&digest);
            if custom != dalek {
                mismatches += 1;
                eprintln!("MISMATCH idx={} custom={} dalek={} digest={:02x?}", i, custom, dalek, digest);
            }
        }
        println!("{{\"corpus\":{},\"mismatches\":{}}}", n, mismatches);
        std::process::exit(if mismatches == 0 { 0 } else { 1 });
    }
    if args.len() == 5 && args[1] == "--pda-dalek" {
        // derive the PDA with the DALEK predicate (validator semantics) and
        // also with the custom predicate; both must agree and match the
        // committed golden vectors.
        let escrow_ref = &args[2];
        let receipt = &args[3];
        let program_id_b58 = &args[4];
        let raw = receipt_raw32(receipt);
        let mut h = Sha256::new();
        h.update(b"intent-protocol/testnet-r1/economic-release");
        h.update([0x00]);
        h.update(escrow_ref.as_bytes());
        h.update([0x00]);
        h.update(raw);
        let digest = h.finalize();
        let program_id = base58_decode(program_id_b58);
        let seeds: Vec<Vec<u8>> = vec![b"release".to_vec(), digest.to_vec()];
        let (custom_addr, custom_bump) = find_program_address(&seeds, &program_id, is_on_curve);
        let (dalek_addr, dalek_bump) = find_program_address(&seeds, &program_id, is_on_curve_dalek);
        println!(
            "{{\"custom\":{{\"pda\":\"{}\",\"bump\":{}}},\"dalek\":{{\"pda\":\"{}\",\"bump\":{}}},\"digest\":\"{}\",\"agree\":{}}}",
            base58_encode(&custom_addr), custom_bump,
            base58_encode(&dalek_addr), dalek_bump,
            hex::encode_to_string(&digest),
            custom_addr == dalek_addr && custom_bump == dalek_bump
        );
        return;
    }
    if args.len() != 4 {
        eprintln!("usage: {} <escrow_ref> <outcome_receipt_hash> <program_id_base58>", args[0]);
        eprintln!("       {} --curve-corpus <N>", args[0]);
        eprintln!("       {} --pda-dalek <escrow_ref> <outcome_receipt_hash> <program_id_base58>", args[0]);
        std::process::exit(2);
    }
    let escrow_ref = &args[1];
    let receipt = &args[2];
    let program_id_b58 = &args[3];

    let raw = receipt_raw32(receipt);

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
    let (address, bump) = find_program_address(&seeds, &program_id, is_on_curve);

    println!(
        "{{\"economic_release_digest\":\"{}\",\"release_pda\":\"{}\",\"bump\":{}}}",
        hex::encode_to_string(&digest),
        base58_encode(&address),
        bump
    );
}

fn receipt_raw32(receipt: &str) -> [u8; 32] {
    assert!(receipt.starts_with("sha256:") && receipt.len() == 7 + 64, "malformed receipt hash");
    let mut raw = [0u8; 32];
    for i in 0..32 {
        let hex_pair = &receipt[7 + i * 2..7 + i * 2 + 2];
        raw[i] = u8::from_str_radix(hex_pair, 16).expect("invalid hex in receipt hash");
    }
    raw
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
