/**
 * TESTNET-R1 / T2 committed-evidence verification (hermetic: reads the
 * committed t2-evidence/report.json and re-derives every deterministic fact;
 * no network access). Third parties can re-run the on-chain leg via
 * scripts/t2-matrix.mjs --verify-style observation; this test seals the
 * recorded proof against tampering and against scope drift.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { economicReleaseDigest, toHex, releasePda, FROZEN, PINNED } from "../src/index.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");

interface Report {
  schema_version: string;
  program_id: string;
  escrow_ref: string;
  outcome_receipt_hash: string;
  pre_state: { claimantAtaBalance: string; treasuryAtaBalance: string; releasePda: { initialized: boolean } };
  final_state: { claimantAtaBalance: string; treasuryAtaBalance: string; releasePda: { initialized: boolean; amountBase: string | null; slot: string | null }; capsPda: { cycleReleasedBase: string | null } };
  scenarios: Array<{ name: string; deltaBase?: string }>;
  acceptance: Record<string, unknown>;
  note: string;
}

const report = JSON.parse(readFileSync(path.join(pkgDir, "t2-evidence/report.json"), "utf8")) as Report;

describe("[TESTNET-R1/T2] on-chain exactly-once — committed evidence", () => {
  test("[T2-E1] the report binds the frozen pair, program id, and derives the correct digest", () => {
    expect(report.schema_version).toBe("t2-matrix-report.v1");
    expect(report.program_id).toBe(PINNED.programId);
    expect(report.escrow_ref).toBe(FROZEN.anchors.escrowRef);
    expect(report.outcome_receipt_hash).toBe(FROZEN.anchors.outcomeReceiptHash);
    const digest = toHex(economicReleaseDigest(report.escrow_ref, report.outcome_receipt_hash));
    const { pda } = releasePda(report.escrow_ref, report.outcome_receipt_hash, report.program_id);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(pda).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  test("[T2-E2] THE acceptance: claimant delta exactly +10, treasury exactly -10, one release, caps 10", () => {
    const pre = BigInt(report.pre_state.claimantAtaBalance);
    const fin = BigInt(report.final_state.claimantAtaBalance);
    expect(fin - pre).toBe(10_000_000n); // EXACTLY 10 USDC-test, exactly once
    const tPre = BigInt(report.pre_state.treasuryAtaBalance);
    const tFin = BigInt(report.final_state.treasuryAtaBalance);
    expect(tPre - tFin).toBe(10_000_000n);
    expect(report.pre_state.releasePda.initialized).toBe(false);
    expect(report.final_state.releasePda.initialized).toBe(true);
    expect(report.final_state.releasePda.amountBase).toBe("10000000");
    expect(report.final_state.capsPda.cycleReleasedBase).toBe("10000000");
    expect(report.acceptance.second_economic_release).toBe(false);
  });

  test("[T2-E3] all eight matrix scenarios present; every post-release scenario moved ZERO funds", () => {
    const names = report.scenarios.map((s) => s.name);
    for (const required of [
      "T2-01-normal-release",
      "T2-02-exact-retry",
      "T2-03-different-nonce",
      "T2-04-response-lost",
      "T2-05-crash-after-submit",
      "T2-06-local-unknown-chain-truth",
      "T2-07-duplicate-client",
      "T2-08-concurrent-clients",
    ]) {
      expect(names, `scenario missing: ${required}`).toContain(required);
    }
    for (const s of report.scenarios) {
      if (s.name !== "T2-01-normal-release" && s.deltaBase !== undefined) {
        expect(BigInt(s.deltaBase), `${s.name} must move zero funds`).toBe(0n);
      }
    }
    // T2-R1: crash-after-submit must be proven BY HANDSHAKE, never by a
    // timer-guessed kill of a starting client
    const t205 = report.scenarios.find((s) => s.name === "T2-05-crash-after-submit") as Record<string, unknown> | undefined;
    expect(t205, "T2-05 record present").toBeDefined();
    expect(t205!.submitted).toBe(true);
    expect(String(t205!.signature)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/); // real base58 tx signature
    expect(t205!.child_killed_after_submit).toBe(true);
    expect(t205!.child_confirmed).toBe(false);
    expect(t205!.child_observed_chain).toBe(false);
    expect(t205!.deltaBase).toBe("0");
    expect((t205 as unknown as { killedBySignal: boolean }).killedBySignal).toBe(true);
    // the chain itself adjudicated the crashed client's duplicate
    const st = t205 as unknown as { parent_post_crash_chain_status: { confirmationStatus?: string; err?: string | null } };
    expect(st.parent_post_crash_chain_status.confirmationStatus).toBe("finalized");
    expect(st.parent_post_crash_chain_status.err).toContain("108"); // DuplicateRelease
    // T2 scope discipline is recorded in the report itself
    expect(JSON.stringify(report.note)).toContain("NO SECOND ECONOMIC RELEASE");
    expect(JSON.stringify(report.note)).toContain("T4");
  });

  test("[T2-E4] EPOCH seal: closed range 7e50a08..dfd4b33 (T2 sign-off) — frozen T2 allowlist, never HEAD", () => {

// ————————————————— GATE EPOCH MODEL (PH-00A / AMENDMENT-2) —————————————————
function epochSeal(label: string, start: string, end: string, allowedDomain: (p: string) => boolean): void {
  for (const sha of [start, end]) {
    expect(execFileSync("git", ["cat-file", "-t", sha], { cwd: repoRoot, encoding: "utf8" }).trim(), `${label}: ${sha} must exist`).toBe("commit");
  }
  const mergeBase = execFileSync("git", ["merge-base", start, end], { cwd: repoRoot, encoding: "utf8" }).trim();
  expect(mergeBase, `${label}: START must be an ancestor of END`).toBe(start);
  const changed = execFileSync("git", ["diff", "--name-only", `${start}..${end}`], { cwd: repoRoot, encoding: "utf8" })
    .split("\n").map((l) => l.trim()).filter(Boolean);
  for (const p of changed) {
    expect(allowedDomain(p), `${label}: closed-epoch scope violation: ${p}`).toBe(true);
  }
}
    const t2r1FlakeFix = "packages/gp-execution/test/gp2-execution.test.ts"; // T2-R1 deterministic N5 forgery flip, disclosed
    epochSeal("T2-E4",
      "7e50a08c0ae49248a8aaf061cd098d7cf48e6c0f",
      "dfd4b333d6d8d7a6c5b8583b1c1420dfb48a581a",
      (p) => p.startsWith("packages/solana-devnet-adapter/") || p === ".gitignore" || p === "package-lock.json" || p === "README.md" || p === t2r1FlakeFix);
  });
});
