/**
 * TESTNET-R1 T1 adapter skeleton — the four verbs (docs/TESTNET-R1.md §5).
 *
 * Identity, frozen:
 *   Adapter ≠ settlement authority
 *   Adapter ≠ verifier
 *   Adapter ≠ economic policy
 *
 * T1 has NO chain capability by construction: there is no RPC client, no
 * transaction builder, and no key material in this package. While Appendix A
 * constants are unpinned, the chain verbs return CHAIN_NOT_AUTHORIZED —
 * they cannot do anything else, structurally.
 */
import { economicReleaseDigest, toHex } from "./digest.ts";
import { FROZEN, PINNED, assertNotMainnet, pinnedComplete } from "./frozen.ts";

export interface SettlementInput {
  escrow_ref: string;
  outcome_receipt_hash: string;
  claim_record_hash: string;
  claimant: string;
  asset: { network: string; asset: string; decimals: number };
  amount: string;
  /** transport endpoint the caller intends to use (denied if mainnet) */
  endpoint?: string;
}

export type DenyReason =
  | "escrow-mismatch"
  | "receipt-mismatch"
  | "claim-record-mismatch"
  | "claimant-mismatch"
  | "asset-mismatch"
  | "amount-mismatch"
  | "mainnet-endpoint-denied";

export type PrepareResult =
  | { status: "DENIED_BEFORE_TX"; reason: DenyReason; detail: string }
  | {
      status: "PREPARED";
      economicReleaseDigest: string;
      programIdPinned: boolean;
      /** T1: while the program id is unpinned, the real release PDA is NOT derivable (fixture derivation exists for vectors only). */
      note: string;
    };

function sameAsset(a: SettlementInput["asset"]): boolean {
  return (
    a.network === FROZEN.asset.network &&
    a.asset === FROZEN.asset.asset &&
    a.decimals === FROZEN.asset.decimals
  );
}

/**
 * prepareSettlement(): bind + verify every input against the frozen local
 * ledger. ANY mismatch → DENY BEFORE TX (zero writes, zero tx — this
 * function is pure). The economic release digest is derivable without the
 * program id (it is a pure function of the EconomicReleaseKey pair).
 */
export function prepareSettlement(input: SettlementInput): PrepareResult {
  if (input.endpoint !== undefined) {
    try {
      assertNotMainnet(input.endpoint);
    } catch (e) {
      return { status: "DENIED_BEFORE_TX", reason: "mainnet-endpoint-denied", detail: String((e as Error).message) };
    }
  }
  const checks: Array<[DenyReason, string, boolean]> = [
    ["escrow-mismatch", input.escrow_ref, input.escrow_ref === FROZEN.anchors.escrowRef],
    ["receipt-mismatch", input.outcome_receipt_hash, input.outcome_receipt_hash === FROZEN.anchors.outcomeReceiptHash],
    ["claim-record-mismatch", input.claim_record_hash, input.claim_record_hash === FROZEN.anchors.claimRecordHash],
    ["claimant-mismatch", input.claimant, input.claimant === FROZEN.anchors.claimant],
    ["amount-mismatch", input.amount, input.amount === FROZEN.amount],
    ["asset-mismatch", `${input.asset.network}/${input.asset.asset}/${input.asset.decimals}`, sameAsset(input.asset)],
  ];
  for (const [reason, value, ok] of checks) {
    if (!ok) {
      return { status: "DENIED_BEFORE_TX", reason, detail: `frozen-ledger mismatch on ${value}` };
    }
  }
  const digest = toHex(economicReleaseDigest(input.escrow_ref, input.outcome_receipt_hash));
  return {
    status: "PREPARED",
    economicReleaseDigest: digest,
    programIdPinned: PINNED.programId !== null,
    note: pinnedComplete()
      ? "Appendix A constants pinned; chain actions remain unauthorized until T2 (this is the T1 skeleton — no RPC layer exists)."
      : "Appendix A constants unpinned: no real transaction capability. Real release PDA not derivable; fixture program id exists for golden vectors only.",
  };
}

export type ChainActionResult = {
  status: "CHAIN_NOT_AUTHORIZED";
  reasons: string[];
};

function notAuthorized(extra: string[] = []): ChainActionResult {
  const reasons = [...extra];
  if (!pinnedComplete()) reasons.push("appendix-a-constants-unpinned");
  reasons.push("t1-skeleton-no-rpc-layer");
  return { status: "CHAIN_NOT_AUTHORIZED", reasons };
}

/** submitSettlement(): T1 — structurally incapable of touching the chain. */
export function submitSettlement(_prepared: PrepareResult, _endpoint?: string): ChainActionResult {
  if (_endpoint !== undefined) assertNotMainnet(_endpoint); // throws — mainnet is a hard denial, not a soft return
  return notAuthorized();
}

/** observeSettlement(): T1 — no chain read capability exists. */
export function observeSettlement(_escrowRef: string, _outcomeReceiptHash: string, _endpoint?: string): ChainActionResult {
  if (_endpoint !== undefined) assertNotMainnet(_endpoint);
  return notAuthorized();
}

/** reconcileSettlement(): T1 — no chain truth to reconcile against yet (T4 scope). */
export function reconcileSettlement(_escrowRef: string, _outcomeReceiptHash: string, _endpoint?: string): ChainActionResult {
  if (_endpoint !== undefined) assertNotMainnet(_endpoint);
  return notAuthorized();
}
