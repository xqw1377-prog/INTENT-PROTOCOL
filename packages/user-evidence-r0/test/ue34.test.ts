/** USER-EVIDENCE-R0 CUT-3 machine tests — UE-3 proof pack + UE-4 portable replayer. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freezeExperiment } from "../src/freeze.ts";
import { runWorkerPatch, type ValidRunRecordV1 } from "../src/run.ts";
import { buildProofPack, tier1VerdictOf } from "../src/proof.ts";
import { replayPack } from "../src/portable-replay.mjs";
import { fixableConfig, fixPatch, makeFixableRepo } from "./helpers.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let tmp = "";
let repoDir = "";
let repoSha = "";
let freezeDir = "";
let patchPath = "";
let recordPath = "";
let proofDir = "";

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "ue34-test-"));
  const repo = makeFixableRepo();
  repoDir = repo.dir;
  repoSha = repo.sha;
  freezeDir = path.join(tmp, "freeze");
  freezeExperiment(repoDir, fixableConfig(repoDir, repoSha), freezeDir);
  patchPath = path.join(tmp, "worker.patch");
  writeFileSync(patchPath, fixPatch(repoDir));
  recordPath = path.join(tmp, "run-record.json");
  runWorkerPatch(
    { repoDir, freezePackDir: freezeDir, patchPath, ranAt: "2026-10-03T14:00:00.000Z" },
    recordPath,
  );
  proofDir = path.join(tmp, "proof");
  buildProofPack({ freezePackDir: freezeDir, runRecordPath: recordPath, patchPath, repoDir, outDir: proofDir, builtAt: "2026-10-03T14:05:00.000Z" });
}, 1_200_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

const sha256File = (p: string): string => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex");
const packCopy = (name: string): string => {
  const c = path.join(tmp, name);
  cpSync(proofDir, c, { recursive: true });
  return c;
};

describe("[UE-3 CUT-3] portable outcome proof pack", () => {
  test("[UE3-ATOMIC] exact file set, manifest hashes every byte, no overwrite, no residue", () => {
    const files = execFileSync("ls", [proofDir], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
    expect(files).toEqual(
      [
        "base.bundle", "contract-freeze.json", "freeze-manifest.json", "proof-manifest.json",
        "run-record.json", "ruleset.json", "task.json", "verify.mjs", "worker.patch",
      ].sort(),
    );
    const manifest = JSON.parse(readFileSync(path.join(proofDir, "proof-manifest.json"), "utf8"));
    expect(manifest.schema_version).toBe("outcome-proof-manifest.v1");
    expect(manifest.tier1_verdict).toBe("VALID");
    for (const [f, entry] of Object.entries(manifest.files as Record<string, { sha256: string; bytes: number }>)) {
      expect(sha256File(path.join(proofDir, f))).toBe(entry.sha256);
      expect(readFileSync(path.join(proofDir, f)).length).toBe(entry.bytes);
    }
    // generation-atomic: refuse to overwrite, existing set intact, no staging residue
    expect(() =>
      buildProofPack({ freezePackDir: freezeDir, runRecordPath: recordPath, patchPath, repoDir, outDir: proofDir, builtAt: "2026-10-03T14:06:00.000Z" }),
    ).toThrow(/PROOF-REFUSED \(outdir-exists\)/);
    const residue = execFileSync("ls", ["-a", path.dirname(proofDir)], { encoding: "utf8" }).split("\n").filter((x) => x.startsWith(".ue3-gen-"));
    expect(residue).toEqual([]);
  });

  test("[UE3-BASE-BYTES] the bundle ALONE materializes the exact frozen base (suite + lockfile hashes included)", () => {
    const task = JSON.parse(readFileSync(path.join(proofDir, "task.json"), "utf8"));
    const clone = path.join(tmp, "basebytes-clone");
    execFileSync("git", ["clone", "--quiet", "--branch", "ue-base", path.join(proofDir, "base.bundle"), clone]);
    expect(execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(task.base_commit_sha);
    expect(sha256File(path.join(clone, task.acceptance_suite))).toBe(task.acceptance_suite_sha256);
    expect(sha256File(path.join(clone, task.lockfile_path))).toBe(task.lockfile_sha256);
  });

  test("[UE3-VERBATIM] worker.patch and run-record.json enter the pack byte-identical", () => {
    expect(readFileSync(path.join(proofDir, "worker.patch"))).toEqual(readFileSync(patchPath));
    expect(readFileSync(path.join(proofDir, "run-record.json"))).toEqual(readFileSync(recordPath));
  });

  test("[UE3-NO-INVALID] an INVALID run can never enter a Tier-1 proof pack", { timeout: 1_200_000 }, () => {
    const wrongPatch = path.join(tmp, "wrong.patch");
    writeFileSync(wrongPatch, "diff --git a/src/add.ts b/src/add.ts\n--- a/src/add.ts\n+++ b/src/add.ts\n@@ -1 +1 @@\n-a\n+b\n");
    const invalidRecord = path.join(tmp, "run-invalid.json");
    runWorkerPatch({ repoDir, freezePackDir: freezeDir, patchPath: wrongPatch, ranAt: "2026-10-03T14:07:00.000Z" }, invalidRecord);
    expect(() =>
      buildProofPack({ freezePackDir: freezeDir, runRecordPath: invalidRecord, patchPath: wrongPatch, repoDir, outDir: path.join(tmp, "proof-bad"), builtAt: "2026-10-03T14:08:00.000Z" }),
    ).toThrow(/PROOF-REFUSED \(run-not-valid\)/);
    expect(existsSync(path.join(tmp, "proof-bad"))).toBe(false);
  });

  test("[UE3-VERDICT] tier1VerdictOf is a total function — flipping ANY single check flips it", () => {
    const rec = JSON.parse(readFileSync(recordPath, "utf8")) as ValidRunRecordV1;
    expect(tier1VerdictOf(rec)).toBe("VALID");
    for (const key of [
      "freeze_closure", "symlink_free_paths", "base_regression_recheck", "install_boundary", "post_install_bytes",
      "lockfile_unchanged", "suite_unchanged", "dependency_policy", "patched_acceptance", "baseline_health_patched", "network_sandbox",
    ]) {
      const flipped = JSON.parse(JSON.stringify(rec));
      flipped.checks[key] = "TAMPERED";
      expect(tier1VerdictOf(flipped), key).toBe("INVALID");
    }
    const det = JSON.parse(JSON.stringify(rec));
    det.checks.determinism = "1/2";
    expect(tier1VerdictOf(det)).toBe("INVALID");
    const noRuns = JSON.parse(JSON.stringify(rec));
    noRuns.runs = [];
    expect(tier1VerdictOf(noRuns)).toBe("INVALID");
  });
});

describe("[UE-4 CUT-3] third-party replayer", () => {
  test("[UE4-R1] replay from the pack ALONE reproduces the Tier-1 verdict by real re-execution", { timeout: 1_200_000 }, () => {
    const report = replayPack(proofDir, { replayedAt: "2026-10-03T15:00:00.000Z" });
    expect(report.status).toBe("PASS");
    expect(report.integrity).toBe("OK");
    expect(report.freeze_closure).toBe("OK");
    expect(report.verdict_binding).toBe("OK");
    expect(report.reproduced?.tier1_verdict).toBe("VALID");
    expect(report.reproduced?.determinism).toBe("2/2");
    expect(report.same_verdict).toBe(true);
    // the report binds to THIS pack by hash (the ledger will require this)
    expect(report.proof_manifest_sha256).toBe(sha256File(path.join(proofDir, "proof-manifest.json")));
  });

  test("[UE4-TAMPER-PATCH] one flipped byte in worker.patch → integrity FAIL", () => {
    const c = packCopy("tamper-patch");
    writeFileSync(path.join(c, "worker.patch"), readFileSync(path.join(c, "worker.patch"), "utf8") + "\n");
    const r = replayPack(c, { replayedAt: "2026-10-03T15:01:00.000Z" });
    expect(r.status).toBe("FAIL");
    expect(r.integrity).toMatch(/^hash:worker\.patch$/);
  });

  test("[UE4-TAMPER-RUNRECORD] edited run record (no manifest rehash) → integrity FAIL", () => {
    const c = packCopy("tamper-record");
    const rec = JSON.parse(readFileSync(path.join(c, "run-record.json"), "utf8"));
    rec.checks.determinism = "1/2"; // the bytes change; the manifest does not
    writeFileSync(path.join(c, "run-record.json"), JSON.stringify(rec, null, 2) + "\n");
    const r = replayPack(c, { replayedAt: "2026-10-03T15:02:00.000Z" });
    expect(r.status).toBe("FAIL");
    expect(r.integrity).toMatch(/^hash:run-record\.json$/);
  });

  test("[UE4-TAMPER-TASK] edited money term (tier1_reward) → freeze closure FAIL", () => {
    const c = packCopy("tamper-task");
    const task = JSON.parse(readFileSync(path.join(c, "task.json"), "utf8"));
    task.tier1_reward = "999";
    // attacker re-hashes the manifest entry so integrity alone would pass
    writeFileSync(path.join(c, "task.json"), JSON.stringify(task, null, 2) + "\n");
    const manifest = JSON.parse(readFileSync(path.join(c, "proof-manifest.json"), "utf8"));
    manifest.files["task.json"].sha256 = sha256File(path.join(c, "task.json"));
    manifest.files["task.json"].bytes = readFileSync(path.join(c, "task.json")).length;
    writeFileSync(path.join(c, "proof-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const r = replayPack(c, { replayedAt: "2026-10-03T15:03:00.000Z" });
    expect(r.status).toBe("FAIL");
    expect(r.freeze_closure).toMatch(/contract-hash|ruleset-hash|precommit-binding|contract-not-derived/);
  });

  test("[UE4-ATTACKER-REHASH] a fully rehashed coordinated lie still fails — only reality can expose it", { timeout: 1_200_000 }, () => {
    const c = packCopy("attacker-rehash");
    // the attack: swap the real fix for a wrong patch, then rehash EVERYTHING
    // the manifest binds (patch, record, manifest.patch_sha256) so integrity
    // and closure pass — the lie is self-consistent on disk.
    const wrongPatch = path.join(tmp, "attack-wrong.patch");
    writeFileSync(wrongPatch, "diff --git a/src/add.ts b/src/add.ts\n--- a/src/add.ts\n+++ b/src/add.ts\n@@ -1 +1 @@\n-export const add = (a: number, b: number): number => a - b; // seeded bug\n+export const add = (a: number, b: number): number => a * b;\n");
    cpSync(wrongPatch, path.join(c, "worker.patch"));
    const newPatchSha = sha256File(path.join(c, "worker.patch"));
    const recPath = path.join(c, "run-record.json");
    const rec = JSON.parse(readFileSync(recPath, "utf8"));
    rec.patch_sha256 = newPatchSha;
    writeFileSync(recPath, JSON.stringify(rec, null, 2) + "\n");
    const manifestPath = path.join(c, "proof-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.patch_sha256 = newPatchSha;
    manifest.files["worker.patch"].sha256 = newPatchSha;
    manifest.files["worker.patch"].bytes = readFileSync(path.join(c, "worker.patch")).length;
    manifest.files["run-record.json"].sha256 = sha256File(recPath);
    manifest.files["run-record.json"].bytes = readFileSync(recPath).length;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const r = replayPack(c, { replayedAt: "2026-10-03T15:04:00.000Z" });
    expect(r.integrity).toBe("OK");
    expect(r.freeze_closure).toBe("OK");
    expect(r.verdict_binding).toBe("OK");
    expect(r.status).toBe("FAIL");
    expect(r.fail_reason).toMatch(/verdict-mismatch:reproduced=INVALID/);
  });

  test("[UE4-STANDALONE] verify.mjs runs third-party style: bare node, cwd = unpacked pack, no repo, no vitest", { timeout: 1_200_000 }, () => {
    const c = packCopy("standalone");
    const reportPath = path.join(c, "..", "standalone-report.json");
    const out = execFileSync("node", ["verify.mjs", "--report", reportPath], { cwd: c, encoding: "utf8", timeout: 10 * 60_000 });
    expect(out).toContain("REPLAY_STATUS=PASS");
    expect(out).toContain("TIER1_VERDICT=VALID");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.status).toBe("PASS");
    expect(report.same_verdict).toBe(true);
  });
});

describe("[UE-4 CUT-2R] verifier trust root (AUDIT-B / UE4-R-TRUST)", () => {
  test("[UE4R-TRUST-STAMP] manifest.verifier_sha256 == pack verify.mjs bytes == package-external VERIFIER-RELEASE.json", () => {
    const release = JSON.parse(readFileSync(path.resolve(pkgDir, "VERIFIER-RELEASE.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(path.join(proofDir, "proof-manifest.json"), "utf8"));
    expect(manifest.verifier_sha256).toBe(sha256File(path.join(proofDir, "verify.mjs")));
    expect(manifest.verifier_sha256).toBe(manifest.files["verify.mjs"].sha256);
    expect(manifest.verifier_sha256).toBe(release.verifier_sha256);
    // the release truly is package-external to the pack: the pack file set does not contain it
    expect(execFileSync("ls", [proofDir], { encoding: "utf8" }).includes("VERIFIER-RELEASE")).toBe(false);
  });

  test("[UE4R-TRUST-TAMPER] swapped verifier + fully rehashed manifest → the ONLY catch is the external trust root", () => {
    const c = packCopy("trust-tamper");
    // attacker ships their own verifier and rehashes the manifest entry —
    // on-disk consistency is perfect; the pack cannot vouch for itself
    writeFileSync(path.join(c, "verify.mjs"), 'console.log("REPLAY_STATUS=PASS"); console.log("TIER1_VERDICT=VALID");\n');
    const manifestPath = path.join(c, "proof-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files["verify.mjs"].sha256 = sha256File(path.join(c, "verify.mjs"));
    manifest.files["verify.mjs"].bytes = readFileSync(path.join(c, "verify.mjs")).length;
    manifest.verifier_sha256 = manifest.files["verify.mjs"].sha256;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const r = replayPack(c, { replayedAt: "2026-10-03T19:00:00.000Z" });
    expect(r.status).toBe("FAIL");
    expect(r.integrity).toMatch(/^verifier-identity$/);
  });

  test("[UE4R-TRUST-STANDALONE-PRINT] standalone mode prints its own identity for out-of-band comparison (never as proof)", { timeout: 1_200_000 }, () => {
    const c = packCopy("trust-print");
    const out = execFileSync("node", ["verify.mjs"], { cwd: c, encoding: "utf8", timeout: 10 * 60_000 });
    const release = JSON.parse(readFileSync(path.resolve(pkgDir, "VERIFIER-RELEASE.json"), "utf8"));
    const printed = /VERIFIER_SHA256=sha256:[0-9a-f]{64}/.exec(out)?.[0]?.slice("VERIFIER_SHA256=".length);
    expect(printed).toBe(release.verifier_sha256);
    expect(out).toContain("a pack cannot vouch for its own verifier");
  });

  test("[UE4R-MANIFEST-SET] a manifest listing fewer files than exist (attacker drops an entry) → integrity FAIL", () => {
    const c = packCopy("manifest-set");
    const manifestPath = path.join(c, "proof-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    delete manifest.files["base.bundle"];
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const r = replayPack(c, { replayedAt: "2026-10-03T19:01:00.000Z" });
    expect(r.status).toBe("FAIL");
    expect(r.integrity).toBe("manifest-file-set");
  });
});
