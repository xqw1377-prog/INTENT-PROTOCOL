/**
 * GP3 V2 verification context (Issue #32 + GP-ID-R1 V3 frozen identity).
 *
 * KEY CHANGE FROM V1:
 *  - intent_hash = sealed IntentContractV1.content_hash from the frozen
 *    identity artifact (sha256:88a2ff855c...), NOT task_freeze_hash.
 *  - Every decision input is RE-SEALED by the receipt engine before use.
 *  - Verifier roles are exactly verifier:gp3-functional + verifier:gp3-policy.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { canonicalize, seal, VerificationDecisionSchema } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import { deriveUuid, proofBinding, sha256Hex } from "./r9.js";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const EVIDENCE_SOURCE_SHA = "3fbef701165a86d3ad6fd95af695b78ebe74fee7";
export const IDENTITY_SOURCE_SHA = "5a72525413431dc04f039df9cf01842083bb8db0"; // GP-ID-R1 V3 FROZEN HEAD
export const VERIFIED_RUN_ID = "9f6610dc-24e9-4e6c-b7c1-67574064d2ae";
export const EVIDENCE_DIR = `packages/golden-path/evidence/${VERIFIED_RUN_ID}`;
export const REQUIRED_LIVE_SUBTREE = "bb14d9375c92d64072f3e8c2f2dd65d794008422";
export const FROZEN_INTENT_CONTENT_HASH = "sha256:88a2ff855c145c95db613297441a5588094a83b349cd3d6e6fd3ea7112e9b35e";
export const FROZEN_MILESTONE_CONTENT_HASH = "sha256:89c2fc53393781b20403fe13d5cf4847fde85b1636935c09339a4487e13d898c";

const git = (args: string[]): string => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
export const gitBuf = (args: string[]): Buffer => execFileSync("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });

export interface FrozenIdentity {
  intent: Record<string, any>;
  milestone: Record<string, any>;
  intentContentHash: string;
  milestoneContentHash: string;
}

export function loadFrozenIdentity(): FrozenIdentity {
  const show = (rel: string): Buffer => gitBuf(["show", `${IDENTITY_SOURCE_SHA}:${rel}`]);
  const intent = JSON.parse(show("packages/golden-path/identity/intent.json").toString("utf8"));
  const milestone = JSON.parse(show("packages/golden-path/identity/milestone.json").toString("utf8"));
  return { intent, milestone, intentContentHash: String(intent.content_hash), milestoneContentHash: String(milestone.content_hash) };
}

export interface FrozenEvidence {
  task: Record<string, any>;
  taskFreezeHash: string;
  bundle: Record<string, any>;
  artifacts: Array<{ key: string; artifact: Record<string, any>; payload_hash: string }>;
  manifest: Record<string, any>;
  raw: Map<string, Buffer>;
  liveSubtree: string;
}

export function loadFrozenEvidence(sourceSha: string = EVIDENCE_SOURCE_SHA): FrozenEvidence {
  const show = (rel: string): Buffer => gitBuf(["show", `${sourceSha}:${rel}`]);
  const task = JSON.parse(show("packages/golden-path/fixtures/gp-001-task.json").toString("utf8"));
  const taskFreezeHash = sha256Hex(show("packages/golden-path/fixtures/gp-001-task.json"));
  const bundle = JSON.parse(show(`${EVIDENCE_DIR}/bundle.json`).toString("utf8"));
  const artifacts = JSON.parse(show(`${EVIDENCE_DIR}/artifacts.json`).toString("utf8"));
  const manifest = JSON.parse(show(`${EVIDENCE_DIR}/manifest.json`).toString("utf8"));
  const raw = new Map<string, Buffer>();
  for (const key of ["base-acceptance", "agent-patch", "patched-acceptance", "build", "policy-boundary", "execution-manifest"]) {
    raw.set(key, show(`${EVIDENCE_DIR}/raw/${key}.bin`));
  }
  return { task, taskFreezeHash, bundle, artifacts, manifest, raw, liveSubtree: git(["rev-parse", "HEAD:packages/protocol-schema"]) };
}

export interface BindingContext {
  intent_hash: string;
  milestone_id: string;
  milestone_revision: number;
  bundle_id: string;
  evidence_root: string;
  policy_hash: string;
}

export function bindingContext(identity: FrozenIdentity, ev: FrozenEvidence): BindingContext {
  return {
    intent_hash: identity.intentContentHash, // GP-ID-R1: sealed intent.content_hash, NOT task_freeze_hash
    milestone_id: String(ev.bundle.milestone_id),
    milestone_revision: Number(ev.bundle.milestone_revision),
    bundle_id: String(ev.bundle.bundle_id),
    evidence_root: String(ev.bundle.merkle_root),
    policy_hash: String(ev.bundle.policy_hash),
  };
}

export interface CheckResult {
  id: string;
  pass: boolean;
  detail?: string;
}

export function replayDigest(checks: CheckResult[]): Hash {
  return sha256Hex(canonicalize(checks.map((c) => [c.id, c.pass]))) as Hash;
}

export const FIXED_CLOCK = {
  decidedAt: "2026-09-23T10:00:00.000Z",
  issuedAt: "2026-09-23T10:00:01.000Z",
};

export interface BuiltDecision {
  decision: Record<string, any>;
  content_hash: string;
}

export function buildDecision(input: {
  verifierId: string;
  verifierDigestSeed: string;
  binding: BindingContext;
  result: "VALID" | "INVALID" | "INSUFFICIENT" | "DISPUTED";
  reasonCodes: string[];
  checks: CheckResult[];
  decisionIdSeed: string;
}): BuiltDecision {
  const decision = {
    schema_version: "decision.v1",
    decision_id: deriveUuid(input.decisionIdSeed),
    verifier_id: input.verifierId,
    verifier_digest: sha256Hex(input.verifierDigestSeed) as Hash,
    intent_hash: input.binding.intent_hash as Hash,
    milestone_id: input.binding.milestone_id,
    milestone_revision: input.binding.milestone_revision,
    bundle_id: input.binding.bundle_id,
    evidence_root: input.binding.evidence_root as Hash,
    policy_hash: input.binding.policy_hash as Hash,
    proof_binding: proofBinding(input.binding) as Hash,
    result: input.result,
    reason_codes: input.reasonCodes,
    replay_digest: replayDigest(input.checks) as Hash,
    decided_at: FIXED_CLOCK.decidedAt,
  };
  const sealed = seal(VerificationDecisionSchema as never, decision) as Record<string, any>;
  return { decision: sealed, content_hash: String(sealed.content_hash) };
}

// re-export identity file paths for tests
export const IDENTITY_FILES = {
  intent: "packages/golden-path/identity/intent.json",
  milestone: "packages/golden-path/identity/milestone.json",
} as const;
