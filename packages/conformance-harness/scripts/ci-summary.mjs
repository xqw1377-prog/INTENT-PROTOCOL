#!/usr/bin/env node
/**
 * CI Job Summary writer (read-only). Emits the Commander-required evidence
 * header: target (Builder A) SHA, harness (Builder B) SHA, Node version,
 * lockfile hashes, dependency pinning, and the report summary. Writes to
 * $GITHUB_STEP_SUMMARY when present, otherwise to stdout (local dry-run).
 */
import { appendFileSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

const capture = readJson(path.join(pkgDir, "sut-snapshot/capture.json"));
const report = readJson(path.join(pkgDir, "report/conformance-report.json"));
const runtimeZod = readJson(path.join(repoRoot, "node_modules/zod/package.json"));

const env = process.env;
const targetSha = env.TARGET_SHA ?? capture?.pinned_sha ?? "unknown";
const harnessSha = env.HARNESS_SHA ?? capture?.source_git_head ?? "unknown";
const targetLock = env.TARGET_LOCKFILE_SHA256 ?? "n/a";
const harnessLock = env.HARNESS_LOCKFILE_SHA256 ?? "n/a";
const conformanceExit = env.CONFORMANCE_EXIT ?? "n/a";

const L = [];
L.push("# Conformance Evidence (Builder B, independent)");
L.push("");
L.push("| Pin | Value |");
L.push("|---|---|");
L.push(`| Builder A target SHA (SUT) | \`${targetSha}\` |`);
L.push(`| Builder B harness SHA | \`${harnessSha}\` |`);
L.push(`| Node | \`${process.version}\` |`);
L.push(`| ICU / Unicode runtime | ICU \`${process.versions.icu ?? "n/a"}\`, Unicode \`${process.versions.unicode ?? "n/a"}\`, V8 \`${process.versions.v8 ?? "n/a"}\` (NFC normalization data source) |`);
L.push(`| Target lockfile (package-lock.json @ target SHA) | \`${targetLock}\` |`);
L.push(`| Harness lockfile (package-lock.json @ harness SHA) | \`${harnessLock}\` |`);
L.push(`| zod (recorded) | \`${capture?.zod_version ?? "n/a"}\` (source: \`${capture?.zod_version_source ?? "n/a"}\`) |`);
L.push(`| zod (runtime) | \`${runtimeZod?.version ?? "n/a"}\` |`);
L.push(`| Capture mode | \`${capture?.mode ?? "n/a"}\` |`);
L.push(`| Conformance exit code | \`${conformanceExit}\` (non-zero = FAIL findings present) |`);
L.push("");

if (capture?.mode && capture.mode !== "git-sha") {
  L.push("> ⚠️ **Capture mode is `${capture.mode}` — NOT gate evidence.** Gate runs require `git-sha` captures.");
  L.push("");
}
if (runtimeZod?.version && capture?.zod_version && runtimeZod.version !== capture.zod_version) {
  L.push("> ⚠️ **Dependency drift:** runtime zod does not match the recorded version (SUT-LOAD-04 should have failed).");
  L.push("");
}

if (report) {
  const s = report.summary;
  L.push("## Report summary");
  L.push("");
  L.push(`- Checks: **${s.counts.PASS} PASS / ${s.counts.FAIL} FAIL / ${s.counts.UNKNOWN} UNKNOWN** (${s.total_checks} total)`);
  L.push(`- Gate status: **${s.gate_status}** — ${s.freeze_declaration}`);
  const blockers = (s.freeze_blockers ?? []).filter((b) => b.status === "OPEN");
  L.push(`- Freeze blockers (Commander-ruled): **${blockers.length} OPEN**`);
  L.push("");
  L.push("| Area | Verdict | PASS | FAIL | UNKNOWN |");
  L.push("|---|---|---|---|---|");
  for (const a of s.areas) L.push(`| ${a.area} | ${a.verdict} | ${a.PASS} | ${a.FAIL} | ${a.UNKNOWN} |`);
  const fails = report.results.filter((r) => r.status === "FAIL");
  if (fails.length) {
    L.push("");
    L.push("### FAIL findings");
    L.push("");
    for (const f of fails) L.push(`- **${f.check_id}** ${f.title} — reproduce: \`${f.reproduce}\``);
  }
} else {
  L.push("## Report summary");
  L.push("");
  L.push("> ⚠️ No report was produced (pipeline failed before report generation).");
}

const out = L.join("\n") + "\n";
if (env.GITHUB_STEP_SUMMARY) {
  appendFileSync(env.GITHUB_STEP_SUMMARY, out);
  console.log("job summary written");
} else {
  console.log(out);
}
