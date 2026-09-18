#!/usr/bin/env node
/**
 * Full conformance pipeline with a FAITHFUL exit code.
 *
 * Runs vitest (JSON output), then always builds the report, then exits with
 * VITEST's exit code. This replaces the old `vitest ...; node build-report`
 * shell chain, whose exit code was silently taken from build-report — i.e. a
 * conformance run with FAIL findings could exit 0. Commander requirement
 * (PR #3 order, 2026-09-17): a run with FAIL findings must fail the job; the
 * report is still produced as evidence.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Spawn the real JS entry via the current node binary: node_modules/.bin/vitest
// is a POSIX shell wrapper that spawnSync cannot exec on Windows, which made the
// runner silently skip the tests and build a report from stale vitest-results.json.
const vitestBin = path.resolve(pkgDir, "../../node_modules/vitest/vitest.mjs");

// CI purges report/ before the run; the output directory must exist for
// vitest's --outputFile regardless of whether vitest recreates it itself.
mkdirSync(path.join(pkgDir, "report"), { recursive: true });

const vitest = spawnSync(
  process.execPath,
  [vitestBin, "run", "--root", "../..", "--reporter=json", "--outputFile=packages/conformance-harness/report/vitest-results.json", "packages/conformance-harness"],
  { cwd: pkgDir, stdio: "inherit" },
);

if (vitest.error || vitest.status === null) {
  // vitest never ran: building a report now would dress stale results up as
  // fresh evidence. Refuse instead.
  console.error(`vitest failed to run: ${vitest.error ?? "no exit status"} — refusing to build a report from possibly-stale results`);
  process.exit(1);
}

const report = spawnSync(process.execPath, ["scripts/build-report.mjs"], { cwd: pkgDir, stdio: "inherit" });

if (report.status !== 0) {
  console.error(`report builder failed (exit ${report.status}) — no evidence written`);
  process.exit(report.status ?? 1);
}
if (vitest.status !== 0) {
  console.error(`conformance finished with FAIL findings (vitest exit ${vitest.status}); report was still built as evidence`);
}
process.exit(vitest.status ?? 1);
