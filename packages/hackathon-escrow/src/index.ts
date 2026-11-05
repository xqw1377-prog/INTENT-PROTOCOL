/**
 * Byte layout shared with packages/hackathon-escrow/program/src/lib.rs.
 * This module does not talk to the network and has no Node-only imports,
 * so the browser demo can bundle it.
 */

export const PROGRAM_ID = "7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F";

/** Devnet genesis, from the frozen TESTNET-R1 materialization record. */
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export const DEVNET_RPC = "https://api.devnet.solana.com";

export const INTENT_LEN = 632;
export const REGISTRY_LEN = 2 + 32 * 32;
export const REGISTRY_CAP = 32;
export const CRITERIA_MAX = 280;
export const SUBMISSION_MAX = 128;
export const MIN_LAMPORTS = 10_000_000n;
export const MAX_LAMPORTS = 500_000_000n;
export const SAMPLE_LAMPORTS = 50_000_000n;

export const IX_CREATE = 1;
export const IX_SUBMIT = 2;
export const IX_VERIFY = 3;
export const IX_SETTLE = 4;
export const IX_CANCEL = 5;

export const STATUS_FUNDED = 1;
export const STATUS_DELIVERED = 2;
export const STATUS_VERIFIED = 3;
export const STATUS_SETTLED = 4;
export const STATUS_CANCELLED = 5;

export const SEED_INTENT = new TextEncoder().encode("intent");
export const SEED_VAULT = new TextEncoder().encode("vault");
export const SEED_REGISTRY = new TextEncoder().encode("registry");

export const ERROR_TEXT: Record<number, string> = {
  200: "The transaction data is malformed.",
  201: "The account address does not match the program's derived address.",
  202: "That action is not available in the current state.",
  203: "The escrow amount must be between 0.01 and 0.5 SOL.",
  204: "The done-criteria text must be 1 to 280 bytes.",
  205: "The submission must be 1 to 128 bytes.",
  206: "Only the creator can cancel this intent.",
  207: "Not earned. The submission does not match the frozen done-criteria. The escrow stays locked.",
  208: "This reward was already settled once.",
  209: "The vault account does not belong to this intent.",
  210: "The payout address is not the deliverer who submitted.",
  211: "An account is not owned by this program.",
  212: "An amount overflowed.",
};

export const SAMPLE_CRITERIA =
  "Freelance bounty from Northwind Coffee: one homepage headline. Done means the submission is exactly the headline agreed before the work, and nothing else.";
export const SAMPLE_ANSWER = "Northwind Coffee: order ahead, skip the line.";
export const SAMPLE_WRONG = "Northwind Coffee: order ahead.";

const textEncoder = new TextEncoder();

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256. Matches Solana's `solana_program::hash::hash` (FIPS 180-4). */
export function sha256(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const padLen = (withOne % 64 <= 56 ? 56 - (withOne % 64) : 56 + 64 - (withOne % 64));
  const buf = new Uint8Array(withOne + padLen + 8);
  buf.set(bytes, 0);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(buf.length - 4, bitLen >>> 0, false);
  view.setUint32(buf.length - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < buf.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, i) => outView.setUint32(i * 4, word, false));
  return out;
}

export function hashUtf8(text: string): Uint8Array {
  return sha256(textEncoder.encode(text));
}

/** sha256(criteria_hash || submission_hash || 0x01). Matches the program. */
export function verificationResultHash(criteriaHash: Uint8Array, submissionHash: Uint8Array): Uint8Array {
  if (criteriaHash.length !== 32 || submissionHash.length !== 32) {
    throw new Error("hashes must be 32 bytes");
  }
  const preimage = new Uint8Array(65);
  preimage.set(criteriaHash, 0);
  preimage.set(submissionHash, 32);
  preimage[64] = 1;
  return sha256(preimage);
}

function u64le(n: bigint): Uint8Array {
  if (n < 0n || n > 0xffff_ffff_ffff_ffffn) throw new Error("u64 out of range");
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, true);
  return out;
}

function u16le(n: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, n, true);
  return out;
}

export function encodeCreate(args: { nonce: bigint; lamports: bigint; expectedHash: Uint8Array; criteria: string }): Uint8Array {
  const criteriaBytes = textEncoder.encode(args.criteria);
  if (criteriaBytes.length === 0 || criteriaBytes.length > CRITERIA_MAX) {
    throw new Error(`criteria must be 1..${CRITERIA_MAX} bytes`);
  }
  if (args.expectedHash.length !== 32) throw new Error("expected hash must be 32 bytes");
  const out = new Uint8Array(1 + 8 + 8 + 32 + 2 + criteriaBytes.length);
  out[0] = IX_CREATE;
  out.set(u64le(args.nonce), 1);
  out.set(u64le(args.lamports), 9);
  out.set(args.expectedHash, 17);
  out.set(u16le(criteriaBytes.length), 49);
  out.set(criteriaBytes, 51);
  return out;
}

export function encodeSubmit(submission: string): Uint8Array {
  const bytes = textEncoder.encode(submission);
  if (bytes.length === 0 || bytes.length > SUBMISSION_MAX) {
    throw new Error(`submission must be 1..${SUBMISSION_MAX} bytes`);
  }
  const out = new Uint8Array(1 + 2 + bytes.length);
  out[0] = IX_SUBMIT;
  out.set(u16le(bytes.length), 1);
  out.set(bytes, 3);
  return out;
}

export function encodeVerify(): Uint8Array {
  return new Uint8Array([IX_VERIFY]);
}

export function encodeSettle(): Uint8Array {
  return new Uint8Array([IX_SETTLE]);
}

export function encodeCancel(): Uint8Array {
  return new Uint8Array([IX_CANCEL]);
}

export interface DecodedIntent {
  status: number;
  creator: Uint8Array;
  deliverer: Uint8Array;
  amount: bigint;
  criteriaHash: Uint8Array;
  expectedSubmissionHash: Uint8Array;
  submissionHash: Uint8Array;
  verificationResultHash: Uint8Array;
  criteria: string;
  submission: string;
  createdSlot: bigint;
  closedSlot: bigint;
}

function readU64(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(offset, true);
}

function readU16(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint16(offset, true);
}

export function decodeIntent(data: Uint8Array): DecodedIntent | null {
  if (data.length < INTENT_LEN || data[0] !== 1) return null;
  const criteriaLen = readU16(data, 204);
  const submissionLen = readU16(data, 486);
  if (criteriaLen > CRITERIA_MAX || submissionLen > SUBMISSION_MAX) return null;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return {
    status: data[2] ?? 0,
    creator: data.slice(3, 35),
    deliverer: data.slice(35, 67),
    amount: readU64(data, 68),
    criteriaHash: data.slice(76, 108),
    expectedSubmissionHash: data.slice(108, 140),
    submissionHash: data.slice(140, 172),
    verificationResultHash: data.slice(172, 204),
    criteria: decoder.decode(data.slice(206, 206 + criteriaLen)),
    submission: decoder.decode(data.slice(488, 488 + submissionLen)),
    createdSlot: readU64(data, 616),
    closedSlot: readU64(data, 624),
  };
}

export function decodeRegistry(data: Uint8Array): Uint8Array[] {
  if (data.length < REGISTRY_LEN || data[0] !== 1) return [];
  const count = Math.min(data[1] ?? 0, REGISTRY_CAP);
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const start = 2 + i * 32;
    out.push(data.slice(start, start + 32));
  }
  return out;
}

export function statusLabel(status: number): string {
  switch (status) {
    case STATUS_FUNDED:
      return "Funded";
    case STATUS_DELIVERED:
      return "Delivered";
    case STATUS_VERIFIED:
      return "Verified";
    case STATUS_SETTLED:
      return "Settled";
    case STATUS_CANCELLED:
      return "Cancelled";
    default:
      return "Unknown";
  }
}

export function isZeroKey(key: Uint8Array): boolean {
  return key.every((b) => b === 0);
}
