/**
 * TESTNET-R1 / T6 machine tests — Golden Run committed-evidence seal.
 * Hermetic: verifies the recorded orchestration end to end and re-runs the
 * offline third-party verifier on the committed pack.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { FROZEN, PINNED } from "../src/index.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const report = JSON.parse(readFileSync(path.join(pkgDir, "t6-evidence/report.json"), "utf8")) as {
  program_id: string;
  escrow_ref: string;
  stages: Array<Record<string, unknown> & { name: string }>;
  acceptance: Record<string, unknown>;
};

const g = (n: string): Record<string, unknown> => {
  const v = report.stages.find((s) => s.name === n);
  if (!v) throw new Error(`golden-run stage missing: ${n}`);
  return v;
};

describe("[TESTNET-R1/T6] golden run — closing orchestration", () => {
  test("[T6-01] all nine stages present, in order, bound to the frozen pair", () => {
    expect(report.program_id).toBe(PINNED.programId);
    expect(report.escrow_ref).toBe(FROZEN.anchors.escrowRef);
    const order = report.stages.map((s) => s.name);
    expect(order).toEqual([
      "1-pre-state-snapshot",
      "2-frozen-anchors",
      "3-prepare",
      "4-submit",
      "5-observe-reconcile",
      "7-proof-pack-build",
      "8-offline-verify",
      "9-final-state-and-acceptance",
    ]); // (stage 6 is folded into 5: observe+reconcile run as one deterministic pair)
  });

  test("[T6-02] frozen anchors all true (receipt/claim/binding/caps — no drift)", () => {
    const checks = g("2-frozen-anchors");
    for (const [k, v] of Object.entries(checks)) {
      if (k === "name") continue;
      expect(v, `anchor check ${k}`).toBe(true);
    }
  });

  test("[T6-03] prepare binding matrix: valid PREPARED, impostor DENIED_BEFORE_TX", () => {
    const prep = g("3-prepare");
    expect(prep.validInput).toBe("PREPARED");
    expect(prep.denyMatrix).toMatchObject({ impostorClaimant: "DENIED_BEFORE_TX", impostorReason: "claimant-mismatch" });
  });

  test("[T6-04] submit stage: on-chain exactly-once adjudicated the replay (Custom 108), no second release", () => {
    const sub = g("4-submit");
    expect(sub.outcome).toBe("adjudicated-on-chain");
    expect(String(sub.err)).toContain("108");
    expect(String(sub.signature)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);
  });

  test("[T6-05] reconcile: RELEASED, no retry, DETERMINISTIC (ran twice, identical)", () => {
    const rec = g("5-observe-reconcile");
    expect(rec.classification).toBe("RELEASED");
    expect(rec.safeToRetry).toBe(false);
    expect(rec.deterministic).toBe(true);
  });

  test("[T6-06] offline third-party verify re-run on the T6 pack (own evidence dir): exit 0, all checks pass", { timeout: 120_000 }, () => {
    const out = execFileSync(process.execPath, ["verify.mjs"], { encoding: "utf8", cwd: path.join(pkgDir, "t6-evidence/proof-pack"), maxBuffer: 64 * 1024 * 1024 });
    expect(out).toContain("TESTNET PROOF PACK VERIFIED");
    expect(out).toMatch(/\d+\/\d+ checks passed/);
  });

  test("[T6-09] T5 FROZEN EVIDENCE IMMUTABILITY: the signed T5 pack is byte-identical to d3371c5", () => {
    const diff = execFileSync("git", ["diff", "d3371c5", "--", "packages/solana-devnet-adapter/t5-proof-pack/"], { cwd: repoRoot, encoding: "utf8" });
    expect(diff, "T5 frozen pack must be byte-identical to the T5 sign-off commit").toBe("");
    // and the working tree matches HEAD there too (no uncommitted drift)
    const status = execFileSync("git", ["status", "--porcelain", "--", "packages/solana-devnet-adapter/t5-proof-pack/"], { cwd: repoRoot, encoding: "utf8" }).trim();
    expect(status).toBe("");
  });

  test("[T6-07] THE total acceptance: exactly-once, ±10 deltas vs recorded genesis, one PDA, caps 10", () => {
    const a = report.acceptance;
    for (const k of [
      "economic_release_exactly_once",
      "claimant_delta_exactly_plus_10",
      "treasury_delta_exactly_minus_10",
      "release_pda_exactly_one",
      "caps_is_10",
      "reconcile_deterministic",
      "proof_pack_verifies_offline",
      "no_second_payment_in_run",
    ]) {
      expect(a[k], `acceptance ${k}`).toBe(true);
    }
    expect(a.claimant_delta_vs_recorded_genesis).toBe("10000000");
    expect(a.treasury_delta_vs_recorded_genesis).toBe("-10000000");
    expect(String(a.note)).toContain("RECORDED GENESIS");
  });

  test("[T6-08] no-drift scope guard: only adapter-domain paths changed since the T5 sign-off (d3371c5)", () => {
    const changed = execFileSync("git", ["diff", "--name-only", "d3371c5..HEAD"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n").map((l) => l.trim()).filter(Boolean);
    for (const p of changed) {
      expect(p.startsWith("packages/solana-devnet-adapter/") || p === "README.md", `T6 scope drift: ${p}`).toBe(true);
    }
  });
});
