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
