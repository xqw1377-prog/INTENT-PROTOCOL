/**
 * USER-EVIDENCE-R0 / UE-0 (CUT-1R) — RealTaskExperimentV1 + dual-hash contract.
 *
 * CONTRACT_FREEZE_HASH covers the COMPLETE economic + verification contract:
 * payer identity, claimant, BOTH reward amounts, all frozen commands,
 * policies, and the VERIFICATION_RULESET_HASH. The payer precommit binds to
 * CONTRACT_FREEZE_HASH — changing ANY committed term (incl. tier1/tier2
 * split) invalidates the precommit. Product constitution enforced at the
 * binding layer: mechanical entitlement cannot be retroactively converted
 * into discretionary entitlement.
 */
import { createHash } from "node:crypto";

const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const NONEMPTY = (s: string | undefined): boolean => typeof s === "string" && s.trim().length > 0;

export interface FrozenCommandsV1 {
  /** MUST FAIL (non-zero / failing tests) on the frozen base — the seeded red. */
  regression_command: string;
  /** MUST PASS on the frozen base — existing-suite health gate (excludes the regression file). */
  baseline_health_command: string;
  /** The patched-acceptance command run in UE-2 (frozen now so UE-2 has zero free variables). */
  patched_acceptance_command: string;
  build_command?: string;
  typecheck_command?: string;
  package_manager: "npm" | "pnpm" | "yarn" | "none";
  install_command: string;
}

export interface RealTaskExperimentV1 {
  schema_version: "real-task-experiment.v1";
  experiment_id: string;
  repository_url: string;
  base_commit_sha: string; // full 40-hex

  payer_identity: string;
  worker_identity: string;

  acceptance_suite: string; // the frozen regression FILE (hashed; also in regression_command)
  acceptance_suite_sha256: string;
  acceptance_full_suite: string[]; // files covered by baseline_health_command
  full_suite_baseline_policy: "ALL_GREEN";

  lockfile_path: string;
  lockfile_sha256: string;

  allowed_paths: string[];
  forbidden_paths: string[];

  max_diff_lines: number;
  new_dependencies_allowed: false;
  network: "disabled";
  determinism_runs: number;

  tier1_reward: string;
  tier2_reward: string;

  claim_mode: "SINGLE_CLAIMANT";

  commands: FrozenCommandsV1;

  payer_precommit_text: string;
  payer_precommit_timestamp: string;
}

/** Deep-sorted canonical JSON (PH-05R3 discipline). */
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
const sha = (v: unknown): string => "sha256:" + createHash("sha256").update(JSON.stringify(deepSorted(v))).digest("hex");

/** VERIFICATION rules only — what a Tier-1 verifier executes/checks. */
export interface VerificationRulesetV1 {
  schema_version: "real-task-verification-ruleset.v1";
  base_commit_sha: string;
  acceptance_suite_sha256: string;
  lockfile_path: string;
  lockfile_sha256: string;
  commands: FrozenCommandsV1;
  allowed_paths: string[];
  forbidden_paths: string[];
  max_diff_lines: number;
  new_dependencies_allowed: false;
  network: "disabled";
  determinism_runs: number;
}

/** The COMPLETE committed contract — verification rules PLUS the economic terms. */
export interface ContractFreezeV1 {
  schema_version: "real-task-contract-freeze.v1";
  payer_identity: string;
  worker_identity: string;
  tier1_reward: string;
  tier2_reward: string;
  claim_mode: "SINGLE_CLAIMANT";
  auto_release: "ABSENT";
  tier2_execution: "ABSENT";
  verification_ruleset_hash: string;
}

export function verificationRulesetOf(e: RealTaskExperimentV1): VerificationRulesetV1 {
  return {
    schema_version: "real-task-verification-ruleset.v1",
    base_commit_sha: e.base_commit_sha,
    acceptance_suite_sha256: e.acceptance_suite_sha256,
    lockfile_path: e.lockfile_path,
    lockfile_sha256: e.lockfile_sha256,
    commands: { ...e.commands },
    allowed_paths: [...e.allowed_paths],
    forbidden_paths: [...e.forbidden_paths],
    max_diff_lines: e.max_diff_lines,
    new_dependencies_allowed: false,
    network: "disabled",
    determinism_runs: e.determinism_runs,
  };
}

export function contractFreezeOf(e: RealTaskExperimentV1): ContractFreezeV1 {
  return {
    schema_version: "real-task-contract-freeze.v1",
    payer_identity: e.payer_identity,
    worker_identity: e.worker_identity,
    tier1_reward: e.tier1_reward,
    tier2_reward: e.tier2_reward,
    claim_mode: "SINGLE_CLAIMANT",
    auto_release: "ABSENT",
    tier2_execution: "ABSENT",
    verification_ruleset_hash: verificationRulesetHash(verificationRulesetOf(e)),
  };
}

export function verificationRulesetHash(r: VerificationRulesetV1): string {
  return sha(r);
}

export function contractFreezeHash(e: RealTaskExperimentV1): string {
  return sha(contractFreezeOf(e));
}

/**
 * UE0-R1/R2/R3: the payer precommit binds to CONTRACT_FREEZE_HASH + its own
 * exact words + timestamp. Changing Tier1 amount, Tier2 amount, payer
 * identity, worker identity, ANY frozen command, or the words — each flips
 * the binding. Same input → same binding.
 */
export function precommitBinding(e: RealTaskExperimentV1): string {
  return "sha256:" + createHash("sha256")
    .update(Buffer.from(contractFreezeHash(e).slice(7), "hex"))
    .update(Buffer.from(e.payer_precommit_text, "utf8"))
    .update(Buffer.from(e.payer_precommit_timestamp, "utf8"))
    .digest("hex");
}

/** UE0-R4/R5: strict completeness — every required field named, hashes exact grammar. */
export function assertFreezeComplete(e: RealTaskExperimentV1): void {
  const fail = (field: string): never => { throw new Error(`freeze incomplete: ${field}`); };
  if (e.schema_version !== "real-task-experiment.v1") fail("schema_version");
  if (!NONEMPTY(e.experiment_id)) fail("experiment_id");
  if (!NONEMPTY(e.repository_url)) fail("repository_url");
  if (!/^[0-9a-f]{40}$/.test(e.base_commit_sha)) fail("base_commit_sha");
  if (!NONEMPTY(e.payer_identity)) fail("payer_identity");
  if (!NONEMPTY(e.worker_identity)) fail("worker_identity");
  if (!NONEMPTY(e.acceptance_suite)) fail("acceptance_suite");
  if (!HASH_RE.test(e.acceptance_suite_sha256)) fail("acceptance_suite_sha256");
  if (e.acceptance_full_suite.length === 0) fail("acceptance_full_suite");
  if (e.full_suite_baseline_policy !== "ALL_GREEN") fail("full_suite_baseline_policy");
  if (!NONEMPTY(e.lockfile_path)) fail("lockfile_path");
  if (!HASH_RE.test(e.lockfile_sha256)) fail("lockfile_sha256");
  if (e.allowed_paths.length === 0) fail("allowed_paths");
  if (e.forbidden_paths.length === 0) fail("forbidden_paths");
  if (!Number.isInteger(e.max_diff_lines) || e.max_diff_lines <= 0) fail("max_diff_lines");
  if (e.new_dependencies_allowed !== false) fail("new_dependencies_allowed");
  if (e.network !== "disabled") fail("network");
  if (!Number.isInteger(e.determinism_runs) || e.determinism_runs < 1) fail("determinism_runs");
  if (!NONEMPTY(e.tier1_reward)) fail("tier1_reward");
  if (!NONEMPTY(e.tier2_reward)) fail("tier2_reward"); // independently required (R4 fix)
  if (e.claim_mode !== "SINGLE_CLAIMANT") fail("claim_mode");
  if (!NONEMPTY(e.commands?.regression_command)) fail("commands.regression_command");
  if (!NONEMPTY(e.commands?.baseline_health_command)) fail("commands.baseline_health_command");
  if (!NONEMPTY(e.commands?.patched_acceptance_command)) fail("commands.patched_acceptance_command");
  if (!NONEMPTY(e.commands?.install_command)) fail("commands.install_command");
  if (!["npm", "pnpm", "yarn", "none"].includes(e.commands?.package_manager ?? "")) fail("commands.package_manager");
  if (!NONEMPTY(e.payer_precommit_text)) fail("payer_precommit_text");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(e.payer_precommit_timestamp)) fail("payer_precommit_timestamp");
}
