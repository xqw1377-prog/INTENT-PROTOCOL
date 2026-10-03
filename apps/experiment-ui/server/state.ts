/**
 * FRONTEND-R1 / FR-1 — experiment state derivation.
 *
 * THE ONLY authority here is the experiment directory. This module maps
 * disk facts to UI facts; it NEVER recomputes any verdict, hash, or rule
 * (spec §24: "the frontend has no authority to override" — and no
 * authority to derive, either). The one presentation-level derivation it
 * performs is the spec's own frozen formula:
 *   tier1_entitlement = EARNED iff primary_verification = VALID
 *                       AND replay = PASS
 * read from the artifacts' already-verified fields.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";

export type RulesState = "DRAFT" | "FROZEN";
export type SubmissionState = "NONE" | "SUBMITTED";
export type PrimaryVerification = "PENDING" | "VALID" | "INVALID";
export type ReplayState = "PENDING" | "PASS" | "FAIL";
export type Tier1Entitlement = "PENDING" | "EARNED" | "NOT_EARNED";
export type PayerResponse = "NONE" | "RECORDED";
export type LedgerState = "OPEN" | "FINALIZED";

/** Spec §24 persistent facts — computed independently, never merged. */
export interface ExperimentFacts {
  rules_state: RulesState;
  submission_state: SubmissionState;
  primary_verification: PrimaryVerification;
  replay: ReplayState;
  tier1_entitlement: Tier1Entitlement;
  payer_response: PayerResponse;
  ledger: LedgerState;
}

/** Spec §2/§24 primary phase. CHECKING/VERIFYING are transient-only. */
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

/** Derive every UI fact from the experiment directory. Pure: reads, never writes. */
export function deriveExperimentFacts(expDir: string): ExperimentFacts {
  const p = experimentPaths(expDir);

  const rules_state: RulesState = existsSync(path.join(p.freezeDir, "freeze-manifest.json")) ? "FROZEN" : "DRAFT";
  const submission_state: SubmissionState = existsSync(p.workerPatch) ? "SUBMITTED" : "NONE";

  let primary_verification: PrimaryVerification = "PENDING";
  if (existsSync(p.runRecord)) {
    const verdict = readJson(p.runRecord).verdict;
    if (verdict === "VALID") primary_verification = "VALID";
    else if (verdict === "INVALID") primary_verification = "INVALID";
  }

  let replay: ReplayState = "PENDING";
  if (existsSync(p.replayReport)) {
    const status = readJson(p.replayReport).status;
    if (status === "PASS") replay = "PASS";
    else if (status === "FAIL") replay = "FAIL";
  }

  // spec §24 frozen derivation — presentation of already-verified facts
  let tier1_entitlement: Tier1Entitlement = "PENDING";
  if (primary_verification === "INVALID") tier1_entitlement = "NOT_EARNED";
  else if (primary_verification === "VALID" && replay === "PASS") tier1_entitlement = "EARNED";

  const payer_response: PayerResponse =
    existsSync(p.observationsDir) &&
    readdirSync(p.observationsDir).some((f) => /^\d{3}\.json$/.test(f))
      ? "RECORDED"
      : "NONE";

  const ledger: LedgerState = existsSync(p.finalLedger) ? "FINALIZED" : "OPEN";

  return { rules_state, submission_state, primary_verification, replay, tier1_entitlement, payer_response, ledger };
}

/** Phase = disk facts + explicitly-marked transient orchestrator states. */
export function deriveExperimentState(expDir: string, transient: TransientStates = {}): ExperimentStateView {
  const p = experimentPaths(expDir);
  const facts = deriveExperimentFacts(expDir);
  const checking = transient.checking === true;
  const verifying = transient.verifying === true;

  let phase: ExperimentPhase;
  if (facts.ledger === "FINALIZED") {
    phase = "FINALIZED";
  } else if (facts.tier1_entitlement === "EARNED") {
    phase = "AWAITING_PAYER";
  } else if (checking) {
    phase = "CHECKING"; // transient — never persisted, never derived
  } else if (verifying) {
    phase = "VERIFYING"; // transient
  } else if (facts.rules_state === "FROZEN") {
    // a completed-but-not-earned run keeps SUBMITTED; the facts carry the outcome
    phase = facts.submission_state === "SUBMITTED" ? "SUBMITTED" : "FROZEN";
  } else if (existsSync(p.eligibility) && readJson(p.eligibility).ok === true) {
    phase = "READY_TO_FREEZE";
  } else {
    phase = "DRAFT";
  }

  return {
    phase,
    transient: { checking, verifying },
    facts,
    hasDraft: existsSync(p.draft),
    hasEligibility: existsSync(p.eligibility),
  };
}
