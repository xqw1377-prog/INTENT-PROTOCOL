#!/usr/bin/env node
/**
 * Freeze the System Under Test.
 *
 * Two modes:
 *
 *   node scripts/capture-sut.mjs --sha <commit>   # RECOMMENDED / required for gate evidence
 *   node scripts/capture-sut.mjs                  # legacy worktree point-in-time capture
 *
 * Commander discipline (2026-09-17, after the drift incident): independent
 * verification must bind to a commit that is PUSHED to the remote and
 * therefore immovable. In --sha mode this script:
 *   1. resolves the commit,
 *   2. REFUSES to run if the commit is not reachable from any remote ref
 *      (local-only or movable SHAs are not acceptable verification anchors),
 *   3. extracts packages/protocol-schema/src from the git object database
 *      (not from the live worktree, which may be dirty or mid-edit),
 *   4. records pinned_sha + remote_refs_containing in capture.json.
 *
 * Worktree mode is retained only for point-in-time diagnostics and marks the
 * capture as such; gate evidence must come from a --sha capture.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../.."); // scripts/ -> conformance-harness/ -> packages/ -> repo root
const SRC = "packages/protocol-schema/src";
const destDir = path.resolve(here, "../sut-snapshot/protocol-schema-src");

const args = process.argv.slice(2);
const shaArg = args.includes("--sha") ? args[args.indexOf("--sha") + 1] : null;

const gitText = (...a) => execFileSync("git", a, { cwd: repoRoot, encoding: "utf8" }).trim();
const gitBuf = (...a) => execFileSync("git", a, { cwd: repoRoot });

let mode = "worktree";
let pinnedSha = null;
let remoteRefs = [];

if (shaArg) {
  mode = "git-sha";
  pinnedSha = gitText("rev-parse", `${shaArg}^{commit}`);
  remoteRefs = gitText("branch", "-r", "--contains", pinnedSha)
    .split("\n").map((s) => s.trim()).filter(Boolean);
  if (remoteRefs.length === 0) {
    console.error(
      `REFUSED: commit ${pinnedSha} is not reachable from any remote ref.\n` +
      "Verification must bind to a pushed, immovable SHA. Push the commit first, then re-run with --sha.",
    );
    process.exit(1);
  }
}

mkdirSync(destDir, { recursive: true });
const digests = [];

const tsFiles = mode === "git-sha"
  ? gitText("ls-tree", "--name-only", pinnedSha, "--", `${SRC}/`).split("\n").map((s) => s.trim()).filter((f) => f.endsWith(".ts"))
  : readdirSync(path.join(repoRoot, SRC)).map((f) => path.join(repoRoot, SRC, f));

for (const f of tsFiles) {
  const rel = f.startsWith("/") ? path.relative(repoRoot, f).split(path.sep).join("/") : f; // ls-tree output is already repo-relative
  const name = path.basename(rel);
  const buf = mode === "git-sha" ? gitBuf("show", `${pinnedSha}:${rel}`) : readFileSync(f);
  if (mode === "worktree") copyFileSync(f, path.join(destDir, name));
  else writeFileSync(path.join(destDir, name), buf);
  digests.push({ file: `${SRC}/${name}`, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length });
}

let head = "unknown";
try {
  head = gitText("rev-parse", "HEAD");
} catch { /* git unavailable */ }

const zodVersion = JSON.parse(readFileSync(path.resolve(repoRoot, "node_modules/zod/package.json"), "utf8")).version;

const capture = {
  mode,
  ...(mode === "git-sha"
    ? { pinned_sha: pinnedSha, remote_refs_containing: remoteRefs }
    : { warning: "worktree capture: point-in-time bytes of a possibly-dirty live tree; NOT valid gate evidence — use --sha <pushed-commit>" }),
  captured_at: new Date().toISOString(),
  source_git_head: head,
  source_dir: SRC,
  zod_version: zodVersion,
  files: digests,
  note: "Verbatim copy of Builder A's protocol-schema source. The harness imports ONLY this snapshot; the live tree is never loaded by tests.",
};
writeFileSync(path.resolve(here, "../sut-snapshot/capture.json"), JSON.stringify(capture, null, 2) + "\n");

if (mode === "worktree") {
  console.warn("WARNING: worktree capture is point-in-time only and is not gate evidence.");
}
console.log(`captured ${digests.length} files (mode=${mode}${mode === "git-sha" ? `, pinned=${pinnedSha.slice(0, 10)}, on [${remoteRefs.join(", ")}]` : ""}) at ${capture.captured_at}`);
