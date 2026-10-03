/**
 * FRONTEND-R1 (HOLD-6 / D7) — experiment state derivation.
 *
 * D7: "file existence alone is NOT sufficient to claim verification."
 * Every persistent fact below is derived by CALLING the frozen
 * verification boundaries — never by re-implementing them:
 *   rules  ← verifyFreezePackDir (UE-1 intake closure)
 *   primary← tier1VerdictOf (UE-3 derived-verdict function) + freeze binding
 *   replay ← structural report check + manifest-hash & pack-bytes-digest
 *            freshness against the CURRENT proof pack (D6)
 *   earned ← the spec's single formula: derived-VALID ∧ replay-PASS
 * The orchestrator keeps NO second state database; phase is a navigation
 * hint derived from these facts plus explicitly-transient process flags.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { verifyFreezePackDir } from "../../../packages/user-evidence-r0/src/pack.ts";
import { tier1VerdictOf } from "../../../packages/user-evidence-r0/src/proof.ts";
import { filesBindingOf, sha256OfFile } from "../../../packages/user-evidence-r0/src/ledger.ts";

export type RulesState = "DRAFT" | "FROZEN";
export type SubmissionState = "NONE" | "SUBMITTED";
export type PrimaryVerification = "PENDING" | "VALID" | "INVALID";
export type ReplayState = "PENDING" | "PASS" | "FAIL";
export type Tier1Entitlement = "PENDING" | "EARNED" | "NOT_EARNED";
export type PayerResponse = "NONE" | "RECORDED";
export type LedgerState = "OPEN" | "FINALIZED";

export interface ExperimentFacts {
  rules_state: RulesState;
  submission_state: SubmissionState;
  primary_verification: PrimaryVerification;
  replay: ReplayState;
  tier1_entitlement: Tier1Entitlement;
  payer_response: PayerResponse;
  ledger: LedgerState;
}

export type ExperimentPhase =
  | "DRAFT"
  | "CHECKING"
  | "READY_TO_FREEZE"
  | "FROZEN"
  | "SUBMITTED"
  | "VERIFYING"
  | "AWAITING_PAYER"
  | "FINALIZED";

export interface TransientStates {
  checking?: boolean;
  verifying?: boolean;
}

export interface ExperimentStateView {
  phase: ExperimentPhase;
  transient: { checking: boolean; verifying: boolean };
  facts: ExperimentFacts;
  hasDraft: boolean;
  hasEligibility: boolean;
  /** D5: readiness = current prepare report succeeded AND current draft matches the reviewed snapshot */
  readiness: { ready: boolean; reason: string };
  /** D5: published terms vs reviewed snapshot (UI must block its frozen claim on mismatch) */
  frozenTermsMatch: boolean | null;
  /** D7: the freeze generation re-verified (closure) — not mere presence */
  freezeVerified: boolean | null;
  /** D6: replay evidence freshness against the current proof pack */
  replayFresh: boolean | null;
  replayUntrustedReason: string | null;
}

export interface ExperimentPaths {
  draft: string;
  notes: string;
  eligibility: string;
  freezeDir: string;
  workerPatch: string;
  runRecord: string;
  replayReport: string;
  proofDir: string;
  observationsDir: string;
  finalLedger: string;
}

export function experimentPaths(expDir: string): ExperimentPaths {
  return {
    draft: path.join(expDir, "draft.json"),
    notes: path.join(expDir, "experiment-notes.json"),
    eligibility: path.join(expDir, "eligibility.json"),
    freezeDir: path.join(expDir, "freeze"),
    workerPatch: path.join(expDir, "worker.patch"),
    runRecord: path.join(expDir, "run-record.json"),
    replayReport: path.join(expDir, "replay-report.json"),
    proofDir: path.join(expDir, "proof"),
    observationsDir: path.join(expDir, "observations"),
    finalLedger: path.join(expDir, "final-ledger.json"),
  };
}

const readJson = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

/** D5: the reviewed input snapshot must equal the current draft, term by term. */
const REVIEWED_FIELDS = [
  "repoPath", "base_commit_sha", "payer_identity", "worker_identity", "tier1_reward", "tier2_reward",
  "allowed_paths", "forbidden_paths", "max_diff_lines", "determinism_runs",
  "regression_command", "baseline_health_command", "patched_acceptance_command",
] as const;

function deriveReadiness(expDir: string): { ready: boolean; reason: string } {
  const p = experimentPaths(expDir);
  if (!existsSync(p.eligibility)) return { ready: false, reason: "no prepare report — run Check eligibility" };
  const eligibility = readJson(p.eligibility);
  if (eligibility.ok !== true) return { ready: false, reason: `prepare failed: ${String(eligibility.reason ?? "")}` };
  const snapshot = eligibility.draft as Record<string, unknown> | undefined;
  const draft = existsSync(p.draft) ? (readJson(p.draft) as Record<string, unknown>) : null;
  if (!snapshot || !draft) return { ready: false, reason: "reviewed snapshot missing — re-prepare and re-check" };
  for (const f of REVIEWED_FIELDS) {
    if (JSON.stringify(snapshot[f]) !== JSON.stringify(draft[f])) {
      return { ready: false, reason: `reviewed inputs changed (${f}) — re-check eligibility before freeze` };
    }
  }
  return { ready: true, reason: "current prepare report matches the reviewed inputs" };
}

/** D5: published freeze terms vs the reviewed snapshot (blocks the UI frozen claim on mismatch). */
function deriveTermsMatch(expDir: string): boolean | null {
  const p = experimentPaths(expDir);
  if (!existsSync(path.join(p.freezeDir, "freeze-manifest.json"))) return null;
  if (!existsSync(p.eligibility)) return null;
  const eligibility = readJson(p.eligibility);
  const snapshot = eligibility.draft as Record<string, unknown> | undefined;
  if (!snapshot) return null;
  let task: Record<string, unknown>;
  try {
    task = readJson(path.join(p.freezeDir, "task.json"));
  } catch {
    return false;
  }
  const manifest = readJson(path.join(p.freezeDir, "freeze-manifest.json"));
  const pairs: Array<[unknown, unknown]> = [
    [task.payer_identity, snapshot.payer_identity],
    [task.worker_identity, snapshot.worker_identity],
    [task.tier1_reward, snapshot.tier1_reward],
    [task.tier2_reward, snapshot.tier2_reward],
    [task.base_commit_sha, snapshot.base_commit_sha],
    [task.allowed_paths, snapshot.allowed_paths],
    [task.forbidden_paths, snapshot.forbidden_paths],
    [task.max_diff_lines, snapshot.max_diff_lines],
    [task.determinism_runs, snapshot.determinism_runs],
    [task.commands, { regression_command: snapshot.regression_command, baseline_health_command: snapshot.baseline_health_command, patched_acceptance_command: snapshot.patched_acceptance_command, package_manager: "npm", install_command: "npm ci --ignore-scripts" }],
    [manifest.acceptance_suite_sha256, eligibility.suiteHash],
    [manifest.lockfile_sha256, eligibility.lockHash],
  ];
  return pairs.every(([a, b]) => JSON.stringify(a) === JSON.stringify(b));
}

/**
 * D6: replay evidence is PASS only when the report says PASS with the same
 * verdict AND binds FRESHLY to the CURRENT proof pack (manifest hash +
 * pack-bytes digest). Stale / mismatched / untrusted → FAIL, never PENDING.
 */
function deriveReplay(expDir: string): { state: ReplayState; fresh: boolean | null; untrustedReason: string | null } {
  const p = experimentPaths(expDir);
  if (!existsSync(p.replayReport)) return { state: "PENDING", fresh: null, untrustedReason: null };
  const packManifest = path.join(p.proofDir, "proof-manifest.json");
  if (!existsSync(packManifest)) return { state: "FAIL", fresh: false, untrustedReason: "replay report exists but the proof pack is missing" };
  let report: Record<string, unknown>;
  try {
    report = readJson(p.replayReport);
  } catch {
    return { state: "FAIL", fresh: false, untrustedReason: "replay report unparsable" };
  }
  if (report.schema_version !== "portable-replay-report.v1") return { state: "FAIL", fresh: false, untrustedReason: "replay report schema" };
  if (report.status !== "PASS" || report.same_verdict !== true) return { state: "FAIL", fresh: false, untrustedReason: `replay status ${String(report.status)} (${String(report.fail_reason ?? "")})` };
  const reproduced = report.reproduced as Record<string, unknown> | undefined;
  if (!reproduced || reproduced.tier1_verdict !== "VALID") return { state: "FAIL", fresh: false, untrustedReason: "reproduced verdict is not VALID" };
  const currentManifestSha = sha256OfFile(packManifest);
  if (report.proof_manifest_sha256 !== currentManifestSha) return { state: "FAIL", fresh: false, untrustedReason: "replay report is stale: proof-manifest changed after the replay" };
  let binding: string;
  try {
    binding = filesBindingOf(p.proofDir);
  } catch {
    return { state: "FAIL", fresh: false, untrustedReason: "proof pack unreadable for the bytes digest" };
  }
  if (report.files_binding !== binding) return { state: "FAIL", fresh: false, untrustedReason: "replay report predates the current pack bytes" };
  return { state: "PASS", fresh: true, untrustedReason: null };
}

/** Derive every UI fact from the experiment directory by CALLING the frozen boundaries. */
export function deriveExperimentFacts(expDir: string): ExperimentFacts {
  const p = experimentPaths(expDir);

  const rules_state: RulesState = existsSync(path.join(p.freezeDir, "freeze-manifest.json")) ? "FROZEN" : "DRAFT";
  const submission_state: SubmissionState = existsSync(p.workerPatch) ? "SUBMITTED" : "NONE";

  // primary = the DERIVED verdict (never a raw verdict string), bound to THIS freeze
  let primary_verification: PrimaryVerification = "PENDING";
  if (existsSync(p.runRecord)) {
    let derived: "VALID" | "INVALID" = "INVALID";
    let bound = false;
    try {
      const record = readJson(p.runRecord);
      derived = tier1VerdictOf(record as never);
      const manifest = readJson(path.join(p.freezeDir, "freeze-manifest.json"));
      const freeze = record.freeze as Record<string, unknown> | undefined;
      bound = !!freeze && freeze.contract_freeze_hash === manifest.contract_freeze_hash && freeze.verification_ruleset_hash === manifest.verification_ruleset_hash;
    } catch {
      derived = "INVALID";
      bound = false;
    }
    primary_verification = derived === "VALID" && bound ? "VALID" : "INVALID";
  }

  const replay = deriveReplay(expDir);

  let tier1_entitlement: Tier1Entitlement = "PENDING";
  if (primary_verification === "INVALID") tier1_entitlement = "NOT_EARNED";
  else if (primary_verification === "VALID" && replay.state === "PASS") tier1_entitlement = "EARNED";

  const payer_response: PayerResponse =
    existsSync(p.observationsDir) && readdirSync(p.observationsDir).some((f) => /^\d{3}\.json$/.test(f)) ? "RECORDED" : "NONE";
  const ledger: LedgerState = existsSync(p.finalLedger) ? "FINALIZED" : "OPEN";

  return { rules_state, submission_state, primary_verification, replay: replay.state, tier1_entitlement, payer_response, ledger };
}

/** Phase = verified disk facts + explicitly-transient process flags (never persisted). */
export function deriveExperimentState(expDir: string, transient: TransientStates = {}): ExperimentStateView {
  const p = experimentPaths(expDir);
  const facts = deriveExperimentFacts(expDir);
  const readiness = deriveReadiness(expDir);
  const checking = transient.checking === true;
  const verifying = transient.verifying === true;

  let phase: ExperimentPhase;
  if (facts.ledger === "FINALIZED") {
    phase = "FINALIZED";
  } else if (facts.tier1_entitlement === "EARNED") {
    phase = "AWAITING_PAYER"; // only the derived-VALID ∧ replay-PASS path
  } else if (checking) {
    phase = "CHECKING";
  } else if (verifying) {
    phase = "VERIFYING";
  } else if (facts.rules_state === "FROZEN") {
    // terminal INVALID stays SUBMITTED (outcome panel); facts carry the result
    phase = facts.submission_state === "SUBMITTED" ? "SUBMITTED" : "FROZEN";
  } else if (readiness.ready) {
    phase = "READY_TO_FREEZE";
  } else {
    phase = "DRAFT";
  }

  let freezeVerified: boolean | null = null;
  if (facts.rules_state === "FROZEN") {
    try {
      verifyFreezePackDir(p.freezeDir);
      freezeVerified = true;
    } catch {
      freezeVerified = false; // D7: presence without verification is an evidence error
    }
  }

  const replay = facts.replay === "PENDING" ? { fresh: null, untrustedReason: null } : deriveReplay(expDir);
  return {
    phase,
    transient: { checking, verifying },
    facts,
    hasDraft: existsSync(p.draft),
    hasEligibility: existsSync(p.eligibility),
    readiness,
    frozenTermsMatch: deriveTermsMatch(expDir),
    freezeVerified,
    replayFresh: replay.fresh,
    replayUntrustedReason: replay.untrustedReason,
  };
}
