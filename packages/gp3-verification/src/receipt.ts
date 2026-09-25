/**
 * GP3 V3 receipt engine with Ed25519 signature verification.
 * Every decision must pass seal + signature verification before use.
 */
import { deriveUuid, proofBinding } from "./r9.js";
import { FIXED_CLOCK } from "./context.js";
import { verifyDecisionSignature } from "./keys.js";
import { OutcomeReceiptSchema, seal, VerificationDecisionSchema } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";

export type Rejection =
  | "not-two-decisions"
  | "verifier-roles-not-exact"
  | "seal-rejected"
  | "content-hash-mismatch"
  | "signature-invalid"
  | "policy-not-satisfied"
  | "binding-mismatch"
  | "binding-inputs-inconsistent"
  | "wrong-proof-binding";

export interface ReceiptOutcome { ok: boolean; reason?: Rejection; receipt?: Record<string, any>; receipt_hash?: string; }

const REQUIRED_ROLES = new Set(["verifier:gp3-functional", "verifier:gp3-policy"]);
const BINDING_KEYS = ["intent_hash", "milestone_id", "milestone_revision", "bundle_id", "evidence_root", "policy_hash"] as const;

export function formReceipt(rawDecisions: Array<Record<string, any>>, ctx: { binding: Record<string, unknown> }): ReceiptOutcome {
  if (rawDecisions.length !== 2) return { ok: false, reason: "not-two-decisions" };

  const sealed: Array<{ d: Record<string, any>; ch: string }> = [];
  for (const raw of rawDecisions) {
    const declaredHash = raw.content_hash !== undefined ? String(raw.content_hash) : undefined;
    const { content_hash: _s, ...body } = raw; void _s;
    let resealed: Record<string, any>;
    try { resealed = seal(VerificationDecisionSchema as never, body) as Record<string, any>; }
    catch { return { ok: false, reason: "seal-rejected" }; }
    if (declaredHash !== undefined && declaredHash !== String(resealed.content_hash)) return { ok: false, reason: "content-hash-mismatch" };
    // B1: verify Ed25519 signature against the frozen public-key registry
    const sig = (raw as any).signature;
    if (!sig || sig.scheme !== "ed25519" || !sig.value) return { ok: false, reason: "signature-invalid" };
    if (!verifyDecisionSignature(String(resealed.verifier_id), String(resealed.content_hash), String(sig.value))) {
      return { ok: false, reason: "signature-invalid" };
    }
    sealed.push({ d: resealed, ch: String(resealed.content_hash) });
  }

  const roles = new Set(sealed.map((s) => String(s.d.verifier_id)));
  if (roles.size !== 2 || ![...roles].every((r) => REQUIRED_ROLES.has(r))) return { ok: false, reason: "verifier-roles-not-exact" };

  const sa = sealed[0]!; const sb = sealed[1]!;
  const da = sa.d, cha = sa.ch, db = sb.d, chb = sb.ch;
  if (cha === chb) return { ok: false, reason: "content-hash-mismatch" };
  if (da.result !== "VALID" || db.result !== "VALID") return { ok: false, reason: "policy-not-satisfied" };
  for (const k of BINDING_KEYS) {
    if (da[k] !== db[k]) return { ok: false, reason: "binding-inputs-inconsistent" };
    if (String(da[k]) !== String(ctx.binding[k])) return { ok: false, reason: "binding-mismatch" };
  }
  const expected = proofBinding({ intent_hash: String(da.intent_hash), milestone_id: String(da.milestone_id), milestone_revision: Number(da.milestone_revision), bundle_id: String(da.bundle_id), evidence_root: String(da.evidence_root), policy_hash: String(da.policy_hash) });
  if (da.proof_binding !== expected || db.proof_binding !== expected) return { ok: false, reason: "wrong-proof-binding" };

  const sorted = [cha, chb].sort();
  const receipt = {
    schema_version: "outcome-receipt.v1",
    receipt_id: deriveUuid(`gp3:v3:receipt:${da.bundle_id}:${expected}`),
    intent_hash: da.intent_hash as Hash,
    milestone_id: String(da.milestone_id),
    milestone_revision: Number(da.milestone_revision),
    evidence_root: da.evidence_root as Hash,
    verification_policy_hash: da.policy_hash as Hash,
    decision_hashes: sorted as Hash[],
    accepted_result: "ACCEPTED",
    issued_at: FIXED_CLOCK.issuedAt,
  };
  const sealedReceipt = seal(OutcomeReceiptSchema as never, receipt) as Record<string, any>;
  return { ok: true, receipt: sealedReceipt, receipt_hash: String(sealedReceipt.content_hash) };
}
