/**
 * EconomicReleaseDigest — frozen byte formula (TESTNET-R1.md §6):
 *
 *   EconomicReleaseDigest = SHA256(
 *       UTF8("intent-protocol/testnet-r1/economic-release")
 *       || 0x00
 *       || UTF8(escrow_ref)
 *       || 0x00
 *       || outcome_receipt_hash_raw32      // 32 raw digest bytes; the
 *   )                                     // "sha256:" prefix and the hex
 *                                         // STRING never participate
 *
 * Nonce, settlement_key, client id, and retry counters are excluded by
 * construction — they are not inputs to this function at all.
 */
import { createHash } from "node:crypto";

export const ECONOMIC_RELEASE_DOMAIN = "intent-protocol/testnet-r1/economic-release";

/** Extract the 32 raw digest bytes from a `sha256:<64 lowercase hex>` string. */
export function receiptHashRaw32(outcomeReceiptHash: string): Uint8Array {
  const m = /^sha256:([0-9a-f]{64})$/.exec(outcomeReceiptHash);
  if (!m) {
    throw new Error(`malformed outcome_receipt_hash (want sha256:<64 lowercase hex>): ${outcomeReceiptHash}`);
  }
  return new Uint8Array(Buffer.from(m[1]!, "hex"));
}

export function economicReleaseDigest(escrowRef: string, outcomeReceiptHash: string): Uint8Array {
  if (escrowRef.length === 0) throw new Error("escrow_ref must be non-empty");
  const h = createHash("sha256");
  h.update(Buffer.from(ECONOMIC_RELEASE_DOMAIN, "utf8"));
  h.update(Buffer.from([0x00]));
  h.update(Buffer.from(escrowRef, "utf8"));
  h.update(Buffer.from([0x00]));
  h.update(receiptHashRaw32(outcomeReceiptHash));
  return new Uint8Array(h.digest());
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
