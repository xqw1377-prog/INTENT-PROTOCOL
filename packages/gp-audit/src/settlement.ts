/**
 * Builder D independent implementation of the FROZEN settlement constructions
 * (docs/GOLDEN-PATH-V1.md @ 5e44297, §4 — which restates docs/TRUST-CHAIN.md
 * @ e28a22e byte-for-byte). Derived from the contract text only; imports
 * nothing from any builder implementation. node:crypto only.
 *
 *   settlement_key (instruction idempotency):
 *     SHA256("intent-protocol/v1/settlement-key" || 0x00
 *            || outcome_receipt_hash[32] || UTF8(escrow_ref) || 0x00
 *            || nonce_u64be[8])
 *
 *   economic release uniqueness key (exactly-once guard):
 *     (escrow_ref, outcome_receipt_hash)   — nonce deliberately NOT a component
 */
import { createHash } from "node:crypto";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const SEP = Uint8Array.from([0]);

function sha256(...chunks: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return new Uint8Array(h.digest());
}

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function hashBytes32(h: string): Uint8Array {
  if (!/^sha256:[0-9a-f]{64}$/.test(h)) throw new Error(`audit: malformed hash ${h}`);
  return Uint8Array.from(Buffer.from(h.slice(7), "hex"));
}

function u64be(n: bigint | number): Uint8Array {
  const v = BigInt(n);
  if (v < 0n || v > 0xffffffffffffffffn) throw new RangeError(`u64 out of range: ${n}`);
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(v, 0);
  return new Uint8Array(b);
}

export function settlementKey(p: { outcome_receipt_hash: string; escrow_ref: string; nonce: bigint | number }): string {
  return `sha256:${hex(
    sha256(
      utf8("intent-protocol/v1/settlement-key"),
      SEP,
      hashBytes32(p.outcome_receipt_hash),
      utf8(p.escrow_ref),
      SEP,
      u64be(p.nonce),
    ),
  )}`;
}

/** Economic exactly-once key (contract §4A): nonce-free by design. */
export function economicReleaseKey(p: { escrow_ref: string; outcome_receipt_hash: string }): string {
  return JSON.stringify([p.escrow_ref, p.outcome_receipt_hash]);
}

/**
 * Toy escrow models used ONLY to demonstrate, executably, why the contract's
 * two layers are both necessary (audit evidence GP0-E05/GP0-E06). Not a
 * production ledger.
 */
export interface ToyReleaseResult { released: boolean; alreadyReleased: boolean }

/** Layer B alone (settlement_key dedup only) — the contract's named vulnerability. */
export class KeyOnlyEscrow {
  private readonly seen = new Set<string>();
  release(k: { outcome_receipt_hash: string; escrow_ref: string; nonce: bigint | number }): ToyReleaseResult {
    const key = settlementKey(k);
    if (this.seen.has(key)) return { released: false, alreadyReleased: true };
    this.seen.add(key);
    return { released: true, alreadyReleased: false };
  }
}

/** Layers A+B (contract §4) — economic tuple guards across nonce changes. */
export class TwoLayerEscrow {
  private readonly economicSeen = new Set<string>();
  private readonly keySeen = new Set<string>();
  release(k: { outcome_receipt_hash: string; escrow_ref: string; nonce: bigint | number }): ToyReleaseResult {
    const econ = economicReleaseKey(k);
    if (this.economicSeen.has(econ)) return { released: false, alreadyReleased: true }; // §4A: different nonce still blocked
    const key = settlementKey(k);
    if (this.keySeen.has(key)) return { released: false, alreadyReleased: true }; // §4B: exact replay blocked
    this.economicSeen.add(econ);
    this.keySeen.add(key);
    return { released: true, alreadyReleased: false };
  }
}
