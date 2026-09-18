#!/usr/bin/env node
/**
 * Freeze the System Under Test.
 *
 * Two modes:
 *
 *   node scripts/capture-sut.mjs --sha <commit>   # REQUIRED for gate evidence
 *   node scripts/capture-sut.mjs                  # legacy worktree point-in-time capture
 *
 * Commander discipline (2026-09-17, after the drift incident): independent
 * verification must bind to a commit that is PUSHED to the remote. Once
 * pushed, the commit SHA is immutable; branch refs themselves may move, which
 * is why the report anchors on pinned_sha (and records which remote refs
 * contained it at capture time as corroboration, not as the anchor).
 *
 * In --sha mode this script:
 *   1. resolves the commit,
 *   2. REFUSES to run if the commit is not reachable from any remote ref
 *      (local-only SHAs are not acceptable verification anchors),
 *   3. extracts packages/protocol-schema/src from the git object database
 *      (not from the live worktree, which may be dirty or mid-edit),
 *   4. reads the zod version from the SAME pinned commit's package-lock.json
 *      (never from live node_modules — a pinned source must not be paired
 *      with a live dependency), and records it with
 *      zod_version_source: "pinned-lockfile",
 *   5. records pinned_sha + remote_url + remote_refs_containing in capture.json.
 *
 * Worktree mode is retained only for point-in-time diagnostics: it captures
 * live bytes and reads the live dependency version, and marks the capture as
 * NOT gate evidence.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../.."); // scripts/ -> conformance-harness/ -> packages/ -> repo root
const SRC = "packages/protocol-schema/src";

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
      "Verification must bind to a pushed commit SHA (immutable once pushed). Push the commit first, then re-run with --sha.",
    );
    process.exit(1);
  }
}

mkdirSync(destDir(), { recursive: true });
const digests = [];

const tsFiles = mode === "git-sha"
  ? gitText("ls-tree", "--name-only", pinnedSha, "--", `${SRC}/`).split("\n").map((s) => s.trim()).filter((f) => f.endsWith(".ts"))
  : readdirSync(path.join(repoRoot, SRC)).map((f) => path.join(repoRoot, SRC, f));

for (const f of tsFiles) {
  const rel = f.startsWith("/") ? path.relative(repoRoot, f).split(path.sep).join("/") : f; // ls-tree output is already repo-relative
  const name = path.basename(rel);
  const buf = mode === "git-sha" ? gitBuf("show", `${pinnedSha}:${rel}`) : readFileSync(f);
  if (mode === "worktree") copyFileSync(f, path.join(destDir(), name));
  else writeFileSync(path.join(destDir(), name), buf);
  digests.push({ file: `${SRC}/${name}`, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length });
}

// Dependency pinning: gate evidence must not pair pinned source with a live dependency.
let zodVersion;
let zodVersionSource;
if (mode === "git-sha") {
  const lock = JSON.parse(gitText("show", `${pinnedSha}:package-lock.json`));
  zodVersion = lock?.packages?.["node_modules/zod"]?.version ?? lock?.dependencies?.zod?.version ?? null;
  if (!zodVersion) {
    console.error(`REFUSED: could not resolve zod version from package-lock.json at ${pinnedSha}.`);
    process.exit(1);
  }
  zodVersionSource = "pinned-lockfile";
} else {
  zodVersion = JSON.parse(readFileSync(path.join(repoRoot, "node_modules/zod/package.json"), "utf8")).version;
  zodVersionSource = "live-node_modules";
}

let head = "unknown";
let remoteUrl = null;
try {
  head = gitText("rev-parse", "HEAD");
} catch { /* git unavailable */ }
try {
  remoteUrl = gitText("remote", "get-url", "origin") ?? null;
} catch { /* no origin */ }

const capture = {
  mode,
  ...(mode === "git-sha"
    ? {
        pinned_sha: pinnedSha,
        remote_url: remoteUrl,
        remote_refs_containing: remoteRefs,
        zod_version_source: zodVersionSource,
      }
    : {
        warning: "worktree capture: point-in-time bytes of a possibly-dirty live tree + live dependency version; NOT valid gate evidence — use --sha <pushed-commit>",
        zod_version_source: zodVersionSource,
      }),
  captured_at: new Date().toISOString(),
  source_git_head: head,
  source_dir: SRC,
  zod_version: zodVersion,
  files: digests,
  note: "Verbatim copy of Builder A's protocol-schema source. The harness imports ONLY this snapshot; the live tree is never loaded by tests. Anchor of validity = pinned_sha (git-sha mode) or the recorded file digests (worktree mode).",
};
writeFileSync(path.join(here, "../sut-snapshot/capture.json"), JSON.stringify(capture, null, 2) + "\n");

const liveZod = (() => {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, "node_modules/zod/package.json"), "utf8")).version;
  } catch {
    return null;
  }
})();
if (mode === "git-sha" && liveZod && liveZod !== zodVersion) {
  console.warn(
    `WARNING: live node_modules zod is ${liveZod} but the pinned lockfile says ${zodVersion}.\n` +
    "The test run would execute against a drifted dependency. Run `npm ci` at the pinned commit before gate evidence is taken,\n" +
    "or the SUT-LOAD-04 dependency-pinning check will fail.",
  );
}
if (mode === "worktree") {
  console.warn("WARNING: worktree capture is point-in-time only and is not gate evidence.");
}
console.log(`captured ${digests.length} files (mode=${mode}${mode === "git-sha" ? `, pinned=${pinnedSha.slice(0, 10)}, on [${remoteRefs.join(", ")}]` : ""}, zod=${zodVersion} from ${zodVersionSource}) at ${capture.captured_at}`);

function destDir() {
  return path.resolve(here, "../sut-snapshot/protocol-schema-src");
}
