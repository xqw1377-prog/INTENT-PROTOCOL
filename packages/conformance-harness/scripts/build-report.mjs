#!/usr/bin/env node
/**
 * Build the machine-readable conformance report from vitest JSON output.
 *
 * Classification rules (strict; UNKNOWN never auto-becomes PASS):
 *   - vitest "failed"                                   -> FAIL
 *   - vitest "passed" + title tagged [GAP]              -> UNKNOWN (gap_documented)
 *   - vitest "todo"/"skipped"                           -> UNKNOWN (blocked, rationale from unknowns.json)
 *   - vitest "passed"                                   -> PASS (evidence = the test itself)
 *
 * Every entry binds its evidence: source test file, full title, duration and
 * (for FAIL) the raw failure messages, which double as reproduction output.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const repoRoot = path.resolve(pkgRoot, "../..");

const vitestJson = JSON.parse(readFileSync(path.join(pkgRoot, "report/vitest-results.json"), "utf8"));
const unknowns = JSON.parse(readFileSync(path.join(pkgRoot, "unknowns.json"), "utf8")).unknowns;
const attackSurfaces = JSON.parse(readFileSync(path.join(pkgRoot, "attack-surfaces.json"), "utf8")).attack_surfaces;
const capture = JSON.parse(readFileSync(path.join(pkgRoot, "sut-snapshot/capture.json"), "utf8"));

const CHECK_ID_RE = /\[([A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)\]/;
const GAP_RE = /\[GAP\]/;

let gitHead = "unknown";
try {
  gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
} catch { /* not a git repo */ }

const sha256File = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const results = [];
for (const tr of vitestJson.testResults) {
  const relFile = path.relative(repoRoot, tr.name).split(path.sep).join("/");
  for (const a of tr.assertionResults) {
    const title = (a.title || a.fullName || "");
    const idMatch = title.match(CHECK_ID_RE);
    const checkId = idMatch ? idMatch[1] : "UNCATALOGUED";
    const isGap = GAP_RE.test(title) || (a.status === "todo");
    let status;
    let unknownKind;
    let rationale;
    if (a.status === "failed") status = "FAIL";
    else if (a.status === "todo" || a.status === "skipped") { status = "UNKNOWN"; unknownKind = "blocked"; }
    else if (GAP_RE.test(title)) { status = "UNKNOWN"; unknownKind = "gap_documented"; }
    else status = "PASS";
    if (status === "UNKNOWN") {
      const u = unknowns[checkId];
      rationale = u ? `${u.kind}: ${u.rationale}` : "no rationale recorded in unknowns.json (harness defect)";
      unknownKind = u ? u.kind : unknownKind;
    }
    results.push({
      check_id: checkId,
      status,
      ...(status === "UNKNOWN" ? { unknown_kind: unknownKind ?? "gap_documented", rationale } : {}),
      area: a.ancestorTitles?.[0] ?? "",
      title,
      evidence: {
        test_file: relFile,
        test_title: title,
        runner_status: a.status,
        duration_ms: a.duration ?? null,
        ...(a.failureMessages && a.failureMessages.length ? { failure_messages: a.failureMessages.map(String) } : {}),
      },
      reproduce: `npx vitest run ${relFile} -t "${(title.match(CHECK_ID_RE) ? title.match(CHECK_ID_RE)[1] : title).replace(/"/g, "")}"`,
    });
  }
}

// de-duplicate identical check ids from test.each by suffixing an index
const seen = new Map();
for (const r of results) {
  const n = seen.get(r.check_id) ?? 0;
  seen.set(r.check_id, n + 1);
  if (n > 0 || seen.get(r.check_id) > 1) r.check_id = `${r.check_id}#${n}`;
}

const counts = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
for (const r of results) counts[r.status]++;

// per-area rollup: an area is FAIL if any check failed, else UNKNOWN if any unknown, else PASS
const areas = new Map();
for (const r of results) {
  const m = r.check_id.match(/^(C-\d+)/);
  const area = m ? m[1] : (r.check_id.startsWith("S-") ? "SPEC-ASSERTIONS" : (r.check_id.startsWith("SUT") || r.check_id.startsWith("PKG") ? "SUT-LOAD" : "OTHER"));
  if (!areas.has(area)) areas.set(area, { area, total: 0, PASS: 0, FAIL: 0, UNKNOWN: 0 });
  const a = areas.get(area);
  if (!a) continue;
  a.total++;
  a[r.status]++;
}
for (const a of areas.values()) a.verdict = a.FAIL > 0 ? "FAIL" : a.UNKNOWN > 0 ? "UNKNOWN" : "PASS";

const freezeBlockers = Object.entries(unknowns)
  .filter(([, u]) => u.freeze_blocking)
  .map(([id, u]) => ({ check_id: id, ruling: u.commander_ruling, rationale: u.rationale, status: "OPEN" }));

const vectorFiles = readdirSync(path.join(pkgRoot, "vectors")).map((f) => ({
  file: `packages/conformance-harness/vectors/${f}`,
  sha256: sha256File(path.join(pkgRoot, "vectors", f)),
}));

const report = {
  report_id: `p0-s0-conformance-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  generated_at: new Date().toISOString(),
  harness: {
    name: "@intent/conformance-harness",
    builder: "Builder B (Independent Verifier)",
    independence: "Reference canonicalizer/hasher/merkle written from the written protocol rules only (ADR-005, arch doc §6.1); zero imports from the SUT in src/reference. The SUT is loaded exclusively via src/sut.ts from a frozen snapshot.",
    reproduce_all: "cd packages/conformance-harness && npm run conformance",
  },
  sut: {
    package: "@intent/protocol-schema",
    capture,
    snapshot_files: capture.files,
  },
  provenance: {
    git_head: gitHead,
    vector_files: vectorFiles,
    unknowns_manifest: sha256File(path.join(pkgRoot, "unknowns.json")),
    attack_surfaces_manifest: sha256File(path.join(pkgRoot, "attack-surfaces.json")),
  },
  summary: {
    total_checks: results.length,
    counts,
    areas: [...areas.values()].sort((x, y) => x.area.localeCompare(y.area)),
    freeze_blockers: freezeBlockers,
    gate_status: "NOT_READY",
    freeze_declaration: `NONE — this report does not declare the schema frozen. Freeze authority belongs to the Commander. ${counts.FAIL} FAIL findings, ${counts.UNKNOWN} UNKNOWN entries and ${freezeBlockers.length} freeze blockers (Commander-ruled) must be dispositioned first.`,
  },
  results,
  attack_surfaces: attackSurfaces,
};

writeFileSync(path.join(pkgRoot, "report/conformance-report.json"), JSON.stringify(report, null, 2) + "\n");

// ---------- markdown summary ----------
const esc = (s) => String(s).replace(/\|/g, "\\|");
const md = [];
md.push("# Intent Protocol P0-S0 Conformance Report (Builder B, Independent Verifier)");
md.push("");
md.push(`- Generated: ${report.generated_at}`);
md.push(`- SUT snapshot: captured ${capture.captured_at} from git \`${capture.source_git_head.slice(0, 8)}\` (zod ${capture.zod_version})`);
md.push(`- Checks: **${counts.PASS} PASS / ${counts.FAIL} FAIL / ${counts.UNKNOWN} UNKNOWN** (${results.length} total)`);
md.push(`- Gate status: **NOT_READY** — no freeze declared; freeze authority: Commander.`);
md.push("");
md.push("## Area rollup");
md.push("");
md.push("| Area | Verdict | PASS | FAIL | UNKNOWN |");
md.push("|---|---|---|---|---|");
for (const a of report.summary.areas) md.push(`| ${a.area} | **${a.verdict}** | ${a.PASS} | ${a.FAIL} | ${a.UNKNOWN} |`);
md.push("");
md.push("## FAIL findings");
md.push("");
for (const r of results.filter((x) => x.status === "FAIL")) {
  md.push(`### ${r.check_id} — ${esc(r.title)}`);
  md.push(`- Evidence: \`${r.evidence.test_file}\``);
  if (r.evidence.failure_messages) md.push(`- Message: \`${esc(String(r.evidence.failure_messages[0]).split("\n")[0]).slice(0, 300)}\``);
  md.push(`- Reproduce: \`${r.reproduce}\``);
  md.push("");
}
md.push("## Freeze blockers (Commander-ruled: must be dispositioned before G1)");
md.push("");
for (const fb of freezeBlockers) md.push(`- **${fb.check_id}**: ${esc(fb.ruling)}`);
md.push("");
md.push("## UNKNOWN (never auto-PASS)");
md.push("");
for (const r of results.filter((x) => x.status === "UNKNOWN")) {
  md.push(`- **${r.check_id}** (${r.unknown_kind}): ${esc(r.rationale ?? "")}`);
}
md.push("");
md.push("## Attack surfaces");
md.push("");
for (const as of attackSurfaces) {
  md.push(`### ${as.id} [${as.severity}] ${esc(as.title)}`);
  md.push(`${as.detail}`);
  md.push(`- Grounded by: ${as.evidence.join(", ")}`);
  md.push("");
}
md.push("## Statement");
md.push("");
md.push("This report is a point-in-time, black-box conformance verdict against the frozen SUT snapshot recorded above. It does not certify the protocol, does not declare any schema frozen, and does not reuse Builder A code as verification logic. UNKNOWN entries stay UNKNOWN until the enforcing layer is delivered and re-verified.");
writeFileSync(path.join(pkgRoot, "report/conformance-report.md"), md.join("\n") + "\n");

console.log(`report: ${counts.PASS} PASS / ${counts.FAIL} FAIL / ${counts.UNKNOWN} UNKNOWN -> report/conformance-report.{json,md}`);
