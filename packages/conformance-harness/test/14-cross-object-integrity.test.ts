import { describe, expect, test } from "vitest";
import { ARTIFACT_HASHES, POLICY_HASH, validBundle, validDecision, validIntent, supersededDecisionGatedSettlement } from "../src/lib/fixtures.js";
import { refProofBinding } from "../src/reference/hash.js";
import { sut, sealWith, contentHashOf } from "../src/sut.js";

const S = sut.objects;
const { merkleRoot, verifyMerkleProof, merkleProof } = sut.merkle;
const fabricated = (c: string) => `sha256:${c.repeat(32)}` as `sha256:${string}`;

/**
 * Binding-consistent decision overrides (remediation-18): the delivered SUT
 * recomputes proof_binding at parse time, so every mutated R9-bound field MUST
 * carry a recomputed binding — otherwise the GAP below would trip the binding
 * rule instead of demonstrating the dangling REFERENCE it is about.
 */
function decisionWith(fields: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...validDecision(), ...fields };
  const proof_binding = refProofBinding({
    intent_hash: merged.intent_hash as string,
    milestone_id: merged.milestone_id as string,
    milestone_revision: merged.milestone_revision as number,
    bundle_id: merged.bundle_id as string,
    evidence_root: merged.evidence_root as string,
    policy_hash: merged.policy_hash as string,
  });
  return { ...merged, ...fields, proof_binding };
}

/**
 * AREA 14 — Cross-object referential integrity.
 *
 * The schema package declares no foreign keys; the architecture doc (§15.1
 * "技术北极星") requires the chain Settlement -> Decision -> Bundle -> Run ->
 * Intent to be verifiable, but that enforcement lives in services /
 * @intent/intent-core which are NOT delivered. Each [GAP] check demonstrates
 * the dangling reference is accepted at the schema layer and records the
 * missing enforcement as UNKNOWN — never as PASS.
 */
describe("[C-14] cross-object referential integrity", () => {
  test("[C-14-01] delivered checker: merkle proof binds a bundle's artifacts to its root (tamper = detect)", () => {
    const artifacts = [ARTIFACT_HASHES.a1, ARTIFACT_HASHES.a2, ARTIFACT_HASHES.a3];
    const root = merkleRoot(artifacts);
    const proof = merkleProof(artifacts, ARTIFACT_HASHES.a2);
    expect(verifyMerkleProof(root, proof)).toBe(true);
    expect(verifyMerkleProof(fabricated("ff"), proof)).toBe(false);
  });

  test("[C-14-02][GAP] decision.intent_hash may be a fabricated hash bound to no Intent object", () => {
    // binding recomputed over the fabricated value: only the DANGLING reference is under test
    expect(() => S.VerificationDecisionSchema.parse(decisionWith({ intent_hash: fabricated("99") }))).not.toThrow();
  });

  test("[C-14-03][GAP] decision.evidence_root is not required to equal merkleRoot(bundle.artifact_hashes)", () => {
    const bundle = S.EvidenceBundleSchema.parse(validBundle({
      merkle_root: merkleRoot([ARTIFACT_HASHES.a1, ARTIFACT_HASHES.a2, ARTIFACT_HASHES.a3]),
      sealed_at: "2026-09-17T01:00:00.000Z",
    }));
    const inconsistentRoot = fabricated("77");
    const inconsistent = decisionWith({ bundle_id: bundle.bundle_id, evidence_root: inconsistentRoot });
    expect(() => S.VerificationDecisionSchema.parse(inconsistent)).not.toThrow();
    expect(inconsistent.evidence_root).not.toBe(bundle.merkle_root); // contradiction is representable
  });

  test("[C-14-04] the SUPERSEDED decision-gated wire (decision_id + proof_binding authorization) is REJECTED by the frozen receipt-gated contract — decision authority is unrepresentable on a settlement (S-GATE-AUTH)", () => {
    // remediation-18 (superseded-GAP class): the old [GAP] asserted the delivered
    // wire PERMITS a dangling decision_id — true of the pre-freeze SUT, reversed
    // against the frozen contract. Authority-boundary enforcement is asserted
    // here; the dangling-REFERENCE class stays with C-14-02/03/05 (S1-deferred).
    const s = supersededDecisionGatedSettlement({ decision_id: "deadbeef-dead-4ead-8ead-deaddeadbead", proof_binding: fabricated("88") });
    expect(() => S.SettlementInstructionSchema.parse(s)).toThrow();
  });

  test("[C-14-05][GAP] decision.milestone_id / bundle.milestone_id may dangle — no existence check in the schema layer (deferred to S1; Milestone IS delivered on the frozen wire)", () => {
    const danglingMilestone = "00000000-0000-4000-8000-000000000000";
    expect(() => S.VerificationDecisionSchema.parse(decisionWith({ milestone_id: danglingMilestone }))).not.toThrow();
    expect(() => S.EvidenceBundleSchema.parse(validBundle({
      state: "OPEN", milestone_id: danglingMilestone,
    }))).not.toThrow();
  });

  test("[C-14-06][GAP] bundle.run_ids may reference runs that do not exist (no ExecutionRun object delivered)", () => {
    expect(() => S.EvidenceBundleSchema.parse(validBundle({
      state: "OPEN", run_ids: ["00000000-0000-4000-8000-000000000000", "00000000-0000-4000-8000-000000000001"],
    }))).not.toThrow();
  });

  test("[C-14-07] intent chain integrity IS locally checkable: parent_hash of v2 must equal hash of v1", () => {
    const v1 = sealWith(S.IntentContractSchema, validIntent());
    const h1 = contentHashOf(v1);
    expect(() => S.IntentContractSchema.parse(validIntent({ version: 2, parent_hash: h1, change_reason: "amend" }))).not.toThrow();
    // lying parent still parses (no global ledger), but a verifier recomputing h1 detects the lie:
    const forged = S.IntentContractSchema.parse(validIntent({ version: 2, parent_hash: fabricated("00"), change_reason: "amend" }));
    expect(forged.parent_hash).not.toBe(h1);
  });

  test("[C-14-08][GAP] verification_policy_ref / settlement_policy_ref are content-addressed refs with no retrievable policy object in the delivered layer", () => {
    const intent = S.IntentContractSchema.parse(validIntent());
    expect(intent.verification_policy_ref.hash).toBe(POLICY_HASH);
    // Domain literals exist (verification-policy / settlement-policy) but no
    // policy object schema ships to bind the ref to actual content.
    expect(Object.keys(S).filter((k) => /Policy/i.test(k))).toEqual([]);
  });

  test.todo("[C-14-09][GAP] ContributionEdge.evidence_ref existence (§11 'edges without evidence are not recorded') — Edge object NOT delivered in the S0 snapshot");
  test.todo("[C-14-10][GAP] DisputeCase.challenged_decision existence — DisputeCase object NOT delivered in the S0 snapshot");
  test.todo("[C-14-11][GAP] ExecutionRun.grants existence/scope check — ExecutionRun/CapabilityGrant objects NOT delivered in the S0 snapshot");
});
