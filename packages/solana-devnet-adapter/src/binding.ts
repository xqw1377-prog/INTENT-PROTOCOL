/**
 * ClaimantPayoutBindingV1 — the claimant→address authority binding
 * (TESTNET-R1.md §7.1). Adapter-local record: NOT a G1 object, GP4/GP5
 * untouched.
 *
 * Invariant: ClaimRecord.claimant → exactly ONE frozen payout binding →
 * exactly ONE Solana destination (wallet_pubkey + token_account). Caller
 * cannot override; adapter cannot discover or choose the recipient.
 *
 * binding_hash (frozen formula, hashObject framing):
 *   SHA256( UTF8("intent-protocol/testnet-r1/claimant-payout-binding")
 *           || 0x00
 *           || UTF8("claimant-payout-binding.v1")
 *           || 0x00
 *           || canonical_json(body_without_binding_hash) )
 * canonical_json: object keys sorted lexicographically, JSON string form,
 * no insignificant whitespace.
 */
import { createHash } from "node:crypto";

export const BINDING_DOMAIN = "intent-protocol/testnet-r1/claimant-payout-binding";
export const BINDING_SCHEMA_VERSION = "claimant-payout-binding.v1";

export interface ClaimantPayoutBindingV1 {
  schema_version: typeof BINDING_SCHEMA_VERSION;
  claim_id: string;
  claimant: string;
  network: string; // "solana-devnet"
  wallet_pubkey: string;
  token_account: string; // ATA
  mint: string;
  bound_at: string; // ISO timestamp
  binding_hash: string; // sha256:<64 hex>
}

/** Minimal canonical JSON: lexicographically sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(canon);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canon((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(canon(value));
}

export function bindingHash(body: Omit<ClaimantPayoutBindingV1, "binding_hash">): string {
  const h = createHash("sha256");
  h.update(Buffer.from(BINDING_DOMAIN, "utf8"));
  h.update(Buffer.from([0x00]));
  h.update(Buffer.from(BINDING_SCHEMA_VERSION, "utf8"));
  h.update(Buffer.from([0x00]));
  h.update(Buffer.from(canonicalJson(body), "utf8"));
  return "sha256:" + h.digest("hex");
}

export function sealBinding(body: Omit<ClaimantPayoutBindingV1, "binding_hash">): ClaimantPayoutBindingV1 {
  return { ...body, binding_hash: bindingHash(body) };
}

export function verifyBinding(binding: ClaimantPayoutBindingV1): boolean {
  const { binding_hash, ...body } = binding;
  return bindingHash(body) === binding_hash;
}
