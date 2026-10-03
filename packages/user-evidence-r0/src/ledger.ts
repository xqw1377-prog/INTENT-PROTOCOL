/**
 * USER-EVIDENCE-R0 / UE-5 (CUT-4) — user-evidence recorder + final ledger.
 *
 * The ledger is the ONLY allowed experiment report form (contract §6).
 * Discipline: user evidence may ONLY be recorded on top of a proof pack
 * whose independent replay PASSES with reproduced Tier-1 verdict VALID —
 * a self-declared VALID is never sufficient. The replay report is bound
 * to the pack by proof-manifest hash, so a pack tampered after the replay
 * is refused. Technical evidence and user evidence stay in separate
 * fields and are never conflated (PT-5R1).
 *
 * Frozen verdict mapping (contract §10):
 *   payer does NOT accept the Tier-1 entitlement            → THESIS CHALLENGED
 *   payer accepts ∧ any post-hoc rule-change attempt        → THESIS MIXED
 *   payer accepts ∧ 0 attempts ∧ repeat-fund ≠ YES          → THESIS MIXED
 *   payer accepts ∧ 0 attempts ∧ repeat-fund = YES          → THESIS STRENGTHENED
 * third_party_replay = DIFFERENT refuses the ledger entirely (technical
 * crisis; user evidence is not recorded on an irreproducible pack).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { replayPack } from "./portable-replay.mjs";
import { verifyFreezePackDir } from "./pack.ts";

export class LedgerError extends Error {
  constructor(readonly reason: string, message: string) {
    super(`LEDGER-REFUSED (${reason}): ${message}`);
  }
}

export interface LedgerObservationsV1 {
  schema_version: "real-task-ledger-observations.v1";
  /** observed replay relation: SAME = third party re-derived the same verdict */
  third_party_replay: "SAME" | "DIFFERENT";
  payer_accepts_tier1: boolean;
  /** the payer's verbatim words, durable record — required when accepted */
  payer_ack_verbatim: string;
  payer_ack_timestamp: string;
  posthoc_rule_change_attempts: number;
  posthoc_rule_change_details: string[];
  repeat_fund_intent: "YES" | "NO" | "NOT_ASKED";
  recorded_at: string;
}

export interface LedgerV1 {
  schema_version: "real-task-ledger.v1";
  experiment_id: string;
  technical: {
    tier1_verdict: "VALID";
    third_party_replay: "SAME";
    verification_ruleset_hash: string;
    contract_freeze_hash: string;
    precommit_binding: string;
    patch_sha256: string;
    determinism: string;
    proof_manifest_sha256: string;
  };
  user_evidence: {
    payer_identity: string;
    worker_identity: string;
    payer_accepts_tier1: boolean;
    payer_ack_verbatim: string;
    payer_ack_timestamp: string;
    posthoc_rule_change_attempts: number;
    posthoc_rule_change_details: string[];
    repeat_fund_intent: "YES" | "NO" | "NOT_ASKED";
  };
  verdict: "THESIS STRENGTHENED" | "THESIS MIXED" | "THESIS CHALLENGED";
  rendered: string;
}

export type ThesisVerdict = LedgerV1["verdict"];

const sha256File = (p: string): string => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex");

/** The frozen §10 mapping — total, deterministic, no free variable. */
export function thesisVerdictOf(o: Pick<LedgerObservationsV1, "payer_accepts_tier1" | "posthoc_rule_change_attempts" | "repeat_fund_intent">): ThesisVerdict {
  if (!o.payer_accepts_tier1) return "THESIS CHALLENGED";
  if (o.posthoc_rule_change_attempts > 0) return "THESIS MIXED";
  if (o.repeat_fund_intent !== "YES") return "THESIS MIXED";
  return "THESIS STRENGTHENED";
}

function assertObservations(o: LedgerObservationsV1): void {
  const bad = (reason: string, msg: string): never => {
    throw new LedgerError("observations", `${reason}: ${msg}`);
  };
  if (o.schema_version !== "real-task-ledger-observations.v1") bad("schema_version", String(o.schema_version));
  if (o.third_party_replay === "DIFFERENT") bad("third_party_replay", "DIFFERENT — an irreproducible pack carries no user evidence");
  if (o.third_party_replay !== "SAME") bad("third_party_replay", String(o.third_party_replay));
  if (typeof o.payer_accepts_tier1 !== "boolean") bad("payer_accepts_tier1", "must be boolean");
  if (o.payer_accepts_tier1 && (typeof o.payer_ack_verbatim !== "string" || o.payer_ack_verbatim.trim() === "")) {
    bad("payer_ack_verbatim", "acceptance requires the payer's verbatim words");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(o.payer_ack_timestamp ?? "")) bad("payer_ack_timestamp", "ISO-8601 Z required");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(o.recorded_at ?? "")) bad("recorded_at", "ISO-8601 Z required");
  if (!Number.isInteger(o.posthoc_rule_change_attempts) || o.posthoc_rule_change_attempts < 0) bad("posthoc_rule_change_attempts", "integer >= 0 required");
  if (!Array.isArray(o.posthoc_rule_change_details)) bad("posthoc_rule_change_details", "array required");
  if (o.posthoc_rule_change_details.length !== o.posthoc_rule_change_attempts) bad("posthoc_rule_change_details", "one detail per attempt");
  if (!["YES", "NO", "NOT_ASKED"].includes(o.repeat_fund_intent)) bad("repeat_fund_intent", String(o.repeat_fund_intent));
}

/** Structural replay-report check: PASS, same verdict, VALID, bound to EVERY byte of THIS pack. */
function assertReplayReport(report: unknown, proofManifestSha: string, filesBinding: string): void {
  const r = report as Record<string, unknown> | null | undefined;
  const bad = (reason: string, msg: string): never => {
    throw new LedgerError("replay", `${reason}: ${msg}`);
  };
  if (!r || typeof r !== "object") bad("not-a-report", "replay report missing");
  if (r.schema_version !== "portable-replay-report.v1") bad("schema_version", String(r.schema_version));
  if (r.status !== "PASS") bad("status", `replay status ${String(r.status)} (${String(r.fail_reason ?? "")})`);
  if (r.same_verdict !== true) bad("same_verdict", "reproduced verdict differs from the recorded one");
  const reproduced = r.reproduced as Record<string, unknown> | undefined;
  if (!reproduced || reproduced.tier1_verdict !== "VALID") bad("tier1", "reproduced Tier-1 verdict is not VALID — no entitlement to ask about");
  if (r.proof_manifest_sha256 !== proofManifestSha) bad("pack-binding", "replay report was produced against DIFFERENT pack bytes");
  if (r.files_binding !== filesBinding) bad("pack-binding", "replay report predates the current pack file set (files_binding mismatch)");
}

/** Digest over every actual pack byte (proof-manifest.json excluded — it is the hashed, not the hasher). */
function filesBindingOf(packDir: string): string {
  const names = readdirSync(packDir)
    .filter((f) => f !== "proof-manifest.json")
    .sort();
  const obj: Record<string, string> = {};
  for (const n of names) obj[n] = sha256File(path.join(packDir, n));
  return "sha256:" + createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

export function recordLedger(
  packDir: string,
  observations: LedgerObservationsV1,
  outPath: string,
  opts: { replayReport?: unknown } = {},
): LedgerV1 {
  // the proof pack carries the freeze generation byte-verbatim, so the full
  // freeze closure re-verifies from the proof pack itself
  verifyFreezePackDir(packDir);
  const manifestPath = path.join(packDir, "proof-manifest.json");
  if (!existsSync(manifestPath)) throw new LedgerError("not-a-proof-pack", `${packDir} has no proof-manifest.json`);
  const proofManifestSha = sha256File(manifestPath);
  const report = opts.replayReport ?? replayPack(packDir, { replayedAt: observations.recorded_at });
  assertReplayReport(report, proofManifestSha, filesBindingOf(packDir));
  assertObservations(observations);

  const task = JSON.parse(readFileSync(path.join(packDir, "task.json"), "utf8")) as {
    experiment_id: string;
    payer_identity: string;
    worker_identity: string;
    base_commit_sha: string;
    payer_precommit_timestamp: string;
  };
  const proofManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    verification_ruleset_hash: string;
    contract_freeze_hash: string;
    precommit_binding: string;
    patch_sha256: string;
  };
  const record = JSON.parse(readFileSync(path.join(packDir, "run-record.json"), "utf8")) as { checks: { determinism: string } };

  const verdict = thesisVerdictOf(observations);
  const ledger: LedgerV1 = {
    schema_version: "real-task-ledger.v1",
    experiment_id: task.experiment_id,
    technical: {
      tier1_verdict: "VALID",
      third_party_replay: "SAME",
      verification_ruleset_hash: proofManifest.verification_ruleset_hash,
      contract_freeze_hash: proofManifest.contract_freeze_hash,
      precommit_binding: proofManifest.precommit_binding,
      patch_sha256: proofManifest.patch_sha256,
      determinism: record.checks.determinism,
      proof_manifest_sha256: proofManifestSha,
    },
    user_evidence: {
      payer_identity: task.payer_identity,
      worker_identity: task.worker_identity,
      payer_accepts_tier1: observations.payer_accepts_tier1,
      payer_ack_verbatim: observations.payer_ack_verbatim,
      payer_ack_timestamp: observations.payer_ack_timestamp,
      posthoc_rule_change_attempts: observations.posthoc_rule_change_attempts,
      posthoc_rule_change_details: observations.posthoc_rule_change_details,
      repeat_fund_intent: observations.repeat_fund_intent,
    },
    verdict,
    rendered: [
      `REAL PAYER: ${task.payer_identity}`,
      `REAL TASK: ${task.experiment_id} @ ${task.base_commit_sha}`,
      `REAL EXTERNAL WORKER: ${task.worker_identity}`,
      `PAYER PRE-COMMIT: bound @ ${proofManifest.precommit_binding} (${task.payer_precommit_timestamp})`,
      `BASE RED / PATCH GREEN / FULL SUITE: RED / GREEN / GREEN (${record.checks.determinism})`,
      `THIRD-PARTY REPLAY: SAME`,
      `PAYER ACCEPTS TIER-1 ENTITLEMENT: ${observations.payer_accepts_tier1 ? "YES" : "NO"}`,
      `POST-HOC RULE CHANGE REQUEST: ${observations.posthoc_rule_change_attempts}`,
      `REPEAT-FUND INTENT: ${observations.repeat_fund_intent}`,
      `VERDICT: ${verdict}`,
    ].join("\n"),
  };

  if (existsSync(outPath)) throw new LedgerError("out-exists", `${outPath} already exists — the ledger is append-only, never rewritten`);
  const tmp = outPath + ".tmp-" + process.pid;
  try {
    writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n");
    renameSync(tmp, outPath);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return ledger;
}

if (process.argv[1]?.endsWith("ledger.ts") && process.argv[2] === "experiment" && process.argv[3] === "ledger") {
  const [, , , , packArg, obsArg, outArg] = process.argv;
  if (!packArg || !obsArg || !outArg) {
    console.error("usage: node --experimental-strip-types src/ledger.ts experiment ledger <proof-pack-dir> <observations.json> <out-ledger.json>");
    process.exit(2);
  }
  try {
    const o = JSON.parse(readFileSync(obsArg, "utf8")) as LedgerObservationsV1;
    const l = recordLedger(path.resolve(packArg), o, path.resolve(outArg));
    console.log(l.rendered);
  } catch (e) {
    console.error(String((e as Error).message));
    process.exit(1);
  }
}
