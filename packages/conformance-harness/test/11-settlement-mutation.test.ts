import { describe, expect, test } from "vitest";
import { refHashObject, refSettlementKey } from "../src/reference/hash.js";
import { fakeHash, validDecision, validSettlement } from "../src/lib/fixtures.js";
import { sut, sealWith, contentHashOf } from "../src/sut.js";

const { SettlementInstructionSchema, VerificationDecisionSchema } = sut.objects;
const contentHash = contentHashOf;
const { proofBinding, settlementKey } = sut.hash;

/** AREA 11 — Settlement mutation and economic-binding primitives. */
describe("[C-11] settlement mutation", () => {
  const settlement = SettlementInstructionSchema.parse(validSettlement());

  test("[C-11-00] control: baseline settlement hash agrees with independent reference", () => {
    const { content_hash: _c, ...payload } = settlement as Record<string, unknown>;
    void _c;
    expect(contentHash(settlement)).toBe(refHashObject("intent-protocol/v1/settlement-instruction", "settlement.v1", payload));
  });

  test("[C-11-01] amount / recipient / reason / outputs mutations change the hash; seal() rejects stale declared hash", () => {
    const h0 = contentHash(settlement);
    const mutate = (fn: (s: Record<string, unknown>) => void) => {
      const s = JSON.parse(JSON.stringify(validSettlement()));
      fn(s);
      return SettlementInstructionSchema.parse(s);
    };
    expect(contentHash(mutate((s) => { (s.outputs as Array<Record<string, unknown>>)[0]!.amount = "999"; }))).not.toBe(h0);
    expect(contentHash(mutate((s) => { (s.outputs as Array<Record<string, unknown>>)[0]!.recipient = "agent:mallory"; }))).not.toBe(h0);
    expect(contentHash(mutate((s) => { (s.outputs as Array<Record<string, unknown>>)[0]!.reason = "no reason"; }))).not.toBe(h0);
    expect(contentHash(mutate((s) => {
      s.outputs = [
        { recipient: "agent:builder-a", asset: { network: "sim:local", asset: "USD", decimals: 2 }, amount: "150", reason: "split" },
        { recipient: "user:alice", asset: { network: "sim:local", asset: "USD", decimals: 2 }, amount: "150", reason: "split" },
      ];
    }))).not.toBe(h0);
    expect(contentHash(mutate(() => {}))).toBe(h0); // control: untouched clone hashes the same
    const lying = { ...JSON.parse(JSON.stringify(validSettlement())), total_amount: "888", content_hash: h0 };
    expect(() => sealWith(SettlementInstructionSchema, lying)).toThrow(/content_hash mismatch/);
  });

  test("[C-11-02] nonce mutation changes the hash (replay separation)", () => {
    const h0 = contentHash(settlement);
    const s = JSON.parse(JSON.stringify(validSettlement()));
    s.nonce = "8";
    expect(contentHash(SettlementInstructionSchema.parse(s))).not.toBe(h0);
  });

  test("[C-11-03] decision proof_binding round-trips the SUT binding API (SUT self-consistency; R9 conformance is enforced by S-R9)", () => {
    const inputs = {
      intent_hash: fakeHash("ab"),
      milestone_revision: 3,
      evidence_root: fakeHash("cd"),
      policy_hash: fakeHash("ef"),
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
      milestone_revision: 3,
      evidence_root: fakeHash("cd"),
      policy_hash: fakeHash("ef"),
    };
    const declared = proofBinding(inputs);
    const tampered = { ...inputs, milestone_revision: 4 };
    expect(proofBinding(tampered)).not.toBe(declared);
  });



  test("[C-11-07] settlementKey idempotency and separation (double-spend key; FROZEN receipt-keyed preimage)", () => {
    const p = { proof_binding: fakeHash("11"), escrow_id: "escrow:sim-0001", settlement_nonce: 7n };
    const k0 = settlementKey(p);
    // FROZEN formula (TRUST-CHAIN @ e28a22e): domain-prefixed, keyed by
    // outcome_receipt_hash; the superseded proof_binding-keyed preimage FAILS here.
    expect(k0, "SUT settlement_key must equal the frozen formula (domain-prefixed, receipt-keyed)")
      .toBe(refSettlementKey({ outcome_receipt_hash: p.proof_binding, escrow_ref: p.escrow_id, nonce: p.settlement_nonce }));
    expect(settlementKey(p)).toBe(k0);
    expect(settlementKey({ ...p, settlement_nonce: 8n })).not.toBe(k0);
    expect(settlementKey({ ...p, escrow_id: "escrow:sim-0002" })).not.toBe(k0);
  });
});
