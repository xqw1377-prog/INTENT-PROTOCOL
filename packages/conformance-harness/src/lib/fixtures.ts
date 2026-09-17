/**
 * Black-box fixtures: complete, schema-valid protocol objects used as the
 * substrate for mutation attacks. All identifiers/timestamps are fixed
 * constants so vectors are reproducible byte-for-byte.
 *
 * NOTE ON CONCURRENT DRIFT: Builder A rewrote objects.ts/states.ts/index.ts
 * while this harness was being built (see README "SUT drift incident").
 * These fixtures target the CURRENT delivered S0 scope: IntentContract,
 * Criterion, EvidenceArtifact, EvidenceBundle, VerificationDecision,
 * SettlementInstruction. Milestone / Plan / ExecutionRun / CapabilityGrant /
 * ContributionEdge / DisputeCase objects documented in the architecture doc
 * are NOT in the delivered snapshot and are covered as UNKNOWN entries.
 */
import { createHash } from "node:crypto";
import type { IntentContract, EvidenceBundle, VerificationDecision, SettlementInstruction, EvidenceArtifact } from "../../sut-snapshot/protocol-schema-src/objects.js";
import type { Hash } from "../../sut-snapshot/protocol-schema-src/hash.js";

export const IDS = {
  intent: "11111111-1111-4111-8111-111111111111",
  milestone: "22222222-2222-4222-8222-222222222222",
  run: "44444444-4444-4444-8444-444444444444",
  artifact1: "66666666-6666-4666-8666-666666666666",
  bundle: "77777777-7777-4777-8777-777777777777",
  decision: "88888888-8888-4888-8888-888888888888",
  settlement: "99999999-9999-4999-8999-999999999999",
} as const;

export const T0 = "2026-09-17T00:00:00.000Z";
export const T1 = "2026-09-17T01:00:00.000Z";

const sha = (s: string): Hash => `sha256:${createHash("sha256").update(s).digest("hex")}` as Hash;

/** Deterministic fake `sha256:`-typed hash from a repeated hex char, for typed SUT calls. */
export const fakeHash = (c: string): Hash => `sha256:${c.repeat(32)}` as Hash;

/** Deterministic, obviously-fake artifact byte hashes. */
export const RAW_ARTIFACTS = {
  a1: Buffer.from("intent-protocol conformance raw artifact #1", "utf8"),
  a2: Buffer.from("intent-protocol conformance raw artifact #2", "utf8"),
  a3: Buffer.from("intent-protocol conformance raw artifact #3", "utf8"),
} as const;

export const ARTIFACT_PAYLOAD_HASHES = {
  a1: `sha256:${createHash("sha256").update(RAW_ARTIFACTS.a1).digest("hex")}` as Hash,
  a2: `sha256:${createHash("sha256").update(RAW_ARTIFACTS.a2).digest("hex")}` as Hash,
  a3: `sha256:${createHash("sha256").update(RAW_ARTIFACTS.a3).digest("hex")}` as Hash,
};
/** Bundle artifact lists carry the artifact PAYLOAD digests (raw bytes in the CAS). */
export const ARTIFACT_HASHES = ARTIFACT_PAYLOAD_HASHES;

export const POLICY_HASH = sha("verification-policy:conformance-v1") as Hash;
export const VERIFIER_DIGEST = sha("verifier-impl:conformance-ref-verifier") as Hash;
export const REPLAY_DIGEST = sha("replay-trace:conformance") as Hash;

function criterion(criterion_id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "criterion.v1",
    criterion_id,
    kind: "MACHINE",
    assertion: `assertion for ${criterion_id}`,
    verifier_ref: "ci:github-actions",
    evidence_requirements: [{ kind: "ci-run", min_level: "E1", source: "github:org/repo", required: true }],
    threshold: { suites: 16, must_pass: true },
    ...extra,
  };
}

export function validIntent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "intent.v1",
    intent_id: IDS.intent,
    version: 1,
    owner_subject: "user:alice",
    goal: {
      statement: "Ship a conformance harness for the Intent Protocol schema layer.",
      target_state: "The harness runs and its report is machine-readable.",
      domain: "software-delivery",
    },
    success_criteria: [
      criterion("crit-tests", { assertion: "All conformance suites execute deterministically.", threshold: { suites: 16, must_pass: true } }),
      criterion("crit-report", { assertion: "A machine-readable conformance report is produced.", threshold: { format: "json" } }),
    ],
    constraints: [{ constraint_id: "cons-no-secrets", kind: "COMPLIANCE", statement: "No secrets in evidence.", max_risk_level: "L1" }],
    budget: {
      asset: { network: "sim:local", asset: "USD", decimals: 2 },
      total: "1000.00",
      execution_cap: "400.00",
    },
    verification_policy_ref: { uri: "ipfs://bafy-policy-verification", hash: POLICY_HASH },
    settlement_policy_ref: { uri: "ipfs://bafy-policy-settlement", hash: sha("settlement-policy:conformance-v1") },
    created_at: T0,
    ...overrides,
  };
}

export { criterion };

export function validBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "bundle.v1",
    bundle_id: IDS.bundle,
    milestone_id: IDS.milestone,
    milestone_revision: 1,
    run_ids: [IDS.run],
    artifact_hashes: [ARTIFACT_HASHES.a1, ARTIFACT_HASHES.a2, ARTIFACT_HASHES.a3],
    submitter: "agent:builder-a",
    policy_hash: POLICY_HASH,
    state: "SEALED",
    ...overrides,
  };
}

export function validDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "decision.v1",
    decision_id: IDS.decision,
    verifier_id: "verifier:independent-b",
    verifier_digest: VERIFIER_DIGEST,
    intent_hash: "sha256:" + "ab".repeat(32),
    milestone_id: IDS.milestone,
    milestone_revision: 1,
    bundle_id: IDS.bundle,
    evidence_root: "sha256:" + "cd".repeat(32),
    policy_hash: POLICY_HASH,
    proof_binding: "sha256:" + "ef".repeat(32),
    result: "VALID",
    reason_codes: ["ALL_CRITERIA_MET"],
    replay_digest: REPLAY_DIGEST,
    decided_at: T1,
    ...overrides,
  };
}

export function validSettlement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "settlement.v1",
    settlement_id: IDS.settlement,
    escrow_ref: "escrow:sim-0001",
    milestone_id: IDS.milestone,
    decision_id: IDS.decision,
    proof_binding: "sha256:" + "ef".repeat(32),
    nonce: "7",
    outputs: [
      { recipient: "agent:builder-a", asset: { network: "sim:local", asset: "USD", decimals: 2 }, amount: "300.00", reason: "milestone payout" },
    ],
    total_amount: "300.00",
    ...overrides,
  };
}

export function validArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "artifact.v1",
    artifact_id: IDS.artifact1,
    kind: "ci-run",
    level: "E1",
    source: "ci:github-actions",
    subject: "commit:abc123",
    captured_at: T0,
    payload_hash: ARTIFACT_PAYLOAD_HASHES.a1,
    locator: "cas://artifact-1",
    privacy_class: "INTERNAL",
    ...overrides,
  };
}

/** Recursively rebuild an object with its keys inserted in a different order. */
export function withKeyOrder<T extends Record<string, unknown>>(obj: T, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of order) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
  return out;
}

/** All permutations of an array (for small n). */
export function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i++) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) out.push([xs[i]!, ...p]);
  }
  return out;
}

/** Deep-permute key insertion order of every plain object in the structure. */
export function deepShuffleKeys(value: unknown, flip: (depth: number, index: number) => boolean, depth = 0, idx = { n: 0 }): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => deepShuffleKeys(v, flip, depth + 1, idx));
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const keys = Object.keys(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    const use = flip(depth, idx.n++);
    const ordered = use ? [...keys].reverse() : keys;
    for (const k of ordered) {
      out[k] = deepShuffleKeys((value as Record<string, unknown>)[k], flip, depth + 1, idx);
    }
    return out;
  }
  return value;
}

export type { IntentContract, EvidenceBundle, EvidenceArtifact, VerificationDecision, SettlementInstruction };
