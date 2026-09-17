import { describe, expect, test } from "vitest";
import { fakeHash, POLICY_HASH, validIntent, validSettlement } from "../src/lib/fixtures.js";
import { sut, sealWith } from "../src/sut.js";

const { IntentContractSchema, SettlementInstructionSchema } = sut.objects;
const { canonicalize } = sut.canonical;

/**
 * SPEC ASSERTIONS (Commander rulings R9–R14 + OQ dispositions, 2026-09-17/18).
 *
 * These are NOT gap-documentation checks. Each one asserts a normative rule
 * that the NEXT gate SUT must satisfy. Against the current (superseded)
 * snapshot most of them FAIL — that is the point: at the formal gate run,
 * a missing rule must surface as FAIL, never as UNKNOWN waiting for an
 * explanation.
 *
 *   [S-R9]    proof_binding must bind milestone_id (ruling R9)
 *   [S-RT]    a sealed object must round-trip JSON text and stay seal-valid
 *   [S-UUID]  UUIDs must be canonical (lowercase v4)
 *   [S-ASSET] one SettlementInstruction carries exactly one asset
 *   [S-SCALE] output amount scale must not exceed asset.decimals
 *   [S-BUDGET] budget execution_cap must not exceed total
 *   [S-SURR]  lone surrogates must be rejected by canonical form (IPC-JSON-1)
 *   [S-SUBJ]  SubjectRef must reject '@' (ruling OQ-5)
 */
describe("[SPEC] R9–R14 normative assertions", () => {
  test("[S-R9] proof binding MUST separate different milestone_ids (all other inputs equal)", () => {
    // Per R9, the binding consumed by a decision must change when the proof
    // TARGET changes. The call passes milestone_id through to the SUT's
    // binding API; a compliant implementation must incorporate it. The
    // current snapshot's proofBinding ignores the extra field entirely, so
    // both milestones receive one binding -> FAIL (by design, until R9 lands).
    const bind = (over: Record<string, unknown>) =>
      (sut.hash.proofBinding as (p: unknown) => string)({
        intent_hash: fakeHash("ab"),
        milestone_revision: 1,
        evidence_root: fakeHash("cd"),
        policy_hash: POLICY_HASH,
        ...over,
      });
    const m1 = "aaaaaaaa-0000-4000-8000-000000000001";
    const m2 = "aaaaaaaa-0000-4000-8000-000000000002";
    const b1 = bind({ milestone_id: m1 });
    const b2 = bind({ milestone_id: m2 });
    expect(b1).not.toBe(b2);
  });

  test("[S-RT] a sealed Intent round-trips JSON text and stays seal-valid", () => {
    const sealed = sealWith(IntentContractSchema, validIntent());
    const text = JSON.stringify(sealed);
    const back = JSON.parse(text);
    const resealed = sealWith(IntentContractSchema, back); // throws if declared hash mismatches after round-trip
    expect(resealed.content_hash).toBe(sealed.content_hash);
    expect(canonicalize(back)).toBe(canonicalize(sealed));
  });

  test("[S-UUID] non-canonical UUIDs (v1-shaped, uppercase) MUST be rejected", () => {
    expect(() => IntentContractSchema.parse(validIntent({ intent_id: "11111111-1111-1111-1111-111111111111" }))).toThrow();
    expect(() => IntentContractSchema.parse(validIntent({ intent_id: "11111111-1111-4111-8111-111111111111".toUpperCase() }))).toThrow();
  });

  test("[S-ASSET] a SettlementInstruction MUST NOT mix multiple assets across outputs", () => {
    const usd = { network: "sim:local", asset: "USD", decimals: 2 };
    const eur = { network: "sim:local", asset: "EUR", decimals: 2 };
    const mixed = validSettlement({
      outputs: [
        { recipient: "agent:builder-a", asset: usd, amount: "150.00", reason: "split" },
        { recipient: "user:alice", asset: eur, amount: "150.00", reason: "split" },
      ],
    });
    expect(() => SettlementInstructionSchema.parse(mixed)).toThrow();
  });

  test("[S-SCALE] output amount scale MUST NOT exceed asset.decimals", () => {
    const usd2 = { network: "sim:local", asset: "USD", decimals: 2 };
    const tooPrecise = validSettlement({
      outputs: [{ recipient: "agent:builder-a", asset: usd2, amount: "150.000", reason: "over-precision" }],
    });
    expect(() => SettlementInstructionSchema.parse(tooPrecise)).toThrow();
  });

  test("[S-BUDGET] execution_cap MUST NOT exceed budget total", () => {
    const inverted = validIntent({
      budget: { asset: { network: "sim:local", asset: "USD", decimals: 2 }, total: "1000.00", execution_cap: "5000.00" },
    });
    expect(() => IntentContractSchema.parse(inverted)).toThrow();
  });

  test("[S-SURR] lone surrogates MUST be rejected by the canonical form (IPC-JSON-1)", () => {
    expect(() => canonicalize({ s: "x\uDFFFy" })).toThrow();
    expect(() => canonicalize({ s: "x\uD800y" })).toThrow();
  });

  test("[S-SUBJ] SubjectRef MUST reject '@' (ruling OQ-5)", () => {
    expect(() => IntentContractSchema.parse(validIntent({ owner_subject: "user:alice@evil" }))).toThrow();
  });
});
