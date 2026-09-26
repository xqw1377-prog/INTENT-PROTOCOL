/**
 * @intent/gp4-settlement public surface (GP4-A + GP4-B, R1/R2/R3 remediated).
 *
 * Consumes frozen G1 primitives from @intent/protocol-schema (subtree
 * bb14d937) and NOTHING from any GP1/GP2/GP3 package code: the frozen GP3
 * receipt artifact is consumed as untrusted DATA and re-sealed via G1.
 *
 * Production surface: EscrowLedger — hold-by-construction.
 * Verification surface: LocalVerificationLedger — explicit override.
 * Instruction idempotency ledger: NOT IMPLEMENTED (GP4-C scope).
 */
export { atomicPublish, atomicReplace, sweepTemp } from "./guard.ts";
export type { PublishResult } from "./guard.ts";
export { receiptAuthority } from "./receipt.ts";
export type { ReceiptAuthority } from "./receipt.ts";
export {
  ESCROW_REF_RE, SETTLEMENT_EDGES, FROZEN_ASSET_TRIPLE,
  EscrowEntrySchema, ReleaseRecordSchema, SettlementPolicySchema,
  frozenAssetTripleOk, hashBody, settlementEdge,
} from "./schema.ts";
export type { AssetTriple, EscrowEntry, EscrowState, ReleaseRecord, SettlementPolicy } from "./schema.ts";
export { EscrowLedger, LedgerCorruptError } from "./ledger.ts";
export type { CreateEscrowInput, ReleaseResult, ReleaseStatus } from "./ledger.ts";
export { LocalVerificationLedger } from "./verification.ts";
