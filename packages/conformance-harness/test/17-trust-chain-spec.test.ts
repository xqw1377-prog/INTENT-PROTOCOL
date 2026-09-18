import { describe, expect, test } from "vitest";
import { fakeHash, validMilestone, validOutcomeReceipt, validSettlement } from "../src/lib/fixtures.js";
import { sut, sealWith } from "../src/sut.js";

const objects = sut.objects as unknown as Record<string, unknown>;
const schemaOf = (name: string): ((input: unknown) => unknown) | undefined =>
  objects[name] as ((input: unknown) => unknown) | undefined;

/**
 * TRUST CHAIN spec assertions (Commander Issue #2 extension order;
 * docs/TRUST-CHAIN.md, COMMANDER-RULED / G1 NORMATIVE).
 *
 *   [S-MS]    MilestoneV1 is a delivered, hashable G1 trust primitive (#3):
 *             parse + seal round-trip idempotent + wrong-hash rejection.
 *   [S-RCPT]  OutcomeReceiptV1 (#7) is delivered and carries the ruled
 *             minimal binding set; hashable and round-trip idempotent.
 *   [S-GATE]  Settlement is RECEIPT-gated: SettlementInstructionV1 binds an
 *             outcome-receipt reference; a decision-only authorization
 *             (decision_id/proof_binding without a receipt) must be
 *             unrepresentable. VerificationDecision is a verifier assertion,
 *             NOT settlement authority.
 *
 * These are black-box assertions against the frozen rulings. Against a SUT
 * that has not delivered the objects yet they FAIL — that is the gate
 * interception posture, identical to the other spec assertions.
 */
describe("[TRUST-CHAIN] G1 trust primitives (Issue #2 extension)", () => {
  test("[S-MS] MilestoneV1 is a delivered hashable G1 primitive: seal round-trip idempotent, wrong hash rejected", () => {
    const parse = schemaOf("MilestoneSchema");
    expect(parse, "MilestoneV1 schema must be exported by the SUT (G1 trust primitive #3)").toBeDefined();
    if (!parse) return;
    const sealed1 = sealWith(parse, validMilestone());
    const back = JSON.parse(JSON.stringify(sealed1)) as Record<string, unknown>;
    const sealed2 = sealWith(parse, back);
    expect(sealed2.content_hash).toBe(sealed1.content_hash);
    expect(() => sealWith(parse, { ...back, content_hash: fakeHash("ff") })).toThrow();
  });

  test("[S-RCPT] OutcomeReceiptV1 is delivered, carries the ruled minimal binding set, and is hashable", () => {
    const parse = schemaOf("OutcomeReceiptSchema") ?? schemaOf("ReceiptSchema");
    expect(parse, "OutcomeReceiptV1 schema must be exported by the SUT (G1 trust primitive #7)").toBeDefined();
    if (!parse) return;

    // Minimal binding set per TRUST-CHAIN.md — semantic SLOTS, tolerant of
    // exact field spelling, strict about coverage.
    const parsed = parse(validOutcomeReceipt()) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    const slots: Array<[string, RegExp]> = [
      ["receipt identity", /receipt_id|^id$/],
      ["schema version", /schema_version/],
      ["intent commitment", /intent_hash|intent_commitment/],
      ["milestone identity", /milestone_id/],
      ["milestone revision", /milestone_revision|revision/],
      ["evidence root", /evidence_root/],
      ["verification policy", /policy_hash/],
      ["accepted decision set", /decision/],
      ["accepted outcome", /result|outcome/],
      ["issued at", /issued_at/],
    ];
    for (const [slot, re] of slots) {
      expect(keys.some((k) => re.test(k)), `receipt must carry slot: ${slot}`).toBe(true);
    }

    // hashable + round-trip idempotent + wrong-hash rejection (R10 shape)
    const sealed1 = sealWith(parse, validOutcomeReceipt());
    const back = JSON.parse(JSON.stringify(sealed1)) as Record<string, unknown>;
    expect(sealWith(parse, back).content_hash).toBe(sealed1.content_hash);
    expect(() => sealWith(parse, { ...back, content_hash: fakeHash("ff") })).toThrow();
  });

  test("[S-GATE] settlement is RECEIPT-gated: binds an outcome-receipt reference; decision-only authorization must be rejected", () => {
    const { SettlementInstructionSchema } = sut.objects;
    // (a) the settlement schema must expose a receipt reference slot
    const shape = Object.keys((SettlementInstructionSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {});
    expect(shape.some((k) => /receipt/i.test(k)), "SettlementInstructionV1 must bind outcome_receipt_hash (TRUST-CHAIN: settlement authority boundary)").toBe(true);
    // (b) a decision-only authorization (no receipt reference) must be unrepresentable
    expect(() => SettlementInstructionSchema.parse(validSettlement()), "a settlement authorized by decision_id/proof_binding alone must be rejected").toThrow();
    // (c) control: a receipt-referencing settlement must parse
    expect(() => SettlementInstructionSchema.parse({ ...validSettlement(), outcome_receipt_hash: fakeHash("99") })).not.toThrow();
  });
});
