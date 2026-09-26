/**
 * @intent/gp4-settlement public surface (GP4-A + GP4-B).
 *
 * Consumes frozen G1 primitives from @intent/protocol-schema (subtree
 * bb14d937) and NOTHING from any GP1/GP2/GP3 package code: the frozen GP3
 * receipt artifact is consumed as untrusted DATA and re-sealed via G1.
 */
export { atomicPublish, atomicReplace, sweepTemp } from "./guard.ts";
export type { PublishResult } from "./guard.ts";
export { receiptAuthority } from "./receipt.ts";
export type { ReceiptAuthority } from "./receipt.ts";
export {
  ALLOWED_NETWORKS, ESCROW_REF_RE, SETTLEMENT_EDGES,
  EscrowEntrySchema, InstructionRecordSchema, ReleaseRecordSchema, SettlementPolicySchema,
  assetTripleKey, hashBody, networkAllowed, settlementEdge,
} from "./schema.ts";
export type { AssetTriple, EscrowEntry, EscrowState, InstructionRecord, ReleaseRecord, SettlementPolicy } from "./schema.ts";
export { EscrowLedger, LedgerCorruptError } from "./ledger.ts";
export type { CreateEscrowInput, ReleaseResult, ReleaseStatus } from "./ledger.ts";
