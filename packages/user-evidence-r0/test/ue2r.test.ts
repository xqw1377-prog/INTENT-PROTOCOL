/** USER-EVIDENCE-R0 CUT-2R machine tests — AUDIT-A blockers A1/A2 (UE2-R-PATH, UE2-R-INSTALL). */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freezeExperiment } from "../src/freeze.ts";
import { runWorkerPatch, type InvalidRunRecordV1 } from "../src/run.ts";
import { evaluatePatchPolicy, isCanonicalRepoRelativePath, parseUnifiedPatch } from "../src/policy.ts";
import { fixableConfig, fixPatch, makeFixableRepo } from "./helpers.ts";

let tmp = "";
let repoDir = "";
let repoSha = "";
let packDir = "";

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "ue2r-test-"));
  const repo = makeFixableRepo();
  repoDir = repo.dir;
  repoSha = repo.sha;
  packDir = path.join(tmp, "gen");
  freezeExperiment(repoDir, fixableConfig(repoDir, repoSha), packDir);
}, 1_200_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

const patchFile = (name: string, text: string): string => {
  const p = path.join(tmp, `${name}.patch`);
  writeFileSync(p, text);
  return p;
};

/** A minimal diff entry whose header AND ---/+++ lines carry the exact given sides. */
const entry = (aSide: string, bSide: string): string =>
  `diff --git ${aSide} ${bSide}\n--- ${aSide}\n+++ ${bSide}\n@@ -1 +1 @@\n-old\n+new\n`;

function expectZeroCommandReject(pack: string, repo: string, patchText: string, reasonRe: RegExp, name: string): void {
  const rec = runWorkerPatch(
    { repoDir: repo, freezePackDir: pack, patchPath: patchFile(name, patchText), ranAt: "2026-10-03T20:00:00.000Z" },
  ) as InvalidRunRecordV1;
  expect(rec.verdict, name).toBe("INVALID");
  expect(rec.invalid_reason, name).toMatch(reasonRe);
  expect(rec.runs, `${name}: the wall is pre-execution`).toEqual([]);
}

describe("[UE2-R-PATH] pure-layer canonical path wall (zero commands)", () => {
  test("[PURE] canonicality function: exact grammar", () => {
    expect(isCanonicalRepoRelativePath("src/add.ts")).toBe(true);
    expect(isCanonicalRepoRelativePath("a/b/c.txt")).toBe(true);
    for (const bad of ["../x", "a/../x", "/abs/x", "C:\\x", "a\\b", "a//b", "a/b/", "./x", "a/./b", ".", "", "a:b", "a\0b"]) {
      expect(isCanonicalRepoRelativePath(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  test("[UE2R-PATH-TRAVERSAL] diff --git a/../x b/../x → pre-execution reject", () => {
    expectZeroCommandReject(packDir, repoDir, entry("a/../evil.ts", "b/../evil.ts"), /non-canonical-path:\.\.\/evil\.ts/, "traversal");
  });

  test("[UE2R-PATH-ABSOLUTE] absolute header path → pre-execution reject", () => {
    expectZeroCommandReject(packDir, repoDir, entry("a//etc/passwd", "b//etc/passwd"), /non-canonical-path:\/etc\/passwd/, "absolute");
  });

  test("[UE2R-PATH-RENAME] rename to ../escape → pre-execution reject", () => {
    const diff = "diff --git a/src/add.ts b/src/add.ts\nsimilarity index 100%\nrename from src/add.ts\nrename to ../escape.ts\n";
    expectZeroCommandReject(packDir, repoDir, diff, /non-canonical-path:\.\.\/escape\.ts/, "rename");
  });

  test("[UE2R-PATH-QUOTED] quoted traversal → pre-execution reject (unquote then canonicalize)", () => {
    expectZeroCommandReject(packDir, repoDir, entry('"a/../q.ts"', '"b/../q.ts"'), /non-canonical-path:\.\.\/q\.ts/, "quoted");
  });

  test("[UE2R-PATH-SEGMENTS] empty / dot segments → pre-execution reject", () => {
    expectZeroCommandReject(packDir, repoDir, entry("a/src//x.ts", "b/src//x.ts"), /non-canonical-path:src\/\/x\.ts/, "empty-seg");
    expectZeroCommandReject(packDir, repoDir, entry("a/./x.ts", "b/./x.ts"), /non-canonical-path:\.\/x\.ts/, "dot-seg");
  });

  test("[UE2R-PATH-SYMLINK-PATCH] a patch that creates/changes a symlink (mode 120000) → pre-execution reject", () => {
    const diff =
      "diff --git a/link2 b/link2\nnew file mode 120000\nindex 0000000..1234567\n--- /dev/null\n+++ b/link2\n@@ -0,0 +1 @@\n+../outside\n";
    expectZeroCommandReject(packDir, repoDir, diff, /symlink-patch/, "symlink-patch");
    expect(evaluatePatchPolicy(parseUnifiedPatch(diff), { allowed_paths: ["**"], forbidden_paths: [], max_diff_lines: 100 }).reason).toBe("symlink-patch");
  });

  test("[UE2R-PATH-SYMLINK-BASE] a canonical, in-scope path THROUGH a base-tree symlink → rejected before ANY command", { timeout: 1_200_000 }, () => {
    const repo = makeFixableRepo({ symlink: true }); // link -> test inside the frozen base
    try {
      const symDir = path.join(tmp, "gen-symlink");
      freezeExperiment(repo.dir, fixableConfig(repo.dir, repo.sha, { allowed_paths: ["src/**", "link/**"] }), symDir);
      // touched path is canonical and ALLOWED (link/**) — only the base-tree
      // symlink walk can catch it, and it must catch it with zero commands
      expectZeroCommandReject(symDir, repo.dir, entry("a/link/green.test.ts", "b/link/green.test.ts"), /symlink-in-path/, "symlink-base");
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });
});

describe("[UE2-R-INSTALL] explicit bootstrap boundary + post-install revalidation", () => {
  test("[UE2R-INSTALL-DRIFT] a frozen install_command that tampers the suite after ci → INVALID post-install-suite-drift", { timeout: 1_200_000 }, () => {
    const cfg = fixableConfig(repoDir, repoSha, {
      commands: {
        ...fixableConfig(repoDir, repoSha).commands,
        install_command: "npm ci --no-audit --no-fund --ignore-scripts && printf ' ' >> test/regression.test.ts",
      },
    });
    const driftDir = path.join(tmp, "gen-drift");
    freezeExperiment(repoDir, cfg, driftDir); // freeze itself stays eligible (UE-1 semantics untouched)
    const rec = runWorkerPatch(
      { repoDir, freezePackDir: driftDir, patchPath: patchFile("fix", fixPatch(repoDir)), ranAt: "2026-10-03T20:10:00.000Z" },
    ) as InvalidRunRecordV1;
    expect(rec.verdict).toBe("INVALID");
    expect(rec.invalid_reason).toBe("post-install-suite-drift");
    expect(rec.runs.map((r) => r.stage)).toContain("install"); // the bootstrap is recorded…
    expect(rec.runs.some((r) => r.command.includes("vitest"))).toBe(false); // …and NO verdict command ever ran
  });
});
