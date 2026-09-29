/**
 * Release PDA derivation — frozen (TESTNET-R1.md §6):
 *
 *   release PDA = findProgramAddress(
 *       [ UTF8("release"), EconomicReleaseDigest[0..32] ],
 *       TESTNET_R1_PROGRAM_ID )
 *
 * Solana PDA semantics implemented directly (no SDK dependency): the address
 * candidate is SHA256(seeds… ‖ programId ‖ "ProgramDerivedAddress" ‖ [bump])
 * scanned bump 255→1 until the candidate is NOT a valid ed25519 curve point.
 * The on-curve check is ed25519 point decompression: interpret the 32 bytes
 * as a little-endian y coordinate (bit 255 = x sign), then
 * x² = (y²−1)/(d·y²+1) must have a solution in GF(2^255−19).
 */
import { createHash } from "node:crypto";
import { economicReleaseDigest } from "./digest.ts";

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58_ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) s = "1" + s;
    else break;
  }
  return s;
}

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const ch of s) {
    const v = B58_ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`invalid base58 character: ${ch}`);
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const ch of s) {
    if (ch === "1") bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

// ————————————— ed25519 on-curve check (pure BigInt field arithmetic) —————————————

const P = 2n ** 255n - 19n;
/** d = -121665/121666 mod p (Edwards curve constant). */
const D = ((): bigint => {
  const num = P - 121665n % P;
  let inv = 121666n;
  // Fermat inverse: a^(p-2) mod p
  let result = 1n;
  let base = inv % P;
  let exp = P - 2n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % P;
    base = (base * base) % P;
    exp >>= 1n;
  }
  inv = result;
  return (num * inv) % P;
})();

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let b = base % mod;
  let e = exp;
  let r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return r;
}

/**
 * True iff the 32 bytes decompress to a point on the ed25519 curve
 * (curve25519-dalek decompress semantics: sign bit masked, y reduced mod p).
 */
export function isOnEd25519Curve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) throw new Error("on-curve check needs exactly 32 bytes");
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]!); // little-endian
  y &= (1n << 255n) - 1n; // clear the x-sign bit
  y %= P; // dalek from_bytes semantics: accept and reduce
  const yy = (y * y) % P;
  const u = (yy - 1n + P) % P;
  const v = (D * yy + 1n) % P;
  if (v === 0n) return u === 0n;
  const x2 = (u * modPow(v, P - 2n, P)) % P;
  if (x2 === 0n) return true;
  // quadratic residue ⇔ x exists
  return modPow(x2, (P - 1n) / 2n, P) === 1n;
}

// ————————————— findProgramAddress —————————————

const PDA_MARKER = "ProgramDerivedAddress";

export function findProgramAddress(seeds: Uint8Array[], programId: Uint8Array): { address: Uint8Array; bump: number } {
  if (programId.length !== 32) throw new Error("program id must be 32 bytes");
  for (const s of seeds) {
    if (s.length > 32) throw new Error("PDA seed too long (max 32 bytes)");
  }
  for (let bump = 255; bump >= 1; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(programId);
    h.update(Buffer.from(PDA_MARKER, "utf8"));
    h.update(Buffer.from([bump]));
    const candidate = new Uint8Array(h.digest());
    if (!isOnEd25519Curve(candidate)) return { address: candidate, bump };
  }
  throw new Error("no PDA found for the given seeds/program");
}

/** Frozen release-PDA seeds: [UTF8("release"), EconomicReleaseDigest]. */
export function releasePda(
  escrowRef: string,
  outcomeReceiptHash: string,
  programId: string,
): { digest: Uint8Array; digestHex: string; pda: string; bump: number } {
  const digest = economicReleaseDigest(escrowRef, outcomeReceiptHash);
  const pid = base58Decode(programId);
  if (pid.length !== 32) throw new Error(`program id must decode to 32 bytes, got ${pid.length}`);
  const { address, bump } = findProgramAddress([Buffer.from("release", "utf8"), digest], pid);
  return {
    digest,
    digestHex: Buffer.from(digest).toString("hex"),
    pda: base58Encode(address),
    bump,
  };
}
