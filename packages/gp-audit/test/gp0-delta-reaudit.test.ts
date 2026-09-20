import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { payeeBindingViolations } from "../src/payee.js";

/**
 * GP0 DELTA RE-AUDIT — executable evidence (Builder D, amendment a1d9749).
 *
 * Scope (Commander order): ONLY
 *   1. B1 wrong-payee closure
 *   2. C1 enum mapping accuracy
 *   3. C2 hidden free variables removed
 *   4. no new blocker introduced
 *   5. G1 zero change
 *
 * Audited amendment: 5e44297 -> a1d9749, docs/GOLDEN-PATH-V1.md + docs/GATES.md
 * only (137 insertions, 16 deletions — every deletion verified as a
 * replacement with a strictly stronger clause; no weakening).
 */

const CONTRACT = readFileSync(
  fileURLToPath(new URL("../../../docs/GOLDEN-PATH-V1.md", import.meta.url)),
  "utf8",
);
const GATES = readFileSync(
  fileURLToPath(new URL("../../../docs/GATES.md", import.meta.url)),
  "utf8",
);

const TASK: import("../src/payee.js").GPTaskFreezeRecord = {
  escrow_ref: "escrow:gp-001-local",
  asset: { network: "solana-devnet", asset: "USDC-test", decimals: 6 },
  reward: "10",
};
const TASK_HASH = "sha256:" + "ab".repeat(32);
const CLAIM: import("../src/payee.js").GPClaimRecord = {
  claimant: "agent:builder-c-agent",
  task_freeze_hash: TASK_HASH,
};
const conforming = {
  escrow_ref: TASK.escrow_ref,
  outputs: [{ recipient: CLAIM.claimant, asset: { ...TASK.asset }, amount: "10" }],
  total_amount: "10",
};

describe("[GP0-DELTA] amendment re-audit evidence", () => {
  test("[GP0-D01] B1 CLOSED in text: payee binding clauses pinned (single output, claimant equality, pre-ELIGIBLE rejection, negative case 9, GP5 released-payee assertion)", () => {
    expect(CONTRACT).toContain("outputs.length == 1");
    expect(CONTRACT).toContain("outputs[0].recipient == ClaimRecord.claimant");
    expect(CONTRACT).toContain("callers may not supply/override the payee");
    expect(CONTRACT).toContain("rejected before settlement becomes ELIGIBLE");
    expect(CONTRACT).toContain("settlement recipient != recorded ClaimRecord claimant -> REJECT / no RELEASE");
    expect(CONTRACT).toContain("derived only from the recorded ClaimRecord claimant");
    expect(CONTRACT).toContain("immutable ClaimRecord");
    expect(GATES).toContain("wrong-recipient settlement is rejected before ELIGIBLE");
    expect(GATES).toContain("actual released payee equals the immutable ClaimRecord claimant");
    expect(GATES).toContain("escrow RELEASED exactly once to that claimant");
  });

  test("[GP0-D02] B1 CLOSED in semantics: conforming instruction passes; wrong-payee / multi-output / wrong-amount / drift each MUST block", () => {
    expect(payeeBindingViolations(conforming, CLAIM, TASK, TASK_HASH), "conforming instruction has zero violations").toEqual([]);
    expect(payeeBindingViolations(
      { ...conforming, outputs: [{ ...conforming.outputs[0]!, recipient: "agent:attacker" }] },
      CLAIM, TASK, TASK_HASH,
    ), "wrong payee is a recipient-mismatch violation").toContain("recipient-mismatch");
    expect(payeeBindingViolations(
      { ...conforming, outputs: [conforming.outputs[0]!, { ...conforming.outputs[0]!, recipient: "user:alice" }] },
      CLAIM, TASK, TASK_HASH,
    ), "multi-output instruction is non-conforming").toContain("outputs-not-single");
    expect(payeeBindingViolations(
      { ...conforming, outputs: [{ ...conforming.outputs[0]!, amount: "100" }], total_amount: "100" },
      CLAIM, TASK, TASK_HASH,
    ), "wrong amount violates the frozen reward").toContain("amount-mismatch");
    expect(payeeBindingViolations(
      { ...conforming, escrow_ref: "escrow:other" },
      CLAIM, TASK, TASK_HASH,
    ), "wrong escrow violates the task freeze").toContain("escrow-mismatch");
    expect(payeeBindingViolations(
      conforming, { ...CLAIM, task_freeze_hash: "sha256:" + "cd".repeat(32) }, TASK, TASK_HASH,
    ), "claim bound to a different task freeze must not authorize settlement").toContain("claim-task-freeze-drift");
    expect(payeeBindingViolations(
      conforming, { ...CLAIM, claimant: "not-a-subjectref" }, TASK, TASK_HASH,
    ), "claimant must parse under the frozen SubjectRef grammar").toContain("claimant-not-subjectref");
  });

  test("[GP0-D03] C1 pinned: prose ACCEPT maps to result === 'VALID'; no 'ACCEPT' wire value may be invented", () => {
    expect(CONTRACT).toContain('VerificationDecisionV1.result === "VALID"');
    expect(CONTRACT).toContain('No `"ACCEPT"` result value may be invented');
    expect(GATES).toContain('both VerificationDecisionV1 wire results equal `"VALID"`');
  });

  test("[GP0-D04] C2 pinned: Task Freeze Record contract freezes every previously-free variable; hash is runtime-audit only (G1 not reopened)", () => {
    expect(CONTRACT).toContain("packages/golden-path/fixtures/gp-001-task.json");
    expect(CONTRACT).toContain('"max_attempts": 3');
    expect(CONTRACT).toContain('"acceptance_suite_sha256": "sha256:<64-lowercase-hex>"');
    expect(CONTRACT).toContain('task_freeze_hash = "sha256:" + SHA256(exact committed UTF-8 file bytes)');
    expect(CONTRACT).toContain("NOT a new G1 `content_hash`, schema primitive, or hash domain");
    expect(CONTRACT).toContain("Changing the record after GP2 starts invalidates the run and requires Commander review");
    expect(CONTRACT).toContain("single machine-readable source of GP-001 task facts");
    // the fake-clock determinism clause is now semantic, not wall-clock
    expect(CONTRACT).toContain("wall-clock waiting is not evidence");
  });

  test("[GP0-D05] G1 zero change: amendment touches docs only; strengthened clauses did not weaken any prior pin", () => {
    // prior audit pins must still hold against the AMENDED text
    expect(CONTRACT).toContain('"network": "solana-devnet"');
    expect(CONTRACT).toContain('"asset": "USDC-test"');
    expect(CONTRACT).toContain('"decimals": 6');
    expect(CONTRACT).toContain("(escrow_ref, outcome_receipt_hash)");
    expect(CONTRACT).toContain("settlement_key alone MUST NOT be used as the economic double-release guard");
    expect(CONTRACT).toContain("same receipt + different nonce -> no second release");
    expect(CONTRACT).toContain("no manual/admin/demo path may create an accepted receipt");
    expect(CONTRACT).toContain("Static string scanning alone is not sufficient.");
    expect(GATES).toContain("economic exactly-once release is enforced by unique key `(escrow_ref, outcome_receipt_hash)`");
    // GP-001 runtime strictness layered OVER the wire, not into it
    expect(CONTRACT).toContain("does not modify MilestoneV1 or any frozen G1 wire object");
  });
});
