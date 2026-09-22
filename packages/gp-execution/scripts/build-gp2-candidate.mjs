#!/usr/bin/env node
/** Wrapper: runs the full GP2 suite; the report-builder test writes gp2-candidate.json. */
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const vitest = path.join(repoRoot, "node_modules/vitest/vitest.mjs");
// pass 1: capture the suite's real counts; pass 2: rebuild the report with them
// (no hand-copied numbers — the Commander's no-transcription-drift order)
const j = execFileSync(process.execPath, [vitest, "run", "--root", "../..", "packages/gp-execution", "--reporter=json"], {
  cwd: pkgDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
});
const vj = JSON.parse(j.slice(j.indexOf("{")));
if ((vj.numFailedTests ?? 0) > 0) { console.error(`suite has failures — report not rebuilt`); process.exit(1); }
// pass-1 was itself a REAL execution instance (its CAS copy is not the
// candidate); clear so the final tree contains exactly the reported run
rmSync(path.join(repoRoot, "packages/golden-path/evidence"), { recursive: true, force: true });
execFileSync(process.execPath, [vitest, "run", "--root", "../..", "packages/gp-execution"], {
  cwd: pkgDir, stdio: "inherit",
  env: { ...process.env, GP2_TESTS_PASSED: String(vj.numPassedTests ?? 0), GP2_TESTS_FAILED: String(vj.numFailedTests ?? 0) },
});
