#!/usr/bin/env node
/** Wrapper: runs the full GP2 suite; the report-builder test writes gp2-candidate.json. */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const vitest = path.join(repoRoot, "node_modules/vitest/vitest.mjs");
execFileSync(process.execPath, [vitest, "run", "--root", "../..", "packages/gp-execution"], {
  cwd: pkgDir, stdio: "inherit",
});
