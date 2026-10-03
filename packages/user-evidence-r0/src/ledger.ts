/**
 * USER-EVIDENCE-R0 / UE-5 (CUT-2R) — user-evidence recorder + final ledger.
 *
 * CUT-2R closes AUDIT-C blockers C1/C2:
 *
 * C1 (UE5-R-PROVENANCE): user evidence is HUMAN observation, and the
 * machine cannot verify humans — so it must never be presented as machine
 * proof. Every observation carries its provenance (source class, observer,
 * exact source record + its hash) and an attestation class. The final
 * report separates TECHNICAL EVIDENCE (= VERIFIED, replay-derived) from
 * USER EVIDENCE (= OBSERVED / UNSIGNED | PAYER-ATTESTED). Never one PASS.
 *
 * C2 (UE5-R-FINALITY): one experiment cannot silently produce two
 * contradictory final ledgers. Observations are append-only revisions
 * (observations/001.json, 002.json, …); the FINAL ledger is one file per
 * experiment, generated once, never regenerated.
 *
 * Standing discipline (unchanged): user evidence may only be recorded on a
 * proof pack whose independent replay PASSES with reproduced Tier-1 VALID,
 * and the replay report is bound to the pack by manifest hash AND a digest
 * over every pack byte.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { replayPack } from "./portable-replay.mjs";
import { verifyFreezePackDir } from "./pack.ts";

export class LedgerError extends Error {
  constructor(readonly reason: string, message: string) {
    super(`LEDGER-REFUSED (${reason}): ${message}`);
  }
}

export type ObservationSource = "INTERVIEW" | "GITHUB_COMMENT" | "EMAIL" | "SIGNED_STATEMENT" | "OTHER";
export type PayerAttestation = "SIGNED" | "UNSIGNED_RECORDED";

export interface LedgerObservationsV1 {
  schema_version: "real-task-ledger-observations.v1";
  /** observed replay relation: SAME = third party re-derived the same verdict */
  third_party_replay: "SAME" | "DIFFERENT";
  payer_accepts_tier1: boolean;
  /** the payer's verbatim words — durable record, required when accepted */
  payer_ack_verbatim: string;
  payer_ack_timestamp: string;
  posthoc_rule_change_attempts: number;
  posthoc_rule_change_details: string[];
  repeat_fund_intent: "YES" | "NO" | "NOT_ASKED";
  // ── UE5-R-PROVENANCE (CUT-2R) ──
  observation_source: ObservationSource;
  observer_identity: string;
  /** the exact observed text / file content / message reference */
  source_record: string;
  /** sha256 over the UTF-8 bytes of source_record — recomputed, never trusted */
  source_record_sha256: string;
  payer_attestation: PayerAttestation;
  recorded_at: string;
}

export interface ObservationFileV1 {
  schema_version: "real-task-observation.v1";
  seq: number;
  recorded_at: string;
  pack_binding: { proof_manifest_sha256: string; files_binding: string };
  replay_check: { status: "PASS"; tier1_verdict: "VALID" };
  observations: LedgerObservationsV1;
}

export interface LedgerV1 {
  schema_version: "real-task-ledger.v1";
  experiment_id: string;
  finalized_at: string;
  finality: { observation_seq: number; observations_total: number; final: true };
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
    observation_source: ObservationSource;
    observer_identity: string;
    source_record: string;
    source_record_sha256: string;
    payer_attestation: PayerAttestation;
    attestation_class: "OBSERVED / UNSIGNED" | "PAYER-ATTESTED";
  };
  verdict: "THESIS STRENGTHENED" | "THESIS MIXED" | "THESIS CHALLENGED";
  rendered: string;
}

export type ThesisVerdict = LedgerV1["verdict"];

const sha256File = (p: string): string => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex");
const sha256Text = (s: string): string => "sha256:" + createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

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
  // UE5-R-PROVENANCE: no observation without a source, an observer, and a hash-bound record
  if (!["INTERVIEW", "GITHUB_COMMENT", "EMAIL", "SIGNED_STATEMENT", "OTHER"].includes(o.observation_source ?? "")) {
    bad("observation_source", "INTERVIEW | GITHUB_COMMENT | EMAIL | SIGNED_STATEMENT | OTHER required");
  }
  if (typeof o.observer_identity !== "string" || o.observer_identity.trim() === "") bad("observer_identity", "who recorded this observation");
  if (typeof o.source_record !== "string" || o.source_record.trim() === "") bad("source_record", "the exact observed text/reference");
  if (!/^sha256:[0-9a-f]{64}$/.test(o.source_record_sha256 ?? "")) bad("source_record_sha256", "sha256 grammar required");
  if (sha256Text(o.source_record) !== o.source_record_sha256) bad("source_record_sha256", "does not hash to source_record — never trusted, always recomputed");
  if (!["SIGNED", "UNSIGNED_RECORDED"].includes(o.payer_attestation ?? "")) bad("payer_attestation", "SIGNED | UNSIGNED_RECORDED required");
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

interface PackContext {
  task: { experiment_id: string; payer_identity: string; worker_identity: string; base_commit_sha: string; payer_precommit_timestamp: string };
  proofManifest: { verification_ruleset_hash: string; contract_freeze_hash: string; precommit_binding: string; patch_sha256: string };
  record: { checks: { determinism: string } };
  proofManifestSha: string;
  filesBinding: string;
}

function loadPackContext(packDir: string): PackContext {
  // the proof pack carries the freeze generation byte-verbatim, so the full
  // freeze closure re-verifies from the proof pack itself
  verifyFreezePackDir(packDir);
  const manifestPath = path.join(packDir, "proof-manifest.json");
  if (!existsSync(manifestPath)) throw new LedgerError("not-a-proof-pack", `${packDir} has no proof-manifest.json`);
  return {
    task: JSON.parse(readFileSync(path.join(packDir, "task.json"), "utf8")),
    proofManifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    record: JSON.parse(readFileSync(path.join(packDir, "run-record.json"), "utf8")),
    proofManifestSha: sha256File(manifestPath),
    filesBinding: filesBindingOf(packDir),
  };
}

function writeImmutable(file: string, content: string): void {
  if (existsSync(file)) throw new LedgerError("out-exists", `${file} already exists — append-only, never rewritten`);
  const tmp = file + ".tmp-" + process.pid;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * UE5-R-FINALITY step 1: append observation NNN (next sequence) under
 * <expDir>/observations/. Revisions are allowed and recorded; files are
 * immutable. Each observation binds to the CURRENT pack bytes.
 */
export function recordObservation(
  packDir: string,
  observations: LedgerObservationsV1,
  expDir: string,
  opts: { replayReport?: unknown } = {},
): ObservationFileV1 {
  const ctx = loadPackContext(packDir);
  const report = opts.replayReport ?? replayPack(packDir, { replayedAt: observations.recorded_at });
  assertReplayReport(report, ctx.proofManifestSha, ctx.filesBinding);
  assertObservations(observations);

  const obsDir = path.join(expDir, "observations");
  mkdirSync(obsDir, { recursive: true });
  const existing = readdirSync(obsDir)
    .filter((f) => /^\d{3}\.json$/.test(f))
    .map((f) => Number(f.slice(0, 3)))
    .sort((a, b) => a - b);
  const seq = (existing[existing.length - 1] ?? 0) + 1;
  const file: ObservationFileV1 = {
    schema_version: "real-task-observation.v1",
    seq,
    recorded_at: observations.recorded_at,
    pack_binding: { proof_manifest_sha256: ctx.proofManifestSha, files_binding: ctx.filesBinding },
    replay_check: { status: "PASS", tier1_verdict: "VALID" },
    observations,
  };
  const target = path.join(obsDir, String(seq).padStart(3, "0") + ".json");
  if (existsSync(target)) throw new LedgerError("out-exists", `observation ${seq} already exists`);
  writeImmutable(target, JSON.stringify(file, null, 2) + "\n");
  return file;
}

/**
 * UE5-R-FINALITY step 2: ONE final ledger per experiment, built from the
 * LATEST observation, written once, never regenerated. Contradictory final
 * ledgers for one experiment are structurally impossible (single path +
 * no-overwrite + no-regeneration).
 */
export function finalizeLedger(packDir: string, expDir: string, opts: { replayReport?: unknown } = {}): LedgerV1 {
  const ctx = loadPackContext(packDir);
  const obsDir = path.join(expDir, "observations");
  if (!existsSync(obsDir)) throw new LedgerError("no-observations", `${obsDir} does not exist — record observations first`);
  const seqs = readdirSync(obsDir)
    .filter((f) => /^\d{3}\.json$/.test(f))
    .map((f) => Number(f.slice(0, 3)))
    .sort((a, b) => a - b);
  if (seqs.length === 0) throw new LedgerError("no-observations", "observations dir is empty");
  const latestSeq = seqs[seqs.length - 1]!;
  const obsFile = JSON.parse(readFileSync(path.join(obsDir, String(latestSeq).padStart(3, "0") + ".json"), "utf8")) as ObservationFileV1;
  // the final ledger re-validates the observation provenance AND the replay
  assertObservations(obsFile.observations);
  const report = opts.replayReport ?? replayPack(packDir, { replayedAt: obsFile.observations.recorded_at });
  assertReplayReport(report, ctx.proofManifestSha, ctx.filesBinding);

  const o = obsFile.observations;
  const verdict = thesisVerdictOf(o);
  const attestationClass: LedgerV1["user_evidence"]["attestation_class"] = o.payer_attestation === "SIGNED" ? "PAYER-ATTESTED" : "OBSERVED / UNSIGNED";
  const ledger: LedgerV1 = {
    schema_version: "real-task-ledger.v1",
    experiment_id: ctx.task.experiment_id,
    finalized_at: o.recorded_at,
    finality: { observation_seq: latestSeq, observations_total: seqs.length, final: true },
    technical: {
      tier1_verdict: "VALID",
      third_party_replay: "SAME",
      verification_ruleset_hash: ctx.proofManifest.verification_ruleset_hash,
      contract_freeze_hash: ctx.proofManifest.contract_freeze_hash,
      precommit_binding: ctx.proofManifest.precommit_binding,
      patch_sha256: ctx.proofManifest.patch_sha256,
      determinism: ctx.record.checks.determinism,
      proof_manifest_sha256: ctx.proofManifestSha,
    },
    user_evidence: {
      payer_identity: ctx.task.payer_identity,
      worker_identity: ctx.task.worker_identity,
      payer_accepts_tier1: o.payer_accepts_tier1,
      payer_ack_verbatim: o.payer_ack_verbatim,
      payer_ack_timestamp: o.payer_ack_timestamp,
      posthoc_rule_change_attempts: o.posthoc_rule_change_attempts,
      posthoc_rule_change_details: o.posthoc_rule_change_details,
      repeat_fund_intent: o.repeat_fund_intent,
      observation_source: o.observation_source,
      observer_identity: o.observer_identity,
      source_record: o.source_record,
      source_record_sha256: o.source_record_sha256,
      payer_attestation: o.payer_attestation,
      attestation_class: attestationClass,
    },
    verdict,
    rendered: [
      `REAL PAYER: ${ctx.task.payer_identity}`,
      `REAL TASK: ${ctx.task.experiment_id} @ ${ctx.task.base_commit_sha}`,
      `REAL EXTERNAL WORKER: ${ctx.task.worker_identity}`,
      `PAYER PRE-COMMIT: bound @ ${ctx.proofManifest.precommit_binding} (${ctx.task.payer_precommit_timestamp})`,
      `BASE RED / PATCH GREEN / FULL SUITE: RED / GREEN / GREEN (${ctx.record.checks.determinism})`,
      `THIRD-PARTY REPLAY: SAME`,
      `PAYER ACCEPTS TIER-1 ENTITLEMENT: ${o.payer_accepts_tier1 ? "YES" : "NO"}`,
      `POST-HOC RULE CHANGE REQUEST: ${o.posthoc_rule_change_attempts}`,
      `REPEAT-FUND INTENT: ${o.repeat_fund_intent}`,
      `OBSERVATION SOURCE: ${o.observation_source} (seq ${latestSeq}/${seqs.length}, record ${o.source_record_sha256})`,
      `OBSERVER: ${o.observer_identity}`,
      `PAYER ATTESTATION: ${o.payer_attestation}`,
      `TECHNICAL EVIDENCE: VERIFIED`,
      `USER EVIDENCE: ${attestationClass}`,
      `VERDICT: ${verdict}`,
    ].join("\n"),
  };
  writeImmutable(path.join(expDir, "final-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
  return ledger;
}

if (process.argv[1]?.endsWith("ledger.ts") && process.argv[2] === "experiment" && (process.argv[3] === "observe" || process.argv[3] === "finalize")) {
  const [, , , cmd, packArg, secondArg, thirdArg] = process.argv;
  try {
    if (cmd === "observe") {
      if (!packArg || !secondArg || !thirdArg) {
        console.error("usage: node --experimental-strip-types src/ledger.ts experiment observe <proof-pack-dir> <observations.json> <exp-dir>");
        process.exit(2);
      }
      const o = JSON.parse(readFileSync(secondArg, "utf8")) as LedgerObservationsV1;
      const f = recordObservation(path.resolve(packArg), o, path.resolve(thirdArg));
      console.log(`OBSERVATION ${String(f.seq).padStart(3, "0")} recorded (append-only).`);
    } else {
      if (!packArg || !secondArg) {
        console.error("usage: node --experimental-strip-types src/ledger.ts experiment finalize <proof-pack-dir> <exp-dir>");
        process.exit(2);
      }
      const l = finalizeLedger(path.resolve(packArg), path.resolve(secondArg));
      console.log(l.rendered);
    }
  } catch (e) {
    console.error(String((e as Error).message));
    process.exit(1);
  }
}
