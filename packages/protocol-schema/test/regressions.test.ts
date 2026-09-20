/**
 * Regression tests for defects found by the independent conformance harness
 * (Builder B, packages/conformance-harness) against the S0 baseline snapshot.
 * Every schema-valid object must be sealable; every hashable value must be canonicalizable.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IntentContractSchema, SettlementInstructionSchema, canonicalize, u64be,
} from "../src/index.js";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const GOLDEN = JSON.parse(readFileSync(join(PKG, "fixtures/golden-vectors.json"), "utf8"));
const validIntent = GOLDEN.valid.find((v: any) => v.schema_version === "intent.v1").input;
const validSettlement = GOLDEN.valid.find((v: any) => v.schema_version === "settlement.v1").input;

describe("schema admits only sealable values", () => {
  test("unsafe integer in criterion.threshold rejected at parse (C-10-03)", () => {
    const bad = JSON.parse(JSON.stringify(validIntent));
    bad.success_criteria[0].threshold = 2 ** 53;
    expect(() => IntentContractSchema.parse(bad)).toThrow();
    bad.success_criteria[0].threshold = 2 ** 53 - 1; // safe integer boundary
    expect(() => IntentContractSchema.parse(bad)).not.toThrow();
  });

  test("calendar-invalid timestamps rejected (C-13-05)", () => {
    for (const ts of ["2026-13-01T00:00:00.000Z", "2026-09-45T00:00:00.000Z", "2026-09-17T99:99:99.999Z", "2026-02-30T00:00:00.000Z"]) {
      expect(() => IntentContractSchema.parse({ ...validIntent, created_at: ts }), ts).toThrow();
    }
    expect(() => IntentContractSchema.parse({ ...validIntent, created_at: "2026-02-28T00:00:00.000Z" })).not.toThrow();
  });

  test("u64 nonce range-checked: 2^64-1 ok, 2^64 rejected (C-13-07b)", () => {
    expect(() => SettlementInstructionSchema.parse({ ...validSettlement, nonce: "18446744073709551615" })).not.toThrow();
    expect(() => u64be("18446744073709551615" as any)).not.toThrow();
    expect(() => SettlementInstructionSchema.parse({ ...validSettlement, nonce: "18446744073709551616" })).toThrow();
  });

  test("-0 rejected by canonicalizer (C-01-07)", () => {
    expect(() => canonicalize({ n: -0 })).toThrow(/-0/);
  });
});

describe("Commander rulings 2026-09-17 (remediation)", () => {
  test("keys must already be NFC — non-NFC key rejected, never normalized/merged", () => {
    expect(() => canonicalize({ "é": 1 })).toThrow(/NFC/);
    // an NFC key + an NFD key for the same glyph: reject rather than merge
    expect(() => canonicalize({ "é": 1, "é": 2 })).toThrow(/NFC/);
    expect(canonicalize({ "é": 1 })).toBe('{"é":1}');
  });

  test("Decimal is non-negative canonical form", () => {
    for (const bad of ["1.10", "1.0", "-0", "00", "01", ".5", "1.", "-1", "0.0", "10.50"]) {
      expect(() => IntentContractSchema.parse({ ...validIntent, budget: { ...validIntent.budget, total: bad } }), bad).toThrow();
    }
    for (const ok of ["1.1", "0.01", "10", "0", "20000", "0.00001"]) {
      expect(() => IntentContractSchema.parse({ ...validIntent, budget: { ...validIntent.budget, total: ok, execution_cap: ok } }), ok).not.toThrow();
    }
  });

  test("criterion_id / constraint_id unique within an intent", () => {
    const crit = validIntent.success_criteria[0];
    expect(() => IntentContractSchema.parse({ ...validIntent, success_criteria: [crit, { ...crit, assertion: "different" }] })).toThrow(/criterion_id/);
    expect(() => IntentContractSchema.parse({ ...validIntent, constraints: [
      { constraint_id: "c1", kind: "SCOPE", statement: "a" },
      { constraint_id: "c1", kind: "TIME", statement: "b" },
    ] })).toThrow(/constraint_id/);
  });

  test("decimalSum is exact (BigInt, no floats)", async () => {
    const { decimalSum } = await import("../src/index.js");
    expect(decimalSum(["0.1", "0.02"])).toBe("0.12");
    expect(decimalSum(["1.1", "0.09", "10"])).toBe("11.19");
    expect(decimalSum(["0.0000001", "0.0000002"])).toBe("0.0000003");
    expect(decimalSum(["1.999", "0.001"])).toBe("2");
    expect(decimalSum(["0"])).toBe("0");
  });
});

describe("Commander rulings R9–R14 (final S0 closure)", () => {
  const validDecision = GOLDEN.valid.find((v: any) => v.schema_version === "decision.v1").input;
  const validBundle = GOLDEN.valid.find((v: any) => v.schema_version === "bundle.v1").input;

  test("R9: proof_binding binds milestone_id and bundle_id (not only revision/root/policy)", async () => {
    const { proofBinding, VerificationDecisionSchema } = await import("../src/index.js");
    const base = {
      intent_hash: validDecision.intent_hash, milestone_id: validDecision.milestone_id,
      milestone_revision: validDecision.milestone_revision, bundle_id: validDecision.bundle_id,
      evidence_root: validDecision.evidence_root, policy_hash: validDecision.policy_hash,
    };
    expect(proofBinding(base)).toBe(validDecision.proof_binding);
    // swapping only the milestone_id (same revision/root/policy) changes the binding
    const other = { ...base, milestone_id: "00000000-0000-4000-8000-0000000000ff" };
    expect(proofBinding(other)).not.toBe(validDecision.proof_binding);
    // a decision carrying the OLD (unbound) binding fails schema
    expect(() => VerificationDecisionSchema.parse({ ...validDecision, milestone_id: other.milestone_id })).toThrow(/proof_binding/);
  });

  test("R10: seal() output re-parses under strict schema and re-seal is idempotent", async () => {
    const { seal, IntentContractSchema: ICS } = await import("../src/index.js");
    const sealed = seal(ICS as any, validIntent);
    expect(() => ICS.parse(sealed)).not.toThrow();
    expect(seal(ICS as any, sealed)).toEqual(sealed);
  });

  test("R11: UUIDs are lowercase hyphenated only", () => {
    expect(() => IntentContractSchema.parse({ ...validIntent, intent_id: "00000000-0000-4000-8000-0000000000AA" })).toThrow();
    expect(() => IntentContractSchema.parse({ ...validIntent, intent_id: validIntent.intent_id.replaceAll("-", "") })).toThrow();
    expect(() => IntentContractSchema.parse({ ...validIntent, intent_id: "00000000-0000-4000-8000-0000000000aa" })).not.toThrow();
  });

  test("R12: settlement single-asset + scale <= decimals; budget cap <= total", async () => {
    const { SettlementInstructionSchema } = await import("../src/index.js");
    const mixed = JSON.parse(JSON.stringify(validSettlement));
    mixed.outputs[1].asset = { network: "fiat:USD", asset: "USD", decimals: 2 };
    expect(() => SettlementInstructionSchema.parse(mixed)).toThrow(/multi-asset/);
    const overscale = JSON.parse(JSON.stringify(validSettlement));
    overscale.outputs[0].amount = "0.0000001";
    overscale.total_amount = "0.0000001";
    expect(() => SettlementInstructionSchema.parse(overscale)).toThrow(/fractional/);
    expect(() => IntentContractSchema.parse({ ...validIntent, budget: { ...validIntent.budget, execution_cap: "99999" } })).toThrow(/execution_cap/);
  });

  test("R13: profile is IPC-JSON-1; unpaired surrogates rejected", async () => {
    const { CANONICAL_PROFILE } = await import("../src/index.js");
    expect(CANONICAL_PROFILE).toBe("IPC-JSON-1");
    expect(() => canonicalize({ s: "x\udfff" })).toThrow(/surrogate/);
    expect(() => canonicalize({ "x\ud800": 1 })).toThrow(/surrogate/);
    expect(canonicalize({ s: "😀" })).toBe('{"s":"😀"}'); // paired surrogate ok
  });
});

describe("Commander remediation B1–B5 (receipt-gated trust chain)", () => {
  const validMilestone = GOLDEN.valid.find((v: any) => v.schema_version === "milestone.v1").input;
  const validReceipt = GOLDEN.valid.find((v: any) => v.schema_version === "outcome-receipt.v1").input;

  test("B1: proofBinding hashes UUIDs as 16 binary bytes (frozen byte protocol KAT)", async () => {
    const { proofBinding } = await import("../src/index.js");
    // Golden vector cross-checked against an independent Python implementation
    // (conformance-harness/vectors/proof-binding-vector.json). A UTF-8-encoded
    // UUID produces a different digest and fails here.
    expect(proofBinding({
      intent_hash: "sha256:" + "ab".repeat(32),
      milestone_id: "22222222-2222-4222-8222-222222222222",
      milestone_revision: 1,
      bundle_id: "77777777-7777-4777-8777-777777777777",
      evidence_root: "sha256:" + "cd".repeat(32),
      policy_hash: "sha256:243f03396706a0ae5b3934a5bcc1380bc9da945697e8c47049e5ffbc11715c84",
    })).toBe("sha256:e2d7869e432e3c99c9834ae3d19dc2476aa9f2e8eeacfaecf5f88a2ee592963b");
    expect(() => proofBinding({
      intent_hash: "sha256:" + "ab".repeat(32), milestone_id: "not-a-uuid",
      milestone_revision: 1, bundle_id: "77777777-7777-4777-8777-777777777777",
      evidence_root: "sha256:" + "cd".repeat(32), policy_hash: "sha256:" + "ef".repeat(32),
    })).toThrow(/UUID/);
  });

  test("B2: artifact and bundle carry a self-declared content_hash and seal round-trip", async () => {
    const { seal, EvidenceArtifactSchema, EvidenceBundleSchema } = await import("../src/index.js");
    const validArtifact = GOLDEN.valid.find((v: any) => v.schema_version === "artifact.v1").input;
    const validBundle = GOLDEN.valid.find((v: any) => v.schema_version === "bundle.v1").input;
    for (const [schema, obj] of [[EvidenceArtifactSchema, validArtifact], [EvidenceBundleSchema, validBundle]] as const) {
      const sealed = seal(schema as any, obj);
      expect(sealed.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(seal(schema as any, JSON.parse(JSON.stringify(sealed))).content_hash).toBe(sealed.content_hash);
      expect(() => seal(schema as any, { ...sealed, content_hash: "sha256:" + "ff".repeat(32) })).toThrow(/content_hash mismatch/);
    }
    // artifact's payload_hash (CAS bytes digest) is content, never the seal field
    const sealed = seal(EvidenceArtifactSchema as any, validArtifact);
    expect(sealed.payload_hash).toBe(validArtifact.payload_hash);
  });

  test("B3: SubjectRef rejects '@'", () => {
    expect(() => IntentContractSchema.parse({ ...validIntent, owner_subject: "user:alice@evil" })).toThrow();
    expect(() => IntentContractSchema.parse({ ...validIntent, owner_subject: "user:alice" })).not.toThrow();
  });

  test("B5: MilestoneV1 + OutcomeReceiptV1 on the frozen exact wire", async () => {
    const { MilestoneSchema, OutcomeReceiptSchema } = await import("../src/index.js");
    expect(() => MilestoneSchema.parse(validMilestone)).not.toThrow();
    expect(() => MilestoneSchema.parse({ ...validMilestone, criterion_ids: [] })).toThrow();
    expect(() => MilestoneSchema.parse({ ...validMilestone, criterion_ids: ["a", "a"] })).toThrow();
    expect(() => OutcomeReceiptSchema.parse(validReceipt)).not.toThrow();
    expect(() => OutcomeReceiptSchema.parse({ ...validReceipt, accepted_result: "VALID" })).toThrow();
    const desc = [...validReceipt.decision_hashes].reverse();
    expect(() => OutcomeReceiptSchema.parse({ ...validReceipt, decision_hashes: desc })).toThrow();
  });

  test("B5: settlement is receipt-gated — decision_id / proof_binding unrepresentable", async () => {
    const { SettlementInstructionSchema, settlementKey } = await import("../src/index.js");
    expect(() => SettlementInstructionSchema.parse({ ...validSettlement, decision_id: "00000000-0000-4000-8000-000000000004" })).toThrow();
    expect(() => SettlementInstructionSchema.parse({ ...validSettlement, proof_binding: "sha256:" + "99".repeat(32) })).toThrow();
    const noReceipt = { ...validSettlement };
    delete noReceipt.outcome_receipt_hash;
    expect(() => SettlementInstructionSchema.parse(noReceipt)).toThrow();
    // settlement_key binds the receipt, not a proof binding (frozen byte protocol KAT)
    expect(settlementKey({ outcome_receipt_hash: "sha256:" + "ad".repeat(32), escrow_ref: "escrow:sim-0001", nonce: 7 }))
      .toBe("sha256:718731cef25064b1c79d7356e06daadff5b27188d7b8a2747748a6bcd9615c33");
  });
});
