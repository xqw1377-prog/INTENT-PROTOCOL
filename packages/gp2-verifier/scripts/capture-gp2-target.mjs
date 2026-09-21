#!/usr/bin/env node
/**
 * Pin the GP2 SUT (formal target) from the git object database.
 * Extracts: the candidate report, the committed evidence directory, and the
 * target's gp-execution sources (for scope/vocabulary scans) — never from the
 * live worktree. Refuses unpinned/local-only SHAs.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const SNAP = path.join(pkgDir, "target-snapshot");
const git = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
const gitBuf = (args) => execFileSync("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });

const sha = process.argv.find((a, i) => process.argv[i - 1] === "--sha");
if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
  console.error("usage: node scripts/capture-gp2-target.mjs --sha <full-40-hex-pushed-commit>");
  process.exit(1);
}
const refs = git(["branch", "-r", "--contains", sha]).split("\n").map((l) => l.trim()).filter((l) => l && !l.includes("HEAD ->"));
if (refs.length === 0) {
  console.error(`refusing: ${sha} not reachable from any remote ref`);
  process.exit(1);
}

const parent = git(["rev-parse", `${sha}^`]);
const changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, sha]).split("\n").filter(Boolean);

// locate the single report run inside the target's evidence tree
const evidenceDir = changed.find((p) => p.startsWith("packages/golden-path/evidence/"))?.split("/").slice(0, 4).join("/");
const runId = evidenceDir?.split("/").pop();
if (!runId) { console.error("no evidence directory in target diff"); process.exit(1); }

mkdirSync(path.join(SNAP, "evidence", "raw"), { recursive: true });
mkdirSync(path.join(SNAP, "target-gp-execution-src"), { recursive: true });

const files = [];
const pull = (rel, dest) => {
  const content = gitBuf(["show", `${sha}:${rel}`]);
  writeFileSync(path.join(SNAP, dest), content);
  files.push({ file: rel, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length });
};
pull("packages/gp-execution/report/gp2-candidate.json", "candidate-report.json");
pull(`${evidenceDir}/bundle.json`, "evidence/bundle.json");
pull(`${evidenceDir}/artifacts.json`, "evidence/artifacts.json");
pull(`${evidenceDir}/manifest.json`, "evidence/manifest.json");
for (const key of ["base-acceptance", "agent-patch", "patched-acceptance", "build", "policy-boundary", "execution-manifest"]) {
  pull(`${evidenceDir}/raw/${key}.bin`, `evidence/raw/${key}.bin`);
}
// target gp-execution sources for F2/F10 scans
for (const f of ["src/task.ts", "src/runner.ts", "src/evidence.ts"]) {
  const content = gitBuf(["show", `${sha}:packages/gp-execution/${f}`]);
  writeFileSync(path.join(SNAP, "target-gp-execution-src", path.basename(f)), content);
  files.push({ file: `packages/gp-execution/${f}`, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length });
}

const capture = {
  mode: "git-sha",
  pinned_sha: sha,
  parent_sha: parent,
  expected_parent: "d4c685bc82a77cfefde6724856f1927fe353c83f",
  remote_url: git(["remote", "get-url", "origin"]),
  remote_refs_containing: refs,
  changed_paths_vs_parent: changed,
  evidence_run_id: runId,
  captured_at: new Date().toISOString(),
  files,
};
writeFileSync(path.join(SNAP, "capture.json"), JSON.stringify(capture, null, 2) + "\n");
console.log(`captured target ${sha.slice(0, 8)} (parent ${parent.slice(0, 8)}, run ${runId.slice(0, 8)}, ${files.length} files) at ${capture.captured_at}`);
