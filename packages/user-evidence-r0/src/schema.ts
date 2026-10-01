/**
 * USER-EVIDENCE-R0 / UE-0 — RealTaskExperimentV1 schema + ruleset identity.
 *
 * A NEW experiment object, deliberately separate from the frozen GP-001 Task
 * Freeze Record. Every Tier-1 JUDGING fact is fixed at freeze time; after
 * START there are zero free variables. Single-claimant, no auto-release,
 * no Tier-2 execution, no chain writes — per docs/experiments/USER-EVIDENCE-R0.md.
 */
import { createHash } from "node:crypto";

export interface RealTaskExperimentV1 {
  schema_version: "real-task-experiment.v1";
  experiment_id: string;
  repository_url: string;
  base_commit_sha: string; // full 40-hex; must exist in the git object database

  payer_identity: string;
  worker_identity: string; // bound at claim time; single claimant in R0

  acceptance_suite: string; // path/pattern spec of the frozen suite
  acceptance_suite_sha256: string;

  lockfile_path: string;
  lockfile_sha256: string;

  allowed_paths: string[];
  forbidden_paths: string[];

  max_diff_lines: number;
  new_dependencies_allowed: false; // hard-coded false in R0
  network: "disabled"; // hard-coded disabled in R0
  determinism_runs: number; // frozen at freeze time (default 3)

  tier1_reward: string; // declared value (testnet-value only in R0)
  tier2_reward: string; // declared, priced, NOT executed in R0

  claim_mode: "SINGLE_CLAIMANT"; // hard-coded for R0

  payer_precommit_text: string; // exact wording, hash-bound to ruleset_hash
  payer_precommit_timestamp: string; // RFC3339
}

/** Deep-sorted canonical JSON (same discipline as the PH-05R3 descriptor). */
function deepSorted(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Array.isArray(value) ? value.map(deepSorted) : value;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    out[k] = deepSorted((value as Record<string, unknown>)[k]);
  }
  return out;
}

/**
 * The ruleset = every field a Tier-1 verifier executes or checks. Same
 * input → same hash (deterministic; no wall-clock inside). The payer
 * precommit is bound to THIS hash, and the precommit itself is folded in
 * via precommitBinding below so the recorded words cannot drift from the
 * rules they claim to accept.
 */
export interface FrozenRulesetV1 {
  schema_version: "real-task-ruleset.v1";
  base_commit_sha: string;
  acceptance_suite_sha256: string;
  lockfile_path: string;
  lockfile_sha256: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  max_diff_lines: number;
  new_dependencies_allowed: false;
  network: "disabled";
  determinism_runs: number;
  claim_mode: "SINGLE_CLAIMANT";
  auto_release: "ABSENT"; // R0: silence→release authority does not exist
  tier2_execution: "ABSENT"; // R0: no dispute machinery
}

export function rulesetOf(e: RealTaskExperimentV1): FrozenRulesetV1 {
  return {
    schema_version: "real-task-ruleset.v1",
    base_commit_sha: e.base_commit_sha,
    acceptance_suite_sha256: e.acceptance_suite_sha256,
    lockfile_path: e.lockfile_path,
    lockfile_sha256: e.lockfile_sha256,
    allowed_paths: [...e.allowed_paths],
    forbidden_paths: [...e.forbidden_paths],
    max_diff_lines: e.max_diff_lines,
    new_dependencies_allowed: false,
    network: "disabled",
    determinism_runs: e.determinism_runs,
    claim_mode: "SINGLE_CLAIMANT",
    auto_release: "ABSENT",
    tier2_execution: "ABSENT",
  };
}

export function rulesetHash(r: FrozenRulesetV1): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(deepSorted(r))).digest("hex");
}

/**
 * UE0-02: the payer precommit is HASH-BOUND to the ruleset + its own exact
 * words + timestamp. Recorded BEFORE any outcome exists. This binding is
 * what makes "I agreed to those rules" a durable fact rather than a memory.
 */
export function precommitBinding(e: RealTaskExperimentV1): string {
  return "sha256:" + createHash("sha256")
    .update(Buffer.from(rulesetHash(rulesetOf(e)).slice(7), "hex"))
    .update(Buffer.from(e.payer_precommit_text, "utf8"))
    .update(Buffer.from(e.payer_precommit_timestamp, "utf8"))
    .digest("hex");
}

/** Structural eligibility (UE0-01): no unresolved Tier-1 variable. Throws with the exact field. */
export function assertFreezeComplete(e: RealTaskExperimentV1): void {
  const fail = (field: string): never => { throw new Error(`freeze incomplete: ${field}`); };
  if (e.schema_version !== "real-task-experiment.v1") fail("schema_version");
  if (!/^[0-9a-f]{40}$/.test(e.base_commit_sha)) fail("base_commit_sha (40-hex)");
  if (!e.repository_url) fail("repository_url");
  if (!e.acceptance_suite_sha256?.startsWith("sha256:")) fail("acceptance_suite_sha256");
  if (!e.lockfile_sha256?.startsWith("sha256:")) fail("lockfile_sha256");
  if (e.allowed_paths.length === 0) fail("allowed_paths (non-empty)");
  if (e.forbidden_paths.length === 0) fail("forbidden_paths (non-empty)");
  if (!Number.isInteger(e.max_diff_lines) || e.max_diff_lines <= 0) fail("max_diff_lines");
  if (e.new_dependencies_allowed !== false) fail("new_dependencies_allowed (hard false)");
  if (e.network !== "disabled") fail("network (hard disabled)");
  if (!Number.isInteger(e.determinism_runs) || e.determinism_runs < 1) fail("determinism_runs");
  if (!e.tier1_reward) fail("tier1_reward");
  if (!e.tier1_reward && e.tier2_reward === undefined) fail("tier2_reward");
  if (e.claim_mode !== "SINGLE_CLAIMANT") fail("claim_mode (hard SINGLE_CLAIMANT)");
  if (!e.payer_precommit_text?.trim()) fail("payer_precommit_text");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(e.payer_precommit_timestamp)) fail("payer_precommit_timestamp");
  if (!e.payer_identity?.trim()) fail("payer_identity");
}
