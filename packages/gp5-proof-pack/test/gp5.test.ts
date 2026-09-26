/**
 * GP5 — End-to-End Golden Path + self-verifiable Proof Pack.
 *
 * GATES.md GP5 PASS surface:
 *   - one uninterrupted GP-001 run through the runtime success path
 *   - actual released payee == immutable ClaimRecord.claimant
 *   - replay / changed-nonce second release blocked
 *   - no demo/admin verification or release bypass (§9: static scan +
 *     black-box negatives)
 *   - Proof Pack + ONE-COMMAND third-party verifier (verify.mjs)
 */
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { buildPack } from "../src/build-pack.ts";
import type { PackReport } from "../src/build-pack.ts";
// shared cross-package child-process storm lock (same O_EXCL lock file as gp4)
import { withRaceLock } from "../../gp4-settlement/test/util.ts";

const execFileP = promisify(execFile);

function buildTmpPack(): { packDir: string; report: PackReport } {
  const packDir = mkdtempSync(path.join(tmpdir(), "gp5-pack-"));
  const report = buildPack(packDir);
  return { packDir, report };
}

/** Run the one-command verifier in a pack dir (serialized against all other child storms). */
function verifyPack(packDir: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return withRaceLock(() => execFileP("node", ["verify.mjs"], { cwd: packDir, timeout: 60_000 }))
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((e: { code?: number; stdout?: string; stderr?: string }) => ({
      code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "",
    }));
}

describe("[GP5] end-to-end golden path + proof pack", () => {
  test("[G5-01] E2E run: bounty SETTLED, settlement RELEASED, payee == claimant, negatives blocked", () => {
    const { report } = buildTmpPack();
    expect(report.bounty_state).toBe("SETTLED");
    expect(report.settlement_state).toBe("RELEASED");
    expect(report.golden_release).toBe("RELEASED");
    expect(report.changed_nonce_replay).toBe("ALREADY_RELEASED");
    expect(report.wrong_payee).toBe("REJECTED_CLAIMANT");
    expect(report.unverified_submission).toMatch(/^REJECTED\(/);
    expect(report.unverified_settlement).toBe("REJECTED_RECEIPT_MISMATCH");
    expect(report.evidence_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("[G5-02] ONE COMMAND third-party verification passes on the untampered pack", { timeout: 120_000 }, async () => {
    const { packDir } = buildTmpPack();
    const v = await verifyPack(packDir);
    const failing = v.stdout.split("\n").filter((l) => l.includes("FAIL")).join(" | ");
    expect(v.code, `verify.mjs failing checks: ${failing}; stderr: ${v.stderr.slice(0, 500)}`).toBe(0);
    expect(v.stdout).toContain("PROOF PACK VERIFIED");
  });

  test("[G5-03] tamper matrix: one byte changed in ANY critical file → verifier fails", { timeout: 240_000 }, async () => {
    const criticals = [
      "objects/intent.json",
      "objects/milestone.json",
      "objects/claim.json",
      "objects/task-freeze.json",
      "evidence/bundle.json",
      "evidence/artifacts.json",
      "decisions/decision-functional.json",
      "decisions/decision-policy.json",
      "decisions/verifier-registry.json",
      "receipt.json",
      "settlement/instruction.json",
      "settlement/escrow.json",
      "settlement/release.json",
      "settlement/settlement-evidence.json",
    ];
    const { packDir } = buildTmpPack();
    for (const rel of criticals) {
      const tampered = mkdtempSync(path.join(tmpdir(), "gp5-tamper-"));
      cpSync(packDir, tampered, { recursive: true });
      const file = path.join(tampered, rel);
      const bytes = readFileSync(file);
      // flip a byte inside a value (never the first/last structural chars)
      const i = Math.max(1, Math.floor(bytes.length / 2));
      const flipped = Buffer.from(bytes);
      flipped[i] = flipped[i]! === 0x30 ? 0x31 : 0x30;
      writeFileSync(file, flipped);
      const v = await verifyPack(tampered);
      expect(v.code, rel).not.toBe(0);
    }
  });

  test("[G5-04/§9-1] static scan: no bypass hooks in ANY runtime settlement/verification source", () => {
    const forbidden = /DEMO_ACCEPT|forceReceipt|skipVerification|mockSuccess|adminRelease|hard-?coded\s+ACCEPT/i;
    const scanTargets = [
      new URL("../src", import.meta.url),
      new URL("../../gp4-settlement/src", import.meta.url),
      new URL("../verify.mjs", import.meta.url),
    ];
    for (const root of scanTargets) {
      const p = fileURLToPath(root);
      const files: string[] = [];
      const stat = statSync(p);
      if (stat.isFile()) files.push(p);
      else for (const e of readdirSync(p, { withFileTypes: true })) {
        if (e.isFile()) files.push(path.join(p, e.name));
      }
      for (const f of files) {
        const text = readFileSync(f, "utf8");
        const m = text.match(forbidden);
        expect(m, `${path.basename(f)}: forbidden bypass hook`).toBeNull();
      }
    }
  });

  test("[G5-05/§9-2] black-box: unverified submissions CANNOT produce VERIFIED / RELEASE (recorded in pack)", () => {
    const { packDir, report } = buildTmpPack();
    // runtime negative is IN the durable journal (folded by verify.mjs too)
    const journal = readFileSync(path.join(packDir, "runtime-journal.jsonl"), "utf8")
      .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as { decision: { command_id: string; accepted: boolean; reason?: string } });
    const neg = journal.find((e) => e.decision.command_id === "gp5-neg")!;
    expect(neg.decision.accepted).toBe(false);
    expect(neg.decision.reason).toBe("prerequisite-required");
    // settlement black-box negatives recorded in the pack report
    expect(report.unverified_submission).toMatch(/^REJECTED\(prerequisite-required\)$/);
    expect(report.unverified_settlement).toBe("REJECTED_RECEIPT_MISMATCH");
  });

  test("[G5-06/§9-3] trace evidence: the demo traverses the SAME Receipt→Settlement boundary", async () => {
    // The pack's settlement artifacts were produced by EscrowLedger.attemptRelease
    // (the one and only release authority), and verify.mjs recomputes the sealed
    // settlement evidence — the same boundary the normal runtime uses.
    const { packDir } = buildTmpPack();
    const v = await verifyPack(packDir);
    expect(v.stdout).toContain("settlement-evidence: seal recomputes");
    expect(v.stdout).toContain("payee: output recipient == immutable ClaimRecord.claimant");
    expect(v.stdout).toContain("economic exactly-once");
  });

  test("[G5-07] committed pack in-repo (if present) also verifies", { timeout: 120_000 }, async () => {
    const committed = fileURLToPath(new URL("../pack", import.meta.url));
    let exists = true;
    try { readdirSync(committed); } catch { exists = false; }
    if (!exists) return; // committed pack generated post-test by CI/builder
    const v = await verifyPack(committed);
    expect(v.code).toBe(0);
  });

  test("[G5-08] regenerate the committed pack deterministically (repo evidence artifact)", { timeout: 180_000 }, async () => {
    const committed = fileURLToPath(new URL("../pack", import.meta.url));
    const fresh = mkdtempSync(path.join(tmpdir(), "gp5-determinism-"));
    const report = buildPack(fresh);
    const manifest = JSON.parse(readFileSync(path.join(fresh, "pack-manifest.json"), "utf8")) as { files: Array<{ file: string; sha256: string }> };
    expect(report.golden_release).toBe("RELEASED");
    expect(manifest.files.length).toBeGreaterThan(20);
    if (existsSync(committed)) {
      const committedManifest = JSON.parse(readFileSync(path.join(committed, "pack-manifest.json"), "utf8")) as { files: Array<{ file: string; sha256: string }> };
      const byFile = new Map(committedManifest.files.map((f) => [f.file, f.sha256]));
      const mismatched = manifest.files.filter((f) => byFile.get(f.file) !== f.sha256);
      expect(mismatched, `committed pack drifted: ${mismatched.map((f) => f.file).join(",")}`).toEqual([]);
    }
  });

  test("[G5-09] committed pack: one-command verify (read-only)", { timeout: 120_000 }, async (t) => {
    const committed = fileURLToPath(new URL("../pack", import.meta.url));
    if (!existsSync(committed)) return t.skip("committed pack not present (generate via G5-10 builder)");
    const v = await verifyPack(committed);
    const failing = v.stdout.split("\n").filter((l) => l.includes("FAIL")).join(" | ");
    expect(v.code, `committed pack verify failed: ${failing}`).toBe(0);
    expect(v.stdout).toContain("PROOF PACK VERIFIED");
  });

  test("[G5-10] REGEN the committed pack — BUILDER ONLY (GP5_REGEN_PACK=1)", { timeout: 180_000 }, (t) => {
    if (process.env.GP5_REGEN_PACK !== "1") {
      return t.skip("builder-only regeneration; normal suites keep the worktree clean for other gates");
    }
    const committed = fileURLToPath(new URL("../pack", import.meta.url));
    rmSync(committed, { recursive: true, force: true });
    const report = buildPack(committed);
    expect(report.golden_release).toBe("RELEASED");
    expect(report.bounty_state).toBe("SETTLED");
  });
});
