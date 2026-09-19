import { describe, expect, test } from "vitest";
import { ARTIFACT_HASHES, fakeHash, POLICY_HASH, validArtifact, validBundle, validDecision, validIntent, validReceiptSettlement } from "../src/lib/fixtures.js";
import { refProofBinding } from "../src/reference/hash.js";
import r9Vector from "../vectors/proof-binding-vector.json";

const R9_CASE = {
  intent_hash: fakeHash("ab"),
  milestone_id: "22222222-2222-4222-8222-222222222222",
  bundle_id: "77777777-7777-4777-8777-777777777777",
  milestone_revision: 1,
  evidence_root: fakeHash("cd"),
  policy_hash: POLICY_HASH,
} as const;
import { sut, sealWith } from "../src/sut.js";

const { IntentContractSchema, EvidenceArtifactSchema, EvidenceBundleSchema, VerificationDecisionSchema, SettlementInstructionSchema } = sut.objects;
const { canonicalize } = sut.canonical;
const { merkleRoot } = sut.merkle;

/**
 * SPEC ASSERTIONS (Commander rulings R9–R14 + OQ dispositions, round 5
 * closeout). Normative, never UNKNOWN: a missing ruled behavior FAILs.
 *
 * Anti-false-positive discipline (Commander blocking comment, PR #3):
 * every "must throw" assertion uses inputs that are LEGAL under Decimal V1
 * minimal form (no trailing zeros) and legal under every OTHER rule, so a
 * throw can only come from the rule under test; every rule also has a
 * matched control case that must parse successfully.
 *
 *   [S-R9]     binding must separate milestone_id AND bundle_id
 *   [S-RT-1..5] all five first-class hashable objects: seal -> JSON text
 *              round-trip -> re-seal idempotence + wrong-hash rejection
 *   [S-UUID]   canonical UUID = lowercase hyphenated text (version-agnostic)
 *   [S-ASSET]  one SettlementInstruction = one asset
 *   [S-SCALE]  amount scale <= asset.decimals
 *   [S-BUDGET] execution_cap <= total
 *   [S-SURR]   lone surrogates rejected by IPC-JSON-1
 *   [S-KEYNFC] object keys must already be NFC (rejected otherwise)
 *   [S-SUBJ]   SubjectRef rejects '@'
 *   [S-UNIQ]   criterion_id / constraint_id unique within their object
 *   [S-MERKLE] SEALED bundle's merkle_root must be the recomputed root
 *   [S-DEC]    canonical Decimal V1 minimal form only
 *   [S-SUM]    total_amount == sum(outputs.amount)
 */
describe("[SPEC] R9–R14 normative assertions", () => {

  const usd2 = { network: "sim:local", asset: "USD", decimals: 2 } as const;
  const usd1 = { network: "sim:local", asset: "USD", decimals: 1 } as const;
  const eur2 = { network: "sim:local", asset: "EUR", decimals: 2 } as const;

  // ------------------------------------------------------------------ R9
  test("[S-R9] R9 EXACT BYTE PROTOCOL: oracle === golden vector; SUT === oracle; separation on milestone_id AND bundle_id", () => {
    // The frozen formula (domain-separated, UUIDs as 16 binary bytes,
    // exact field order) — sensitivity alone is NOT sufficient: a wrong but
    // input-sensitive hash must still fail here.
    const golden = r9Vector.expected;
    // guard: the golden vector case must be exactly the fixture-derived inputs
    expect(R9_CASE, "golden vector case drift").toEqual(r9Vector.case);
    // (1) the independent TS oracle reproduces the third-party-computed golden digest
    expect(refProofBinding(R9_CASE), "oracle vs golden KAT").toBe(golden);
    // (2/3) the oracle separates both proof targets
    expect(refProofBinding({ ...R9_CASE, milestone_id: "aaaaaaaa-0000-4000-8000-000000000002" }), "milestone_id sensitivity").not.toBe(golden);
    expect(refProofBinding({ ...R9_CASE, bundle_id: "bbbbbbbb-0000-4000-8000-000000000002" }), "bundle_id sensitivity").not.toBe(golden);
    // (4) the SUT must implement the SAME frozen byte protocol
    const sutBinding = (sut.hash.proofBinding as (p: unknown) => string)(R9_CASE);
    expect(sutBinding, "SUT must equal the frozen-formula oracle").toBe(golden);
    expect((sut.hash.proofBinding as (p: unknown) => string)({ ...R9_CASE, milestone_id: "aaaaaaaa-0000-4000-8000-000000000002" })).not.toBe(sutBinding);
    expect((sut.hash.proofBinding as (p: unknown) => string)({ ...R9_CASE, bundle_id: "bbbbbbbb-0000-4000-8000-000000000002" })).not.toBe(sutBinding);
  });

  // ------------------------------------------------------------------ R10
  // validBundle() is now legal-by-default under the frozen spec (correct
  // merkle_root + sealed_at + minimal-form fields).

  test.each([
    ["IntentContract", () => validIntent(), IntentContractSchema],
    ["EvidenceArtifact", () => validArtifact(), EvidenceArtifactSchema],
    ["EvidenceBundle", () => validBundle(), EvidenceBundleSchema],
    ["VerificationDecision", () => validDecision(), VerificationDecisionSchema],
    ["SettlementInstruction", () => validReceiptSettlement(), SettlementInstructionSchema],
  ])("[S-RT] %s: seal -> JSON text round-trip -> re-seal idempotent; wrong declared hash rejected", (_name, fixture, schema) => {
    const sealed1 = sealWith(schema as never, fixture());
    const back = JSON.parse(JSON.stringify(sealed1));
    const sealed2 = sealWith(schema as never, back); // throws if round-trip breaks seal validity
    expect(sealed2.content_hash).toBe(sealed1.content_hash); // idempotent
    expect(canonicalize(back)).toBe(canonicalize(JSON.parse(JSON.stringify(sealed1))));
    expect(() => sealWith(schema as never, { ...back, content_hash: fakeHash("ff") })).toThrow(); // wrong declared hash rejected
  });

  // ------------------------------------------------------------------ UUID
  test("[S-UUID] UUID canonical form = lowercase hyphenated text; version-agnostic; uppercase rejected", () => {
    // v1-shaped lowercase IS canonical (ruling does not pin a version)
    expect(() => IntentContractSchema.parse(validIntent({ intent_id: "11111111-1111-1111-1111-111111111111" }))).not.toThrow();
    expect(() => IntentContractSchema.parse(validIntent({ intent_id: "11111111-1111-4111-8111-111111111111" }))).not.toThrow(); // control
    expect(() => IntentContractSchema.parse(validIntent({ intent_id: "11111111-1111-4111-8111-111111111111".toUpperCase() }))).toThrow();
  });

  // ------------------------------------------------------------------ assets
  test("[S-ASSET] one SettlementInstruction MUST carry exactly one asset (inputs otherwise legal)", () => {
    const mixed = validReceiptSettlement({
      outputs: [
        { recipient: "agent:builder-a", asset: usd2, amount: "150", reason: "split" },
        { recipient: "user:alice", asset: eur2, amount: "150", reason: "split" },
      ],
    });
    const control = validReceiptSettlement({
      outputs: [
        { recipient: "agent:builder-a", asset: usd2, amount: "150", reason: "split" },
        { recipient: "user:alice", asset: usd2, amount: "150", reason: "split" },
      ],
    });
    expect(() => SettlementInstructionSchema.parse(control)).not.toThrow(); // proves inputs are legal otherwise
    expect(() => SettlementInstructionSchema.parse(mixed)).toThrow(); // can only fail on the asset-mixing rule
  });

  test("[S-SCALE] amount scale MUST NOT exceed asset.decimals (decimal text itself legal)", () => {
    const control = validReceiptSettlement({
      outputs: [{ recipient: "agent:builder-a", asset: usd1, amount: "15.5", reason: "scale ok" }], // scale 1 == decimals 1
      total_amount: "15.5", // sum-consistent: S-SUM cannot fire here
    });
    const overPrecise = validReceiptSettlement({
      outputs: [{ recipient: "agent:builder-a", asset: usd1, amount: "15.55", reason: "scale exceeds" }], // minimal-form legal decimal, scale 2 > 1
      total_amount: "15.55", // sum-consistent: S-SUM cannot fire here
    });
    expect(() => SettlementInstructionSchema.parse(control)).not.toThrow();
    expect(() => SettlementInstructionSchema.parse(overPrecise)).toThrow(); // can only fail on the scale rule
  });

  // ------------------------------------------------------------------ budget
  test("[S-BUDGET] execution_cap MUST NOT exceed budget total (both minimal-form decimals)", () => {
    const control = validIntent({
      budget: { asset: usd2, total: "1000", execution_cap: "500" },
    });
    const inverted = validIntent({
      budget: { asset: usd2, total: "1000", execution_cap: "5000" },
    });
    expect(() => IntentContractSchema.parse(control)).not.toThrow();
    expect(() => IntentContractSchema.parse(inverted)).toThrow(); // can only fail on cap<=total
  });

  // ------------------------------------------------------------------ canonical text
  test("[S-SURR] lone surrogates MUST be rejected by the canonical form (IPC-JSON-1)", () => {
    expect(() => canonicalize({ s: "x\uDFFFy" })).toThrow();
    expect(() => canonicalize({ s: "x\uD800y" })).toThrow();
  });

  test("[S-KEYNFC] object keys MUST already be NFC — non-NFC keys are rejected, never silently normalized (IPC-JSON-1 R3)", () => {
    const nfcKey: Record<string, number> = {};
    nfcKey["\u00e9"] = 1;
    const nfdKey: Record<string, number> = {};
    nfdKey["e\u0301"] = 1;
    expect(() => canonicalize(nfcKey)).not.toThrow(); // control
    expect(() => canonicalize(nfdKey)).toThrow(); // must be rejected, not normalized away
  });

  test("[S-SUBJ] SubjectRef MUST reject '@' (ruling OQ-5)", () => {
    expect(() => IntentContractSchema.parse(validIntent({ owner_subject: "user:alice" }))).not.toThrow(); // control
    expect(() => IntentContractSchema.parse(validIntent({ owner_subject: "user:alice@evil" }))).toThrow();
  });

  // ------------------------------------------------------------------ uniqueness / merkle / decimal / sum
  test("[S-UNIQ] criterion_id and constraint_id MUST be unique within the Intent", () => {
    const intent = validIntent() as { success_criteria: Array<Record<string, unknown>>; constraints: Array<Record<string, unknown>> };
    const dupCriterion = validIntent({
      success_criteria: [...intent.success_criteria, { ...intent.success_criteria[0]!, assertion: "same id, different content" }],
    });
    const dupConstraint = validIntent({
      constraints: [...intent.constraints, { ...intent.constraints[0]!, statement: "same id, different content" }],
    });
    expect(() => IntentContractSchema.parse(validIntent())).not.toThrow(); // control
    expect(() => IntentContractSchema.parse(dupCriterion)).toThrow();
    expect(() => IntentContractSchema.parse(dupConstraint)).toThrow();
  });

  test("[S-MERKLE] a SEALED bundle whose merkle_root is not the recomputed root MUST be rejected", () => {
    const correct = validBundle({
      merkle_root: merkleRoot([ARTIFACT_HASHES.a1, ARTIFACT_HASHES.a2, ARTIFACT_HASHES.a3]),
      sealed_at: "2026-09-17T01:00:00.000Z",
    });
    const lying = validBundle({
      merkle_root: fakeHash("ee"),
      sealed_at: "2026-09-17T01:00:00.000Z",
    });
    expect(() => EvidenceBundleSchema.parse(correct)).not.toThrow(); // control
    expect(() => EvidenceBundleSchema.parse(lying)).toThrow(); // can only fail on root verification
  });

  test("[S-DEC] amounts MUST be canonical Decimal V1 minimal form (no trailing zeros, no negative zero)", () => {
    const at = (amount: string) => SettlementInstructionSchema.parse(validReceiptSettlement({
      outputs: [{ recipient: "agent:builder-a", asset: usd2, amount, reason: "decimal probe" }],
      total_amount: amount, // sum-consistent: S-SUM cannot fire here
    }));
    expect(() => at("150")).not.toThrow();  // canonical integer form
    expect(() => at("15.5")).not.toThrow(); // canonical fractional form
    for (const nonCanonical of ["1.10", "0.00", "-0", "150.0"]) {
      expect(() => at(nonCanonical), `${nonCanonical} must be rejected as non-canonical`).toThrow();
    }
  });

  test("[S-SUM] total_amount MUST equal the exact sum of outputs.amount", () => {
    const outputs = [
      { recipient: "agent:builder-a", asset: usd2, amount: "150", reason: "split" },
      { recipient: "user:alice", asset: usd2, amount: "50.5", reason: "split" },
    ];
    const control = validReceiptSettlement({ outputs, total_amount: "200.5" });
    const mismatch = validReceiptSettlement({ outputs, total_amount: "299" });
    expect(() => SettlementInstructionSchema.parse(control)).not.toThrow();
    expect(() => SettlementInstructionSchema.parse(mismatch)).toThrow(); // can only fail on the sum invariant
  });
});
