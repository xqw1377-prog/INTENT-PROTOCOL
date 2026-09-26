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
 *   escrows/<escrow_ref>/instructions/<settlement-key-hex>.json InstructionRecordV1
 *
 * On-disk names use the bare 64-hex-char body of a `sha256:<hex>` hash:
 * ':' is not a legal filename character on NTFS. Parsed records always carry
 * the full `sha256:<hex>` form.
 */
import { z } from "zod";

/**
 * escrow_ref charset: path-safe, lowercase, bounded. This is the namespace of
 * the escrow ledger directory tree — anything outside this grammar NEVER
 * reaches a path operation (defense against traversal via untrusted
 * SettlementInstruction.escrow_ref, which G1 only constrains to min(1)).
 */
export const ESCROW_REF_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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
 * EscrowEntryV1 — created atomically (link-publish) at funding time.
 * `outcome_receipt_hash` binds the escrow to EXACTLY ONE accepted receipt:
 * the frozen GP3 receipt authority, never a second identity.
 * `release_enabled` DEFAULTS TO FALSE (hold-by-default; GP-001 ships under
 * policies/gp-001-settlement-hold-v1.json).
 */
export const EscrowEntrySchema = z.object({
  schema_version: z.literal("gp4-escrow.v1"),
  escrow_ref: z.string().regex(ESCROW_REF_RE),
  asset: AssetTripleSchema,
  amount: z.string().regex(DECIMAL_RE).refine((s) => s !== "0", "amount must be positive"),
  outcome_receipt_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
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

// NOTE (P1-A remediation): the settlement_key instruction idempotency LEDGER
// (InstructionRecordV1, instructions/<settlement_key>.json) is GP4-C scope and
// is deliberately NOT implemented in GP4-A/B. The settlement_key is still
// re-derived by the engine (frozen G1 settlementKey) and returned in results,
// but no instruction persistence exists in this package. Exact-instruction
// replay is subsumed by the economic guard for release purposes:
// same settlement_key ⇒ same receipt ⇒ same (escrow_ref, receipt) pair.

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
