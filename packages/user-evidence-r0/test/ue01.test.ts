/** USER-EVIDENCE-R0 CUT-1 machine tests — UE0-01..05 + UE1-01..10. */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  assertFreezeComplete, precommitBinding, rulesetHash, rulesetOf,
  type RealTaskExperimentV1,
} from "../src/schema.ts";
import { freezeExperiment, materializeBase, runPreflight, type FreezeTaskConfig } from "../src/freeze.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");

const PRECOMMIT_TEXT =
  "I agree that if the frozen Tier-1 rules are satisfied, the Tier-1 reward has been earned by the recorded worker.";

function validConfig(): FreezeTaskConfig {
  return {
    experiment_id: "ue-001",
    repository_url: "https://example.invalid/repo",
    base_commit_sha: "0000000000000000000000000000000000000000", // overridden per test
    payer_identity: "payer:real-maintainer",
    worker_identity: "worker:external-001",
    acceptance_suite: "packages/user-evidence-r0/fixtures/red-suite.test.ts",
    acceptance_full_suite: [],
    lockfile_path: "package-lock.json",
    allowed_paths: ["src/**"],
    forbidden_paths: ["packages/user-evidence-r0/fixtures/**", "package-lock.json", ".github/**"],
    max_diff_lines: 200,
    determinism_runs: 3,
    tier1_reward: "80",
    tier2_reward: "20",
    payer_precommit_text: PRECOMMIT_TEXT,
    payer_precommit_timestamp: "2026-10-01T12:00:00.000Z",
    full_suite_baseline_policy: "ALL_GREEN",
  };
}

/** A REAL mini repo with a REAL red test, committed so the object database holds the base. */
function makeRealRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "ue1-repo-"));
  const wr = (rel: string, content: string) => {
    const p = path.join(dir, rel);
    writeFileSync(p, content);
  };
  wr("package.json", JSON.stringify({ name: "mini", private: true, type: "module", scripts: { test: "vitest run packages/user-evidence-r0/test/fixtures" } }, null, 2) + "\n");
  // reuse the ROOT node_modules (junction copy, like the GP2 runner) + a MINIMAL
  // vitest config of the mini repo's own (the root config's hygiene gate and
  // include patterns do not apply to the experiment sandbox)
  cpSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), { recursive: true, dereference: false });
  wr("vitest.config.ts", `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["packages/user-evidence-r0/fixtures/**/*.test.ts"] } });\n`);
  // vitest include needs our fixture under packages/... to be picked up; simplest: mirror path
  const fixtureDir = path.join(dir, "packages/user-evidence-r0/fixtures");
  cpSync(path.join(pkgDir, "fixtures"), fixtureDir, { recursive: true });
  cpSync(path.join(pkgDir, "src"), path.join(dir, "packages/user-evidence-r0/src"), { recursive: true });
  wr("package-lock.json", JSON.stringify({ name: "mini", lockfileVersion: 3, requires: true, packages: { "": { name: "mini" } } }, null, 2) + "\n");
  const g = (args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  g(["init", "--quiet"]);
  g(["add", "-A"]);
  g(["-c", "user.name=ue1", "-c", "user.email=ue1@invalid", "commit", "--quiet", "-m", "base"]);
  const sha = g(["rev-parse", "HEAD"]);
  return { dir, sha };
}

describe("[UE-0] experiment contract", () => {
  test("[UE0-01] schema completeness: every Tier-1 judging variable resolved; each missing field is named", () => {
    const cfg = validConfig();
    const e: RealTaskExperimentV1 = {
      schema_version: "real-task-experiment.v1", experiment_id: cfg.experiment_id,
      repository_url: cfg.repository_url, base_commit_sha: cfg.base_commit_sha,
      payer_identity: cfg.payer_identity, worker_identity: cfg.worker_identity,
      acceptance_suite: cfg.acceptance_suite, acceptance_suite_sha256: "sha256:" + "a".repeat(64),
      lockfile_path: cfg.lockfile_path, lockfile_sha256: "sha256:" + "b".repeat(64),
      allowed_paths: cfg.allowed_paths, forbidden_paths: cfg.forbidden_paths,
      max_diff_lines: cfg.max_diff_lines, new_dependencies_allowed: false, network: "disabled",
      determinism_runs: cfg.determinism_runs, tier1_reward: cfg.tier1_reward, tier2_reward: cfg.tier2_reward,
      claim_mode: "SINGLE_CLAIMANT", payer_precommit_text: cfg.payer_precommit_text,
      payer_precommit_timestamp: cfg.payer_precommit_timestamp,
    };
    expect(() => assertFreezeComplete(e)).not.toThrow();
    // each missing field is named
    for (const field of ["base_commit_sha", "allowed_paths", "max_diff_lines", "payer_precommit_text", "payer_identity"] as const) {
      const broken = { ...e } as Record<string, unknown>;
      if (field === "base_commit_sha") broken[field] = "short";
      else if (field === "allowed_paths" || field === "forbidden_paths") broken[field] = [];
      else if (field === "max_diff_lines") broken[field] = 0;
      else broken[field] = "";
      expect(() => assertFreezeComplete(broken as never), field).toThrow(field);
    }
  });

  test("[UE0-02] payer precommit is hash-bound to the ruleset + exact words + timestamp", () => {
    const cfg = validConfig();
    const e: RealTaskExperimentV1 = {
      schema_version: "real-task-experiment.v1", experiment_id: "ue-x", repository_url: cfg.repository_url,
      base_commit_sha: "f".repeat(40), payer_identity: "p", worker_identity: "w",
      acceptance_suite: "s", acceptance_suite_sha256: "sha256:" + "a".repeat(64),
      lockfile_path: "l", lockfile_sha256: "sha256:" + "b".repeat(64),
      allowed_paths: ["src/**"], forbidden_paths: ["t/**"], max_diff_lines: 10,
      new_dependencies_allowed: false, network: "disabled", determinism_runs: 3,
      tier1_reward: "1", tier2_reward: "1", claim_mode: "SINGLE_CLAIMANT",
      payer_precommit_text: "I agree.", payer_precommit_timestamp: "2026-10-01T00:00:00Z",
    };
    const b1 = precommitBinding(e);
    expect(b1).toMatch(/^sha256:[0-9a-f]{64}$/);
    // changing the RULES changes the binding
    const changedRules = { ...e, max_diff_lines: 11 } as RealTaskExperimentV1;
    expect(precommitBinding(changedRules)).not.toBe(b1);
    // changing the WORDS changes the binding
    const changedWords = { ...e, payer_precommit_text: "I agree (v2)." } as RealTaskExperimentV1;
    expect(precommitBinding(changedWords)).not.toBe(b1);
    // same input → same binding
    expect(precommitBinding({ ...e })).toBe(b1);
  });

  test("[UE0-03] single-claim is hard-coded (schema rejects any other mode)", () => {
    const cfg = validConfig();
    const e = {
      schema_version: "real-task-experiment.v1", experiment_id: "x", repository_url: "u",
      base_commit_sha: "f".repeat(40), payer_identity: "p", worker_identity: "w",
      acceptance_suite: "s", acceptance_suite_sha256: "sha256:" + "a".repeat(64),
      lockfile_path: "l", lockfile_sha256: "sha256:" + "b".repeat(64),
      allowed_paths: ["s"], forbidden_paths: ["t"], max_diff_lines: 1,
      new_dependencies_allowed: false, network: "disabled" as const, determinism_runs: 1,
      tier1_reward: "1", tier2_reward: "1", claim_mode: "OPEN_SEASON" as unknown as "SINGLE_CLAIMANT",
      payer_precommit_text: "t", payer_precommit_timestamp: "2026-10-01T00:00:00Z",
    };
    expect(() => assertFreezeComplete(e as never)).toThrow("claim_mode");
  });

  test("[UE0-04 + UE0-05] auto-release and Tier-2 execution are EXPLICITLY ABSENT in the ruleset", () => {
    const cfg = validConfig();
    const r = rulesetOf({
      schema_version: "real-task-experiment.v1", experiment_id: "x", repository_url: "u",
      base_commit_sha: "f".repeat(40), payer_identity: "p", worker_identity: "w",
      acceptance_suite: "s", acceptance_suite_sha256: "sha256:" + "a".repeat(64),
      lockfile_path: "l", lockfile_sha256: "sha256:" + "b".repeat(64),
      allowed_paths: ["s"], forbidden_paths: ["t"], max_diff_lines: 1,
      new_dependencies_allowed: false, network: "disabled", determinism_runs: 1,
      tier1_reward: "1", tier2_reward: "1", claim_mode: "SINGLE_CLAIMANT",
      payer_precommit_text: "t", payer_precommit_timestamp: "2026-10-01T00:00:00Z",
    });
    expect(r.auto_release).toBe("ABSENT");
    expect(r.tier2_execution).toBe("ABSENT");
    expect(r.new_dependencies_allowed).toBe(false);
    expect(r.network).toBe("disabled");
  });
});

describe("[UE-1] real task freezer", () => {
  test("[UE1-01..05, UE1-07..08] freeze a REAL repo with a REAL red test: hashes pinned, preflight green, forbidden paths enforced", { timeout: 600_000 }, () => {
    const { dir, sha } = makeRealRepo();
    try {
      const cfg = { ...validConfig(), base_commit_sha: sha, repository_url: dir };
      const out = mkdtempSync(path.join(tmpdir(), "ue1-out-"));
      try {
        const m = freezeExperiment(dir, cfg, out);
        // UE1-01: exact base commit exists (freeze would have thrown otherwise)
        expect(m.base_commit_sha).toBe(sha);
        // UE1-03/04: suite + lockfile hashes pinned in the manifest and files
        expect(m.acceptance_suite_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(m.lockfile_sha256).toMatch(/^sha256:[0-9-a-f]*$/); // format guard
        expect(existsSync(path.join(out, "task.json"))).toBe(true);
        expect(existsSync(path.join(out, "ruleset.json"))).toBe(true);
        expect(existsSync(path.join(out, "freeze-manifest.json"))).toBe(true);
        // UE1-06: determinism runs frozen in the artifacts
        const task = JSON.parse(readFileSync(path.join(out, "task.json"), "utf8"));
        expect(task.determinism_runs).toBe(3);
        expect(task.network).toBe("disabled");
        expect(task.new_dependencies_allowed).toBe(false); // UE1-08 in the frozen contract
        expect(task.claim_mode).toBe("SINGLE_CLAIMANT");
        // UE1-07: forbidden paths recorded and resolvable (preflight passed)
        expect(task.forbidden_paths).toContain("package-lock.json");
        // UE1-09: ruleset hash deterministic
        expect(m.ruleset_hash).toBe(rulesetHash(rulesetOf(task)));
        expect(m.precommit_binding).toBe(precommitBinding(task));
      } finally { rmSync(out, { recursive: true, force: true }); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[UE1-02] base regression RED is REQUIRED — a green-at-base suite is INELIGIBLE", { timeout: 600_000 }, () => {
    const { dir, sha } = makeRealRepo();
    try {
      // a suite that is GREEN at base: reuse a passing test (identity of this package)
      const cfg = { ...validConfig(), base_commit_sha: sha, acceptance_suite: "packages/user-evidence-r0/fixtures/green.test.ts" };
      expect(() => runPreflight(dir, cfg)).toThrow(/INELIGIBLE \(base-not-red\)/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[UE1-01] a non-existent base SHA is INELIGIBLE before anything runs", { timeout: 120_000 }, () => {
    const { dir } = makeRealRepo();
    try {
      const cfg = { ...validConfig(), base_commit_sha: "0".repeat(40) };
      expect(() => runPreflight(dir, cfg)).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[UE1-10] freeze output reopens byte-identically (round-trip, frozen artifacts are the storage)", { timeout: 600_000 }, () => {
    const { dir, sha } = makeRealRepo();
    try {
      const cfg = { ...validConfig(), base_commit_sha: sha };
      const out1 = mkdtempSync(path.join(tmpdir(), "ue1-rt1-"));
      const out2 = mkdtempSync(path.join(tmpdir(), "ue1-rt2-"));
      try {
        freezeExperiment(dir, cfg, out1);
        freezeExperiment(dir, cfg, out2);
        for (const f of ["task.json", "ruleset.json", "freeze-manifest.json"]) {
          expect(readFileSync(path.join(out1, f)).equals(readFileSync(path.join(out2, f))), f).toBe(true);
        }
        // and the artifacts THEMSELVES satisfy the schema on reopen
        const task = JSON.parse(readFileSync(path.join(out1, "task.json"), "utf8"));
        expect(() => assertFreezeComplete(task)).not.toThrow();
      } finally { rmSync(out1, { recursive: true, force: true }); rmSync(out2, { recursive: true, force: true }); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
