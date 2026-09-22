/**
 * GP3 receipt engine (Issue #32 §6/§7): forms an OutcomeReceiptV1 ONLY after
 * the frozen 2-of-2 policy is satisfied. No manual/admin/demo path exists —
 * formReceipt is the single constructor and every guard below is mandatory.
 */
import { deriveUuid, proofBinding } from "./r9.js";
import { FIXED_CLOCK } from "./context.js";
import { OutcomeReceiptSchema, seal } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";

export type Rejection =
  | "not-two-decisions"
  | "duplicate-decision"
  | "verifier-identity-not-distinct"
  | "policy-not-satisfied"
  | "binding-mismatch"
  | "binding-inputs-inconsistent"
  | "wrong-proof-binding"
  | "decision-hash-mismatch";

export interface ReceiptOutcome {
  ok: boolean;
  reason?: Rejection;
  receipt?: Record<string, any>;
  receipt_hash?: string;
}

const BINDING_KEYS = ["intent_hash", "milestone_id", "milestone_revision", "bundle_id", "evidence_root", "policy_hash"] as const;

export interface ReceiptContext {
  /** the binding BOTH decisions must carry (recomputed by the engine from R9) */
  binding: Record<string, unknown>;
}

export function formReceipt(
  decisions: Array<{ decision: Record<string, any>; content_hash: string }>,
  ctx: ReceiptContext,
): ReceiptOutcome {
  if (decisions.length !== 2) return { ok: false, reason: "not-two-decisions" };

  const [a = null, b = null] = decisions;
  if (!a || !b) return { ok: false, reason: "not-two-decisions" };
  const da = a.decision;
  const db = b.decision;

  if (a.content_hash === b.content_hash) return { ok: false, reason: "duplicate-decision" };
  if (da.verifier_id === db.verifier_id) return { ok: false, reason: "verifier-identity-not-distinct" };

  // 2-of-2: BOTH results must be VALID wire value; any other result blocks
  if (da.result !== "VALID" || db.result !== "VALID") return { ok: false, reason: "policy-not-satisfied" };

  // both decisions must target the SAME frozen binding, and that binding must
  // equal the engine context's expected binding
  for (const k of BINDING_KEYS) {
    if (da[k] !== db[k]) return { ok: false, reason: "binding-inputs-inconsistent", };
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

  // decision hashes: canonical form is non-empty, unique, STRICTLY ascending.
  // Unsorted input is normalized ONLY because the frozen schema rule defines
  // the canonical set; the underlying hashes themselves are never altered.
  const sorted = [a.content_hash, b.content_hash].sort();
  if (new Set(sorted).size !== 2) return { ok: false, reason: "duplicate-decision" };

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
  const sealed = seal(OutcomeReceiptSchema as never, receipt) as Record<string, any>;
  return { ok: true, receipt: sealed, receipt_hash: String(sealed.content_hash) };
}
