/**
 * GP4-A — Settlement persistence schema (Builder: Zcode, branch zcode/gp4-a-b).
 *
 * Runtime state lives OUTSIDE the frozen G1 objects (GOLDEN-PATH-V1.md §3).
 * These records are ledger-side facts, not protocol objects: they carry no
 * content_hash authority. The ONLY settlement authority in this package is
 * the accepted OutcomeReceipt content_hash consumed via the frozen G1 seal.
 *
 * Persistence layout under one ledger root:
 *
 *   escrows/<escrow_ref>/escrow.json                          EscrowEntryV1
 *   escrows/<escrow_ref>/releases/<receipt-hash-hex>.json     ReleaseRecordV1   ← ECONOMIC GUARD
 *
 * (There is deliberately NO instructions/ tree and no InstructionRecord:
 * instruction idempotency is GP4-C scope — see the note below.)
 *
 * On-disk names use the bare 64-hex-char body of a `sha256:<hex>` hash:
 * ':' is not a legal filename character on NTFS. Parsed records always carry
 * the full `sha256:<hex>` form.
 */
import { z } from "zod";

/**
 * escrow_ref grammar. GP4-C: the frozen GP-001 task fixture pins
 * escrow_ref = "escrow:gp-001-local", so ':' is a legal character in the
 * NAMESPACE — but it is NOT a legal filename character (NTFS), so directory
 * names use refDir() percent-encoding (injective: '%' never appears raw).
 * Traversal-safe by construction: '/', '\', and absolute forms are rejected
 * by the charset; anything outside the charset NEVER reaches a path op.
 */
export const ESCROW_REF_RE = /^[a-z0-9][a-z0-9:._-]{0,63}$/;

/** Percent-encode a escrow_ref into a filesystem-safe directory name. */
export function refDir(ref: string): string {
  if (!ESCROW_REF_RE.test(ref)) throw new Error(`malformed escrow_ref: ${ref}`);
  return ref.replace(/[^a-z0-9._-]/g, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

const HASH_BODY_RE = /^[0-9a-f]{64}$/;
const DECIMAL_RE = /^(0|[1-9]\d*)(\.\d{1,18})?$/;

export function hashBody(h: string): string {
  const body = h.startsWith("sha256:") ? h.slice(7) : h;
  if (!HASH_BODY_RE.test(body)) throw new Error(`malformed hash: ${h}`);
  return body;
}

/**
 * THE frozen GP-001 asset triple (GOLDEN-PATH-V1.md §2 — the ONLY asset GP4
 * may settle; opaque, case-sensitive V1 labels). R2 remediation: no second
 * asset domain (no "local-ledger"), no generalization. Any other triple —
 * different network, different asset label, or different decimals — is
 * DENIED at release and rejected at escrow creation.
 */
export const FROZEN_ASSET_TRIPLE = { network: "solana-devnet", asset: "USDC-test", decimals: 6 } as const;

export function frozenAssetTripleOk(asset: { network: string; asset: string; decimals: number }): boolean {
  return asset.network === FROZEN_ASSET_TRIPLE.network
    && asset.asset === FROZEN_ASSET_TRIPLE.asset
    && asset.decimals === FROZEN_ASSET_TRIPLE.decimals;
}

export const AssetTripleSchema = z.object({
  network: z.string().min(1),
  asset: z.string().min(1),
  decimals: z.number().int().min(0).max(18),
}).strict();
export type AssetTriple = z.infer<typeof AssetTripleSchema>;

export function assetTripleKey(a: AssetTriple): string {
  return `${a.network}|${a.asset}|${a.decimals}`;
}

/** Unix seconds — IPC-JSON-1 safe integers only. */
const UnixSeconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const EscrowStateSchema = z.enum(["LOCKED", "ELIGIBLE", "RELEASED"]);
export type EscrowState = z.infer<typeof EscrowStateSchema>;

/**
 * EscrowEntryV2 (GP4-C) — created atomically (link-publish) at funding time.
 * `outcome_receipt_hash` binds the escrow to EXACTLY ONE accepted receipt.
 * `claim_record_hash` binds it to EXACTLY ONE immutable ClaimRecord: the
 * payee authorization source (GATES.md GP4: recipient == ClaimRecord.claimant).
 * `release_enabled` DEFAULTS TO FALSE (hold-by-default).
 */
export const EscrowEntrySchema = z.object({
  schema_version: z.literal("gp4-escrow.v2"),
  escrow_ref: z.string().regex(ESCROW_REF_RE),
  asset: AssetTripleSchema,
  amount: z.string().regex(DECIMAL_RE).refine((s) => s !== "0", "amount must be positive"),
  outcome_receipt_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  claim_record_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  state: EscrowStateSchema,
  release_enabled: z.boolean().default(false),
  created_at: UnixSeconds,
  updated_at: UnixSeconds,
}).strict().superRefine((v, ctx) => {
  // R12 unit closure: amount scale may not exceed asset decimals.
  const frac = v.amount.split(".")[1] ?? "";
  if (frac.length > v.asset.decimals) {
    ctx.addIssue({ code: "custom", message: "amount scale exceeds asset.decimals", path: ["amount"] });
  }
});
export type EscrowEntry = z.infer<typeof EscrowEntrySchema>;

/**
 * ReleaseRecordV1 — the economic release fact. One file per
 * (escrow_ref, outcome_receipt_hash) pair; the file's existence IS the
 * exactly-once marker (kernel-atomic link publish, see guard.ts).
 */
export const ReleaseRecordSchema = z.object({
  schema_version: z.literal("gp4-release.v1"),
  escrow_ref: z.string().regex(ESCROW_REF_RE),
  outcome_receipt_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  settlement_key: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  amount: z.string().regex(DECIMAL_RE),
  asset: AssetTripleSchema,
  released_at: UnixSeconds,
}).strict();
export type ReleaseRecord = z.infer<typeof ReleaseRecordSchema>;

// NOTE (P1-A remediation, superseded by GP4-C): the settlement_key
// instruction idempotency ledger is implemented in GP4-C — see
// InstructionRecordSchema below. It remains the INSTRUCTION layer only;
// the economic uniqueness authority stays with the
// (escrow_ref, outcome_receipt_hash) release guard. The two layers never
// merge.

/**
 * InstructionRecordV1 — settlement_key instruction journal (GP4-C part A).
 * Advisory idempotency/audit layer: records accepted (winning) instructions.
 * NEVER an economic authority.
 */
export const InstructionRecordSchema = z.object({
  schema_version: z.literal("gp4-instruction.v1"),
  settlement_key: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  escrow_ref: z.string().regex(ESCROW_REF_RE),
  outcome_receipt_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  nonce: z.string().regex(/^(0|[1-9]\d*)$/),
  first_seen_at: UnixSeconds,
}).strict();
export type InstructionRecord = z.infer<typeof InstructionRecordSchema>;

/**
 * SettlementEvidenceV1 (GP4-F) — the sealed settlement evidence record with
 * the full reverse-traceability chain. Sealed via canonical-bytes sha256
 * (runtime ledger binding; `evidence_hash` is excluded from its own
 * preimage). Every `links` field MUST resolve to a committed frozen
 * artifact (verified by tests + scripts/gp4-evidence.ts).
 */
export const SettlementEvidenceSchema = z.object({
  schema_version: z.literal("gp4-evidence.v1"),
  escrow_ref: z.string().regex(ESCROW_REF_RE),
  asset: AssetTripleSchema,
  amount: z.string().regex(DECIMAL_RE),
  outcome_receipt_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  claim_record_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  escrow_state: EscrowStateSchema,
  release: ReleaseRecordSchema.nullable(),
  instructions: z.array(InstructionRecordSchema),
  links: z.object({
    intent_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    milestone_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    milestone_revision: z.number().int().min(1),
    evidence_root: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    verification_policy_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    task_freeze_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    bounty_id: z.string().min(1),
    claimant: z.string().min(1),
  }).strict(),
  produced_at: UnixSeconds,
  evidence_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
}).strict();
export type SettlementEvidence = z.infer<typeof SettlementEvidenceSchema>;

/**
 * ClaimRecordV1 (GP4-C part B) — the immutable payee authorization source.
 * Grammar transcribed from the FROZEN GP1 machine contract
 * (packages/gp-runtime/src/machines.ts claimRecordShapeViolations —
 * transcribed, not imported, because gp-runtime has no package exports and
 * MUST NOT be modified). Identity binding hash: sha256 of IPC-JSON-1
 * canonical bytes (a ledger-side runtime binding, not a G1 domain object).
 */
export const ClaimRecordSchema = z.object({
  schema_version: z.literal("gp-claim.v1"),
  claim_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  bounty_id: z.string().min(1),
  claimant: z.string().regex(/^(user|org|agent|verifier|arbitrator|service|operator):[A-Za-z0-9._-]{1,128}$/),
  task_freeze_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  claimed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
}).strict();
export type ClaimRecord = z.infer<typeof ClaimRecordSchema>;

/**
 * Frozen settlement state machine, transcribed from GOLDEN-PATH-V1.md §3
 * (identical to packages/gp-runtime/src/machines.ts EDGES; transcribed, not
 * imported, because gp-runtime is a frozen GP1 package with no package
 * exports and MUST NOT be modified). Walk order is normative: there is no
 * LOCKED→RELEASED edge.
 */
export const SETTLEMENT_EDGES: readonly { from: EscrowState; to: EscrowState; authority: string }[] = [
  { from: "LOCKED", to: "ELIGIBLE", authority: "accepted-receipt-ref" },
  { from: "ELIGIBLE", to: "RELEASED", authority: "release-observed-ref" },
];

export function settlementEdge(from: EscrowState, to: EscrowState) {
  return SETTLEMENT_EDGES.find((e) => e.from === from && e.to === to);
}

/** Frozen committed hold policy (packages/golden-path/identity/policies/). */
export const SettlementPolicySchema = z.object({
  authority: z.string().min(1),
  gp4_gate: z.string().min(1),
  policy_id: z.string().min(1),
  release_enabled: z.boolean(),
}).strict();
export type SettlementPolicy = z.infer<typeof SettlementPolicySchema>;
