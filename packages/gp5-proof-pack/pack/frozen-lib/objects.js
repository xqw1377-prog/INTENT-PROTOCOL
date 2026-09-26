/**
 * S0 canonical schemas (Appendix A of the Technical Architecture, V0.1 draft).
 *
 * Scope: IntentContractV1, CriterionV1, MilestoneV1, EvidenceArtifactV1,
 * EvidenceBundleV1, VerificationDecisionV1, OutcomeReceiptV1,
 * SettlementInstructionV1 — the eight G1 trust primitives (docs/TRUST-CHAIN.md)
 * plus the shared sub-schemas they reference. `schema_version` literals are
 * frozen per object.
 *
 * Hashing convention:
 *   content_hash = hashObject(Domain.X, schema_version, object minus { content_hash, signature })
 * Signatures sign the content_hash, not the raw bytes.
 */
import { z } from "zod";
import { Domain, hashObject, proofBinding } from "./hash.js";
import { merkleRoot } from "./merkle.js";
import { AssetRefSchema, DecimalSchema, EvidenceLevel, HashRefSchema, HashSchema, PrivacyClass, RiskLevel, SignatureSchema, SubjectRefSchema, TimestampSchema, U32Schema, U64Schema, UUIDSchema, } from "./primitives.js";
import { DecisionResult, EvidenceBundleState } from "./states.js";
const Json = z.lazy(() => z.union([z.string(), z.number().refine(Number.isSafeInteger, "must be a safe integer"), z.boolean(), z.null(), z.array(Json), z.record(Json)]));
/**
 * Exact decimal addition over canonical decimal strings — BigInt scaled
 * arithmetic, never floats (Commander ruling: settlement math must be exact).
 * Inputs must already satisfy DecimalSchema.
 */
export function decimalSum(amounts) {
    let scale = 0;
    for (const a of amounts) {
        const frac = a.split(".")[1];
        if (frac && frac.length > scale)
            scale = frac.length;
    }
    let sum = 0n;
    for (const a of amounts) {
        const [int, frac = ""] = a.split(".");
        sum += BigInt(int + frac.padEnd(scale, "0"));
    }
    const s = sum.toString().padStart(scale + 1, "0");
    const int = scale ? s.slice(0, -scale) : s;
    const frac = scale ? s.slice(-scale).replace(/0+$/, "") : "";
    return frac ? `${int}.${frac}` : int;
}
/** Fractional-digit count of a canonical decimal ("0.01" → 2, "10" → 0). */
export function decimalScale(a) {
    return a.split(".")[1]?.length ?? 0;
}
/** Exact comparison of two canonical decimals via scaled BigInt (no floats). Returns -1 | 0 | 1. */
export function decimalCompare(a, b) {
    const scale = Math.max(decimalScale(a), decimalScale(b));
    const toInt = (v) => {
        const [i, f = ""] = v.split(".");
        return BigInt(i + f.padEnd(scale, "0"));
    };
    const d = toInt(a) - toInt(b);
    return d < 0n ? -1 : d > 0n ? 1 : 0;
}
// ---------------------------------------------------------------- CriterionV1
export const EvidenceRuleSchema = z.object({
    kind: z.string().min(1),
    min_level: EvidenceLevel,
    source: z.string().min(1),
    required: z.boolean(),
}).strict();
export const CriterionSchema = z.object({
    schema_version: z.literal("criterion.v1"),
    criterion_id: z.string().min(1),
    kind: z.enum(["MACHINE", "ECONOMIC", "CRYPTO", "HUMAN"]),
    assertion: z.string().min(1),
    verifier_ref: z.string().min(1),
    evidence_requirements: z.array(EvidenceRuleSchema).min(1),
    threshold: Json,
}).strict();
// ---------------------------------------------------------------- IntentContractV1
export const GoalSpecSchema = z.object({
    statement: z.string().min(1).max(4000),
    /** Desired end-state as the owner phrased it; Goal != Task (WP §4.2). */
    target_state: z.string().min(1).max(4000),
    domain: z.string().min(1),
}).strict();
export const ConstraintSchema = z.object({
    constraint_id: z.string().min(1),
    kind: z.enum(["FORBIDDEN_ACTION", "SCOPE", "COMPLIANCE", "BUDGET", "TIME", "OTHER"]),
    statement: z.string().min(1),
    max_risk_level: RiskLevel.optional(),
}).strict();
export const BudgetSpecSchema = z.object({
    asset: AssetRefSchema,
    total: DecimalSchema,
    /** Hard cap for model/tool/API spend inside the total. */
    execution_cap: DecimalSchema,
}).strict().superRefine((v, ctx) => {
    // R12: cap never exceeds total; amount scale never exceeds asset decimals.
    if (decimalCompare(v.execution_cap, v.total) > 0) {
        ctx.addIssue({ code: "custom", message: "execution_cap exceeds total", path: ["execution_cap"] });
    }
    for (const [k, amt] of [["total", v.total], ["execution_cap", v.execution_cap]]) {
        if (decimalScale(amt) > v.asset.decimals) {
            ctx.addIssue({ code: "custom", message: `${k} has more fractional digits than asset.decimals`, path: [k] });
        }
    }
});
export const IntentContractSchema = z.object({
    schema_version: z.literal("intent.v1"),
    intent_id: UUIDSchema,
    version: U32Schema.min(1),
    owner_subject: SubjectRefSchema,
    goal: GoalSpecSchema,
    success_criteria: z.array(CriterionSchema).min(1),
    constraints: z.array(ConstraintSchema),
    budget: BudgetSpecSchema,
    deadline: TimestampSchema.optional(),
    verification_policy_ref: HashRefSchema,
    settlement_policy_ref: HashRefSchema,
    parent_hash: HashSchema.optional(),
    /** Required when version > 1 (AmendIntent). */
    change_reason: z.string().min(1).optional(),
    created_at: TimestampSchema,
    content_hash: HashSchema.optional(),
    signature: SignatureSchema.optional(),
}).strict().superRefine((v, ctx) => {
    if (v.version === 1 && v.parent_hash)
        ctx.addIssue({ code: "custom", message: "version 1 must not have parent_hash", path: ["parent_hash"] });
    if (v.version > 1 && !v.parent_hash)
        ctx.addIssue({ code: "custom", message: "version > 1 requires parent_hash", path: ["parent_hash"] });
    if (v.version > 1 && !v.change_reason)
        ctx.addIssue({ code: "custom", message: "version > 1 requires change_reason", path: ["change_reason"] });
    const dup = (ids) => ids.filter((id, i) => ids.indexOf(id) !== i);
    const dupCrit = dup(v.success_criteria.map((c) => c.criterion_id));
    if (dupCrit.length)
        ctx.addIssue({ code: "custom", message: `duplicate criterion_id: ${dupCrit.join(",")}`, path: ["success_criteria"] });
    const dupCons = dup(v.constraints.map((c) => c.constraint_id));
    if (dupCons.length)
        ctx.addIssue({ code: "custom", message: `duplicate constraint_id: ${dupCons.join(",")}`, path: ["constraints"] });
});
// ---------------------------------------------------------------- EvidenceArtifactV1
export const EvidenceArtifactSchema = z.object({
    schema_version: z.literal("artifact.v1"),
    artifact_id: UUIDSchema,
    kind: z.string().min(1),
    level: EvidenceLevel,
    /** Who/what produced it, e.g. "github:org/repo", "ci:github-actions", "http-probe:eu-west-1". */
    source: z.string().min(1),
    /** What it is about, e.g. "commit:abc123", "url:https://...". */
    subject: z.string().min(1),
    captured_at: TimestampSchema,
    /**
     * Hash of the raw artifact bytes in the CAS; never embeds RESTRICTED content.
     * Named payload_hash (not content_hash) because content_hash is the object self-digest
     * convention — see OPEN-QUESTIONS OQ-2.
     */
    payload_hash: HashSchema,
    locator: z.string().min(1),
    privacy_class: PrivacyClass,
    content_hash: HashSchema.optional(),
    signature: SignatureSchema.optional(),
}).strict();
// ---------------------------------------------------------------- EvidenceBundleV1
export const EvidenceBundleSchema = z.object({
    schema_version: z.literal("bundle.v1"),
    bundle_id: UUIDSchema,
    milestone_id: UUIDSchema,
    milestone_revision: U32Schema.min(1),
    run_ids: z.array(UUIDSchema),
    artifact_hashes: z.array(HashSchema),
    merkle_root: HashSchema.optional(),
    submitter: SubjectRefSchema,
    policy_hash: HashSchema,
    sealed_at: TimestampSchema.optional(),
    state: EvidenceBundleState,
    content_hash: HashSchema.optional(),
    signature: SignatureSchema.optional(),
}).strict().superRefine((v, ctx) => {
    if (v.state === "SEALED") {
        if (v.artifact_hashes.length === 0)
            ctx.addIssue({ code: "custom", message: "SEALED bundle requires >= 1 artifact", path: ["artifact_hashes"] });
        if (!v.merkle_root)
            ctx.addIssue({ code: "custom", message: "SEALED bundle requires merkle_root", path: ["merkle_root"] });
        if (!v.sealed_at)
            ctx.addIssue({ code: "custom", message: "SEALED bundle requires sealed_at", path: ["sealed_at"] });
        if (new Set(v.artifact_hashes).size !== v.artifact_hashes.length) {
            ctx.addIssue({ code: "custom", message: "duplicate artifact_hash in bundle", path: ["artifact_hashes"] });
        }
        // Commander ruling: merkle_root must be *equal to* the recomputed root, not just present.
        if (v.merkle_root && v.artifact_hashes.length && merkleRoot(v.artifact_hashes) !== v.merkle_root) {
            ctx.addIssue({ code: "custom", message: "merkle_root does not equal merkleRoot(artifact_hashes)", path: ["merkle_root"] });
        }
    }
});
// ---------------------------------------------------------------- MilestoneV1
export const MilestoneAllocationSchema = z.object({
    asset: AssetRefSchema,
    amount: DecimalSchema,
}).strict();
export const MilestoneSchema = z.object({
    schema_version: z.literal("milestone.v1"),
    milestone_id: UUIDSchema,
    intent_hash: HashSchema,
    milestone_revision: U32Schema.min(1),
    /** Non-empty, unique; array order is canonical/significant. */
    criterion_ids: z.array(z.string().min(1)).min(1),
    verification_policy_hash: HashSchema,
    settlement_policy_hash: HashSchema,
    allocation: MilestoneAllocationSchema,
    content_hash: HashSchema.optional(),
    signature: SignatureSchema.optional(),
}).strict().superRefine((v, ctx) => {
    if (new Set(v.criterion_ids).size !== v.criterion_ids.length) {
        ctx.addIssue({ code: "custom", message: "duplicate criterion_id in milestone", path: ["criterion_ids"] });
    }
    if (decimalScale(v.allocation.amount) > v.allocation.asset.decimals) {
        ctx.addIssue({ code: "custom", message: "allocation amount has more fractional digits than asset.decimals", path: ["allocation", "amount"] });
    }
});
// ---------------------------------------------------------------- VerificationDecisionV1
export const VerificationDecisionSchema = z.object({
    schema_version: z.literal("decision.v1"),
    decision_id: UUIDSchema,
    verifier_id: SubjectRefSchema,
    verifier_digest: HashSchema,
    intent_hash: HashSchema,
    milestone_id: UUIDSchema,
    milestone_revision: U32Schema.min(1),
    bundle_id: UUIDSchema,
    evidence_root: HashSchema,
    policy_hash: HashSchema,
    /** = proofBinding({intent_hash, milestone_revision, evidence_root, policy_hash}) — anti replay. */
    proof_binding: HashSchema,
    result: DecisionResult,
    reason_codes: z.array(z.string().min(1)),
    /** Digest of the deterministic replay trace; a second verifier must reproduce it. */
    replay_digest: HashSchema,
    decided_at: TimestampSchema,
    content_hash: HashSchema.optional(),
    signature: SignatureSchema.optional(),
}).strict().superRefine((v, ctx) => {
    // Commander ruling: proof_binding must recompute exactly from the object's own fields.
    const recomputed = proofBinding({
        intent_hash: v.intent_hash,
        milestone_id: v.milestone_id,
        milestone_revision: v.milestone_revision,
        bundle_id: v.bundle_id,
        evidence_root: v.evidence_root,
        policy_hash: v.policy_hash,
    });
    if (recomputed !== v.proof_binding) {
        ctx.addIssue({ code: "custom", message: "proof_binding does not equal recomputed binding", path: ["proof_binding"] });
    }
});
// ---------------------------------------------------------------- OutcomeReceiptV1
/**
 * The protocol-recognized accepted outcome for one milestone revision after the
 * verification policy is satisfied (docs/TRUST-CHAIN.md). Receipt formation and
 * policy-aggregation execution are S1; G1 freezes the commitment structure.
 * A VerificationDecision is a verifier assertion — it is never payment authority;
 * the receipt is.
 */
export const OutcomeReceiptSchema = z.object({
    schema_version: z.literal("outcome-receipt.v1"),
    receipt_id: UUIDSchema,
    intent_hash: HashSchema,
    milestone_id: UUIDSchema,
    milestone_revision: U32Schema.min(1),
    evidence_root: HashSchema,
    verification_policy_hash: HashSchema,
    /** Deterministic accepted-decision set: non-empty, unique, strictly lexicographically ascending. */
    decision_hashes: z.array(HashSchema).min(1),
    /** A receipt is not a decision: the only representable outcome is ACCEPTED. */
    accepted_result: z.literal("ACCEPTED"),
    issued_at: TimestampSchema,
    content_hash: HashSchema.optional(),
    signature: SignatureSchema.optional(),
}).strict().superRefine((v, ctx) => {
    for (let i = 1; i < v.decision_hashes.length; i++) {
        if (v.decision_hashes[i] <= v.decision_hashes[i - 1]) {
            ctx.addIssue({
                code: "custom",
                message: "decision_hashes must be unique and strictly lexicographically ascending",
                path: ["decision_hashes", i],
            });
            break;
        }
    }
});
// ---------------------------------------------------------------- SettlementInstructionV1
export const SettlementOutputSchema = z.object({
    recipient: SubjectRefSchema,
    asset: AssetRefSchema,
    amount: DecimalSchema,
    reason: z.string().min(1),
}).strict();
/**
 * Receipt-gated settlement (docs/TRUST-CHAIN.md): the ONLY authority field is
 * `outcome_receipt_hash`. `decision_id` and `proof_binding` are forbidden
 * authority fields in V1 — a raw VerificationDecision cannot authorize settlement.
 */
export const SettlementInstructionSchema = z.object({
    schema_version: z.literal("settlement.v1"),
    settlement_id: UUIDSchema,
    escrow_ref: z.string().min(1),
    outcome_receipt_hash: HashSchema,
    nonce: U64Schema,
    outputs: z.array(SettlementOutputSchema).min(1),
    total_amount: DecimalSchema,
    expires_at: TimestampSchema.optional(),
    content_hash: HashSchema.optional(),
}).strict().superRefine((v, ctx) => {
    // R5: total_amount must be the EXACT decimal sum of outputs (no floats).
    if (decimalSum(v.outputs.map((o) => o.amount)) !== v.total_amount) {
        ctx.addIssue({ code: "custom", message: "total_amount does not equal exact sum of outputs", path: ["total_amount"] });
    }
    // R12: V1 settlement is single-asset; every output must reference the same asset triple.
    const assetKey = (a) => `${a.network}|${a.asset}|${a.decimals}`;
    const first = assetKey(v.outputs[0].asset);
    for (const [i, o] of v.outputs.entries()) {
        if (assetKey(o.asset) !== first) {
            ctx.addIssue({ code: "custom", message: "multi-asset settlement is not allowed in V1", path: ["outputs", i, "asset"] });
        }
    }
    // R12: amount scale may not exceed asset decimals (unit closure).
    const maxScale = v.outputs[0].asset.decimals;
    for (const [i, o] of v.outputs.entries()) {
        if (decimalScale(o.amount) > maxScale) {
            ctx.addIssue({ code: "custom", message: "amount has more fractional digits than asset.decimals", path: ["outputs", i, "amount"] });
        }
    }
    if (decimalScale(v.total_amount) > maxScale) {
        ctx.addIssue({ code: "custom", message: "total_amount has more fractional digits than asset.decimals", path: ["total_amount"] });
    }
});
function stripDerived(o) {
    const { content_hash: _c, signature: _s, ...rest } = o;
    return rest;
}
const DOMAINS = {
    "intent.v1": Domain.Intent,
    "criterion.v1": Domain.Intent, // Criterion is hashed inside its parent IntentContract
    "milestone.v1": Domain.Milestone,
    "artifact.v1": Domain.EvidenceArtifact,
    "bundle.v1": Domain.EvidenceBundle,
    "decision.v1": Domain.VerificationDecision,
    "outcome-receipt.v1": Domain.OutcomeReceipt,
    "settlement.v1": Domain.SettlementInstruction,
};
/** content_hash for a protocol object (content_hash/signature are excluded from the preimage). */
export function contentHash(o) {
    const domain = DOMAINS[o.schema_version];
    if (!domain)
        throw new Error(`no domain for schema_version ${o.schema_version}`);
    return hashObject(domain, o.schema_version, stripDerived(o));
}
/**
 * Validate + compute content_hash. If the input already carries a content_hash it must match —
 * this is the tamper check for received objects.
 */
export function seal(schema, input) {
    const o = schema.parse(input);
    const h = contentHash(o);
    if (o.content_hash && o.content_hash !== h) {
        throw new Error(`content_hash mismatch: declared ${o.content_hash}, computed ${h}`);
    }
    return { ...o, content_hash: h };
}
//# sourceMappingURL=objects.js.map