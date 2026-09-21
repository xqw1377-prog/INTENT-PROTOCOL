#!/usr/bin/env node
/**
 * Freeze the GP1 SUT (packages/gp-runtime/src) at an exact pushed SHA.
 *
 * Modeled on the G1 capture discipline (packages/conformance-harness/
 * scripts/capture-sut.mjs): extracts file CONTENT from the git object
 * database (never the live worktree), refuses SHAs not reachable from any
 * remote ref, and records pinned_sha + digests + parent-diff paths for the
 * scope audit. Tooling-only addition (Issue #12 §D adapter rule).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const SNAP_DIR = path.join(pkgDir, "sut-snapshot", "gp-runtime-src");
const SUT_FILES = ["machines.ts", "runtime.ts"];

const git = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();

const shaArg = process.argv.find((a, i) => process.argv[i - 1] === "--sha");
if (!shaArg || !/^[0-9a-f]{40}$/.test(shaArg)) {
  console.error("usage: node scripts/capture-gp1-sut.mjs --sha <full-40-hex-pushed-commit>");
  process.exit(1);
}

// Refuse local-only / movable SHAs: must be reachable from a remote ref.
const refs = git(["branch", "-r", "--contains", shaArg]).split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.includes("HEAD ->"));
if (refs.length === 0) {
  console.error(`refusing: ${shaArg} is not reachable from any remote ref (not pushed / local-only)`);
  process.exit(1);
}

const parent = git(["rev-parse", `${shaArg}^`]);
const changedPaths = git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, shaArg]).split("\n").filter((l) => l.length > 0);

mkdirSync(SNAP_DIR, { recursive: true });
const files = [];
for (const f of SUT_FILES) {
  const content = execFileSync("git", ["show", `${shaArg}:packages/gp-runtime/src/${f}`], { cwd: repoRoot });
  writeFileSync(path.join(SNAP_DIR, f), content);
  files.push({ file: `packages/gp-runtime/src/${f}`, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length });
}

const capture = {
  mode: "git-sha",
  pinned_sha: shaArg,
  remote_url: git(["remote", "get-url", "origin"]),
  remote_refs_containing: refs,
  parent_sha: parent,
  changed_paths_vs_parent: changedPaths,
  captured_at: new Date().toISOString(),
  files,
};
writeFileSync(path.join(pkgDir, "sut-snapshot", "capture.json"), JSON.stringify(capture, null, 2) + "\n");
console.log(`captured ${files.length} SUT files (mode=git-sha, pinned=${shaArg.slice(0, 8)}, parent=${parent.slice(0, 8)}, on [${refs.join(", ")}]) at ${capture.captured_at}`);
