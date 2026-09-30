/**
 * TESTNET-R1 / T4 machine tests: UNKNOWN → RECONCILE → safe terminal state.
 * Hermetic: the classification rules and lifecycle are pure; the committed
 * t4-evidence/report.json is sealed against tampering. On-chain rerun via
 * scripts/t4-reconcile.mjs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { classify, nextAdapterState, InvalidTransitionError, unknownNeverPermitsResubmission, type ChainObservation } from "../src/reconcile.ts";
import { FROZEN, PINNED } from "../src/index.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");

const baseObs = (over: Partial<ChainObservation> = {}): ChainObservation => ({
  releasePda: { initialized: false, amountBase: null },
  claimantBalance: "10000000",
  treasuryBalance: "90000000",
  capsCycleReleased: "10000000",
  signature: null,
  lastValidBlockHeight: null,
  currentBlockHeight: 500_000,
  ...over,
});

describe("[TESTNET-R1/T4] UNKNOWN → RECONCILE → safe terminal state", () => {
  test("[T4-01] classification rule matrix (pure, deterministic)", () => {
    // R1 — the on-chain fact outranks everything, even a "lost" signature
    const released = classify(baseObs({ releasePda: { initialized: true, amountBase: "10000000" }, signature: { known: true, found: false } }));
    expect(released.classification).toBe("RELEASED");
    expect(released.safeToRetry).toBe(false);

    // R2 — rejected on chain (Custom 108 DuplicateRelease)
    const rejected108 = classify(baseObs({ signature: { known: true, found: true, slot: 42, confirmationStatus: "finalized", err: '{"InstructionError":[0,{"Custom":108}]}' } }));
    expect(rejected108.classification).toBe("REJECTED");
    expect(rejected108.safeToRetry).toBe(false);
    expect(rejected108.reason).toContain("108");

    // R2 — rejected for another on-chain reason: still no retry
    const rejectedOther = classify(baseObs({ signature: { known: true, found: true, err: '{"InstructionError":[0,{"Custom":103}]}' } }));
    expect(rejectedOther.classification).toBe("REJECTED");
    expect(rejectedOther.safeToRetry).toBe(false);

    // R3 — success without the fact: refuse to guess
    const successNoFact = classify(baseObs({ signature: { known: true, found: true, err: null } }));
    expect(successNoFact.classification).toBe("STILL_UNKNOWN");
    expect(successNoFact.safeToRetry).toBe(false);

    // R4 — expired and not found: the ONLY safe-retry class
    const notLanded = classify(baseObs({ signature: { known: true, found: false }, lastValidBlockHeight: 499_000, currentBlockHeight: 500_000 }));
    expect(notLanded.classification).toBe("NOT_LANDED");
    expect(notLanded.safeToRetry).toBe(true);

    // R5 — in flight within the window
    const inFlight = classify(baseObs({ signature: { known: true, found: false }, lastValidBlockHeight: 500_100, currentBlockHeight: 500_000 }));
    expect(inFlight.classification).toBe("STILL_UNKNOWN");
    expect(inFlight.safeToRetry).toBe(false);

    // R5 — no signature at all and no fact: no blind resubmission
    const blind = classify(baseObs());
    expect(blind.classification).toBe("STILL_UNKNOWN");
    expect(blind.safeToRetry).toBe(false);

    // T4-R1 authorization gate negatives: expiry WITHOUT the original
    // signature knowledge can NEVER grant retry permission
    const unknownSignerExpired = classify(baseObs({ signature: { known: false, found: false }, lastValidBlockHeight: 499_000, currentBlockHeight: 500_000 }));
    expect(unknownSignerExpired.classification).toBe("STILL_UNKNOWN");
    expect(unknownSignerExpired.safeToRetry).toBe(false);
    const nullSignatureExpired = classify(baseObs({ signature: null, lastValidBlockHeight: 499_000, currentBlockHeight: 500_000 }));
    expect(nullSignatureExpired.classification).toBe("STILL_UNKNOWN");
    expect(nullSignatureExpired.safeToRetry).toBe(false);
  });

  test("[T4-02] THE frozen invariant: UNKNOWN ≠ permission to resubmit (exhaustive over the rule space)", () => {
    const results = [
      baseObs({ releasePda: { initialized: true, amountBase: "10000000" } }),
      baseObs({ signature: { known: true, found: true, err: '{"InstructionError":[0,{"Custom":108}]}' } }),
      baseObs({ signature: { known: true, found: true, err: null } }),
      baseObs({ signature: { known: true, found: false }, lastValidBlockHeight: 499_000 }),
      baseObs({ signature: { known: true, found: false }, lastValidBlockHeight: 500_100 }),
      baseObs({ signature: { known: false, found: false }, lastValidBlockHeight: 499_000 }), // T4-R1 gate
      baseObs({ signature: null, lastValidBlockHeight: 499_000 }), // T4-R1 gate
      baseObs(),
    ].map(classify);
    expect(unknownNeverPermitsResubmission(results)).toBe(true);
    expect(results.filter((r) => r.safeToRetry).map((r) => r.classification)).toEqual(["NOT_LANDED"]);
  });

  test("[T4-03] adapter lifecycle transitions (T0 §8) — invalid transitions rejected", () => {
    expect(nextAdapterState("PREPARED", "SUBMITTED")).toBe("SUBMITTED");
    expect(nextAdapterState("SUBMITTED", "CONFIRMED")).toBe("CONFIRMED");
    expect(nextAdapterState("CONFIRMED", "FINALIZED")).toBe("FINALIZED");
    expect(nextAdapterState("SUBMITTED", "UNKNOWN")).toBe("UNKNOWN");
    expect(nextAdapterState("UNKNOWN", "RECONCILED")).toBe("RECONCILED");
    for (const [from, to] of [
      ["PREPARED", "CONFIRMED"], ["PREPARED", "FINALIZED"], ["PREPARED", "UNKNOWN"],
      ["SUBMITTED", "FINALIZED"], ["SUBMITTED", "RECONCILED"],
      ["CONFIRMED", "UNKNOWN"], ["CONFIRMED", "RECONCILED"], ["CONFIRMED", "SUBMITTED"],
      ["UNKNOWN", "PREPARED"], ["UNKNOWN", "SUBMITTED"], ["UNKNOWN", "CONFIRMED"], ["UNKNOWN", "FINALIZED"],
      ["FINALIZED", "ANY"], ["RECONCILED", "ANY"],
    ] as const) {
      expect(() => nextAdapterState(from, to as never), `${from} → ${to}`).toThrow(InvalidTransitionError);
    }
  });

  test("[T4-04] committed on-chain evidence sealed (t4-evidence/report.json)", () => {
    const report = JSON.parse(readFileSync(path.join(pkgDir, "t4-evidence/report.json"), "utf8")) as {
      program_id: string;
      escrow_ref: string;
      acceptance: Record<string, unknown>;
      scenarios: Array<{ name: string; classification: string; safeToRetry: boolean; fixtureUnreleasedPair?: boolean; signatureStatus?: { found?: boolean; err?: string | null } }>;
    };
    expect(report.program_id).toBe(PINNED.programId);
    expect(report.escrow_ref).toBe(FROZEN.anchors.escrowRef);
    const byNameRaw: Record<string, { name: string; classification: string; safeToRetry: boolean; reason?: string; fixtureUnreleasedPair?: boolean; signatureStatus?: { found?: boolean; err?: string | null } }> = Object.fromEntries(report.scenarios.map((s) => [s.name, s]));
    const g = (n: string): { name: string; classification: string; safeToRetry: boolean; reason?: string; fixtureUnreleasedPair?: boolean; signatureStatus?: { found?: boolean; err?: string | null } } => {
      const v = byNameRaw[n];
      if (!v) throw new Error(`scenario missing: ${n}`);
      return v;
    };
    // the pair is terminal: the recovery answer is RELEASED, and the
    // lost-response duplicate itself is adjudicated Custom(108) on chain
    expect(g("T4-A-timeout-disconnect").classification).toBe("RELEASED");
    expect(g("T4-A-timeout-disconnect").safeToRetry).toBe(false);
    expect(g("T4-A-timeout-disconnect").signatureStatus?.found).toBe(true);
    expect(g("T4-A-timeout-disconnect").signatureStatus?.err).toContain("108");
    expect(g("T4-B-missing-local-state").classification).toBe("RELEASED");
    expect(g("T4-B-missing-local-state").safeToRetry).toBe(false);
    expect(g("T4-C-expired-not-landed").classification).toBe("NOT_LANDED");
    expect(g("T4-C-expired-not-landed").safeToRetry).toBe(true);
    expect(g("T4-C-expired-not-landed").fixtureUnreleasedPair).toBe(true); // honest about the fixture world
    // T4-R2: the five evidence elements of the REAL-expiry proof are sealed
    const c = g("T4-C-expired-not-landed") as unknown as {
      fixtureTransaction: { signed: boolean; submitted: boolean; realSignature: string; realLastValidBlockHeight: number };
      signatureFoundOnChain: boolean;
      observation?: unknown;
    };
    expect(c.fixtureTransaction.signed).toBe(true);
    expect(c.fixtureTransaction.submitted).toBe(false);
    expect(c.fixtureTransaction.realSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/); // REAL signature shape
    expect(Number.isFinite(c.fixtureTransaction.realLastValidBlockHeight)).toBe(true);
    expect(c.signatureFoundOnChain).toBe(false);
    // expiry fact itself: the classification-time block height is PAST the real window
    const cReason = g("T4-C-expired-not-landed").reason;
    const cObserved = /block height (\d+) is past lastValid (\d+)/.exec(cReason ?? "");
    expect(cObserved, "T4-C reason must carry the observed heights").not.toBeNull();
    expect(Number(cObserved![1])).toBeGreaterThan(c.fixtureTransaction.realLastValidBlockHeight);
    expect(g("T4-D-still-unknown").classification).toBe("STILL_UNKNOWN");
    expect(g("T4-D-still-unknown").safeToRetry).toBe(false);
    expect(g("T4-D-still-unknown").fixtureUnreleasedPair).toBe(true);
    // T4-R2: same sealing for the open-window world
    const d = g("T4-D-still-unknown") as unknown as {
      fixtureTransaction: { signed: boolean; submitted: boolean; realSignature: string; realLastValidBlockHeight: number };
      currentBlockHeight: number;
    };
    expect(d.fixtureTransaction.signed).toBe(true);
    expect(d.fixtureTransaction.submitted).toBe(false);
    expect(d.fixtureTransaction.realSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);
    expect(Number.isFinite(d.fixtureTransaction.realLastValidBlockHeight)).toBe(true);
    // open-window fact itself: still WITHIN the real window
    expect(d.currentBlockHeight).toBeLessThanOrEqual(d.fixtureTransaction.realLastValidBlockHeight);
    expect(report.acceptance.claimant_unchanged).toBe(true);
    expect(report.acceptance.treasury_unchanged).toBe(true);
    expect(report.acceptance.unknown_never_permits_resubmission).toBe(true);
  });

  test("[T4-05] EPOCH seal: closed range 2cabc63..ad935ee (T4 sign-off) — frozen T4 allowlist, never HEAD", () => {

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
    epochSeal("T4-05",
      "2cabc6346b8a8b7c5d4265265a65a6fa2d5eb601",
      "ad935eeebe9263cb91b9153bb174528394200c7e",
      (p) => p.startsWith("packages/solana-devnet-adapter/") || p === "README.md");
  });
});
