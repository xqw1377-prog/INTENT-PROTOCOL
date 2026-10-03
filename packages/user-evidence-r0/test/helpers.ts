/**
 * USER-EVIDENCE-R0 CUT-2..4 test helpers.
 *
 * makeFixableRepo builds a REAL mini repo with a REAL fixable bug: the
 * frozen acceptance test demands add(1,2) === 3, the shipped src/add.ts
 * subtracts. The only path to green is a worker patch inside src/** —
 * exactly the Tier-1 shape of the First Real Task Card.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { FreezeTaskConfig } from "../src/freeze.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");

export const PRECOMMIT_TEXT =
  "I agree that if the frozen Tier-1 rules are satisfied, the Tier-1 reward has been earned by the recorded worker.";

const BUGGY_ADD = "export const add = (a: number, b: number): number => a - b; // seeded bug\n";
const FIXED_ADD = "export const add = (a: number, b: number): number => a + b;\n";
const WRONG_ADD = "export const add = (a: number, b: number): number => a * b; // still wrong\n";

const REGRESSION_TEST = [
  'import { expect, test } from "vitest";',
  'import { add } from "../src/add.ts";',
  "",
  'test("frozen acceptance: add(1,2) === 3", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "});",
  "",
].join("\n");

const GREEN_TEST = [
  'import { expect, test } from "vitest";',
  "",
  'test("baseline health", () => {',
  "  expect(1 + 1).toBe(2);",
  "});",
  "",
].join("\n");

/** A REAL mini repo: own package.json + lockfile, a seeded bug, red + green suites. */
export function makeFixableRepo(): { dir: string; sha: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "ue2-repo-"));
  const wr = (rel: string, content: string): void => {
    execFileSync("mkdir", ["-p", path.dirname(path.join(dir, rel))]);
    writeFileSync(path.join(dir, rel), content);
  };
  const vitestVersion = JSON.parse(readFileSync(path.join(repoRoot, "node_modules/vitest/package.json"), "utf8")).version;
  wr("package.json", JSON.stringify({ name: "fixable", private: true, type: "module", devDependencies: { vitest: vitestVersion } }, null, 2) + "\n");
  execFileSync("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund", "--ignore-scripts"], { cwd: dir, encoding: "utf8", timeout: 300_000 });
  wr("src/add.ts", BUGGY_ADD);
  wr("test/regression.test.ts", REGRESSION_TEST);
  wr("test/green.test.ts", GREEN_TEST);
  const g = (args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  g(["init", "--quiet"]);
  g(["add", "-A"]);
  g(["-c", "user.name=ue2", "-c", "user.email=ue2@invalid", "commit", "--quiet", "-m", "base"]);
  return { dir, sha: g(["rev-parse", "HEAD"]) };
}

/** Produce a unified-diff patch by mutating the repo worktree, capturing `git diff --cached HEAD`, then restoring HEAD exactly. */
export function makePatch(
  repoDir: string,
  mutate: (wr: (rel: string, content: string) => void, rm: (rel: string) => void) => void,
): string {
  const wr = (rel: string, content: string): void => {
    execFileSync("mkdir", ["-p", path.dirname(path.join(repoDir, rel))]);
    writeFileSync(path.join(repoDir, rel), content);
  };
  const rm = (rel: string): void => {
    execFileSync("rm", ["-f", path.join(repoDir, rel)]);
  };
  mutate(wr, rm);
  execFileSync("git", ["add", "-A"], { cwd: repoDir });
  const diff = execFileSync("git", ["diff", "--cached", "HEAD"], { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  execFileSync("git", ["reset", "--quiet", "--hard", "HEAD"], { cwd: repoDir });
  execFileSync("git", ["clean", "-fdq"], { cwd: repoDir });
  return diff;
}

/** The one correct fix: add(1,2) === 3 inside the allowed scope. */
export function fixPatch(repoDir: string): string {
  return makePatch(repoDir, (wr) => wr("src/add.ts", FIXED_ADD));
}

/** A patch that applies cleanly but does NOT fix the bug (still red). */
export function wrongFixPatch(repoDir: string): string {
  return makePatch(repoDir, (wr) => wr("src/add.ts", WRONG_ADD));
}

export function fixableConfig(repoDir: string, sha: string, over: Partial<FreezeTaskConfig> = {}): FreezeTaskConfig {
  return {
    experiment_id: "ue-002",
    repository_url: repoDir,
    base_commit_sha: sha,
    payer_identity: "payer:real-maintainer",
    worker_identity: "worker:external-002",
    acceptance_suite: "test/regression.test.ts",
    acceptance_full_suite: ["test/green.test.ts"],
    lockfile_path: "package-lock.json",
    allowed_paths: ["src/**"],
    forbidden_paths: ["test/**", "package-lock.json", ".github/**"],
    max_diff_lines: 200,
    determinism_runs: 2,
    tier1_reward: "80",
    tier2_reward: "20",
    payer_precommit_text: PRECOMMIT_TEXT,
    payer_precommit_timestamp: "2026-10-03T12:00:00.000Z",
    commands: {
      regression_command: "node node_modules/vitest/vitest.mjs run test/regression.test.ts --reporter=json",
      baseline_health_command: "node node_modules/vitest/vitest.mjs run test/green.test.ts --reporter=json",
      patched_acceptance_command: "node node_modules/vitest/vitest.mjs run test --reporter=json",
      package_manager: "npm",
      install_command: "npm ci --no-audit --no-fund --ignore-scripts",
    },
    ...over,
  };
}
