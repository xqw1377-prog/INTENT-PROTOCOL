#!/usr/bin/env node
/**
 * Official GP2 candidate evidence builder (TEST-HYGIENE-R1 form).
 *
 * Explicit builder command — the ONLY thing allowed to materialize
 * gp2-candidate.json and the evidence CAS under golden-path/evidence/.
 * Committed GP2 evidence runs (the GP3 binding inputs) are NEVER deleted;
 * each invocation adds its own official run directory.
 */
import { execFileSync } from "node:child_process";
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
// pass 2: BUILDER MODE — the report-builder test writes gp2-candidate.json
// and persists its evidence CAS; the hygiene gate exempts builder runs.
execFileSync(process.execPath, [vitest, "run", "--root", "../..", "packages/gp-execution/test/gp2-build-report.test.ts"], {
  cwd: pkgDir, stdio: "inherit",
  env: {
    ...process.env,
    GP2_BUILD_CANDIDATE: "1",
    GP2_TESTS_PASSED: String(vj.numPassedTests ?? 0),
    GP2_TESTS_FAILED: String(vj.numFailedTests ?? 0),
  },
});
