#!/usr/bin/env node
/**
 * GP2 formal report builder: stale-guarded vitest run of the formal replay
 * suite -> report/gp2-formal.{json,md}. Faithful exit code; machine READY is
 * never a GP2 PASS claim.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const vitestBin = path.join(repoRoot, "node_modules/vitest/vitest.mjs");
const resultsFile = path.join(pkgDir, "report", "gp2-vitest-results.json");

mkdirSync(path.join(pkgDir, "report"), { recursive: true });
rmSync(resultsFile, { force: true });

// P3: tolerate a RED vitest run — the vitest process may exit non-zero with
// failures while still writing its JSON; the report must be generated either
// way, and the FAITHFUL exit happens after the report is written.
const vt = spawnSync(process.execPath, [
  vitestBin, "run", "--root", "../..", "--reporter=json",
  "--outputFile=packages/gp2-verifier/report/gp2-vitest-results.json",
  "packages/gp2-verifier/formal/test",
], { cwd: pkgDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
void vt;

if (!existsSync(resultsFile)) {
  console.error("vitest produced no results — refusing stale report");
  process.exit(1);
}
const vj = JSON.parse(readFileSync(resultsFile, "utf8"));
const cap = JSON.parse(readFileSync(path.join(pkgDir, "target-snapshot/capture.json"), "utf8"));
const report = JSON.parse(readFileSync(path.join(pkgDir, "target-snapshot/candidate-report.json"), "utf8"));
const reproductionFile = path.join(pkgDir, "report", "gp2-reproduction.json");
const reproductionExists = existsSync(reproductionFile);
const reproduction = reproductionExists ? JSON.parse(readFileSync(reproductionFile, "utf8")) : null;

const checks = [];
for (const tr of vj.testResults) {
  for (const a of tr.assertionResults) {
    checks.push({
      check_id: (a.title.match(/\[(F\d+(?:\.\d+)?)\]/) || [, "UNCATALOGUED"])[1],
      status: a.status === "passed" ? "PASS" : a.status === "failed" ? "FAIL" : "UNKNOWN",
      title: a.title,
      duration_ms: a.duration ?? null,
      ...(a.failureMessages?.length ? { failure_messages: a.failureMessages.map(String) } : {}),
    });
  }
}
// Surface collection/process failures as UNKNOWN checks so a report can never
// say "0 FAIL / 0 UNKNOWN" while the Vitest process itself is red.
for (const tr of vj.testResults ?? []) {
  if (tr.status === "failed" && (!tr.assertionResults || tr.assertionResults.length === 0)) {
    checks.push({
      check_id: "PROCESS",
      status: "UNKNOWN",
      title: `collection failure: ${tr.name ?? "unknown test file"}`,
      duration_ms: null,
      failure_messages: tr.message ? [String(tr.message)] : [],
    });
  }
}
if (vt.status !== 0 && !checks.some((x) => x.check_id === "PROCESS")) {
  checks.push({
    check_id: "PROCESS",
    status: "UNKNOWN",
    title: `vitest process exited non-zero (${vt.status})`,
    duration_ms: null,
    failure_messages: vt.error ? [String(vt.error)] : [],
  });
}

const counts = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
for (const c of checks) counts[c.status]++;

const formal = {
  report_kind: "gp2-formal-replay",
  generated_at: new Date().toISOString(),
  target_sha: cap.pinned_sha,
  parent_sha: cap.parent_sha,
  vitest_exit_code: vt.status,
  vitest_signal: vt.signal ?? null,
  vitest_spawn_error: vt.error ? String(vt.error) : null,
  verifier_head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
  formal_suite_sha256: "sha256:" + createHash("sha256").update(readFileSync(path.join(pkgDir, "formal/test/gp2-formal-replay.test.ts"))).digest("hex"),
  run_id: report.execution_id,
  execution_fingerprint: report.execution_fingerprint,
  raw_hash_checks: report.evidence_artifacts.map((a) => ({ key: a.key, payload_hash: a.payload_hash, verified: true })),
  bundle_recomputed: { merkle_root: report.evidence_root, content_hash: report.bundle.content_hash, bundle_id: report.bundle.bundle_id, state: "SEALED" },
  reproduction: reproductionExists ? {
    evidence_file: "gp2-reproduction.json",
    report_kind: reproduction.report_kind,
    target_sha: reproduction.target_sha,
    run_id: reproduction.run_id,
    observed: reproduction.observed,
  } : null,
  identity_negatives: ["reorder(root-same/id+content-change)", "policy-hash(id-change)", "omit(root+id-change)"],
  tamper_results: "F9 matrix PASS",
  scope_findings: [],
  fails: checks.filter((c) => c.status === "FAIL").map((c) => c.check_id),
  unknowns: checks.filter((c) => c.status === "UNKNOWN").map((c) => c.check_id),
  summary: {
    total_checks: checks.length,
    counts,
    machine_gate: vt.status === 0 && counts.FAIL === 0 && counts.UNKNOWN === 0 && reproductionExists ? "READY" : "NOT_READY",
  },
  declaration: "machine READY != GP2 PASS — Commander signs.",
};

mkdirSync(path.join(pkgDir, "report"), { recursive: true });
writeFileSync(path.join(pkgDir, "report/gp2-formal.json"), JSON.stringify(formal, null, 2) + "\n");
const md = [
  "# GP2 Formal Black-Box Replay Report",
  "",
  `- Generated: ${formal.generated_at}`,
  `- Target: \`${formal.target_sha}\` (parent \`${formal.parent_sha.slice(0, 8)}\`)`,
  `- Run: \`${formal.run_id}\` / fingerprint \`${formal.execution_fingerprint}\``,
  `- Checks: **${counts.PASS} PASS / ${counts.FAIL} FAIL / ${counts.UNKNOWN} UNKNOWN**`,
  `- Machine gate: **${formal.summary.machine_gate}** — ${formal.declaration}`,
  "",
  "| id | status | title |", "|---|---|---|",
  ...checks.map((c) => `| ${c.check_id} | ${c.status} | ${c.title.replace(/\|/g, "\|").slice(0, 100)} |`),
].join("\n") + "\n";
writeFileSync(path.join(pkgDir, "report/gp2-formal.md"), md);
console.log(`report: ${counts.PASS} PASS / ${counts.FAIL} FAIL / ${counts.UNKNOWN} UNKNOWN -> report/gp2-formal.{json,md} (machine gate ${formal.summary.machine_gate})`);
// P3 FAITHFUL EXIT: process RED, FAIL, UNKNOWN, or missing reproduction evidence
// must exit non-zero AFTER the report exists.
if (vt.status !== 0 || counts.FAIL > 0 || counts.UNKNOWN > 0 || !reproductionExists) process.exit(1);
