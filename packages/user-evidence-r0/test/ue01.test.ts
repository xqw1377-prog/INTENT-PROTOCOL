/** USER-EVIDENCE-R0 CUT-1R machine tests — UE0-R1..R5 + UE1-R1..R6. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  assertFreezeComplete, contractFreezeHash, precommitBinding, verificationRulesetHash, verificationRulesetOf,
  type RealTaskExperimentV1,
} from "../src/schema.ts";
import { freezeExperiment, runPreflight, type FreezeTaskConfig } from "../src/freeze.ts";
import { contractFreezeOf } from "../src/schema.ts";
import { createHash } from "node:crypto";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");

const PRECOMMIT_TEXT =
  "I agree that if the frozen Tier-1 rules are satisfied, the Tier-1 reward has been earned by the recorded worker.";

function validConfig(): FreezeTaskConfig {
  return {
    experiment_id: "ue-001",
    repository_url: "https://example.invalid/repo",
    base_commit_sha: "0".repeat(40), // overridden per test
    payer_identity: "payer:real-maintainer",
    worker_identity: "worker:external-001",
    acceptance_suite: "packages/user-evidence-r0/fixtures/red-suite.test.ts",
    acceptance_full_suite: ["packages/user-evidence-r0/fixtures/green.test.ts"],
    lockfile_path: "package-lock.json",
    allowed_paths: ["src/**"],
    forbidden_paths: ["packages/user-evidence-r0/fixtures/**", "package-lock.json", ".github/**"],
    max_diff_lines: 200,
    determinism_runs: 2,
    tier1_reward: "80",
    tier2_reward: "20",
    payer_precommit_text: PRECOMMIT_TEXT,
    payer_precommit_timestamp: "2026-10-01T12:00:00.000Z",
    commands: {
      regression_command: "node node_modules/vitest/vitest.mjs run packages/user-evidence-r0/fixtures/red-suite.test.ts --reporter=json",
      baseline_health_command: "node node_modules/vitest/vitest.mjs run packages/user-evidence-r0/fixtures/green.test.ts --reporter=json",
      patched_acceptance_command: "node node_modules/vitest/vitest.mjs run packages/user-evidence-r0/fixtures --reporter=json",
      package_manager: "npm",
      install_command: "npm ci --ignore-scripts",
    },
  };
}

function validExperiment(over: Partial<RealTaskExperimentV1> = {}): RealTaskExperimentV1 {
  return {
    schema_version: "real-task-experiment.v1",
    experiment_id: "ue-x",
    repository_url: "https://example.invalid/r",
    base_commit_sha: "f".repeat(40),
    payer_identity: "payer:p",
    worker_identity: "worker:w",
    acceptance_suite: "s.ts",
    acceptance_suite_sha256: "sha256:" + "a".repeat(64),
    acceptance_full_suite: ["g.ts"],
    full_suite_baseline_policy: "ALL_GREEN",
    lockfile_path: "package-lock.json",
    lockfile_sha256: "sha256:" + "b".repeat(64),
    allowed_paths: ["src/**"],
    forbidden_paths: ["t/**"],
    max_diff_lines: 10,
    new_dependencies_allowed: false,
    network: "disabled",
    determinism_runs: 2,
    tier1_reward: "80",
    tier2_reward: "20",
    claim_mode: "SINGLE_CLAIMANT",
    commands: {
      regression_command: "false",
      baseline_health_command: "true",
      patched_acceptance_command: "true",
      package_manager: "npm",
      install_command: "npm ci --ignore-scripts",
    },
    payer_precommit_text: "I agree.",
    payer_precommit_timestamp: "2026-10-01T00:00:00Z",
    ...over,
  } as RealTaskExperimentV1;
}

/** A REAL mini repo: own package.json+lockfile, committed red + green suites. NOT borrowing node_modules. */
function makeRealRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "ue1r-repo-"));
  const wr = (rel: string, content: string) => writeFileSync(path.join(dir, rel), content);
  wr("package.json", JSON.stringify({
    name: "mini", private: true, type: "module",
    devDependencies: { vitest: JSON.parse(readFileSync(path.join(repoRoot, "node_modules/vitest/package.json"), "utf8")).version },
  }, null, 2) + "\n");
  // a REAL lockfile that npm ci can reconstruct from (deps resolve from the local npm cache — offline)
  execFileSync("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: dir, encoding: "utf8", timeout: 300_000 });
  const fixturesSrc = path.join(pkgDir, "fixtures");
  const fixturesDst = path.join(dir, "packages/user-evidence-r0/fixtures");
  execFileSync("mkdir", ["-p", fixturesDst]);
  for (const f of ["red-suite.test.ts", "green.test.ts"]) {
    execFileSync("cp", [path.join(fixturesSrc, f), path.join(fixturesDst, f)]);
  }
  const g = (args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  g(["init", "--quiet"]);
  g(["add", "-A"]);
  g(["-c", "user.name=ue1", "-c", "user.email=ue1@invalid", "commit", "--quiet", "-m", "base"]);
  return { dir, sha: g(["rev-parse", "HEAD"]) };
}

describe("[UE-0 CUT-1R] contract binding", () => {
  test("[UE0-R1] precommit flips when Tier1 amount changes", () => {
    const e = validExperiment();
    const b1 = precommitBinding(e);
    expect(precommitBinding(validExperiment({ tier1_reward: "20" }))).not.toBe(b1);
  });
  test("[UE0-R2] precommit flips when Tier2 amount changes", () => {
    const e = validExperiment();
    expect(precommitBinding(validExperiment({ tier2_reward: "80" }))).not.toBe(precommitBinding(e));
  });
  test("[UE0-R3] payer identity change invalidates binding (worker too; every frozen command too)", () => {
    const e = validExperiment();
    const b1 = precommitBinding(e);
    expect(precommitBinding(validExperiment({ payer_identity: "payer:other" }))).not.toBe(b1);
    expect(precommitBinding(validExperiment({ worker_identity: "worker:other" }))).not.toBe(b1);
    const changedCmd = validExperiment();
    changedCmd.commands = { ...changedCmd.commands, regression_command: "false # v2" };
    expect(precommitBinding(changedCmd)).not.toBe(b1);
    expect(precommitBinding(validExperiment())).toBe(b1); // identity stable
  });
  test("[UE0-R4] all required fields strict-validated (each miss named)", () => {
    for (const field of ["experiment_id", "worker_identity", "acceptance_suite", "lockfile_path", "tier2_reward"] as const) {
      const broken: Record<string, unknown> = { ...validExperiment() };
      broken[field] = "";
      expect(() => assertFreezeComplete(broken as never), field).toThrow(field);
    }
    expect(() => assertFreezeComplete(validExperiment())).not.toThrow();
  });
  test("[UE0-R5] all sha256 fields exact grammar ^sha256:[0-9a-f]{64}$ (bad shapes rejected)", () => {
    for (const bad of ["", "sha256:", "sha256:xyz", "sha256:" + "a".repeat(63), "notahash"]) {
      const broken: Record<string, unknown> = { ...validExperiment(), acceptance_suite_sha256: bad };
      expect(() => assertFreezeComplete(broken as never), JSON.stringify(bad)).toThrow("acceptance_suite_sha256");
    }
  });
});

describe("[UE-1 CUT-1R] real preflight", () => {
  test("[UE1-R1..R5] REAL repo end-to-end: clean-room install, net-denied sandbox, red regression, green baseline, deterministic, frozen artifacts", { timeout: 1_200_000 }, () => {
    const { dir, sha } = makeRealRepo();
    try {
      const cfg = { ...validConfig(), base_commit_sha: sha, repository_url: dir, determinism_runs: 2 };
      const outParent = mkdtempSync(path.join(tmpdir(), "ue1r-out-"));
      const out = path.join(outParent, "gen");
      try {
        const m = freezeExperiment(dir, cfg, out);
        expect(m.preflight.dependency_reconstruction).toBe("CLEAN_ROOM_OK");
        expect(m.preflight.network_sandbox).toBe("DENIED_VERIFIED");
        expect(m.preflight.base_regression).toBe("RED");
        expect(m.preflight.baseline_health).toBe("GREEN");
        expect(m.preflight.determinism).toBe("2/2");
        expect(m.verification_ruleset_hash).toBe(verificationRulesetHash(verificationRulesetOf(JSON.parse(readFileSync(path.join(out, "task.json"), "utf8")))));
        expect(m.contract_freeze_hash).toBe(contractFreezeHash(JSON.parse(readFileSync(path.join(out, "task.json"), "utf8"))));
        expect(existsSync(path.join(out, "contract-freeze.json"))).toBe(true);
      } finally { rmSync(outParent, { recursive: true, force: true }); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[UE1-R1 negative] regression PASSING at base → INELIGIBLE", { timeout: 900_000 }, () => {
    const { dir, sha } = makeRealRepo();
    try {
      const cfg = { ...validConfig(), base_commit_sha: sha, commands: { ...validConfig().commands, regression_command: validConfig().commands.baseline_health_command } };
      expect(() => runPreflight(dir, cfg)).toThrow(/INELIGIBLE \(base-not-red\)/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[UE1-R2 negative] baseline FAILING at base → INELIGIBLE", { timeout: 900_000 }, () => {
    const { dir, sha } = makeRealRepo();
    try {
      const cfg = { ...validConfig(), base_commit_sha: sha, commands: { ...validConfig().commands, baseline_health_command: validConfig().commands.regression_command } };
      expect(() => runPreflight(dir, cfg)).toThrow(/INELIGIBLE \(baseline-not-green\)/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[UE1-R6] a FAILED freeze leaves the output dir UNTOUCHED (no residue mistaken for success)", { timeout: 900_000 }, () => {
    const { dir, sha } = makeRealRepo();
    try {
      const out = mkdtempSync(path.join(tmpdir(), "ue1r-res-"));
      try {
        const stale = path.join(out, "task.json");
        writeFileSync(stale, '{"stale": true}\n');
        const bad = { ...validConfig(), base_commit_sha: sha, commands: { ...validConfig().commands, regression_command: "true" } };
        expect(() => freezeExperiment(dir, bad, out)).toThrow(/INELIGIBLE/);
        expect(JSON.parse(readFileSync(stale, "utf8"))).toEqual({ stale: true }); // old content intact, nothing overwritten
        expect(existsSync(path.join(out, "freeze-manifest.json"))).toBe(false);
      } finally { rmSync(out, { recursive: true, force: true }); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("[UE-1 CUT-1R2] artifact persistence", () => {
  // same canonical form the schema hashes with: deep-sorted keys, no whitespace
  const canonical = (v: unknown): string => {
    const ds = (x: unknown): unknown => {
      if (x === null || typeof x !== "object" || Array.isArray(x)) return Array.isArray(x) ? x.map(ds) : x;
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(x as Record<string, unknown>).sort()) o[k] = ds((x as Record<string, unknown>)[k]);
      return o;
    };
    return JSON.stringify(ds(v));
  };

  test("[UE1-R7/R8/R9/R10] on-disk generation is the canonical self-verifying closure", { timeout: 1_200_000 }, () => {
    const { dir, sha } = makeRealRepo();
    try {
      const cfg = { ...validConfig(), base_commit_sha: sha, repository_url: dir };
      const outParent = mkdtempSync(path.join(tmpdir(), "ue1r2-ok-"));
      const out = path.join(outParent, "gen");
      try {
        const m = freezeExperiment(dir, cfg, out);
        const task = JSON.parse(readFileSync(path.join(out, "task.json"), "utf8"));
        const rulesetFile = JSON.parse(readFileSync(path.join(out, "ruleset.json"), "utf8"));
        const contractFile = JSON.parse(readFileSync(path.join(out, "contract-freeze.json"), "utf8"));
        // R7: contract-freeze.json is EXACTLY ContractFreezeV1 (schema_version + content)
        expect(contractFile.schema_version).toBe("real-task-contract-freeze.v1");
        expect(contractFile).toEqual(contractFreezeOf(task));
        // R8/R9/R10: hashes re-derive from the on-disk artifacts
        expect(createHash("sha256").update(canonical(contractFile)).digest("hex")).toBe(m.contract_freeze_hash.slice(7));
        expect(createHash("sha256").update(canonical(rulesetFile)).digest("hex")).toBe(m.verification_ruleset_hash.slice(7));
        expect(precommitBinding(task)).toBe(m.precommit_binding);
      } finally { rmSync(outParent, { recursive: true, force: true }); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[UE1-R6A] publish is generation-atomic: 4/4 same-generation artifacts or nothing; outDir must not pre-exist", { timeout: 1_200_000 }, () => {
    const { dir, sha } = makeRealRepo();
    try {
      const cfg = { ...validConfig(), base_commit_sha: sha, repository_url: dir };
      const parent = mkdtempSync(path.join(tmpdir(), "ue1r2-at-"));
      const out = path.join(parent, "gen");
      try {
        expect(existsSync(out)).toBe(false);
        const m = freezeExperiment(dir, cfg, out);
        const files = execFileSync("ls", [out], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
        expect(files).toEqual(["contract-freeze.json", "freeze-manifest.json", "ruleset.json", "task.json"]);
        // refusing to overwrite: a second freeze into the SAME dir is rejected, existing set intact
        expect(() => freezeExperiment(dir, cfg, out)).toThrow(/INELIGIBLE \(outdir-exists\)/);
        const files2 = execFileSync("ls", [out], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
        expect(files2).toEqual(files);
        expect(JSON.parse(readFileSync(path.join(out, "freeze-manifest.json"), "utf8")).frozen_at).toBe(m.frozen_at);
      } finally { rmSync(parent, { recursive: true, force: true }); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[UE1-R6B] injected publish failure exposes ZERO partial new generation", { timeout: 1_200_000 }, () => {
    const { dir, sha } = makeRealRepo();
    try {
      const cfg = { ...validConfig(), base_commit_sha: sha, repository_url: dir };
      const parent = mkdtempSync(path.join(tmpdir(), "ue1r2-fail-"));
      try {
        const out = path.join(parent, "gen");
        // simulate a publish-phase failure AFTER preflight by making the parent read-only
        // so the rename of the staging dir cannot land
        execFileSync("chmod", ["555", parent]);
        try {
          expect(() => freezeExperiment(dir, cfg, out)).toThrow(); // rename fails → 0/4 visible
        } finally {
          execFileSync("chmod", ["755", parent]);
        }
        expect(existsSync(out)).toBe(false);
        // no stray .ue1-gen-* staging residue left behind
        const residue = execFileSync("ls", ["-a", parent], { encoding: "utf8" }).split("\n").filter((x) => x.startsWith(".ue1-gen-"));
        expect(residue).toEqual([]);
      } finally { rmSync(parent, { recursive: true, force: true }); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
