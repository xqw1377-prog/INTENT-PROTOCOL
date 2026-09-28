/**
 * TEST-HYGIENE-R1 master gate (Commander MAIN-CLOSURE-R1).
 *
 * Contract: `npm test` is a PURE FUNCTION of the checkout —
 *   git status --porcelain BEFORE the full run
 *     ==
 *   git status --porcelain AFTER the full run
 *
 * On a clean checkout both sides are empty. Any tracked-file rewrite,
 * stray untracked artifact, or evidence UUID dir produced by a test FAILS
 * the run. Tests must write only to mkdtemp()/OS temp.
 *
 * Exemptions: the explicit builder materialization modes ARE the official
 * evidence commands (not tests observing them); they set their env flag and
 * the gate records the exemption instead of comparing.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// NB: fileURLToPath, never URL.pathname — the repo path contains a space and
// the raw pathname is percent-encoded ("INTENT%20PROTOCOL"), which would
// produce a nonexistent cwd and surface as spawnSync ENOENT.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BUILDER_MODE_FLAGS = ["GP5_REGEN_PACK", "GP2_BUILD_CANDIDATE", "GP2_RECORD_REPRODUCTION"];

// vitest's globalSetup subprocess can run with a minimal PATH — resolve git
// through common absolute locations before giving up.
const GIT_CANDIDATES = ["git", "/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];
function gitBin(): string {
  for (const candidate of GIT_CANDIDATES) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch { /* try next */ }
  }
  throw new Error("hygiene gate: git executable not found");
}

function porcelain(): string {
  return execFileSync(gitBin(), ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
}

export default function setup(): () => void {
  const activeBuilders = BUILDER_MODE_FLAGS.filter((f) => process.env[f] === "1");
  if (activeBuilders.length > 0) {
    console.log(`[hygiene-gate] SKIPPED — builder materialization mode: ${activeBuilders.join(", ")}`);
    return () => {};
  }

  const before = porcelain();
  // keep the snapshot outside the repository tree
  const snap = path.join(mkdtempSync(path.join(tmpdir(), "hygiene-gate-")), "before.porcelain");
  writeFileSync(snap, before);

  return () => {
    const after = porcelain();
    if (after === before) return;
    const beforeSet = new Set(before.split("\n"));
    const added = after.split("\n").filter((l) => l.trim() && !beforeSet.has(l));
    throw new Error(
      "TEST-HYGIENE-R1 VIOLATION: the suite mutated the worktree.\n" +
      "Tests may only write to OS temp dirs; official evidence is materialized " +
      "by explicit builder commands only.\n" +
      `New mutations:\n${added.join("\n")}`,
    );
  };
}
