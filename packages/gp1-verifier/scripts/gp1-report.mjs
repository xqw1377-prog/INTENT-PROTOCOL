#!/usr/bin/env node
/**
 * Build the GP1 formal-replay report from vitest JSON output, with structural
 * self-validation and a FAITHFUL exit code (any FAIL -> nonzero after the
 * report is written). Tooling-only addition; reads the oracle/SUT read-only.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const vitestBin = path.resolve(repoRoot, "node_modules/vitest/vitest.mjs");
const resultsFile = path.join(pkgDir, "report", "gp1-vitest-results.json");

// STALE-EVIDENCE GUARD (same discipline as the G1 harness): delete previous
// results, run, require a fresh file, only then report.
mkdirSync(path.join(pkgDir, "report"), { recursive: true });
rmSync(resultsFile, { force: true });
const runStart = Date.now();

const vitest = execFileSync(
  process.execPath,
  [vitestBin, "run", "--root", "../..", "--reporter=json", "--outputFile=packages/gp1-verifier/report/gp1-vitest-results.json", "packages/gp1-verifier/formal/test/gp1-formal-replay.test.ts"],
  { cwd: pkgDir, encoding: "utf8" },
);
console.log(vitest.split("\n").filter((l) => l.includes("Tests") || l.includes("Test Files")).join("\n"));

if (!existsSync(resultsFile)) {
  console.error("vitest produced no results file — refusing to report stale evidence");
  process.exit(1);
}

const vj = JSON.parse(readFileSync(resultsFile, "utf8"));
const capture = JSON.parse(readFileSync(path.join(pkgDir, "sut-snapshot", "capture.json"), "utf8"));

const git = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
let harnessHead = "unknown";
try { harnessHead = git(["rev-parse", "HEAD"]); } catch { /* not a repo */ }

const checks = [];
for (const tr of vj.testResults) {
  for (const a of tr.assertionResults) {
    checks.push({
      check_id: (a.title.match(/\[([A-Z0-9-]+[\.\-][A-Z0-9\.\-]+)\]/) || [, "UNCATALOGUED"])[1],
      status: a.status === "passed" ? "PASS" : a.status === "failed" ? "FAIL" : "UNKNOWN",
      title: a.title,
      test_file: path.relative(repoRoot, tr.name).split(path.sep).join("/"),
      duration_ms: a.duration ?? null,
      ...(a.failureMessages?.length ? { failure_messages: a.failureMessages.map(String) } : {}),
    });
  }
}
const counts = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
for (const c of checks) counts[c.status]++;

const adapterDigest = createHash("sha256").update(readFileSync(path.join(pkgDir, "formal/adapter.ts"))).digest("hex");
const formalDigest = createHash("sha256").update(readFileSync(path.join(pkgDir, "test/gp1-formal-replay.test.ts"))).digest("hex");

const report = {
  report_kind: "gp1-formal-replay",
  generated_at: new Date().toISOString(),
  formal_target: capture.pinned_sha,
  harness: { head: harnessHead, adapter_sha256: adapterDigest, formal_suite_sha256: formalDigest },
  sut: {
    pinned_sha: capture.pinned_sha,
    parent_sha: capture.parent_sha,
    remote_refs_containing: capture.remote_refs_containing,
    snapshot_files: capture.files,
    changed_paths_vs_parent: capture.changed_paths_vs_parent,
  },
  coverage: {
    trace_vectors: 384,
    legal_edges: 13,
    illegal_pairs: 70,
    prerequisite_probes: "4-state x 5 future-authority edges",
    crash_prefixes: "every prefix of a 5-commit durable journal",
  },
  summary: { total_checks: checks.length, counts, machine_gate: counts.FAIL === 0 && counts.UNKNOWN === 0 ? "READY" : "NOT_READY" },
  freeze_declaration: "NONE — machine READY is never an automatic GP1 PASS; the final signature belongs to the Commander.",
  checks,
};

// structural self-validation
const errors = [];
if (report.formal_target !== "fc87aa9e09f9ecf72b4bf8e005c3c865a6450999") errors.push("formal target drift");
if (checks.length < 11) errors.push(`expected >= 11 checks, got ${checks.length}`);
if (counts.PASS !== checks.length) errors.push(`non-PASS checks present: ${JSON.stringify(counts)}`);
if (errors.length) {
  writeFileSync(path.join(pkgDir, "report/gp1-replay-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.error("REPORT INVALID: " + errors.join("; "));
  process.exit(1);
}

writeFileSync(path.join(pkgDir, "report/gp1-replay-report.json"), JSON.stringify(report, null, 2) + "\n");
const md = [
  "# GP1 Formal Black-Box Replay Report (Builder D)",
  "",
  `- Generated: ${report.generated_at}`,
  `- Formal target: \`${report.formal_target}\` (pinned via git object database, mode=git-sha)`,
  `- Harness head: \`${harnessHead}\``,
  `- Checks: **${counts.PASS} PASS / ${counts.FAIL} FAIL / ${counts.UNKNOWN} UNKNOWN** (${checks.length})`,
  `- Machine gate: **${report.summary.machine_gate}** — ${report.freeze_declaration}`,
  "",
  "## Coverage",
  "",
  "- 384 seeded oracle vectors replayed field-for-field through the thin black-box adapter",
  "- 13 legal edges reachable; 70 illegal pairs exhaustively rejected; 4-state prerequisite probes on all 5 future-authority edges",
  "- idempotency/conflict; ClaimRecord immutability; crash-at-every-prefix reload against the real durable journal (isolated temp dir)",
  "- scope audit (diff + files + exports) clean; wall-clock independence; no-payment side effects (RELEASED writes ONLY journal.jsonl)",
  "",
  "## Checks",
  "",
  "| id | status | title |",
  "|---|---|---|",
  ...checks.map((c) => `| ${c.check_id} | ${c.status} | ${c.title.replace(/\|/g, "\\|")} |`),
].join("\n") + "\n";
writeFileSync(path.join(pkgDir, "report/gp1-replay-report.md"), md);
console.log(`report: ${counts.PASS} PASS / ${counts.FAIL} FAIL / ${counts.UNKNOWN} UNKNOWN -> report/gp1-replay-report.{json,md} (machine gate ${report.summary.machine_gate})`);
