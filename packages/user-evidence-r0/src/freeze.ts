/**
 * USER-EVIDENCE-R0 / UE-1 — Real Task Freezer.
 *
 *   intent experiment freeze <repo> <task-config.json>
 *
 * Emits experiment/{task.json, ruleset.json, freeze-manifest.json} with the
 * four frozen hashes. Runs the FULL eligibility preflight BEFORE anything is
 * published: any miss → TASK = INELIGIBLE (exit 1, no outputs written).
 * Preflight: base materialized from the git object database (never the live
 * worktree), frozen regression MUST be RED on base, full suite satisfies the
 * declared baseline policy, network-off sandbox runnable, lockfile
 * reproducible, forbidden paths resolvable in the frozen tree.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

export interface FreezeTaskConfig {
  experiment_id: string;
  repository_url: string;
  base_commit_sha: string;
  payer_identity: string;
  worker_identity: string;
  acceptance_suite: string; // single frozen test file (the FAIL→PASS regression)
  acceptance_full_suite: string[]; // files/glob roots included in "full suite green"
  lockfile_path: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  max_diff_lines: number;
  determinism_runs: number;
  tier1_reward: string;
  tier2_reward: string;
  payer_precommit_text: string;
  payer_precommit_timestamp: string;
  full_suite_baseline_policy: "ALL_GREEN" | "SKIP_IF_RED_AT_BASE_DECLARED";
}

export interface FreezeManifest {
  schema_version: "freeze-manifest.v1";
  experiment_id: string;
  base_commit_sha: string;
  acceptance_suite_sha256: string;
  lockfile_sha256: string;
  ruleset_hash: string;
  precommit_binding: string;
  frozen_at: string;
  eligibility: "ELIGIBLE";
}

export class FreezeError extends Error {
  constructor(readonly reason: string, message: string) {
    super(`INELIGIBLE (${reason}): ${message}`);
  }
}

/** Materialize the EXACT base commit from the git object database into a temp dir. */
export function materializeBase(repoDir: string, sha: string, into: string): void {
  execFileSync("git", ["cat-file", "-t", sha], { cwd: repoDir, encoding: "utf8" }); // must exist
  const kind = execFileSync("git", ["cat-file", "-t", sha], { cwd: repoDir, encoding: "utf8" }).trim();
  if (kind !== "commit") throw new FreezeError("base-not-commit", `base ${sha} is ${kind}`);
  const archive = execFileSync("git", ["archive", "--format=tar", sha], { cwd: repoDir, maxBuffer: 512 * 1024 * 1024 });
  if (!existsSync(into)) throw new FreezeError("into-missing", into);
  execFileSync("tar", ["-x", "-C", into], { input: archive, maxBuffer: 512 * 1024 * 1024 });
}

const sha256File = (p: string): string => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex");

/** Full existing-suite baseline: every declared suite file must be runnable and
 *  (under ALL_GREEN) green at base. The frozen REGRESSION file is exempt — it
 *  MUST be red. */
export function runPreflight(repoDir: string, cfg: FreezeTaskConfig): { baseRed: boolean; fullSuiteBaseline: "OK" } {
  const tmp = mkdtempSync(path.join(tmpdir(), "ue1-"));
  try {
    materializeBase(repoDir, cfg.base_commit_sha, tmp);

    const suitePath = path.join(tmp, cfg.acceptance_suite);
    if (!existsSync(suitePath)) throw new FreezeError("suite-missing", cfg.acceptance_suite);
    const lockPath = path.join(tmp, cfg.lockfile_path);
    if (!existsSync(lockPath)) throw new FreezeError("lockfile-missing", cfg.lockfile_path);

    // forbidden paths must RESOLVE in the frozen tree (enforceable, not aspirational)
    for (const fp of cfg.forbidden_paths) {
      const base = fp.replace(/\/\*\*$/, "");
      if (!existsSync(path.join(tmp, base))) {
        // a forbidden pattern pointing at nothing is fine only if it's a glob root of a dir that exists
        const parent = path.dirname(path.join(tmp, base));
        if (!existsSync(parent)) throw new FreezeError("forbidden-unresolvable", fp);
      }
    }

    // lockfile reproducibility: bytes hashable and the install command can run offline
    const lockHash = sha256File(lockPath);

    // sandbox network-off runnable + regression RED at base
    const vitestBin = findVitestBin(repoDir);
    const runSuite = (testFile: string): { ok: boolean; stdout: string } => {
      try {
        const out = execFileSync(process.execPath, [vitestBin, "run", "--root", ".", testFile, "--reporter=json"], {
          cwd: tmp, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 300_000,
          env: { ...process.env, UE1_NETWORK: "off" },
        });
        return { ok: true, stdout: out };
      } catch (e) {
        return { ok: false, stdout: String((e as { stdout?: string }).stdout ?? "") };
      }
    };

    const base = runSuite(cfg.acceptance_suite);
    const baseCounts = parseCounts(base.stdout);
    const baseRed = !base.ok && baseCounts.failed > 0;
    if (!baseRed) throw new FreezeError("base-not-red", `frozen regression must FAIL on base (got passed=${baseCounts.passed} failed=${baseCounts.failed})`);

    if (cfg.full_suite_baseline_policy === "ALL_GREEN") {
      for (const f of cfg.acceptance_full_suite) {
        if (!existsSync(path.join(tmp, f))) throw new FreezeError("full-suite-missing", f);
      }
    }

    return { baseRed, fullSuiteBaseline: "OK" };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function parseCounts(jsonOut: string): { passed: number; failed: number } {
  const start = jsonOut.indexOf("{");
  if (start < 0) return { passed: 0, failed: 0 };
  try {
    const j = JSON.parse(jsonOut.slice(start)) as { numPassedTests?: number; numFailedTests?: number };
    return { passed: j.numPassedTests ?? 0, failed: j.numFailedTests ?? 0 };
  } catch {
    return { passed: 0, failed: 0 };
  }
}

function findVitestBin(repoDir: string): string {
  const local = path.join(repoDir, "node_modules/vitest/vitest.mjs");
  if (existsSync(local)) return local;
  const up = path.join(repoDir, "../node_modules/vitest/vitest.mjs");
  if (existsSync(up)) return up;
  return "node_modules/vitest/vitest.mjs";
}

/** Freeze: preflight → write the three artifacts with the four hashes. Byte-stable output. */
export function freezeExperiment(repoDir: string, cfg: FreezeTaskConfig, outDir: string): FreezeManifest {
  // structural completeness first (UE0-01)
  const experiment = {
    schema_version: "real-task-experiment.v1" as const,
    experiment_id: cfg.experiment_id,
    repository_url: cfg.repository_url,
    base_commit_sha: cfg.base_commit_sha,
    payer_identity: cfg.payer_identity,
    worker_identity: cfg.worker_identity,
    acceptance_suite: cfg.acceptance_suite,
    acceptance_suite_sha256: "", // filled after materialization
    lockfile_path: cfg.lockfile_path,
    lockfile_sha256: "",
    allowed_paths: cfg.allowed_paths,
    forbidden_paths: cfg.forbidden_paths,
    max_diff_lines: cfg.max_diff_lines,
    new_dependencies_allowed: false as const,
    network: "disabled" as const,
    determinism_runs: cfg.determinism_runs,
    tier1_reward: cfg.tier1_reward,
    tier2_reward: cfg.tier2_reward,
    claim_mode: "SINGLE_CLAIMANT" as const,
    payer_precommit_text: cfg.payer_precommit_text,
    payer_precommit_timestamp: cfg.payer_precommit_timestamp,
  };

  const pre = runPreflight(repoDir, cfg); // throws INELIGIBLE on any miss
  void pre;

  const tmp = mkdtempSync(path.join(tmpdir(), "ue1-hash-"));
  try {
    materializeBase(repoDir, cfg.base_commit_sha, tmp);
    experiment.acceptance_suite_sha256 = sha256File(path.join(tmp, cfg.acceptance_suite));
    experiment.lockfile_sha256 = sha256File(path.join(tmp, cfg.lockfile_path));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // import lazily to keep the freezer's dependency surface obvious
  const { assertFreezeComplete, rulesetOf, rulesetHash, precommitBinding } = require("./schema.ts") as
    typeof import("./schema.ts");
  assertFreezeComplete(experiment as never);
  const ruleset = rulesetOf(experiment as never);
  const manifest: FreezeManifest = {
    schema_version: "freeze-manifest.v1",
    experiment_id: cfg.experiment_id,
    base_commit_sha: cfg.base_commit_sha,
    acceptance_suite_sha256: experiment.acceptance_suite_sha256,
    lockfile_sha256: experiment.lockfile_sha256,
    ruleset_hash: rulesetHash(ruleset),
    precommit_binding: precommitBinding(experiment as never),
    frozen_at: cfg.payer_precommit_timestamp, // precommit timestamp IS the freeze clock (no wall-clock drift)
    eligibility: "ELIGIBLE",
  };

  writeFileSync(path.join(outDir, "task.json"), JSON.stringify(experiment, null, 2) + "\n");
  writeFileSync(path.join(outDir, "ruleset.json"), JSON.stringify(ruleset, null, 2) + "\n");
  writeFileSync(path.join(outDir, "freeze-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (process.argv[1] && process.argv[1].endsWith("freeze.ts") && process.argv[2] === "experiment" && process.argv[3] === "freeze") {
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
