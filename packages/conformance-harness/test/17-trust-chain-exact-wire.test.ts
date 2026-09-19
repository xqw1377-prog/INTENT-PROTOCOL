import { describe, expect, test } from "vitest";
import {
  DECISION_HASH_1, DECISION_HASH_2, fakeHash, POLICY_HASH,
  validMilestone, validOutcomeReceipt, validReceiptSettlement, supersededDecisionGatedSettlement,
} from "../src/lib/fixtures.js";
import { refHashObject } from "../src/reference/hash.js";
import { sut, sealWith } from "../src/sut.js";

// Typed access to the SUT schema registry. The FROZEN names are asserted, never
// aliased: unlike the superseded scaffold there is NO `?? fallback` resolution —
// a missing exact name is itself the conformance failure.
const objects = sut.objects as unknown as Record<string, unknown>;
interface Parseable { parse: (input: unknown) => unknown }
const asParseable = (s: unknown): Parseable => s as Parseable;

const { SettlementInstructionSchema } = sut.objects;

/**
 * TRUST-CHAIN EXACT-WIRE VERIFIERS (Builder B, B-TC1..B-TC3).
 *
 * Normative source: docs/TRUST-CHAIN.md, frozen at main @ e28a22e
 * ("governance: freeze exact G1 milestone receipt and settlement wire
 * contracts") — COMMANDER-RULED / G1 NORMATIVE:
 *
 *   "These field names and schema_version literals are normative for G1.
 *    Builder A and Builder B MUST implement these exact names; semantic
 *    aliases are not conforming."
 *
 * These verifiers GUESS NOTHING: no regex slot matching, no alias fallbacks.
 * Each object must be exported under its exact frozen schema name, must carry
 * EXACTLY the frozen field-name set (a semantic alias missing OR added is a
 * conformance failure), must carry the frozen schema_version literal, and must
 * enforce the frozen field rules. Hash domains are pinned byte-exactly against
 * the independent reference (refHashObject), not assumed from the SUT's own
 * mapping.
 *
 * Authority model (frozen):
 *   VerificationDecision = how a verifier judged a result  (never payment authority)
 *   OutcomeReceipt       = the protocol formally accepting the outcome
 *   Settlement           = authorized ONLY by an OutcomeReceipt
 *
 * Posture: against an SUT that has not delivered the exact-wire objects these
 * FAIL — the gate interception posture, identical to test/16. Deliberate FAIL
 * findings make the run exit non-zero on purpose.
 */

/** Unwrap zod effects (superRefine) wrappers to the inner object schema's shape. */
function shapeOf(schema: unknown): Record<string, unknown> {
  let s: unknown = schema;
  for (let i = 0; i < 5; i++) {
    const cur = s as { shape?: Record<string, unknown>; _def?: { schema?: unknown; innerType?: unknown } } | null;
    if (!cur) break;
    if (cur.shape) return cur.shape;
    s = cur._def?.schema ?? cur._def?.innerType;
  }
  throw new Error("schema is not a zod object (no .shape reachable)");
}

const literalValue = (z: unknown): unknown => (z as { value?: unknown } | undefined)?.value;

/** strip content_hash / signature for domain-pinned digest recomputation. */
function stripDerived(o: Record<string, unknown>): Record<string, unknown> {
  const { content_hash: _c, signature: _s, ...rest } = o;
  return rest;
}

function exactFieldSet(shape: Record<string, unknown>, required: readonly string[], optional: readonly string[]): void {
  expect(new Set(Object.keys(shape)), "exact wire: the field-name set must be EXACTLY the frozen set — no alias, no omission, no addition")
    .toEqual(new Set([...required, ...optional]));
  for (const f of required) expect(shape, `exact wire: ${f} is required by the frozen contract`).toHaveProperty(f);
}

describe("[TRUST-CHAIN] B-TC1 MilestoneV1 exact-wire verifier", () => {
  const REQUIRED = ["schema_version", "milestone_id", "intent_hash", "milestone_revision", "criterion_ids", "verification_policy_hash", "settlement_policy_hash", "allocation"] as const;

  test("[S-MS-WIRE-01] MilestoneV1 exact wire: exported as MilestoneSchema, exact frozen field set, schema_version literal 'milestone.v1'", () => {
    const schema = objects.MilestoneSchema;
    expect(schema, "MilestoneSchema must be exported by the SUT under its EXACT frozen name (no alias resolution)").toBeDefined();
    if (!schema) return;
    const shape = shapeOf(schema);
    exactFieldSet(shape, REQUIRED, ["content_hash", "signature"]);
    expect(literalValue(shape.schema_version), "schema_version must be the frozen literal 'milestone.v1'").toBe("milestone.v1");
    // strict wire: a semantic alias field is not conforming and must not parse
    expect(() => asParseable(schema).parse(validMilestone({ milestone_ref: "alias-probe" })), "alias/unknown fields must be rejected (strict wire)").toThrow();
    expect(() => asParseable(schema).parse(validMilestone({ intent_commitment: fakeHash("bb") })), "semantic alias 'intent_commitment' must be unrepresentable").toThrow();
  });

  test("[S-MS-WIRE-02] MilestoneV1 rules: revision >= 1; criterion_ids non-empty, unique; allocation scale <= asset.decimals", () => {
    const schema = objects.MilestoneSchema;
    expect(schema, "MilestoneSchema must be exported by the SUT under its EXACT frozen name").toBeDefined();
    if (!schema) return;
    expect(() => asParseable(schema).parse(validMilestone()), "control: the frozen-wire fixture must parse").not.toThrow();
    expect(() => asParseable(schema).parse(validMilestone({ milestone_revision: 0 })), "milestone_revision 0 must be rejected (U32 >= 1)").toThrow();
    expect(() => asParseable(schema).parse(validMilestone({ criterion_ids: [] })), "empty criterion_ids must be rejected").toThrow();
    expect(() => asParseable(schema).parse(validMilestone({ criterion_ids: ["crit-tests", "crit-tests"] })), "duplicate criterion_ids must be rejected").toThrow();
    expect(() => asParseable(schema).parse(validMilestone({
      allocation: { asset: { network: "sim:local", asset: "USD", decimals: 1 }, amount: "15.55" },
    })), "allocation amount scale > asset.decimals must be rejected").toThrow();
    expect(() => asParseable(schema).parse(validMilestone({
      allocation: { asset: { network: "sim:local", asset: "USD", decimals: 1 }, amount: "15.5" },
    })), "control: scale == decimals must parse").not.toThrow();
  });

  test("[S-MS-HASH-01] MilestoneV1 digest: every required field feeds it, criterion order is canonical, domain pinned to intent-protocol/v1/milestone, round-trip idempotent", () => {
    const schema = objects.MilestoneSchema;
    expect(schema, "MilestoneSchema must be exported by the SUT under its EXACT frozen name").toBeDefined();
    if (!schema) return;
    const base = sealWith(schema, validMilestone());
    // domain pin: content_hash must be the frozen-domain hash of the stripped object (byte-exact)
    expect(base.content_hash, "content_hash domain must be exactly intent-protocol/v1/milestone over milestone.v1")
      .toBe(refHashObject("intent-protocol/v1/milestone", "milestone.v1", stripDerived(validMilestone())));
    const mutations: Array<[string, Record<string, unknown>]> = [
      ["milestone_id", { milestone_id: "33333333-3333-4333-8333-333333333333" }],
      ["intent_hash", { intent_hash: fakeHash("bb") }],
      ["milestone_revision", { milestone_revision: 2 }],
      ["criterion_ids content", { criterion_ids: ["crit-tests", "crit-report", "crit-extra"] }],
      ["verification_policy_hash", { verification_policy_hash: fakeHash("bb") }],
      ["settlement_policy_hash", { settlement_policy_hash: fakeHash("bb") }],
      ["allocation", { allocation: { asset: { network: "sim:local", asset: "USD", decimals: 2 }, amount: "301" } }],
    ];
    for (const [field, patch] of mutations) {
      expect(sealWith(schema, validMilestone(patch)).content_hash, `digest sensitivity: ${field}`).not.toBe(base.content_hash);
    }
    // array order is canonical/significant: swapping two criteria changes the digest
    expect(sealWith(schema, validMilestone({ criterion_ids: ["crit-report", "crit-tests"] })).content_hash,
      "criterion_ids order must be digest-significant (order is canonical)").not.toBe(base.content_hash);
    // identity tuple (intent_hash, milestone_id, milestone_revision): all three proven above.
    // R10 shape: seal -> JSON round-trip -> re-seal idempotent; wrong declared hash rejected.
    const back = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    expect(sealWith(schema, back).content_hash).toBe(base.content_hash);
    expect(() => sealWith(schema, { ...back, content_hash: fakeHash("ff") })).toThrow();
  });
});

describe("[TRUST-CHAIN] B-TC2 OutcomeReceiptV1 exact-wire verifier", () => {
  const REQUIRED = ["schema_version", "receipt_id", "intent_hash", "milestone_id", "milestone_revision", "evidence_root", "verification_policy_hash", "decision_hashes", "accepted_result", "issued_at"] as const;

  test("[S-RCPT-WIRE-01] OutcomeReceiptV1 exact wire: exported as OutcomeReceiptSchema, exact frozen field set, literals 'outcome-receipt.v1' / 'ACCEPTED'", () => {
    const schema = objects.OutcomeReceiptSchema;
    expect(schema, "OutcomeReceiptSchema must be exported by the SUT under its EXACT frozen name (no alias resolution, no ReceiptSchema fallback)").toBeDefined();
    if (!schema) return;
    const shape = shapeOf(schema);
    exactFieldSet(shape, REQUIRED, ["content_hash", "signature"]);
    expect(literalValue(shape.schema_version), "schema_version must be the frozen literal 'outcome-receipt.v1'").toBe("outcome-receipt.v1");
    expect(() => asParseable(schema).parse(validOutcomeReceipt()), "control: the frozen-wire fixture must parse").not.toThrow();
    expect(() => asParseable(schema).parse(validOutcomeReceipt({ accepted_result: "VALID" })), "accepted_result must be exactly 'ACCEPTED' (a receipt is not a decision)").toThrow();
    expect(() => asParseable(schema).parse(validOutcomeReceipt({ accepted_result: "REJECTED" })), "accepted_result 'REJECTED' must be unrepresentable on a receipt").toThrow();
    expect(() => asParseable(schema).parse(validOutcomeReceipt({ policy_hash: POLICY_HASH })), "alias/unknown fields must be rejected (strict wire)").toThrow();
  });

  test("[S-RCPT-SET-01] decision_hashes MUST be non-empty, unique, strictly lexicographically ascending", () => {
    const schema = objects.OutcomeReceiptSchema;
    expect(schema, "OutcomeReceiptSchema must be exported by the SUT under its EXACT frozen name").toBeDefined();
    if (!schema) return;
    expect(() => asParseable(schema).parse(validOutcomeReceipt({ decision_hashes: [] })), "empty decision_hashes must be rejected").toThrow();
    expect(() => asParseable(schema).parse(validOutcomeReceipt({ decision_hashes: [DECISION_HASH_2, DECISION_HASH_1] })), "descending decision_hashes must be rejected").toThrow();
    expect(() => asParseable(schema).parse(validOutcomeReceipt({ decision_hashes: [DECISION_HASH_1, DECISION_HASH_1] })), "duplicate decision_hashes must be rejected").toThrow();
    expect(() => asParseable(schema).parse(validOutcomeReceipt({ decision_hashes: [DECISION_HASH_1, DECISION_HASH_2] })), "control: strictly ascending set must parse").not.toThrow();
    expect(() => asParseable(schema).parse(validOutcomeReceipt({
      decision_hashes: [DECISION_HASH_1, DECISION_HASH_2, fakeHash("33")],
    })), "control: three-element ascending set must parse").not.toThrow();
  });

  test("[S-RCPT-HASH-01] OutcomeReceiptV1 digest: every required field feeds it, domain pinned to intent-protocol/v1/outcome-receipt, round-trip idempotent", () => {
    const schema = objects.OutcomeReceiptSchema;
    expect(schema, "OutcomeReceiptSchema must be exported by the SUT under its EXACT frozen name").toBeDefined();
    if (!schema) return;
    const base = sealWith(schema, validOutcomeReceipt());
    expect(base.content_hash, "content_hash domain must be exactly intent-protocol/v1/outcome-receipt over outcome-receipt.v1")
      .toBe(refHashObject("intent-protocol/v1/outcome-receipt", "outcome-receipt.v1", stripDerived(validOutcomeReceipt())));
    const mutations: Array<[string, Record<string, unknown>]> = [
      ["receipt_id", { receipt_id: "bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2" }],
      ["intent_hash", { intent_hash: fakeHash("bb") }],
      ["milestone_id", { milestone_id: "33333333-3333-4333-8333-333333333333" }],
      ["milestone_revision", { milestone_revision: 2 }],
      ["evidence_root", { evidence_root: fakeHash("bb") }],
      ["verification_policy_hash", { verification_policy_hash: fakeHash("bb") }],
      ["decision_hashes", { decision_hashes: [DECISION_HASH_1] }],
      ["issued_at", { issued_at: "2026-09-17T02:00:00.000Z" }],
    ];
    for (const [field, patch] of mutations) {
      expect(sealWith(schema, validOutcomeReceipt(patch)).content_hash, `digest sensitivity: ${field}`).not.toBe(base.content_hash);
    }
    const back = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    expect(sealWith(schema, back).content_hash).toBe(base.content_hash);
    expect(() => sealWith(schema, { ...back, content_hash: fakeHash("ff") })).toThrow();
  });
});

describe("[TRUST-CHAIN] B-TC3 receipt-gated Settlement exact-wire verifier", () => {
  const REQUIRED = ["schema_version", "settlement_id", "escrow_ref", "outcome_receipt_hash", "nonce", "outputs", "total_amount"] as const;

  test("[S-GATE-AUTH-01] Settlement exact wire: exact frozen field set carrying outcome_receipt_hash; decision_id / proof_binding are FORBIDDEN authority fields", () => {
    const shape = shapeOf(SettlementInstructionSchema);
    exactFieldSet(shape, REQUIRED, ["expires_at", "content_hash"]);
    expect(Object.keys(shape), "forbidden authority field decision_id must be absent from the frozen wire").not.toContain("decision_id");
    expect(Object.keys(shape), "forbidden authority field proof_binding must be absent from the frozen wire").not.toContain("proof_binding");
    expect(literalValue(shape.schema_version), "schema_version must be the frozen literal 'settlement.v1'").toBe("settlement.v1");
    expect(() => SettlementInstructionSchema.parse(validReceiptSettlement()), "control: the receipt-gated fixture must parse").not.toThrow();
    expect(() => SettlementInstructionSchema.parse(validReceiptSettlement({ decision_id: "88888888-8888-4888-8888-888888888888" })), "decision_id must be unrepresentable on a V1 settlement").toThrow();
    expect(() => SettlementInstructionSchema.parse(validReceiptSettlement({ proof_binding: fakeHash("99") })), "proof_binding must be unrepresentable on a V1 settlement").toThrow();
  });

  test("[S-GATE-AUTH-02] Settlement authorization is structurally receipt-gated: no receipt -> reject; raw decision authority -> reject", () => {
    const { outcome_receipt_hash: _omitted, ...withoutReceipt } = validReceiptSettlement();
    expect(() => SettlementInstructionSchema.parse(withoutReceipt), "a settlement without outcome_receipt_hash must be rejected").toThrow();
    expect(() => SettlementInstructionSchema.parse(supersededDecisionGatedSettlement()), "the superseded decision-gated wire (decision_id + proof_binding) must NOT parse under the frozen contract").toThrow();
    expect(() => SettlementInstructionSchema.parse(validReceiptSettlement()), "control: receipt-gated settlement must parse").not.toThrow();
  });

  test("[S-GATE-AUTH-03] Settlement frozen rules on the receipt-gated wire: one asset, scale <= decimals, total == exact sum", () => {
    const usd2 = { network: "sim:local", asset: "USD", decimals: 2 };
    const usd1 = { network: "sim:local", asset: "USD", decimals: 1 };
    const eur2 = { network: "sim:local", asset: "EUR", decimals: 2 };
    expect(() => SettlementInstructionSchema.parse(validReceiptSettlement({
      outputs: [
        { recipient: "agent:builder-a", asset: usd2, amount: "150", reason: "split" },
        { recipient: "user:alice", asset: eur2, amount: "150", reason: "split" },
      ],
    })), "mixed-asset outputs must be rejected").toThrow();
    expect(() => SettlementInstructionSchema.parse(validReceiptSettlement({
      outputs: [{ recipient: "agent:builder-a", asset: usd1, amount: "15.55", reason: "scale" }],
      total_amount: "15.55",
    })), "output amount scale > asset.decimals must be rejected").toThrow();
    expect(() => SettlementInstructionSchema.parse(validReceiptSettlement({
      outputs: [
        { recipient: "agent:builder-a", asset: usd2, amount: "150", reason: "split" },
        { recipient: "user:alice", asset: usd2, amount: "50.5", reason: "split" },
      ],
      total_amount: "299",
    })), "total_amount != exact sum(outputs.amount) must be rejected").toThrow();
    expect(() => SettlementInstructionSchema.parse(validReceiptSettlement({
      outputs: [
        { recipient: "agent:builder-a", asset: usd2, amount: "150", reason: "split" },
        { recipient: "user:alice", asset: usd2, amount: "50.5", reason: "split" },
      ],
      total_amount: "200.5",
    })), "control: exact-sum settlement must parse").not.toThrow();
  });
});
