/**
 * USER-EVIDENCE-R0 / UE-1 (CUT-1R) — Real Task Freezer.
 *
 * Command-frozen preflight (real repos are not all Vitest):
 *   materialize EXACT base from the git object database
 *   → clean-room dependency reconstruct from the frozen lockfile (R4)
 *   → NETWORK-DENIED sandbox enforced by the OS, negatively tested (R3):
 *      macOS: sandbox-exec deny network; Linux: unshare -n. Both are
 *      verified at freeze time by a probe that MUST fail to connect and
 *      MUST still run local work — otherwise INELIGIBLE.
 *   → regression_command MUST FAIL on base (R1)
 *   → baseline_health_command MUST PASS on base (R2)
 *   → determinism: N consecutive reproductions of BOTH results (R5)
 * Atomic publish (R6): everything runs in a temp staging dir; artifacts are
 * published ONLY after every check passes. A failed freeze leaves the
 * output dir untouched (zero publishable residue).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { assertFreezeComplete, contractFreezeHash, contractFreezeOf, precommitBinding, verificationRulesetHash, verificationRulesetOf, type RealTaskExperimentV1 } from "./schema.ts";

export interface FreezeTaskConfig {
  experiment_id: string;
  repository_url: string;
  base_commit_sha: string;
  payer_identity: string;
  worker_identity: string;
  acceptance_suite: string;
  acceptance_full_suite: string[];
  lockfile_path: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  max_diff_lines: number;
  determinism_runs: number;
  tier1_reward: string;
  tier2_reward: string;
  payer_precommit_text: string;
  payer_precommit_timestamp: string;
  commands: {
    regression_command: string;
    baseline_health_command: string;
    patched_acceptance_command: string;
    build_command?: string;
    typecheck_command?: string;
    package_manager: "npm" | "pnpm" | "yarn" | "none";
    install_command: string;
  };
}

export interface FreezeManifest {
  schema_version: "freeze-manifest.v2";
  experiment_id: string;
  base_commit_sha: string;
  acceptance_suite_sha256: string;
  lockfile_sha256: string;
  verification_ruleset_hash: string;
  contract_freeze_hash: string;
  precommit_binding: string;
  frozen_at: string;
  eligibility: "ELIGIBLE";
  preflight: {
    dependency_reconstruction: "CLEAN_ROOM_OK";
    network_sandbox: "DENIED_VERIFIED";
    base_regression: "RED";
    baseline_health: "GREEN";
    determinism: `${number}/${number}`;
  };
}

export class FreezeError extends Error {
  constructor(readonly reason: string, message: string) {
    super(`INELIGIBLE (${reason}): ${message}`);
  }
}

const sha256File = (p: string): string => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex");

/** Materialize the EXACT base commit from the git object database. */
export function materializeBase(repoDir: string, sha: string, into: string): void {
  const kind = execFileSync("git", ["cat-file", "-t", sha], { cwd: repoDir, encoding: "utf8" }).trim();
  if (kind !== "commit") throw new FreezeError("base-not-commit", `base ${sha} is ${kind}`);
  const archive = execFileSync("git", ["archive", "--format=tar", sha], { cwd: repoDir, maxBuffer: 512 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", into], { input: archive, maxBuffer: 512 * 1024 * 1024 });
}

/** R4: reconstruct dependencies from the frozen lockfile in a CLEAN room (no borrowed node_modules). */
export function reconstructDependencies(baseDir: string, cfg: FreezeTaskConfig): void {
  const lock = path.join(baseDir, cfg.lockfile_path);
  if (!existsSync(lock)) throw new FreezeError("lockfile-missing", cfg.lockfile_path);
  // remove any vendored/pre-existing deps so the reconstruction is real
  for (const d of ["node_modules"]) {
    rmSync(path.join(baseDir, d), { recursive: true, force: true });
  }
  try {
    execFileSync("sh", ["-c", cfg.commands.install_command], {
      cwd: baseDir, encoding: "utf8", timeout: 15 * 60_000, maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, CI: "1", npm_config_frozen_lockfile: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    throw new FreezeError("install-failed", `${cfg.commands.install_command}: ${String((e as Error).message).slice(0, 200)}`);
  }
}

/** R3: run a command inside a NETWORK-DENIED sandbox; throws if the wrap is unavailable. */
export function inNetSandbox(cmd: string, cwd: string, timeoutMs = 10 * 60_000): { code: number; stdout: string } {
  const wrapped =
    process.platform === "darwin"
      ? `sandbox-exec -p '(version 1)(allow default)(deny network*)' sh -c ${JSON.stringify(cmd)}`
      : `unshare -n sh -c ${JSON.stringify(cmd)}`; // Linux: dedicated empty netns
  try {
    const out = execFileSync("sh", ["-c", wrapped], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout: out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "" };
  }
}

/** R3 negative test: a REAL outbound attempt MUST fail inside the sandbox, local work MUST succeed. */
export function verifyNetSandbox(cwd: string): void {
  const probe = `node -e "const net=require('node:net');const s=net.connect({host:'1.1.1.1',port:53,timeout:3000});s.on('error',()=>process.exit(0));s.on('connect',()=>{s.destroy();process.exit(1)});setTimeout(()=>process.exit(0),4000)"`;
  const r = inNetSandbox(probe, cwd, 30_000);
  if (r.code !== 0) throw new FreezeError("network-sandbox-ineffective", "TCP connect to 1.1.1.1:53 SUCCEEDED inside the network-denied sandbox");
  const local = inNetSandbox(`node -e "process.exit(0)"`, cwd, 30_000);
  if (local.code !== 0) throw new FreezeError("network-sandbox-too-strict", "local process execution broken inside sandbox");
}

/** R5: repeat the pair of commands N times; each repetition must reproduce the SAME outcomes. */
function determinismCheck(cfg: FreezeTaskConfig, cwd: string): `${number}/${number}` {
  const reds: boolean[] = [];
  const greens: boolean[] = [];
  for (let i = 0; i < cfg.determinism_runs; i++) {
    reds.push(inNetSandbox(cfg.commands.regression_command, cwd).code !== 0);
    greens.push(inNetSandbox(cfg.commands.baseline_health_command, cwd).code === 0);
  }
  const allRed = reds.every(Boolean);
  const allGreen = greens.every(Boolean);
  if (!allRed) throw new FreezeError("determinism-red-unstable", `regression red reproductions: ${reds.join(",")}`);
  if (!allGreen) throw new FreezeError("determinism-green-unstable", `baseline green reproductions: ${greens.join(",")}`);
  return `${cfg.determinism_runs}/${cfg.determinism_runs}`;
}

/** Full preflight in a temp staging dir; returns the preflight record on success. */
export function runPreflight(repoDir: string, cfg: FreezeTaskConfig): { suiteHash: string; lockHash: string; preflight: FreezeManifest["preflight"] } {
  const stage = mkdtempSync(path.join(tmpdir(), "ue1-stage-"));
  try {
    materializeBase(repoDir, cfg.base_commit_sha, stage);
    const suiteHash = sha256File(path.join(stage, cfg.acceptance_suite));
    const lockHash = sha256File(path.join(stage, cfg.lockfile_path));

    // forbidden paths resolvable (policy frozen at UE-1; patch enforcement is UE-2)
    for (const fp of cfg.forbidden_paths) {
      const base = fp.replace(/\/\*\*$/, "");
      if (!existsSync(path.join(stage, base))) {
        const parent = path.dirname(path.join(stage, base));
        if (!existsSync(parent)) throw new FreezeError("forbidden-unresolvable", fp);
      }
    }

    reconstructDependencies(stage, cfg);      // R4 clean-room
    verifyNetSandbox(stage);                  // R3 negative probe
    // R1 + R2 (single-shot; N-run covered by determinismCheck)
    const red = inNetSandbox(cfg.commands.regression_command, stage);
    if (red.code === 0) throw new FreezeError("base-not-red", "regression_command PASSED on base (must FAIL)");
    const green = inNetSandbox(cfg.commands.baseline_health_command, stage);
    if (green.code !== 0) throw new FreezeError("baseline-not-green", `baseline_health_command FAILED on base: ${green.stdout.slice(-200)}`);
    const det = determinismCheck(cfg, stage); // R5

    return {
      suiteHash, lockHash,
      preflight: {
        dependency_reconstruction: "CLEAN_ROOM_OK",
        network_sandbox: "DENIED_VERIFIED",
        base_regression: "RED",
        baseline_health: "GREEN",
        determinism: det,
      },
    };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Freeze with ATOMIC PUBLISH (R6): preflight fully in temp; publish only on success. */
export function freezeExperiment(repoDir: string, cfg: FreezeTaskConfig, outDir: string): FreezeManifest {
  const pre = runPreflight(repoDir, cfg); // throws INELIGIBLE → outDir untouched

  const experiment: RealTaskExperimentV1 = {
    schema_version: "real-task-experiment.v1",
    experiment_id: cfg.experiment_id,
    repository_url: cfg.repository_url,
    base_commit_sha: cfg.base_commit_sha,
    payer_identity: cfg.payer_identity,
    worker_identity: cfg.worker_identity,
    acceptance_suite: cfg.acceptance_suite,
    acceptance_suite_sha256: pre.suiteHash,
    acceptance_full_suite: cfg.acceptance_full_suite,
    full_suite_baseline_policy: "ALL_GREEN",
    lockfile_path: cfg.lockfile_path,
    lockfile_sha256: pre.lockHash,
    allowed_paths: cfg.allowed_paths,
    forbidden_paths: cfg.forbidden_paths,
    max_diff_lines: cfg.max_diff_lines,
    new_dependencies_allowed: false,
    network: "disabled",
    determinism_runs: cfg.determinism_runs,
    tier1_reward: cfg.tier1_reward,
    tier2_reward: cfg.tier2_reward,
    claim_mode: "SINGLE_CLAIMANT",
    commands: { ...cfg.commands },
    payer_precommit_text: cfg.payer_precommit_text,
    payer_precommit_timestamp: cfg.payer_precommit_timestamp,
  };
  assertFreezeComplete(experiment);

  const manifest: FreezeManifest = {
    schema_version: "freeze-manifest.v2",
    experiment_id: cfg.experiment_id,
    base_commit_sha: cfg.base_commit_sha,
    acceptance_suite_sha256: pre.suiteHash,
    lockfile_sha256: pre.lockHash,
    verification_ruleset_hash: verificationRulesetHash(verificationRulesetOf(experiment)),
    contract_freeze_hash: contractFreezeHash(experiment),
    precommit_binding: precommitBinding(experiment),
    frozen_at: cfg.payer_precommit_timestamp,
    eligibility: "ELIGIBLE",
    preflight: pre.preflight,
  };

  // CUT-1R2 generation-atomic publish: the complete generation is built in a
  // SIBLING temp dir, fsync-verified, then the FINAL dir must NOT exist and
  // the temp dir is RENAMED into place. Either 4/4 same-generation artifacts
  // appear, or 0/4 — a mid-publish failure can never leave a mixed set.
  // outDir must NOT pre-exist (no overwrite / no stale mixing in R0).
  if (existsSync(outDir)) {
    throw new FreezeError("outdir-exists", `${outDir} already exists — refuse to overwrite or mix generations`);
  }
  const parent = path.dirname(outDir);
  execFileSync("mkdir", ["-p", parent]);
  const staging = mkdtempSync(path.join(parent, ".ue1-gen-"));
  try {
    const onDiskContract = contractFreezeOf(experiment); // EXACTLY the hashed object
    writeFileSync(path.join(staging, "task.json"), JSON.stringify(experiment, null, 2) + "\n");
    writeFileSync(path.join(staging, "ruleset.json"), JSON.stringify(verificationRulesetOf(experiment), null, 2) + "\n");
    writeFileSync(path.join(staging, "contract-freeze.json"), JSON.stringify(onDiskContract, null, 2) + "\n");
    writeFileSync(path.join(staging, "freeze-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    // fsync every artifact before the rename (durability of the generation)
    for (const f of readdirSync(staging)) {
      const fd = openSync(path.join(staging, f), "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
    }
    // self-check the staged generation reopens and rehashes identically
    const stagedTask = JSON.parse(readFileSync(path.join(staging, "task.json"), "utf8")) as RealTaskExperimentV1;
    const stagedRuleset = verificationRulesetOf(stagedTask);
    const stagedRulesetFile = JSON.parse(readFileSync(path.join(staging, "ruleset.json"), "utf8"));
    if (JSON.stringify(stagedRuleset) !== JSON.stringify(stagedRulesetFile)) {
      throw new FreezeError("generation-selfcheck", "staged ruleset does not derive from staged task");
    }
    const stagedContract = JSON.parse(readFileSync(path.join(staging, "contract-freeze.json"), "utf8"));
    if (JSON.stringify(stagedContract) !== JSON.stringify(contractFreezeOf(stagedTask))) {
      throw new FreezeError("generation-selfcheck", "staged contract-freeze.json is not the canonical ContractFreezeV1 of the staged task");
    }
    if (contractFreezeHash(stagedTask) !== manifest.contract_freeze_hash) {
      throw new FreezeError("generation-selfcheck", "staged task rehash != manifest.contract_freeze_hash");
    }
    if (verificationRulesetHash(stagedRuleset) !== manifest.verification_ruleset_hash) {
      throw new FreezeError("generation-selfcheck", "staged ruleset rehash != manifest.verification_ruleset_hash");
    }
    if (precommitBinding(stagedTask) !== manifest.precommit_binding) {
      throw new FreezeError("generation-selfcheck", "staged task precommit rebind != manifest.precommit_binding");
    }
    // THE atomic step: rename the verified generation into place
    renameSync(staging, outDir);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true }); // 0/4 on ANY failure (incl. injected)
    throw e;
  }
  return manifest;
}

if (process.argv[1]?.endsWith("freeze.ts") && process.argv[2] === "experiment" && process.argv[3] === "freeze") {
  const [, , , , repoArg, cfgArg, outArg] = process.argv;
  if (!repoArg || !cfgArg || !outArg) {
    console.error("usage: node --experimental-strip-types src/freeze.ts experiment freeze <repo> <task-config.json> <out-dir>");
    process.exit(2);
  }
  const cfg = JSON.parse(readFileSync(cfgArg, "utf8")) as FreezeTaskConfig;
  try {
    const m = freezeExperiment(path.resolve(repoArg), cfg, path.resolve(outArg));
    console.log("ELIGIBLE — frozen:", JSON.stringify(m, null, 2));
  } catch (e) {
    console.error(String((e as Error).message));
    process.exit(1);
  }
}
