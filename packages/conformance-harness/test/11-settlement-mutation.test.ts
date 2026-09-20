import { describe, expect, test } from "vitest";
import { refHashObject, refSettlementKey } from "../src/reference/hash.js";
import { fakeHash, IDS, POLICY_HASH, validDecision, validReceiptSettlement } from "../src/lib/fixtures.js";
import { sut, sealWith, contentHashOf } from "../src/sut.js";

const { SettlementInstructionSchema, VerificationDecisionSchema } = sut.objects;
const contentHash = contentHashOf;
const { proofBinding, settlementKey } = sut.hash;

/** AREA 11 — Settlement mutation and economic-binding primitives. */
describe("[C-11] settlement mutation", () => {
  // LAZY baseline: parsing at describe scope would abort collection against a
  // non-conforming SUT and silently drop this whole file from the evidence —
  // each check must record its own verdict instead.
  const baseline = (): Record<string, unknown> =>
    SettlementInstructionSchema.parse(validReceiptSettlement()) as Record<string, unknown>;

  test("[C-11-00] control: baseline settlement hash agrees with independent reference", () => {
    const settlement = baseline();
    const { content_hash: _c, ...payload } = settlement as Record<string, unknown>;
    void _c;
    expect(contentHash(settlement)).toBe(refHashObject("intent-protocol/v1/settlement-instruction", "settlement.v1", payload));
  });

  test("[C-11-01] amount / recipient / reason / outputs mutations change the hash; seal() rejects stale declared hash", () => {
    const h0 = contentHash(baseline());
    const mutate = (fn: (s: Record<string, unknown>) => void) => {
      const s = JSON.parse(JSON.stringify(validReceiptSettlement()));
      fn(s);
      return SettlementInstructionSchema.parse(s);
    };
    // remediation-18 (amount/total class): an amount mutation must keep the
    // object SUM-CONSISTENT (total tracks the new amount) so the check isolates
    // hash SENSITIVITY — a bare amount change trips S-SUM at parse instead.
    expect(contentHash(mutate((s) => {
      (s.outputs as Array<Record<string, unknown>>)[0]!.amount = "999";
      s.total_amount = "999";
    }))).not.toBe(h0);
    expect(contentHash(mutate((s) => { (s.outputs as Array<Record<string, unknown>>)[0]!.recipient = "agent:mallory"; }))).not.toBe(h0);
    expect(contentHash(mutate((s) => { (s.outputs as Array<Record<string, unknown>>)[0]!.reason = "no reason"; }))).not.toBe(h0);
    expect(contentHash(mutate((s) => {
      s.outputs = [
        { recipient: "agent:builder-a", asset: { network: "sim:local", asset: "USD", decimals: 2 }, amount: "150", reason: "split" },
        { recipient: "user:alice", asset: { network: "sim:local", asset: "USD", decimals: 2 }, amount: "150", reason: "split" },
      ]; // 150 + 150 = 300 = untouched total: sum-consistent structure change
    }))).not.toBe(h0);
    expect(contentHash(mutate(() => {}))).toBe(h0); // control: untouched clone hashes the same
    // remediation-18 (amount/total class): the lying input must be SUM-CONSISTENT
    // (single legal mutation: escrow_ref) so the ONLY violation is the stale
    // declared content_hash — a total_amount lie would trip S-SUM at parse first.
    const lying = { ...JSON.parse(JSON.stringify(validReceiptSettlement())), escrow_ref: "escrow:sim-0002", content_hash: h0 };
    expect(() => sealWith(SettlementInstructionSchema, lying)).toThrow(/content_hash mismatch/);
  });

  test("[C-11-02] nonce mutation changes the hash (replay separation)", () => {
    const h0 = contentHash(baseline());
    const s = JSON.parse(JSON.stringify(validReceiptSettlement()));
    s.nonce = "8";
    expect(contentHash(SettlementInstructionSchema.parse(s))).not.toBe(h0);
  });

  test("[C-11-03] decision proof_binding round-trips the SUT binding API (SUT self-consistency; R9 conformance is enforced by S-R9)", () => {
    // FROZEN R9 six-field binding (remediation-18): the values MUST equal the
    // decision fixture's own fields so the parse-time recomputation holds.
    const inputs = {
      intent_hash: fakeHash("ab"),
      milestone_id: IDS.milestone,
      milestone_revision: 3,
      bundle_id: IDS.bundle,
      evidence_root: fakeHash("cd"),
      policy_hash: POLICY_HASH,
    };
    const computed = proofBinding(inputs);
    const decision = VerificationDecisionSchema.parse(validDecision({ ...inputs, proof_binding: computed }));
    expect(decision.proof_binding).toBe(computed);
    const { content_hash: _c, ...payload } = decision as Record<string, unknown>;
    void _c;
    expect(contentHash(decision)).toBe(refHashObject("intent-protocol/v1/verification-decision", "decision.v1", payload));
  });

  test("[C-11-04] tampering milestone_revision invalidates a declared proof_binding (detectable by recompute)", () => {
    const inputs = {
      intent_hash: fakeHash("ab"),
      milestone_id: IDS.milestone,
      milestone_revision: 3,
      bundle_id: IDS.bundle,
      evidence_root: fakeHash("cd"),
      policy_hash: POLICY_HASH,
    };
    const declared = proofBinding(inputs);
    const tampered = { ...inputs, milestone_revision: 4 };
    expect(proofBinding(tampered)).not.toBe(declared);
  });



  test("[C-11-07] settlementKey idempotency and separation (double-spend key; FROZEN receipt-keyed preimage)", () => {
    // FROZEN parameterization (remediation-18): outcome_receipt_hash / escrow_ref / nonce.
    const p = { outcome_receipt_hash: fakeHash("11"), escrow_ref: "escrow:sim-0001", nonce: 7n };
    const k0 = settlementKey(p);
    expect(k0, "SUT settlement_key must equal the frozen formula (domain-prefixed, receipt-keyed)")
      .toBe(refSettlementKey({ ...p }));
    expect(settlementKey(p)).toBe(k0);
    expect(settlementKey({ ...p, nonce: 8n })).not.toBe(k0);
    expect(settlementKey({ ...p, escrow_ref: "escrow:sim-0002" })).not.toBe(k0);
  });
});
