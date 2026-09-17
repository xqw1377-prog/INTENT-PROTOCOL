/**
 * Shared builders for golden vectors and tests. All values are fixed so that
 * generated digests are stable across runs and machines (G0 evidence).
 */
import {
  Domain, hashObject, hashBytes, merkleRoot, proofBinding,
} from "../dist/index.js";

const T = "2026-09-17T00:00:00.000Z";
/** Deterministic fake hash for reference fields: sha256:<hex of n, zero-padded to 64>. */
export const H = (n) => "sha256:" + n.toString(16).padStart(64, "0");
export const U = (s) => `00000000-0000-4000-8000-${s.padStart(12, "0")}`;

export const POLICY_REF = { uri: "policy://software-delivery/v1", hash: H(0xa0) };
export const SETTLEMENT_REF = { uri: "policy://milestone-escrow/v1", hash: H(0xa1) };
export const ASSET = { network: "evm:8453", asset: "0xUSDC", decimals: 6 };

export function criterion(id = "crit-tests", assertion = "required test suite passes 30/30 after target commit") {
  return {
    schema_version: "criterion.v1",
    criterion_id: id,
    kind: "MACHINE",
    assertion,
    verifier_ref: "verifier:ci-verifier@1",
    evidence_requirements: [{ kind: "ci-run", min_level: "E2", source: "github-actions", required: true }],
    threshold: { passed: 30, total: 30 },
  };
}

export function intent(overrides = {}) {
  return {
    schema_version: "intent.v1",
    intent_id: U("1"),
    version: 1,
    owner_subject: "user:alice",
    goal: {
      statement: "Launch a restaurant menu diagnosis agent",
      target_state: "30 real merchants onboarded with diagnosis reports",
      domain: "software-delivery",
    },
    success_criteria: [criterion()],
    constraints: [
      { constraint_id: "c1", kind: "FORBIDDEN_ACTION", statement: "never touch merchant payment keys" },
    ],
    budget: { asset: ASSET, total: "20000.00", execution_cap: "2000.00" },
    deadline: "2026-10-17T00:00:00.000Z",
    verification_policy_ref: POLICY_REF,
    settlement_policy_ref: SETTLEMENT_REF,
    created_at: T,
    ...overrides,
  };
}

export function artifact(id, subject, contentHash) {
  return {
    schema_version: "artifact.v1",
    artifact_id: U(id),
    kind: "ci-run-log",
    level: "E2",
    source: "ci:github-actions",
    subject,
    captured_at: T,
    payload_hash: contentHash,
    locator: "cas://sha256/" + contentHash.slice(7, 20),
    privacy_class: "INTERNAL",
  };
}

export const ARTIFACT_HASHES = [H(0xb1), H(0xb2), H(0xb3)];

export function bundle(overrides = {}) {
  return {
    schema_version: "bundle.v1",
    bundle_id: U("3"),
    milestone_id: U("2"),
    milestone_revision: 1,
    run_ids: [U("9")],
    artifact_hashes: [...ARTIFACT_HASHES],
    merkle_root: merkleRoot(ARTIFACT_HASHES),
    submitter: "agent:executor_01",
    policy_hash: POLICY_REF.hash,
    sealed_at: T,
    state: "SEALED",
    ...overrides,
  };
}

export function intentHashOf(o = intent()) {
  return hashObject(Domain.Intent, o.schema_version, o);
}

export function decision(overrides = {}) {
  const ih = intentHashOf();
  const b = bundle();
  return {
    schema_version: "decision.v1",
    decision_id: U("4"),
    verifier_id: "verifier:ci-verifier@1",
    verifier_digest: H(0xc0),
    intent_hash: ih,
    milestone_id: U("2"),
    milestone_revision: 1,
    bundle_id: U("3"),
    evidence_root: b.merkle_root,
    policy_hash: POLICY_REF.hash,
    proof_binding: proofBinding({ intent_hash: ih, milestone_revision: 1, evidence_root: b.merkle_root, policy_hash: POLICY_REF.hash }),
    result: "VALID",
    reason_codes: ["TESTS_PASS", "DEPLOY_REACHABLE"],
    replay_digest: hashBytes(new TextEncoder().encode("replay-trace-v1")),
    decided_at: T,
    ...overrides,
  };
}

export function settlement(overrides = {}) {
  const d = decision();
  return {
    schema_version: "settlement.v1",
    settlement_id: U("5"),
    escrow_ref: "escrow:0xabc123",
    milestone_id: U("2"),
    decision_id: U("4"),
    proof_binding: d.proof_binding,
    nonce: "0",
    outputs: [
      { recipient: "agent:executor_01", asset: ASSET, amount: "1500.00", reason: "milestone-1 completion" },
      { recipient: "org:platform", asset: ASSET, amount: "150.00", reason: "settlement fee 10%" },
    ],
    total_amount: "1650.00",
    expires_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}
