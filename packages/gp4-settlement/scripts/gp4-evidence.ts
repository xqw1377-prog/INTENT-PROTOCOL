/**
 * GP4 official evidence generator (run by .github/workflows/gp4-evidence.yml).
 *
 * Builds a local verification ledger, executes the golden GP-001 release
 * from the committed frozen artifacts (receipt + claim + task), runs the
 * adversarial replay sweep, seals the settlement evidence, and prints a
 * machine-readable report. Exits non-zero on ANY inconsistency.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import {
  EscrowLedger, LocalVerificationLedger, buildSettlementEvidence, verifySettlementEvidence,
  claimAuthority,
} from "../src/index.ts";

const repoRoot = new URL("../../../", import.meta.url);
const receipt = JSON.parse(readFileSync(new URL("packages/gp3-verification/artifacts/receipt.json", repoRoot), "utf8"));
const claim = JSON.parse(readFileSync(new URL("packages/gp4-settlement/fixtures/gp-001-claim.json", repoRoot), "utf8"));
const ESCROW_REF = "escrow:gp-001-local";
const ASSET = { network: "solana-devnet", asset: "USDC-test", decimals: 6 };
const instruction = (nonce: string, recipient = "agent:gp-001-demo") => ({
  schema_version: "settlement.v1",
  settlement_id: "11111111-1111-4111-8111-111111111111",
  escrow_ref: ESCROW_REF,
  outcome_receipt_hash: receipt.content_hash,
  nonce,
  outputs: [{ recipient, asset: ASSET, amount: "10", reason: "GP4 official evidence" }],
  total_amount: "10",
});

const outDir = process.argv[2] ?? "gp4-artifacts";
mkdirSync(outDir, { recursive: true });

const report: Record<string, unknown> = {
  schema_version: "gp4-evidence-report.v1",
  node: process.version,
  escrow_ref: ESCROW_REF,
};

// 1 — golden release
const ledgerRoot = path.join(outDir, "ledger");
const vl = LocalVerificationLedger.open(ledgerRoot, { now: () => 1_700_000_000 });
const created = vl.createEscrowForVerification({
  escrow_ref: ESCROW_REF, asset: ASSET, amount: "10",
  outcome_receipt_hash: receipt.content_hash,
  claim_record_hash: claimAuthority(claim).claim_record_hash,
});
if (created.status !== "CREATED") throw new Error(`escrow not created: ${JSON.stringify(created)}`);
const rel1 = vl.attemptRelease({ receipt, instruction: instruction("1"), claim_record: claim });
if (rel1.status !== "RELEASED") throw new Error(`golden release failed: ${JSON.stringify(rel1)}`);
const rel2 = vl.attemptRelease({ receipt, instruction: instruction("2"), claim_record: claim });
if (rel2.status !== "ALREADY_RELEASED") throw new Error(`different-nonce replay must be ALREADY_RELEASED: ${JSON.stringify(rel2)}`);
const wrongPayee = vl.attemptRelease({ receipt, instruction: instruction("3", "agent:impostor"), claim_record: claim });
if (wrongPayee.status !== "REJECTED_CLAIMANT") throw new Error(`wrong payee must be rejected: ${JSON.stringify(wrongPayee)}`);

// 2 — sealed evidence + third-party re-verification
const evidence = buildSettlementEvidence(vl, ESCROW_REF, { receipt, claim_record: claim });
if (!verifySettlementEvidence(evidence)) throw new Error("evidence seal failed third-party re-verification");
writeFileSync(path.join(outDir, "settlement-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");

// 3 — restart + idempotence sweep
const reopened = EscrowLedger.open(ledgerRoot);
const afterRestart = reopened.attemptRelease({ receipt, instruction: instruction("4"), claim_record: claim });
if (afterRestart.status !== "ALREADY_RELEASED") throw new Error("post-restart replay must be ALREADY_RELEASED");

report.golden_release = "RELEASED";
report.different_nonce_replay = rel2.status;
report.wrong_payee = wrongPayee.status;
report.post_restart_replay = afterRestart.status;
report.settlement_key = rel1.settlement_key;
report.evidence_hash = evidence.evidence_hash;
report.links_resolved = Object.keys(evidence.links);
writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
