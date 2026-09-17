/**
 * S0 canonical schemas (Appendix A of the Technical Architecture, V0.1 draft).
 *
 * Scope: IntentContractV1, CriterionV1, EvidenceArtifactV1, EvidenceBundleV1,
 * VerificationDecisionV1, SettlementInstructionV1 — plus the shared sub-schemas
 * they reference. `schema_version` literals are frozen per object.
 *
 * Hashing convention:
 *   content_hash = hashObject(Domain.X, schema_version, object minus { content_hash, signature })
 * Signatures sign the content_hash, not the raw bytes.
 */
import { z } from "zod";
import { Domain, hashObject, type Hash } from "./hash.js";
import {
  AssetRefSchema, DecimalSchema, EvidenceLevel, HashRefSchema, HashSchema, PrivacyClass, RiskLevel,
  SignatureSchema, SubjectRefSchema, TimestampSchema, U32Schema, U64Schema, UUIDSchema,
} from "./primitives.js";
import { DecisionResult, EvidenceBundleState } from "./states.js";

const Json: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number().int(), z.boolean(), z.null(), z.array(Json), z.record(Json)]),
);

// ---------------------------------------------------------------- CriterionV1

export const EvidenceRuleSchema = z.object({
  kind: z.string().min(1),
  min_level: EvidenceLevel,
  source: z.string().min(1),
  required: z.boolean(),
}).strict();
export type EvidenceRule = z.infer<typeof EvidenceRuleSchema>;

export const CriterionSchema = z.object({
  schema_version: z.literal("criterion.v1"),
  criterion_id: z.string().min(1),
  kind: z.enum(["MACHINE", "ECONOMIC", "CRYPTO", "HUMAN"]),
  assertion: z.string().min(1),
  verifier_ref: z.string().min(1),
  evidence_requirements: z.array(EvidenceRuleSchema).min(1),
  threshold: Json,
}).strict();
export type Criterion = z.infer<typeof CriterionSchema>;

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
}).strict();

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
  if (v.version === 1 && v.parent_hash) ctx.addIssue({ code: "custom", message: "version 1 must not have parent_hash", path: ["parent_hash"] });
  if (v.version > 1 && !v.parent_hash) ctx.addIssue({ code: "custom", message: "version > 1 requires parent_hash", path: ["parent_hash"] });
  if (v.version > 1 && !v.change_reason) ctx.addIssue({ code: "custom", message: "version > 1 requires change_reason", path: ["change_reason"] });
});
export type IntentContract = z.infer<typeof IntentContractSchema>;

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
  /** Hash of the raw artifact bytes in the CAS; never embeds RESTRICTED content. */
  content_hash: HashSchema,
  locator: z.string().min(1),
  privacy_class: PrivacyClass,
  signature: SignatureSchema.optional(),
}).strict();
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

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
}).strict().superRefine((v, ctx) => {
  if (v.state === "SEALED") {
    if (v.artifact_hashes.length === 0) ctx.addIssue({ code: "custom", message: "SEALED bundle requires >= 1 artifact", path: ["artifact_hashes"] });
    if (!v.merkle_root) ctx.addIssue({ code: "custom", message: "SEALED bundle requires merkle_root", path: ["merkle_root"] });
    if (!v.sealed_at) ctx.addIssue({ code: "custom", message: "SEALED bundle requires sealed_at", path: ["sealed_at"] });
    if (new Set(v.artifact_hashes).size !== v.artifact_hashes.length) {
      ctx.addIssue({ code: "custom", message: "duplicate artifact_hash in bundle", path: ["artifact_hashes"] });
    }
  }
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

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
}).strict();
export type VerificationDecision = z.infer<typeof VerificationDecisionSchema>;

// ---------------------------------------------------------------- SettlementInstructionV1

export const SettlementOutputSchema = z.object({
  recipient: SubjectRefSchema,
  asset: AssetRefSchema,
  amount: DecimalSchema,
  reason: z.string().min(1),
}).strict();
export type SettlementOutput = z.infer<typeof SettlementOutputSchema>;

export const SettlementInstructionSchema = z.object({
  schema_version: z.literal("settlement.v1"),
  settlement_id: UUIDSchema,
  escrow_ref: z.string().min(1),
  milestone_id: UUIDSchema,
  decision_id: UUIDSchema,
  proof_binding: HashSchema,
  nonce: U64Schema,
  outputs: z.array(SettlementOutputSchema).min(1),
  total_amount: DecimalSchema,
  expires_at: TimestampSchema.optional(),
  content_hash: HashSchema.optional(),
}).strict();
export type SettlementInstruction = z.infer<typeof SettlementInstructionSchema>;

// ---------------------------------------------------------------- Seal helpers

type Hashable = { schema_version: string; content_hash?: Hash | undefined; signature?: unknown };

function stripDerived<T extends Hashable>(o: T): Omit<T, "content_hash" | "signature"> {
  const { content_hash: _c, signature: _s, ...rest } = o;
  return rest;
}

const DOMAINS = {
  "intent.v1": Domain.Intent,
  "criterion.v1": Domain.Intent, // Criterion is hashed inside its parent IntentContract
  "artifact.v1": Domain.EvidenceArtifact,
  "bundle.v1": Domain.EvidenceBundle,
  "decision.v1": Domain.VerificationDecision,
  "settlement.v1": Domain.SettlementInstruction,
} as const;

/** content_hash for a protocol object (content_hash/signature are excluded from the preimage). */
export function contentHash<T extends Hashable>(o: T): Hash {
  const domain = DOMAINS[o.schema_version as keyof typeof DOMAINS];
  if (!domain) throw new Error(`no domain for schema_version ${o.schema_version}`);
  return hashObject(domain, o.schema_version, stripDerived(o));
}

/**
 * Validate + compute content_hash. If the input already carries a content_hash it must match —
 * this is the tamper check for received objects.
 */
export function seal<T>(schema: z.ZodType<T & Hashable>, input: unknown): T & { content_hash: Hash } {
  const o = schema.parse(input);
  const h = contentHash(o);
  if (o.content_hash && o.content_hash !== h) {
    throw new Error(`content_hash mismatch: declared ${o.content_hash}, computed ${h}`);
  }
  return { ...o, content_hash: h };
}
