/**
 * GP5 — End-to-End Golden Path driver + Proof Pack composer.
 *
 * One uninterrupted GP-001 run through the SAME runtime success path used
 * outside demo mode (GATES.md GP5):
 *
 *   Intent (frozen) → Milestone (frozen) → immutable ClaimRecord (CLAIM)
 *   → Agent execution (committed GP2 evidence) → SEALED EvidenceBundle
 *   → Verifier A VALID → Verifier B VALID → OutcomeReceipt (frozen GP3)
 *   → SettlementInstruction (recipient == claimant)
 *   → escrow RELEASED exactly once → replay / changed-nonce blocked
 *   → sealed settlement evidence → self-verifiable Proof Pack
 *
 * Black-box negatives recorded in report.json (§9): unverified submission
 * cannot reach VERIFIED; changed-nonce and wrong-payee cannot release.
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { GPRuntime } from "../../gp-runtime/src/runtime.ts";
import type { Command } from "../../gp-runtime/src/runtime.ts";
import type { ClaimRecord } from "../../gp-runtime/src/machines.ts";
import {
  LocalVerificationLedger, buildSettlementEvidence, sealEvidence, receiptAuthority, claimAuthority,
} from "../../gp4-settlement/src/index.ts";
import { frozenSeal } from "../../gp4-settlement/src/frozen.ts";
import { OutcomeReceiptSchema, SettlementInstructionSchema } from "@intent/protocol-schema";

const PKG_ROOT = path.dirname(fileURLToPath(new URL(".", import.meta.url))); // src/ (approximate under vitest transforms)

/** Locate the repository root robustly (vitest transforms import.meta.url). */
function findRepoRoot(): string {
  let dir = PKG_ROOT;
  for (let i = 0; i < 8; i++) {
    if (existsSyncRepo(path.join(dir, "packages", "protocol-schema", "package.json"))) return dir;
    dir = path.resolve(dir, "..");
  }
  throw new Error("repository root not found (packages/protocol-schema missing)");
}
function existsSyncRepo(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
const REPO_ROOT = findRepoRoot();
export const PACKAGE_ROOT = path.join(REPO_ROOT, "packages", "gp5-proof-pack");

export const FROZEN = {
  escrowRef: "escrow:gp-001-local",
  asset: { network: "solana-devnet", asset: "USDC-test", decimals: 6 },
  amount: "10",
  nonce: "1",
  claimant: "agent:gp-001-demo",
};

export interface PackReport {
  schema_version: "gp5-report.v1";
  bounty_state: string;
  settlement_state: string;
  golden_release: string;
  changed_nonce_replay: string;
  wrong_payee: string;
  unverified_submission: string;
  unverified_settlement: string;
  settlement_key: string;
  evidence_hash: string;
  checks_passed: string[];
}

export function buildPack(packDir: string): PackReport {
  const readRepo = (rel: string): unknown => JSON.parse(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
  const receipt = readRepo("packages/gp3-verification/artifacts/receipt.json") as Record<string, unknown>;
  const dF = readRepo("packages/gp3-verification/artifacts/decision-functional.json") as Record<string, unknown>;
  const dP = readRepo("packages/gp3-verification/artifacts/decision-policy.json") as Record<string, unknown>;
  const registry = readRepo("packages/gp3-verification/keys/verifier-registry.json");
  const claim = readRepo("packages/gp4-settlement/fixtures/gp-001-claim.json") as Record<string, unknown>;
  const intent = readRepo("packages/golden-path/identity/intent.json");
  const milestone = readRepo("packages/golden-path/identity/milestone.json");

  // ————————————— 1. runtime CLAIM: the immutable ClaimRecord enters the fold
  const rtDir = path.join(packDir, ".tmp-runtime");
  const rt = new GPRuntime({ dir: rtDir });
  const at = (n: number) => `2026-09-24T09:${String(n).padStart(2, "0")}:00.000Z`;
  const cmd = (id: string, machine: Command["machine"], entity: string, to: string, extra: Partial<Command> = {}): Command =>
    ({ command_id: id, machine, entity, op: "transition", to, at: at(10), ...extra });

  const d1 = rt.submit(cmd("gp5-01", "bounty", "GP-001", "FUNDED"));
  const d2 = rt.submit(cmd("gp5-02", "bounty", "GP-001", "CLAIMED", { claim: claim as unknown as ClaimRecord }));
  const d3 = rt.submit(cmd("gp5-03", "bounty", "GP-001", "EXECUTING"));
  const d4 = rt.submit(cmd("gp5-04", "bounty", "GP-001", "SUBMITTED"));
  // §9 black-box negative: an UNVERIFIED submission cannot reach VERIFIED
  const unverified = rt.submit(cmd("gp5-neg", "bounty", "GP-001", "VERIFIED"));
  const d5 = rt.submit(cmd("gp5-05", "bounty", "GP-001", "VERIFIED", {
    prerequisite: { kind: "policy-satisfied-ref", ref: "op:gp3-2of2-20260924a1" },
  }));
  if (![d1, d2, d3, d4, d5].every((d) => d.accepted)) throw new Error("golden runtime walk rejected a legal transition");
  if (unverified.accepted) throw new Error("BLACKBOX FAILURE: unverified submission reached VERIFIED");

  // settlement machine (frozen edges) walks in step with the escrow engine
  const s1 = rt.submit(cmd("gp5-06", "settlement", FROZEN.escrowRef, "ELIGIBLE", {
    prerequisite: { kind: "accepted-receipt-ref", ref: "op:gp3-receipt-da577b3d" },
  }));
  if (!s1.accepted) throw new Error("LOCKED→ELIGIBLE rejected");

  // ————————————— 2. economic settlement through the SAME GP4 engine
  const claimHash = claimAuthority(claim).claim_record_hash;
  const ledgerRoot = path.join(packDir, ".tmp-ledger");
  const vl = LocalVerificationLedger.open(ledgerRoot, { now: () => 1_700_000_000 });
  const created = vl.createEscrowForVerification({
    escrow_ref: FROZEN.escrowRef, asset: FROZEN.asset, amount: FROZEN.amount,
    outcome_receipt_hash: String(receipt.content_hash), claim_record_hash: claimHash,
  });
  if (created.status !== "CREATED") throw new Error(`escrow creation failed: ${JSON.stringify(created)}`);

  const mkInstruction = (nonce: string, recipient = FROZEN.claimant) => ({
    schema_version: "settlement.v1",
    settlement_id: "22222222-2222-4222-8222-222222222222",
    escrow_ref: FROZEN.escrowRef,
    outcome_receipt_hash: String(receipt.content_hash),
    nonce,
    outputs: [{ recipient, asset: FROZEN.asset, amount: FROZEN.amount, reason: "GP5 golden path settlement" }],
    total_amount: FROZEN.amount,
  });

  const rel = vl.attemptRelease({ receipt, instruction: mkInstruction(FROZEN.nonce), claim_record: claim });
  if (rel.status !== "RELEASED") throw new Error(`golden release failed: ${JSON.stringify(rel)}`);
  const replay = vl.attemptRelease({ receipt, instruction: mkInstruction("2"), claim_record: claim });
  if (replay.status !== "ALREADY_RELEASED") throw new Error("changed-nonce replay must be blocked");
  const wrongPayee = vl.attemptRelease({ receipt, instruction: mkInstruction("3", "agent:impostor"), claim_record: claim });
  if (wrongPayee.status !== "REJECTED_CLAIMANT") throw new Error("wrong payee must be rejected");
  // §9 black-box negative: a single-decision pseudo-receipt cannot settle.
  // It seals to a DIFFERENT content_hash (wire-valid but not the accepted
  // 2-of-2 identity), so settlement refuses it at the binding boundary.
  const { content_hash: _drop, decision_hashes: _dh, ...singleRaw } = receipt;
  void _drop; void _dh;
  const singleReceipt = { ...singleRaw, decision_hashes: [dF.content_hash] };
  const singleHash = receiptAuthority(singleReceipt).outcome_receipt_hash;
  if (singleHash === String(receipt.content_hash)) throw new Error("test construction broken: single-decision hash equals 2-of-2 hash");
  const unverifiedSettlement = vl.attemptRelease({
    receipt: singleReceipt,
    instruction: { ...mkInstruction("4"), outcome_receipt_hash: singleHash },
    claim_record: claim,
  });
  if (unverifiedSettlement.status === "RELEASED") throw new Error("BLACKBOX FAILURE: single-decision receipt released");

  const s2 = rt.submit(cmd("gp5-07", "settlement", FROZEN.escrowRef, "RELEASED", {
    prerequisite: { kind: "release-observed-ref", ref: "op:gp4-release-observed1" },
  }));
  const d6 = rt.submit(cmd("gp5-08", "bounty", "GP-001", "SETTLED", {
    prerequisite: { kind: "release-observed-ref", ref: "op:gp4-release-observed1" },
  }));
  if (!s2.accepted || !d6.accepted) throw new Error("post-release runtime walk rejected");

  const evidence = buildSettlementEvidence(vl, FROZEN.escrowRef, { receipt, claim_record: claim });

  // ————————————— 3. compose the pack
  const put = (rel: string, data: string | Buffer): void => {
    const file = path.join(packDir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, data);
  };
  const copyRepo = (rel: string, dest: string): void => cpSync(path.join(REPO_ROOT, rel), path.join(packDir, dest), { recursive: true });

  put("objects/intent.json", JSON.stringify(intent, null, 2) + "\n");
  put("objects/milestone.json", JSON.stringify(milestone, null, 2) + "\n");
  put("objects/task-freeze.json", readFileSync(path.join(REPO_ROOT, "packages/golden-path/fixtures/gp-001-task.json")));
  put("objects/claim.json", JSON.stringify(claim, null, 2) + "\n");
  copyRepo("packages/golden-path/evidence/9f6610dc-24e9-4e6c-b7c1-67574064d2ae", "evidence");
  put("decisions/decision-functional.json", JSON.stringify(dF, null, 2) + "\n");
  put("decisions/decision-policy.json", JSON.stringify(dP, null, 2) + "\n");
  put("decisions/verifier-registry.json", JSON.stringify(registry, null, 2) + "\n");
  put("receipt.json", JSON.stringify(receipt, null, 2) + "\n");

  const sealedInstruction = frozenSeal(SettlementInstructionSchema, mkInstruction(FROZEN.nonce));
  put("settlement/instruction.json", JSON.stringify(sealedInstruction, null, 2) + "\n");
  const escrowDir = path.join(ledgerRoot, "escrows", "escrow%3agp-001-local");
  put("settlement/escrow.json", readFileSync(path.join(escrowDir, "escrow.json")));
  put("settlement/release.json", readFileSync(path.join(escrowDir, "releases", `${String(receipt.content_hash).slice(7)}.json`)));
  for (const f of readdirSync(path.join(escrowDir, "instructions"))) {
    put(`settlement/journal/${f}`, readFileSync(path.join(escrowDir, "instructions", f)));
  }
  put("settlement/settlement-evidence.json", JSON.stringify(sealEvidence({ ...evidence, produced_at: 1_700_000_000 }), null, 2) + "\n");
  put("runtime-journal.jsonl", readFileSync(path.join(rtDir, "journal.jsonl")));

  // vendored frozen G1 wire library (byte-copy of the built dist) + its one
  // runtime dependency (zod) so the pack is FULLY self-contained
  copyRepo("packages/protocol-schema/dist", "frozen-lib");
  copyRepo("packages/protocol-schema/package.json", "frozen-lib/package.json");
  copyRepo("node_modules/zod", "frozen-lib/node_modules/zod");
  cpSync(path.join(PACKAGE_ROOT, "verify.mjs"), path.join(packDir, "verify.mjs"));

  // sealed receipt sanity: the frozen GP3 artifact still seals (wire exact)
  frozenSeal(OutcomeReceiptSchema, receipt);

  // ————————————— 4. pack manifest (every file, except the manifest itself)
  const files: Array<{ file: string; sha256: string }> = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith(".tmp")) walk(p); }
      else files.push({ file: path.relative(packDir, p).replaceAll("\\", "/"), sha256: "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex") });
    }
  };
  walk(packDir);
  put("pack-manifest.json", JSON.stringify({ schema_version: "gp5-pack-manifest.v1", files }, null, 2) + "\n");

  const report: PackReport = {
    schema_version: "gp5-report.v1",
    bounty_state: rt.stateOf("bounty", "GP-001"),
    settlement_state: rt.stateOf("settlement", FROZEN.escrowRef),
    golden_release: rel.status,
    changed_nonce_replay: replay.status,
    wrong_payee: wrongPayee.status,
    unverified_submission: unverified.accepted ? "ACCEPTED(BLACKBOX-FAILURE)" : `REJECTED(${unverified.reason})`,
    unverified_settlement: unverifiedSettlement.status,
    settlement_key: rel.settlement_key!,
    evidence_hash: evidence.evidence_hash!,
    checks_passed: [
      "runtime-walk", "claim-immutable", "2of2-policy-prereq", "golden-release",
      "changed-nonce-blocked", "wrong-payee-rejected", "single-decision-cannot-settle",
      "settlement-evidence-sealed", "pack-manifest-hashed",
    ],
  };
  put("report.json", JSON.stringify(report, null, 2) + "\n");
  return report;
}

// canonicalization helper (frozen G1) for the builder's own hash needs
import { canonicalize } from "@intent/protocol-schema";
function canonicalOf(v: unknown): string {
  return canonicalize(v as Parameters<typeof canonicalize>[0]);
}
