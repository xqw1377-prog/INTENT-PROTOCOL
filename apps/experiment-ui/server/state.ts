/**
 * FRONTEND-R1 (HOLD-6 review fix) — experiment state derivation.
 *
 * D7 + review P0-1/P0-2: NOTHING here is decided by file presence. A
 * phase or fact may only advance when ONE verified evidence chain holds:
 *
 *   freeze generation re-verifies (verifyFreezePackDir)
 *   ∧ published terms == reviewed snapshot
 *   ∧ run record derives VALID (tier1VerdictOf) ∧ binds THIS freeze
 *   ∧ record.patch_sha256 == the CURRENT submitted worker.patch bytes
 *   ∧ proof manifest binds the CURRENT freeze task.json, worker.patch,
 *     and run-record.json (one chain, not three coincidences)
 *   ∧ replay report PASS ∧ same verdict ∧ fresh binding to the CURRENT
 *     pack (manifest hash + bytes digest) ∧ the pack's verifier bytes
 *     equal the EXPERIMENT-01 anchor (fresh ≠ trusted)
 *
 * Anything missing, stale, mismatched, or untrusted closes the EARNED
 * path and is surfaced as an evidence error — the UI never substitutes
 * for correct derivation. All checks CALL frozen boundaries; none are
 * re-implemented here.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { verifyFreezePackDir } from "../../../packages/user-evidence-r0/src/pack.ts";
import { tier1VerdictOf } from "../../../packages/user-evidence-r0/src/proof.ts";
import { filesBindingOf, sha256OfFile, sha256Of } from "../../../packages/user-evidence-r0/src/ledger.ts";
import { TRUST_ANCHOR } from "./trust-anchor.ts";

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
  readiness: { ready: boolean; reason: string };
  /** D5: published terms vs reviewed snapshot (null = no snapshot to compare) */
  frozenTermsMatch: boolean | null;
  /** D7: the freeze generation re-verified via the frozen closure */
  freezeVerified: boolean | null;
  freezePresent: boolean;
  /** D6: the run record binds the CURRENT submitted patch bytes */
  patchBindingMatch: boolean | null;
  /** D6: the proof pack binds the current freeze task, patch, and record */
  proofChainMatch: boolean | null;
  replayFresh: boolean | null;
  replayUntrustedReason: string | null;
  /** every broken/stale/mismatched piece of evidence, named */
  evidenceErrors: string[];
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
const tryReadJson = (p: string): Record<string, unknown> | null => {
  try {
    return readJson(p);
  } catch {
    return null;
  }
};

/** D5: the reviewed input snapshot must equal the current draft, term by term. */
const REVIEWED_FIELDS = [
  "repoPath", "base_commit_sha", "payer_identity", "worker_identity", "tier1_reward", "tier2_reward",
  "allowed_paths", "forbidden_paths", "max_diff_lines", "determinism_runs",
  "regression_command", "baseline_health_command", "patched_acceptance_command",
  "acceptance_suite", "acceptance_full_suite",
] as const;

function deriveReadiness(expDir: string): { ready: boolean; reason: string } {
  const p = experimentPaths(expDir);
  if (!existsSync(p.eligibility)) return { ready: false, reason: "no prepare report — run Check eligibility" };
  const eligibility = tryReadJson(p.eligibility);
  if (!eligibility) return { ready: false, reason: "prepare report unparsable — re-check eligibility" };
  if (eligibility.ok !== true) return { ready: false, reason: `prepare failed: ${String(eligibility.reason ?? "")}` };
  const snapshot = eligibility.draft as Record<string, unknown> | undefined;
  const draft = tryReadJson(p.draft);
  if (!snapshot || !draft) return { ready: false, reason: "reviewed snapshot missing — re-prepare and re-check" };
  for (const f of REVIEWED_FIELDS) {
    if (JSON.stringify(snapshot[f]) !== JSON.stringify(draft[f])) {
      return { ready: false, reason: `reviewed inputs changed (${f}) — re-check eligibility before freeze` };
    }
  }
  return { ready: true, reason: "current prepare report matches the reviewed inputs" };
}

/** D5: published freeze terms vs the reviewed snapshot. */
function deriveTermsMatch(expDir: string, eligibility: Record<string, unknown> | null): boolean | null {
  const p = experimentPaths(expDir);
  if (!existsSync(path.join(p.freezeDir, "freeze-manifest.json"))) return null;
  const snapshot = eligibility?.draft as Record<string, unknown> | undefined;
  if (!snapshot) return null;
  const task = tryReadJson(path.join(p.freezeDir, "task.json"));
  const manifest = tryReadJson(path.join(p.freezeDir, "freeze-manifest.json"));
  if (!task || !manifest) return false;
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
    [task.acceptance_suite, snapshot.acceptance_suite],
    [task.acceptance_full_suite, snapshot.acceptance_full_suite],
    [task.commands, { regression_command: snapshot.regression_command, baseline_health_command: snapshot.baseline_health_command, patched_acceptance_command: snapshot.patched_acceptance_command, package_manager: "npm", install_command: "npm ci --ignore-scripts" }],
    [manifest.acceptance_suite_sha256, eligibility.suiteHash],
    [manifest.lockfile_sha256, eligibility.lockHash],
  ];
  return pairs.every(([a, b]) => JSON.stringify(a) === JSON.stringify(b));
}

/** D6: the proof pack must bind the CURRENT freeze task, submitted patch, and run record. */
function deriveProofChain(expDir: string): { match: boolean | null; errors: string[] } {
  const p = experimentPaths(expDir);
  const manifestPath = path.join(p.proofDir, "proof-manifest.json");
  if (!existsSync(manifestPath)) return { match: null, errors: [] };
  const manifest = tryReadJson(manifestPath);
  if (!manifest || manifest.schema_version !== "outcome-proof-manifest.v1") return { match: false, errors: ["proof manifest missing or invalid"] };
  const files = (manifest.files ?? {}) as Record<string, { sha256?: string }>;
  const links: Array<[string, string]> = [
    ["task.json", path.join(p.freezeDir, "task.json")],
    ["worker.patch", p.workerPatch],
    ["run-record.json", p.runRecord],
  ];
  const errors: string[] = [];
  for (const [entry, current] of links) {
    if (!files[entry]?.sha256) {
      errors.push(`proof manifest does not list ${entry}`);
      continue;
    }
    if (!existsSync(current)) {
      errors.push(`proof binds ${entry} but the current artifact is missing`);
      continue;
    }
    if (files[entry].sha256 !== sha256OfFile(current)) {
      errors.push(`proof ${entry} does not match the current ${path.basename(current)}`);
    }
  }
  return { match: errors.length === 0, errors };
}

/** D6: replay evidence — PASS only when fresh AND source-trusted (fresh ≠ trusted). */
function deriveReplay(expDir: string, proofChain: boolean | null): { state: ReplayState; fresh: boolean | null; untrustedReason: string | null; error?: string } {
  const p = experimentPaths(expDir);
  if (!existsSync(p.replayReport)) return { state: "PENDING", fresh: null, untrustedReason: null };
  const packManifest = path.join(p.proofDir, "proof-manifest.json");
  const packVerify = path.join(p.proofDir, "verify.mjs");
  if (!existsSync(packManifest)) return { state: "FAIL", fresh: false, untrustedReason: "replay report exists but the proof pack is missing" };
  if (proofChain === false) return { state: "FAIL", fresh: false, untrustedReason: "the proof pack is not bound to the current evidence chain" };
  const report = tryReadJson(p.replayReport);
  if (!report || report.schema_version !== "portable-replay-report.v1") return { state: "FAIL", fresh: false, untrustedReason: "replay report missing or invalid" };
  if (report.status !== "PASS" || report.same_verdict !== true) return { state: "FAIL", fresh: false, untrustedReason: `replay status ${String(report.status)} (${String(report.fail_reason ?? "")})` };
  const reproduced = report.reproduced as Record<string, unknown> | undefined;
  if (!reproduced || reproduced.tier1_verdict !== "VALID") return { state: "FAIL", fresh: false, untrustedReason: "reproduced verdict is not VALID" };
  if (existsSync(packVerify) && sha256OfFile(packVerify) !== TRUST_ANCHOR.portable_replay_sha256) {
    return { state: "FAIL", fresh: false, untrustedReason: "the pack's verifier bytes do not match the EXPERIMENT-001 anchor — source not trusted" };
  }
  if (report.proof_manifest_sha256 !== sha256OfFile(packManifest)) return { state: "FAIL", fresh: false, untrustedReason: "replay report is stale: proof-manifest changed after the replay" };
  let binding: string;
  try {
    binding = filesBindingOf(p.proofDir);
  } catch {
    return { state: "FAIL", fresh: false, untrustedReason: "proof pack unreadable for the bytes digest" };
  }
  if (report.files_binding !== binding) return { state: "FAIL", fresh: false, untrustedReason: "replay report predates the current pack bytes" };
  return { state: "PASS", fresh: true, untrustedReason: null };
}

/** P0-2: observations are RECORDED only when structurally valid and pack-bound. */
function derivePayerResponse(expDir: string, errors: string[]): PayerResponse {
  const p = experimentPaths(expDir);
  if (!existsSync(p.observationsDir)) return "NONE";
  const files = readdirSync(p.observationsDir).filter((f) => /^\d{3}\.json$/.test(f)).sort();
  if (files.length === 0) return "NONE";
  const packManifest = path.join(p.proofDir, "proof-manifest.json");
  let valid = 0;
  for (const f of files) {
    const obs = tryReadJson(path.join(p.observationsDir, f));
    const o = obs?.observations as Record<string, unknown> | undefined;
    const binding = obs?.pack_binding as Record<string, unknown> | undefined;
    const problems: string[] = [];
    if (!obs || obs.schema_version !== "real-task-observation.v1") problems.push("schema");
    if (!o || typeof o.payer_accepts_tier1 !== "boolean" || typeof o.source_record !== "string" || !/^sha256:[0-9a-f]{64}$/.test(String(o.source_record_sha256 ?? ""))) problems.push("observation fields");
    else if (sha256Of(o.source_record) !== o.source_record_sha256) problems.push("source_record hash mismatch");
    if (existsSync(packManifest) && (!binding || binding.proof_manifest_sha256 !== sha256OfFile(packManifest))) problems.push("pack binding stale");
    if (problems.length) errors.push(`observation ${f} invalid: ${problems.join(", ")}`);
    else valid++;
  }
  return valid > 0 ? "RECORDED" : "NONE";
}

/** P0-2: FINALIZED only when the final ledger verifies against the current pack. */
function deriveLedger(expDir: string, errors: string[]): LedgerState {
  const p = experimentPaths(expDir);
  if (!existsSync(p.finalLedger)) return "OPEN";
  const ledger = tryReadJson(p.finalLedger);
  const problems: string[] = [];
  if (!ledger || ledger.schema_version !== "real-task-ledger.v1") problems.push("schema");
  const finality = ledger?.finality as Record<string, unknown> | undefined;
  const technical = ledger?.technical as Record<string, unknown> | undefined;
  if (!finality || finality.final !== true) problems.push("finality");
  if (!technical || !["THESIS STRENGTHENED", "THESIS MIXED", "THESIS CHALLENGED"].includes(String(ledger?.verdict ?? ""))) problems.push("verdict");
  const packManifest = path.join(p.proofDir, "proof-manifest.json");
  if (existsSync(packManifest) && technical?.proof_manifest_sha256 !== sha256OfFile(packManifest)) problems.push("pack binding stale");
  if (problems.length) {
    errors.push(`final ledger invalid: ${problems.join(", ")}`);
    return "OPEN";
  }
  return "FINALIZED";
}

/** Derive every UI fact from the experiment directory by CALLING the frozen boundaries. */
export function deriveExperimentFacts(expDir: string): ExperimentFacts & { evidenceErrors: string[]; patchBindingMatch: boolean | null; proofChainMatch: boolean | null } {
  const p = experimentPaths(expDir);
  const evidenceErrors: string[] = [];

  // rules: a generation exists AND its closure re-verifies — presence alone is an evidence error
  const freezePresent = existsSync(path.join(p.freezeDir, "freeze-manifest.json"));
  let freezeVerified = false;
  if (freezePresent) {
    try {
      verifyFreezePackDir(p.freezeDir);
      freezeVerified = true;
    } catch (e) {
      freezeVerified = false;
      evidenceErrors.push(`freeze generation present but unverified: ${String((e as Error).message)}`);
    }
  }
  const rules_state: RulesState = freezePresent && freezeVerified ? "FROZEN" : "DRAFT";

  const submission_state: SubmissionState = existsSync(p.workerPatch) ? "SUBMITTED" : "NONE";

  // primary: DERIVED verdict ∧ THIS-freeze binding ∧ CURRENT-patch binding
  let primary_verification: PrimaryVerification = "PENDING";
  let patchBindingMatch: boolean | null = null;
  if (existsSync(p.runRecord)) {
    const record = tryReadJson(p.runRecord);
    let derived: "VALID" | "INVALID" = "INVALID";
    let freezeBound = false;
    patchBindingMatch = false;
    try {
      derived = tier1VerdictOf(record as never);
      const manifest = tryReadJson(path.join(p.freezeDir, "freeze-manifest.json"));
      const freeze = record.freeze as Record<string, unknown> | undefined;
      freezeBound = !!manifest && !!freeze && freeze.contract_freeze_hash === manifest.contract_freeze_hash && freeze.verification_ruleset_hash === manifest.verification_ruleset_hash;
    } catch {
      derived = "INVALID";
      freezeBound = false;
    }
    if (existsSync(p.workerPatch) && typeof record?.patch_sha256 === "string") {
      patchBindingMatch = record.patch_sha256 === sha256OfFile(p.workerPatch);
    }
    if (derived === "VALID" && !freezeBound) evidenceErrors.push("run record does not bind this freeze generation");
    if (derived === "VALID" && patchBindingMatch === false) evidenceErrors.push("run record does not bind the current submitted patch bytes");
    primary_verification = derived === "VALID" && freezeBound && patchBindingMatch === true ? "VALID" : "INVALID";
  }

  const proofChain = deriveProofChain(expDir);
  evidenceErrors.push(...proofChain.errors);
  const replay = deriveReplay(expDir, proofChain.match);

  // the FULL chain gates EARNED — nothing advances on presence or partial coincidence
  const eligibility = tryReadJson(p.eligibility);
  const frozenTermsMatch = deriveTermsMatch(expDir, eligibility);
  if (frozenTermsMatch === false) evidenceErrors.push("published terms differ from the reviewed snapshot");

  let tier1_entitlement: Tier1Entitlement = "PENDING";
  if (primary_verification === "INVALID") tier1_entitlement = "NOT_EARNED";
  else if (
    primary_verification === "VALID" &&
    freezeVerified &&
    frozenTermsMatch === true &&
    proofChain.match === true &&
    replay.state === "PASS"
  ) {
    tier1_entitlement = "EARNED";
  }

  const payer_response = derivePayerResponse(expDir, evidenceErrors);
  const ledger = deriveLedger(expDir, evidenceErrors);

  return { rules_state, submission_state, primary_verification, replay: replay.state, tier1_entitlement, payer_response, ledger, evidenceErrors, patchBindingMatch, proofChainMatch: proofChain.match };
}

/** Phase = verified disk facts + explicitly-transient process flags (never persisted). */
export function deriveExperimentState(expDir: string, transient: TransientStates = {}): ExperimentStateView {
  const facts = deriveExperimentFacts(expDir);
  const readiness = deriveReadiness(expDir);
  const checking = transient.checking === true;
  const verifying = transient.verifying === true;

  let phase: ExperimentPhase;
  if (facts.ledger === "FINALIZED") {
    phase = "FINALIZED";
  } else if (facts.tier1_entitlement === "EARNED") {
    phase = "AWAITING_PAYER"; // only the fully-verified chain
  } else if (checking) {
    phase = "CHECKING";
  } else if (verifying) {
    phase = "VERIFYING";
  } else if (facts.rules_state === "FROZEN") {
    phase = facts.submission_state === "SUBMITTED" ? "SUBMITTED" : "FROZEN";
  } else if (readiness.ready) {
    phase = "READY_TO_FREEZE";
  } else {
    phase = "DRAFT";
  }

  const p = experimentPaths(expDir);
  const chain = deriveProofChain(expDir);
  const replay = deriveReplay(expDir, chain.match);
  return {
    phase,
    transient: { checking, verifying },
    facts: {
      rules_state: facts.rules_state,
      submission_state: facts.submission_state,
      primary_verification: facts.primary_verification,
      replay: facts.replay,
      tier1_entitlement: facts.tier1_entitlement,
      payer_response: facts.payer_response,
      ledger: facts.ledger,
    },
    hasDraft: existsSync(p.draft),
    hasEligibility: existsSync(p.eligibility),
    readiness,
    frozenTermsMatch: deriveTermsMatch(expDir, tryReadJson(p.eligibility)),
    freezeVerified: existsSync(path.join(p.freezeDir, "freeze-manifest.json")) ? facts.rules_state === "FROZEN" : null,
    freezePresent: existsSync(path.join(p.freezeDir, "freeze-manifest.json")),
    patchBindingMatch: facts.patchBindingMatch,
    proofChainMatch: chain.match,
    replayFresh: replay.fresh,
    replayUntrustedReason: replay.untrustedReason,
    evidenceErrors: facts.evidenceErrors,
  };
}
