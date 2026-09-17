import { describe, expect, test } from "vitest";
import { ARTIFACT_HASHES, fakeHash, POLICY_HASH, validDecision, validIntent } from "../src/lib/fixtures.js";
import { sut, sealWith, contentHashOf } from "../src/sut.js";

const { IntentContractSchema, VerificationDecisionSchema, EvidenceBundleSchema } = sut.objects;
const contentHash = contentHashOf;
const { proofBinding, settlementKey } = sut.hash;

/** AREA 12 — Replay of the same bundle: binding must be revision/policy-bound and idempotent. */
describe("[C-12] replay of the same bundle", () => {
  const inputs = {
    intent_hash: fakeHash("ab"),
    milestone_revision: 1,
    evidence_root: fakeHash("cd"),
    policy_hash: POLICY_HASH,
  };

  test("[C-12-01] identical decision inputs reproduce the identical proof_binding (idempotent, 10x)", () => {
    const b0 = proofBinding(inputs);
    for (let i = 0; i < 10; i++) expect(proofBinding({ ...inputs })).toBe(b0);
  });

  test("[C-12-02] same evidence replayed at a LATER milestone revision yields a different binding (stale proof rejected)", () => {
    expect(proofBinding({ ...inputs, milestone_revision: 2 })).not.toBe(proofBinding(inputs));
  });

  test("[C-12-03] same evidence under a different policy hash yields a different binding", () => {
    expect(proofBinding({ ...inputs, policy_hash: fakeHash("0f") })).not.toBe(proofBinding(inputs));
  });

  test("[C-12-04] amended intent (version 2) hashes differently from version 1 — old proofs cannot target the new version", () => {
    const v1 = sealWith(IntentContractSchema, validIntent());
    const h1 = contentHash(v1);
    const v2 = sealWith(IntentContractSchema, validIntent({
      version: 2,
      parent_hash: h1,
      change_reason: "budget raised",
      budget: { asset: { network: "sim:local", asset: "USD", decimals: 2 }, total: "2000.00", execution_cap: "800.00" },
    }));
    expect(contentHash(v2)).not.toBe(h1);
    // and version>1 without change_reason / parent_hash is rejected
    expect(() => IntentContractSchema.parse(validIntent({ version: 2, change_reason: "x" }))).toThrow();
    expect(() => IntentContractSchema.parse(validIntent({ version: 2, parent_hash: fakeHash("ab") }))).toThrow();
  });

  test("[C-12-05] settlement double-spend key: same (binding, escrow, nonce) -> same key; retried with new nonce -> new key", () => {
    const p = { proof_binding: proofBinding(inputs), escrow_id: "escrow:sim-0001", settlement_nonce: 7n };
    const k1 = settlementKey(p);
    expect(settlementKey(p)).toBe(k1);
    expect(settlementKey({ ...p, settlement_nonce: 8n })).not.toBe(k1);
  });

  test("[C-12-06][GAP] a decision may reference a bundle that is OPEN (unsealed) — no cross-check in the schema layer", () => {
    const openBundle = EvidenceBundleSchema.parse({
      schema_version: "bundle.v1", bundle_id: "77777777-7777-4777-8777-777777777777", milestone_id: "22222222-2222-4222-8222-222222222222",
      milestone_revision: 1, run_ids: [], artifact_hashes: [], submitter: "agent:builder-a", policy_hash: POLICY_HASH, state: "OPEN",
    });
    void openBundle;
    const decision = validDecision({ bundle_id: "77777777-7777-4777-8777-777777777777" });
    expect(() => VerificationDecisionSchema.parse(decision)).not.toThrow(); // nothing binds decision to bundle state
  });

  test("[C-12-07][GAP] the same bundle_id with a DIFFERENT artifact set is representable — no uniqueness/append-only constraint in schema", () => {
    const sealed = (hashes: string[]) => EvidenceBundleSchema.parse({
      schema_version: "bundle.v1", bundle_id: "77777777-7777-4777-8777-777777777777", milestone_id: "22222222-2222-4222-8222-222222222222",
      milestone_revision: 1, run_ids: ["44444444-4444-4444-8444-444444444444"], artifact_hashes: hashes,
      merkle_root: sut.merkle.merkleRoot(hashes as `sha256:${string}`[]), submitter: "agent:builder-a",
      policy_hash: POLICY_HASH, sealed_at: "2026-09-17T01:00:00.000Z", state: "SEALED",
    });
    const b1 = sealed([ARTIFACT_HASHES.a1, ARTIFACT_HASHES.a2]);
    const b2 = sealed([ARTIFACT_HASHES.a3]);
    expect(b1.bundle_id).toBe(b2.bundle_id);
    expect(b1.merkle_root).not.toBe(b2.merkle_root);
  });
});
