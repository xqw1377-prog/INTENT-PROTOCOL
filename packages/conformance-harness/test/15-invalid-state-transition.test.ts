import { describe, expect, test } from "vitest";
import { ARTIFACT_HASHES, validBundle, validDecision } from "../src/lib/fixtures.js";
import { sut } from "../src/sut.js";

const S = sut.objects;
const { merkleRoot } = sut.merkle;

/**
 * AREA 15 — Invalid state transitions.
 *
 * G0 gate requires "非法跃迁 100% 阻断". What is delivered at S0:
 *  - EvidenceBundleState enum collapsed to OPEN|SEALED (arch doc §7 documents
 *    seven states); only the OPEN->SEALED seam is frozen per states.ts.
 *  - No Intent/Milestone/Settlement state machines (objects or enums) ship.
 *  - No transition engine anywhere (@intent/intent-core absent).
 * Checks that cannot be executed are recorded as todo/UNKNOWN, never PASS.
 */
describe("[C-15] invalid state transitions", () => {
  test("[C-15-01] out-of-enum state literals are rejected (bundle 'CLOSED'/'VALID', decision result 'MAYBE')", () => {
    expect(() => S.EvidenceBundleSchema.parse(validBundle({ state: "CLOSED", merkle_root: "sha256:" + "ab".repeat(32), sealed_at: "2026-09-17T01:00:00.000Z" }))).toThrow();
    expect(() => S.EvidenceBundleSchema.parse(validBundle({ state: "VALID" }))).toThrow();
    expect(() => S.VerificationDecisionSchema.parse(validDecision({ result: "MAYBE" }))).toThrow();
    expect(() => S.EvidenceBundleSchema.parse(validBundle({ state: "OPEN" }))).not.toThrow(); // control
  });

  test("[C-15-02] delivered bundle invariant: SEALED requires merkle_root + sealed_at + >=1 artifact + no duplicates", () => {
    const sealed = { merkle_root: "sha256:" + "ab".repeat(32), sealed_at: "2026-09-17T01:00:00.000Z" };
    expect(() => S.EvidenceBundleSchema.parse(validBundle({ state: "SEALED", artifact_hashes: [], ...sealed }))).toThrow();
    expect(() => S.EvidenceBundleSchema.parse(validBundle({ state: "SEALED", artifact_hashes: [ARTIFACT_HASHES.a1] }))).toThrow();
    expect(() => S.EvidenceBundleSchema.parse(validBundle({ state: "SEALED", artifact_hashes: [ARTIFACT_HASHES.a1, ARTIFACT_HASHES.a1], ...sealed }))).toThrow();
    expect(() => S.EvidenceBundleSchema.parse(validBundle({ state: "SEALED", artifact_hashes: [ARTIFACT_HASHES.a1], ...sealed }))).not.toThrow();
  });

  test("[C-15-03] OPEN bundle carries no seal requirements (forward seam OPEN->SEALED is the only frozen transition)", () => {
    expect(() => S.EvidenceBundleSchema.parse(validBundle({ state: "OPEN", artifact_hashes: [], run_ids: [] }))).not.toThrow();
  });


  test("[C-15-05][GAP] delivered EvidenceBundleState has only 2 of the 7 states documented in arch doc §7 (VERIFYING/VALID/INVALID/INSUFFICIENT/CHALLENGED absent)", () => {
    const delivered = ["OPEN", "SEALED"] as const;
    expect(Object.values(sut.states.EvidenceBundleState.enum).sort()).toEqual([...delivered].sort());
  });

  test.todo("[C-15-06][GAP] Milestone state machine PLANNED->EXECUTING->SUBMITTED->VERIFIED/DISPUTED/FAILED (arch doc §7) — no object, no enum, no engine delivered");
  test.todo("[C-15-07][GAP] Settlement state machine LOCKED->ELIGIBLE->...->RELEASED/REFUNDED (arch doc §7) — SettlementInstruction carries no state field at all in S0");
  test.todo("[C-15-08][GAP] Intent state machine DRAFT->FROZEN->ACTIVE->... (arch doc §7) — not delivered");
  test.todo("[C-15-09][GAP] G0 gate 'illegal transitions 100% blocked' cannot be evaluated: no state-machine code exists in the delivered snapshot (@intent/intent-core absent)");
});
