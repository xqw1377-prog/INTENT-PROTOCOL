/** Shared GP4 test fixtures (imported by both test files; not a test module). */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { EscrowLedger } from "../src/index.ts";

/** Frozen GP3 OutcomeReceipt content_hash (GP3 closed ledger). */
export const FROZEN_RH = "sha256:da577b3d04bc53dac6ace4c200679ab36bc1fa21e8be31e2e5c7197cc7706380";

/** Frozen GP-001 asset triple (GOLDEN-PATH-V1.md §2). */
export const FROZEN_ASSET = { network: "solana-devnet", asset: "USDC-test", decimals: 6 } as const;

export function freshLedger(): { ledger: EscrowLedger; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "gp4-ledger-"));
  return { ledger: EscrowLedger.open(root, { now: () => 1_700_000_000 }), root };
}

/** The frozen canonical receipt artifact (GP2/GP3 output) as untrusted data. */
export function frozenReceipt(): unknown {
  return JSON.parse(readFileSync(new URL("../../../packages/gp3-verification/artifacts/receipt.json", import.meta.url), "utf8"));
}

export function makeInstruction(over?: Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: "settlement.v1",
    settlement_id: "11111111-1111-4111-8111-111111111111",
    escrow_ref: "gp-001-escrow-1",
    outcome_receipt_hash: FROZEN_RH,
    nonce: "1",
    outputs: [{ recipient: "agent:gp-001-demo", asset: FROZEN_ASSET, amount: "10", reason: "GP4-B" }],
    total_amount: "10",
    ...over,
  };
}
