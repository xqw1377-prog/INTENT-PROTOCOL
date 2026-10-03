/** USER-EVIDENCE-R0 CUT-2 machine tests — UE-2 real-task runner. */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { freezeExperiment } from "../src/freeze.ts";
import { runWorkerPatch, type InvalidRunRecordV1, type ValidRunRecordV1 } from "../src/run.ts";
import { fixableConfig, fixPatch, makeFixableRepo, makePatch, wrongFixPatch } from "./helpers.ts";

let tmp = "";
let repoDir = "";
let repoSha = "";
let packDir = ""; // max_diff_lines = 200, allowed src/** only

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "ue2-test-"));
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

test("[UE2-ACCEPT] correct fix: base red re-proven, patched green, baseline green, deterministic → VALID", { timeout: 1_200_000 }, () => {
  const out = path.join(tmp, "run-valid.json");
  const rec = runWorkerPatch(
    { repoDir, freezePackDir: packDir, patchPath: patchFile("fix", fixPatch(repoDir)), ranAt: "2026-10-03T13:00:00.000Z" },
    out,
  ) as ValidRunRecordV1;
  expect(rec.verdict).toBe("VALID");
  expect(rec.policy_result).toBe("OK");
  expect(rec.checks).toEqual({
    freeze_closure: "VERIFIED",
    base_regression_recheck: "RED",
    lockfile_unchanged: "OK",
    suite_unchanged: "OK",
    dependency_policy: "OK",
    patched_acceptance: "GREEN",
    baseline_health_patched: "GREEN",
    determinism: "2/2",
    network_sandbox: "DENIED_VERIFIED",
  });
  const stages = rec.runs.map((r) => r.stage);
  expect(stages).toContain("base-regression-recheck");
  expect(stages).toContain("patched-acceptance");
  expect(stages).toContain("baseline-health-patched");
  expect(stages.filter((s) => s.startsWith("determinism-"))).toHaveLength(2);
  for (const r of rec.runs) expect(r.stdout_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  // the record on disk is byte-stable and reloads as the same verdict
  const onDisk = JSON.parse(readFileSync(out, "utf8")) as ValidRunRecordV1;
  expect(onDisk.verdict).toBe("VALID");
  expect(onDisk.patch_touched_paths).toEqual(["src/add.ts"]);
});

test("[UE2-NOT-GREEN] a clean patch that does NOT fix the bug → INVALID patched-acceptance-red", { timeout: 1_200_000 }, () => {
  const rec = runWorkerPatch(
    { repoDir, freezePackDir: packDir, patchPath: patchFile("wrong", wrongFixPatch(repoDir)), ranAt: "2026-10-03T13:01:00.000Z" },
  ) as InvalidRunRecordV1;
  expect(rec.verdict).toBe("INVALID");
  expect(rec.invalid_reason).toBe("patched-acceptance-red");
  expect(rec.runs.length).toBeGreaterThan(0); // it really executed before failing
});

test("[UE2-PATH-DENY] patch touches a forbidden path (the tests) → INVALID, ZERO commands executed", () => {
  const diff = makePatch(repoDir, (wr) => {
    wr("src/add.ts", "export const add = (a: number, b: number): number => a + b;\n");
    wr("test/green.test.ts", 'import { expect, test } from "vitest";\n\ntest("tampered", () => {\n  expect(true).toBe(true);\n});\n');
  });
  const rec = runWorkerPatch(
    { repoDir, freezePackDir: packDir, patchPath: patchFile("deny", diff), ranAt: "2026-10-03T13:02:00.000Z" },
  ) as InvalidRunRecordV1;
  expect(rec.verdict).toBe("INVALID");
  expect(rec.invalid_reason).toBe("forbidden-path:test/green.test.ts");
  expect(rec.runs).toEqual([]); // the wall is pre-execution
});

test("[UE2-SCOPE] patch touches a path neither allowed nor forbidden → INVALID out-of-scope", () => {
  const diff = makePatch(repoDir, (wr) => {
    wr("src/add.ts", "export const add = (a: number, b: number): number => a + b;\n");
    wr("README.md", "sneaky scope grab\n");
  });
  const rec = runWorkerPatch(
    { repoDir, freezePackDir: packDir, patchPath: patchFile("scope", diff), ranAt: "2026-10-03T13:03:00.000Z" },
  ) as InvalidRunRecordV1;
  expect(rec.invalid_reason).toBe("out-of-scope:README.md");
  expect(rec.runs).toEqual([]);
});

test("[UE2-LOCK] patch touches the lockfile → INVALID forbidden-path (lockfile)", () => {
  const diff = makePatch(repoDir, (wr) => {
    wr("src/add.ts", "export const add = (a: number, b: number): number => a + b;\n");
    const lock = readFileSync(path.join(repoDir, "package-lock.json"), "utf8");
    wr("package-lock.json", lock.replace('"lockfileVersion"', '"lockfileVersion" // touched', 1));
  });
  const rec = runWorkerPatch(
    { repoDir, freezePackDir: packDir, patchPath: patchFile("lock", diff), ranAt: "2026-10-03T13:04:00.000Z" },
  ) as InvalidRunRecordV1;
  expect(rec.invalid_reason).toBe("forbidden-path:package-lock.json");
});

test("[UE2-DIFF-BOUND] diff over the frozen bound → INVALID, no execution", { timeout: 1_200_000 }, () => {
  const boundDir = path.join(tmp, "gen-bound");
  freezeExperiment(repoDir, fixableConfig(repoDir, repoSha, { max_diff_lines: 2 }), boundDir);
  const diff = makePatch(repoDir, (wr) => {
    wr("src/add.ts", "export const add = (a: number, b: number): number => a + b;\n// padding line 1\n// padding line 2\n// padding line 3\n");
  });
  const rec = runWorkerPatch(
    { repoDir, freezePackDir: boundDir, patchPath: patchFile("bound", diff), ranAt: "2026-10-03T13:05:00.000Z" },
  ) as InvalidRunRecordV1;
  expect(rec.invalid_reason).toMatch(/^diff-over-bound:\d+>2$/);
  expect(rec.runs).toEqual([]);
});

test("[UE2-DEPENDENCY-DENY] dependency-section change inside an otherwise allowed path → INVALID", { timeout: 1_200_000 }, () => {
  const depDir = path.join(tmp, "gen-dep");
  freezeExperiment(
    repoDir,
    fixableConfig(repoDir, repoSha, { allowed_paths: ["src/**", "package.json"], forbidden_paths: ["test/**", "package-lock.json", ".github/**"] }),
    depDir,
  );
  const diff = makePatch(repoDir, (wr) => {
    wr("src/add.ts", "export const add = (a: number, b: number): number => a + b;\n");
    const pkg = JSON.parse(readFileSync(path.join(repoDir, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    pkg.devDependencies["left-pad"] = "1.3.0";
    wr("package.json", JSON.stringify(pkg, null, 2) + "\n");
  });
  const rec = runWorkerPatch(
    { repoDir, freezePackDir: depDir, patchPath: patchFile("dep", diff), ranAt: "2026-10-03T13:06:00.000Z" },
  ) as InvalidRunRecordV1;
  expect(rec.invalid_reason).toBe("dependency-change:package.json");
});

test("[UE2-R0-INTAKE] a tampered freeze pack refuses the run entirely (no record, nothing executed)", () => {
  const broken = path.join(tmp, "gen-broken");
  cpSync(packDir, broken, { recursive: true });
  const taskPath = path.join(broken, "task.json");
  const task = JSON.parse(readFileSync(taskPath, "utf8")) as Record<string, unknown>;
  task.tier1_reward = "999";
  writeFileSync(taskPath, JSON.stringify(task, null, 2) + "\n");
  const out = path.join(tmp, "run-broken.json");
  expect(() =>
    runWorkerPatch({ repoDir, freezePackDir: broken, patchPath: patchFile("fix2", fixPatch(repoDir)), ranAt: "2026-10-03T13:07:00.000Z" }, out),
  ).toThrow(/FREEZE-PACK-INVALID/);
  expect(existsSync(out)).toBe(false);
});

test("[UE2-RECORD-IMMUTABLE] a written run record is never silently overwritten", { timeout: 1_200_000 }, () => {
  const out = path.join(tmp, "run-once.json");
  runWorkerPatch({ repoDir, freezePackDir: packDir, patchPath: patchFile("fix3", fixPatch(repoDir)), ranAt: "2026-10-03T13:08:00.000Z" }, out);
  const bytes = readFileSync(out, "utf8");
  expect(() =>
    runWorkerPatch({ repoDir, freezePackDir: packDir, patchPath: patchFile("fix4", fixPatch(repoDir)), ranAt: "2026-10-03T13:09:00.000Z" }, out),
  ).toThrow(/RUN-REFUSED \(out-exists\)/);
  expect(readFileSync(out, "utf8")).toBe(bytes);
  expect(execFileSync("ls", [tmp], { encoding: "utf8" }).split("\n").filter((f) => f.includes(".tmp-"))).toEqual([]);
});
