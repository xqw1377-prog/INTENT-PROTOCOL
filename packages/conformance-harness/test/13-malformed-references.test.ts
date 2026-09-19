import { describe, expect, test } from "vitest";
import { validDecision, validIntent, validReceiptSettlement } from "../src/lib/fixtures.js";
import { sut } from "../src/sut.js";

const S = sut.objects;
const goodHash = "sha256:" + "ab".repeat(32);

/** AREA 13 — Malformed artifact/primitive references must be rejected. */
describe("[C-13] malformed references", () => {
  test.each([
    ["uppercase hex", `sha256:${"AB".repeat(32)}`],
    ["63 chars", `sha256:${"a".repeat(63)}`],
    ["65 chars", `sha256:${"a".repeat(65)}`],
    ["no prefix", "a".repeat(64)],
    ["0x prefix", `0x${"ab".repeat(32)}`],
    ["sha384", `sha384:${"a".repeat(96)}`],
    ["empty", ""],
    ["trailing newline", `${goodHash}\n`],
    ["internal spaces", `sha256:${"a".repeat(32)} ${"b".repeat(32)}`],
  ])("[C-13-01] hash field rejects malformed value: %s", (_label, bad) => {
    expect(() => S.IntentContractSchema.parse(validIntent({ verification_policy_ref: { uri: "ipfs://x", hash: bad } }))).toThrow();
    expect(sut.hash.isHash(bad)).toBe(false);
  });

  test.each([
    ["no colon", "useralice"],
    ["empty id", "user:"],
    ["unknown kind", "wallet:0xabc123"],
    ["id too long (129)", `user:${"a".repeat(129)}`],
    ["space in id", "user:alice smith"],
    ["slash in id", "user:alice/evil"],
    ["colon-injection", "user:alice:admin"],
  ])("[C-13-02] SubjectRef rejects: %s", (_label, bad) => {
    expect(() => S.IntentContractSchema.parse(validIntent({ owner_subject: bad }))).toThrow();
  });


  test("[C-13-02b] SubjectRef accepts boundary id length 128 and all documented kinds", () => {
    expect(() => S.IntentContractSchema.parse(validIntent({ owner_subject: `user:${"a".repeat(128)}` }))).not.toThrow();
    for (const kind of ["user", "org", "agent", "verifier", "arbitrator", "service", "operator"]) {
      expect(() => S.IntentContractSchema.parse(validIntent({ owner_subject: `${kind}:x` }))).not.toThrow();
    }
  });

  test("[C-13-03] HashRef rejects empty uri and malformed hash", () => {
    expect(() => S.IntentContractSchema.parse(validIntent({ verification_policy_ref: { uri: "", hash: goodHash } }))).toThrow();
    expect(() => S.IntentContractSchema.parse(validIntent({ verification_policy_ref: { uri: "ipfs://x", hash: "nope" } }))).toThrow();
  });

  test.each([
    ["no milliseconds", "2026-09-17T00:00:00Z"],
    ["offset timezone", "2026-09-17T00:00:00.000+00:00"],
    ["lowercase z", "2026-09-17T00:00:00.000z"],
    ["date only", "2026-09-17"],
    ["space separator", "2026-09-17 00:00:00.000Z"],
  ])("[C-13-04] Timestamp rejects: %s", (_label, bad) => {
    expect(() => S.IntentContractSchema.parse(validIntent({ created_at: bad }))).toThrow();
  });

  test("[C-13-05] FAIL: Timestamp regex accepts calendrically impossible RFC 3339 strings (month 13, day 45, hour 99)", () => {
    // TimestampSchema claims "RFC 3339 UTC timestamp with millisecond
    // precision" but only checks the digit shape, not the calendar.
    for (const bad of ["2026-13-01T00:00:00.000Z", "2026-09-45T00:00:00.000Z", "2026-09-17T99:99:99.999Z"]) {
      expect(() => S.IntentContractSchema.parse(validIntent({ created_at: bad })), bad).toThrow();
    }
  });

  test.each([
    ["exponent", "1.5e3"],
    ["leading zero", "01.5"],
    ["bare dot", ".5"],
    ["trailing dot", "1."],
    ["explicit plus", "+1"],
    ["empty", ""],
    ["thousands separator", "1 000"],
    ["NaN", "NaN"],
    ["comma decimal", "1,5"],
  ])("[C-13-06] Decimal rejects: %s", (_label, bad) => {
    expect(() => S.IntentContractSchema.parse(validIntent({ budget: { asset: { network: "sim:local", asset: "USD", decimals: 2 }, total: bad, execution_cap: "1" } }))).toThrow();
  });

  test.each([
    ["negative", "-1"],
    ["exponent", "1e3"],
    ["hex", "0x10"],
    ["empty", ""],
    ["leading space", " 7"],
    ["explicit plus", "+7"],
  ])("[C-13-07] U64-as-string rejects: %s", (_label, bad) => {
    expect(() => S.SettlementInstructionSchema.parse(validReceiptSettlement({ nonce: bad }))).toThrow();
  });

  test("[C-13-07b] FAIL: U64-as-string regex has no upper bound — 2^64 is accepted by the schema but rejected by u64be() at hashing time", () => {
    expect(() => S.SettlementInstructionSchema.parse(validReceiptSettlement({ nonce: "0" }))).not.toThrow();
    expect(() => S.SettlementInstructionSchema.parse(validReceiptSettlement({ nonce: "18446744073709551615" }))).not.toThrow();
    // 2^64 is out of u64 range; the documented U64Schema ("u64 as decimal
    // string") should reject it, but the regex accepts any digit string, so a
    // schema-valid settlement exists that can never be canonicalized/hashed.
    expect(() => S.SettlementInstructionSchema.parse(validReceiptSettlement({ nonce: "18446744073709551616" }))).toThrow();
  });

  test.each([
    ["negative", -1],
    ["float", 1.5],
    ["u32 overflow", 2 ** 32],
    ["NaN", NaN],
  ])("[C-13-08] U32 number rejects: %s", (_label, bad) => {
    expect(() => S.IntentContractSchema.parse(validIntent({ version: bad }))).toThrow();
  });

  test.each([
    ["not a uuid", "not-a-uuid"],
    ["braced", "{11111111-1111-4111-8111-111111111111}"],
    ["empty", ""],
    ["g hex digit", "g1111111-1111-4111-8111-111111111111"],
  ])("[C-13-09] UUID rejects: %s", (_label, bad) => {
    expect(() => S.IntentContractSchema.parse(validIntent({ intent_id: bad }))).toThrow();
  });


  test("[C-13-10] decision/bundle malformed cross-fields: non-uuid bundle_id, bad evidence_root, negative revision", () => {
    expect(() => S.VerificationDecisionSchema.parse(validDecision({ bundle_id: "not-a-uuid" }))).toThrow();
    expect(() => S.VerificationDecisionSchema.parse(validDecision({ evidence_root: "sha256:short" }))).toThrow();
    expect(() => S.VerificationDecisionSchema.parse(validDecision({ milestone_revision: 0 }))).toThrow();
    expect(() => S.VerificationDecisionSchema.parse(validDecision({ milestone_revision: -1 }))).toThrow();
    expect(() => S.VerificationDecisionSchema.parse(validDecision({ result: "MAYBE" }))).toThrow();
  });

  test("[C-13-11] escrow_ref and decision reason_codes entries must be non-empty; settlement needs >=1 output", () => {
    expect(() => S.SettlementInstructionSchema.parse(validReceiptSettlement({ escrow_ref: "" }))).toThrow();
    expect(() => S.VerificationDecisionSchema.parse(validDecision({ reason_codes: [""] }))).toThrow();
    expect(() => S.SettlementInstructionSchema.parse(validReceiptSettlement({ outputs: [] }))).toThrow();
  });

  test.todo("[C-13-12][GAP] ExecutionRun output_manifest / CapabilityGrant / ContributionEdge NodeRef / DisputeCase reference validation (objects NOT delivered in the S0 snapshot)");
});
