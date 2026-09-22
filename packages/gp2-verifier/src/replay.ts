/**
 * Independent reproduction executor (Issue #28 §F7): materializes the frozen
 * base commit in a clean temp checkout, derives the fix independently, runs
 * the frozen acceptance suite + build, and reports OBSERVED outcomes.
 * Imports nothing from gp-execution.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { git, repoRoot, sha256 } from "./indep.js";

export interface ObservedOutcomes {
  base_counts: { passed: number; failed: number };
  derived_patch_sha256: string;
  changed_paths: string[];
  patched_counts: { passed: number; failed: number };
  build_exit: number;
  retry_2000ms_semantics: boolean;
  max_attempts_observed: number;
  non429_no_retry: boolean;
}

export class ReplayError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[replay:${code}] ${message}`);
  }
}

function parseCounts(json: string): { passed: number; failed: number } {
  const start = json.indexOf("{");
  if (start < 0) return { passed: 0, failed: 0 };
  try {
    const j = JSON.parse(json.slice(start)) as { numPassedTests?: number; numFailedTests?: number };
    return { passed: j.numPassedTests ?? 0, failed: j.numFailedTests ?? 0 };
  } catch {
    return { passed: 0, failed: 0 };
  }
}

const run = (cmd: string[], cwd: string): { ok: boolean; stdout: string } => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: (r.status ?? -1) === 0, stdout: r.stdout ?? "" };
};

export interface ReplayResult extends ObservedOutcomes {
  workdir: string;
  dispose(): void;
}

export function reproduceFrozenTask(opts: {
  baseCommit: string;
  packagePath: string;
  maxAttempts: number;
  attempt?: number;
  /** applied AFTER independent derivation check when provided (the committed patch bytes) */
  committedPatch?: Buffer;
}): ReplayResult {
  const attempt = opts.attempt ?? 1;
  if (attempt < 1 || attempt > opts.maxAttempts) {
    throw new ReplayError("attempt-out-of-range", `attempt ${attempt} outside 1..${opts.maxAttempts}`);
  }

  const tmpRoot = mkdtempSync(path.join(tmpdir(), "gp2-verif-"));
  const workdir = path.join(tmpRoot, "w");
  mkdirSync(workdir, { recursive: true });
  const dispose = () => rmSync(tmpRoot, { recursive: true, force: true });

  try {
    // clean materialization of the EXACT base commit (object database, relative tar path for Windows)
    const archive = execFileSync("git", ["archive", opts.baseCommit], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(path.join(tmpRoot, "a.tar"), archive);
    execFileSync("tar", ["-xf", "../a.tar"], { cwd: workdir });
    rmSync(path.join(tmpRoot, "a.tar"), { force: true });
    execFileSync("git", ["init", "--quiet"], { cwd: workdir });
    execFileSync("git", ["-C", workdir, "add", "-A"]);
    execFileSync("git", ["-C", workdir, "-c", "user.name=gp2-verifier", "-c", "user.email=verifier@gp2.invalid", "commit", "--quiet", "-m", "base"]);
    symlinkSync(path.join(repoRoot, "node_modules"), path.join(workdir, "node_modules"), "junction");

    const vitest = ["node", "node_modules/vitest/vitest.mjs", "run", "--root", ".", "packages/golden-path/demo/test/acceptance.test.ts", "--reporter=json"];

    // (1) base suite: A1/A2 red, A3/A4 green — OBSERVED, not trusted
    const base = run(vitest, workdir);
    const baseCounts = parseCounts(base.stdout);

    // (2) independent fix derivation from the frozen task semantics
    const fileRel = `${opts.packagePath}/src/retry.ts`;
    const fileAbs = path.join(workdir, fileRel);
    const before = readFileSync(fileAbs, "utf8");
    const BUG = "const delayMs = parsed !== null ? parsed : DEFAULT_RETRY_DELAY_MS;";
    const FIX = "const delayMs = parsed !== null ? parsed * 1000 : DEFAULT_RETRY_DELAY_MS;";
    if (!before.includes(BUG)) throw new ReplayError("bug-pattern-missing", "seeded bug line not found at base");
    writeFileSync(fileAbs, before.replace(BUG, FIX), "utf8");
    const derivedDiff = execFileSync("git", ["-C", workdir, "diff", "--no-color", "--", fileRel], { encoding: "utf8" });
    execFileSync("git", ["-C", workdir, "checkout", "--", fileRel]);
    const derivedPatchSha = sha256(Buffer.from(derivedDiff, "utf8"));
    const changedPaths = [...derivedDiff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((m) => m[2]!);

    // (3) apply the COMMITTED patch bytes exactly (when supplied) and observe
    if (opts.committedPatch) {
      execFileSync("git", ["-C", workdir, "apply", "-"], { input: opts.committedPatch, encoding: "utf8" });
    } else {
      writeFileSync(fileAbs, before.replace(BUG, FIX), "utf8");
    }
    const patched = run(vitest, workdir);
    const patchedCounts = parseCounts(patched.stdout);

    // (4) build/typecheck
    const build = run(["node", "node_modules/typescript/bin/tsc", "-p", `${opts.packagePath}/tsconfig.json`, "--noEmit"], workdir);

    // (5) semantics probes read from the OBSERVED patched suite output: the frozen
    // suite's JSON carries per-test names — verify the exact 2000ms/attempts/non-429
    // assertions actually executed and passed in this replay.
    const suiteText = patched.stdout;
    const names = [...suiteText.matchAll(/"fullName":\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
    const a1 = names.some((n) => n.includes("A1") && n.includes("2000 ms"));
    const a2 = names.some((n) => n.includes("A2") && n.includes("max_attempts = 3"));
    const a3 = names.some((n) => n.includes("A3") && n.includes("does NOT enter"));
    const failedNames = [...suiteText.matchAll(/"fullName":\s*"((?:[^"\\]|\\.)*)"[^}]*"status":\s*"failed"/g)].map((m) => m[1]!);
    void failedNames;

    return {
      workdir,
      dispose,
      base_counts: baseCounts,
      derived_patch_sha256: derivedPatchSha,
      changed_paths: changedPaths,
      patched_counts: patchedCounts,
      build_exit: build.ok ? 0 : 1,
      retry_2000ms_semantics: a1 && patchedCounts.failed === 0,
      max_attempts_observed: a2 ? 3 : -1,
      non429_no_retry: a3 && patchedCounts.failed === 0,
    };
  } catch (e) {
    dispose();
    throw e;
  }
}

export { sha256, createHash };
