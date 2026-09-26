/**
 * GP4-B/C multi-process race child.
 *
 * Run by test/gp4-b-guard.test.ts as:
 *   node --experimental-strip-types attempt-release.ts \
 *        <ledgerRoot> <escrowRef> <receiptPath> <claimPath> <nonce> <amount> <network> <asset> <decimals>
 *
 * Prints ONE line of JSON — the attemptRelease result — and exits 0.
 * Uses the REAL engine (no reimplementation).
 */
import { readFileSync } from "node:fs";
import { EscrowLedger } from "../src/index.ts";

const [, , ledgerRoot, escrowRef, receiptPath, claimPath, nonce, amount, network, asset, decimals] = process.argv;
if (!ledgerRoot || !escrowRef || !receiptPath || !claimPath || !nonce || !amount || !network || !asset || !decimals) {
  process.stdout.write(JSON.stringify({ status: "USAGE_ERROR" }));
  process.exit(0);
}

const receipt: unknown = JSON.parse(readFileSync(receiptPath, "utf8"));
const claim: unknown = JSON.parse(readFileSync(claimPath, "utf8"));
const receiptHash = (receipt as { content_hash?: string }).content_hash ?? "";

const instruction = {
  schema_version: "settlement.v1",
  settlement_id: "11111111-1111-4111-8111-111111111111",
  escrow_ref: escrowRef,
  outcome_receipt_hash: receiptHash,
  nonce: String(nonce),
  outputs: [{
    recipient: "agent:gp-001-demo",
    asset: { network, asset, decimals: Number(decimals) },
    amount,
    reason: "gp4 multi-process race attempt",
  }],
  total_amount: amount,
};

const ledger = EscrowLedger.open(ledgerRoot);
const r = ledger.attemptRelease({ receipt, instruction, claim_record: claim });
process.stdout.write(JSON.stringify({ status: r.status, settlement_key: r.settlement_key ?? null, reason: r.reason ?? null }));
