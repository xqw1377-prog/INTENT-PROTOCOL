/**
 * GP3 V2 receipt engine (Issue #32 §6/§7 + Commander GP3-R1 review):
 *
 * KEY CHANGES FROM V1:
 *  1. Every decision input is RE-SEALED via seal(VerificationDecisionSchema, d)
 *     before ANY field is read — schema parse, proof_binding superRefine,
 *     content_hash recomputation, declared-hash mismatch check. The engine
 *     never trusts caller-supplied content_hash.
 *  2. Verifier roles are EXACTLY {verifier:gp3-functional, verifier:gp3-policy}.
 *     No unknown verifier, no two functional, no missing policy.
 */
import { deriveUuid, proofBinding } from "./r9.js";
import { FIXED_CLOCK } from "./context.js";
import { OutcomeReceiptSchema, seal, VerificationDecisionSchema } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";

export type Rejection =
  | "not-two-decisions"
  | "verifier-roles-not-exact"
  | "seal-rejected"
  | "content-hash-mismatch"
  | "policy-not-satisfied"
  | "binding-mismatch"
  | "binding-inputs-inconsistent"
  | "wrong-proof-binding";

export interface ReceiptOutcome {
  ok: boolean;
  reason?: Rejection;
  receipt?: Record<string, any>;
  receipt_hash?: string;
}

const REQUIRED_VERIFIER_ROLES = new Set(["verifier:gp3-functional", "verifier:gp3-policy"]);
const BINDING_KEYS = ["intent_hash", "milestone_id", "milestone_revision", "bundle_id", "evidence_root", "policy_hash"] as const;

export interface ReceiptContext {
  binding: Record<string, unknown>;
}

export function formReceipt(
  rawDecisions: Array<Record<string, any>>,
  ctx: ReceiptContext,
): ReceiptOutcome {
  if (rawDecisions.length !== 2) return { ok: false, reason: "not-two-decisions" };

  // HARD GATE: re-seal every decision — schema parse + proof_binding superRefine +
  // content_hash recomputation. If the declared hash mismatches the resealed
  // hash, reject. The engine uses ONLY the resealed fields from this point.
  const sealed: Array<{ d: Record<string, any>; ch: string }> = [];
  for (const raw of rawDecisions) {
    const declaredHash = raw.content_hash !== undefined ? String(raw.content_hash) : undefined;
    const { content_hash: _stripped, ...body } = raw;
    void _stripped;
    let resealed: Record<string, any>;
    try {
      resealed = seal(VerificationDecisionSchema as never, body) as Record<string, any>;
    } catch {
      return { ok: false, reason: "seal-rejected" };
    }
    if (declaredHash !== undefined && declaredHash !== String(resealed.content_hash)) {
      return { ok: false, reason: "content-hash-mismatch" };
    }
    sealed.push({ d: resealed, ch: String(resealed.content_hash) });
  }

  // Verifier roles: EXACTLY {functional, policy}
  const roles = new Set(sealed.map((s) => String(s.d.verifier_id)));
  if (roles.size !== 2 || ![...roles].every((r) => REQUIRED_VERIFIER_ROLES.has(r))) {
    return { ok: false, reason: "verifier-roles-not-exact" };
  }

  const sa = sealed[0]!;
  const sb = sealed[1]!;
  const da = sa.d, cha = sa.ch, db = sb.d, chb = sb.ch;
  if (cha === chb) return { ok: false, reason: "content-hash-mismatch" };

  // 2-of-2: BOTH results must be VALID
  if (da.result !== "VALID" || db.result !== "VALID") return { ok: false, reason: "policy-not-satisfied" };

  // Both decisions must carry the SAME binding, equal to the engine context
  for (const k of BINDING_KEYS) {
    if (da[k] !== db[k]) return { ok: false, reason: "binding-inputs-inconsistent" };
    if (String(da[k]) !== String(ctx.binding[k])) return { ok: false, reason: "binding-mismatch" };
  }

  // proof_binding must be the exact frozen R9 recomputation over the shared inputs
  const expected = proofBinding({
    intent_hash: String(da.intent_hash),
    milestone_id: String(da.milestone_id),
    milestone_revision: Number(da.milestone_revision),
    bundle_id: String(da.bundle_id),
    evidence_root: String(da.evidence_root),
    policy_hash: String(da.policy_hash),
  });
  if (da.proof_binding !== expected || db.proof_binding !== expected) return { ok: false, reason: "wrong-proof-binding" };

  const sorted = [cha, chb].sort();
  const receipt = {
    schema_version: "outcome-receipt.v1",
    receipt_id: deriveUuid(`gp3:receipt:${da.bundle_id}:${expected}`),
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
