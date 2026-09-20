import { describe, expect, test } from "vitest";
import { validArtifact, validBundle, validDecision, validIntent, validReceiptSettlement } from "../src/lib/fixtures.js";
import { sut } from "../src/sut.js";

const S = sut.objects;

/** AREA 8 — Unknown fields and unsupported versions must be rejected (strict schemas). */
describe("[C-08] unknown fields / unsupported version", () => {
  const objects: Array<[string, Record<string, unknown>]> = [
    ["IntentContract", validIntent()],
    ["EvidenceArtifact", validArtifact()],
    ["EvidenceBundle", validBundle()], // carries the CORRECT recomputed merkle_root (remediation-18: a fabricated root is no legal positive control under the SEALED merkle rule)
    ["VerificationDecision", validDecision()],
    ["SettlementInstruction", validReceiptSettlement()],
    ["Criterion", (validIntent() as { success_criteria: Array<Record<string, unknown>> }).success_criteria[0]!],
  ];

  const schemaByName: Record<string, (input: unknown) => unknown> = {
    IntentContract: (x) => S.IntentContractSchema.parse(x),
    EvidenceArtifact: (x) => S.EvidenceArtifactSchema.parse(x),
    EvidenceBundle: (x) => S.EvidenceBundleSchema.parse(x),
    VerificationDecision: (x) => S.VerificationDecisionSchema.parse(x),
    SettlementInstruction: (x) => S.SettlementInstructionSchema.parse(x),
    Criterion: (x) => S.CriterionSchema.parse(x),
  };

  test.each(objects)("[C-08-01] %s rejects an unknown top-level field", (name, fixture) => {
    expect(() => schemaByName[name]!(fixture)).not.toThrow(); // control: valid
    expect(() => schemaByName[name]!({ ...fixture, tenant_id: "evil" })).toThrow();
  });

  test("[C-08-02] nested unknown fields are rejected (goal/criterion/budget/output/signature/evidence-rule/hashref)", () => {
    const goal = validIntent().goal as Record<string, unknown>;
    expect(() => S.IntentContractSchema.parse(validIntent({ goal: { ...goal, extra: 1 } }))).toThrow();
    const criteria = JSON.parse(JSON.stringify((validIntent() as { success_criteria: Array<Record<string, unknown>> }).success_criteria));
    criteria[0].sneaky = true;
    expect(() => S.IntentContractSchema.parse(validIntent({ success_criteria: criteria }))).toThrow();
    criteria[0].sneaky = undefined; // restore
    criteria[0].evidence_requirements[0].extra = 1;
    expect(() => S.IntentContractSchema.parse(validIntent({ success_criteria: criteria }))).toThrow();
    expect(() => S.IntentContractSchema.parse(validIntent({ budget: { asset: { network: "sim:local", asset: "USD", decimals: 2, note: "x" }, total: "1", execution_cap: "1" } }))).toThrow();
    expect(() => S.SettlementInstructionSchema.parse(validReceiptSettlement({
      outputs: [{ recipient: "agent:builder-a", asset: { network: "sim:local", asset: "USD", decimals: 2 }, amount: "1", reason: "r", memo: "x" }],
      total_amount: "1", // remediation-18: keep the input sum-consistent so the ONLY violation is the unknown `memo` field
    }))).toThrow();
    expect(() => S.IntentContractSchema.parse(validIntent({
      signature: { scheme: "ed25519", signer: "user:alice", key_id: "k1", value: "sig", vendor: "x" },
    }))).toThrow();
    expect(() => S.IntentContractSchema.parse(validIntent({ verification_policy_ref: { uri: "ipfs://x", hash: "sha256:" + "ab".repeat(32), tag: "latest" } }))).toThrow();
  });

  test("[C-08-03] unsupported schema_version literals are rejected for every delivered object kind", () => {
    const cases: Array<(input: unknown) => unknown> = [
      (x) => S.IntentContractSchema.parse(x),
      (x) => S.EvidenceArtifactSchema.parse(x),
      (x) => S.EvidenceBundleSchema.parse(x),
      (x) => S.VerificationDecisionSchema.parse(x),
      (x) => S.SettlementInstructionSchema.parse(x),
      (x) => S.CriterionSchema.parse(x),
    ];
    const fixtures = [
      validIntent(),
      validArtifact(),
      validBundle({ state: "OPEN" }),
      validDecision(),
      validReceiptSettlement(),
      (validIntent() as { success_criteria: Array<Record<string, unknown>> }).success_criteria[0]!,
    ];
    cases.forEach((parse, i) => {
      expect(() => parse(fixtures[i])).not.toThrow(); // control: valid literal
      expect(() => parse({ ...fixtures[i]!, schema_version: "future.v9" })).toThrow();
      expect(() => parse({ ...fixtures[i]!, schema_version: fixtures[i]!.schema_version === "intent.v1" ? "intent.v2" : `${String(fixtures[i]!.schema_version).split(".")[0]}.v2` })).toThrow();
    });
    // shape/typing mutations
    for (const bad of ["INTENT.V1", "intent.v1 ", " intent.v1", 1, null]) {
      expect(() => S.IntentContractSchema.parse(validIntent({ schema_version: bad })), `schema_version=${JSON.stringify(bad)}`).toThrow();
    }
  });

  test("[C-08-04] missing schema_version is rejected", () => {
    const noVersion = validIntent();
    delete (noVersion as Record<string, unknown>).schema_version;
    expect(() => S.IntentContractSchema.parse(noVersion)).toThrow();
  });

  test("[C-08-05][GAP] Criterion.threshold is open-ended JSON: arbitrary nested unknown semantics are accepted by design", () => {
    const criteria = JSON.parse(JSON.stringify((validIntent() as { success_criteria: Array<Record<string, unknown>> }).success_criteria));
    criteria[0].threshold = { nested: { very: { deep: ["arbitrary", { junk: true }] } } };
    expect(() => S.IntentContractSchema.parse(validIntent({ success_criteria: criteria }))).not.toThrow();
  });

  test.todo("[C-08-06][GAP] unknown-field strictness for Milestone/Plan/ExecutionRun/CapabilityGrant/ContributionEdge/DisputeCase (objects documented in arch doc §6 but NOT delivered in the S0 snapshot)");
});
