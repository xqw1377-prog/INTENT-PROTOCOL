/**
 * GP3 V3 context: frozen identity + evidence + binding + decision construction
 * with Ed25519 signing.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, seal, VerificationDecisionSchema } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import { deriveUuid, proofBinding, sha256Hex } from "./r9.js";
import { signDecision } from "./keys.js";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const EVIDENCE_SOURCE_SHA = "3fbef701165a86d3ad6fd95af695b78ebe74fee7";
export const IDENTITY_SOURCE_SHA = "5a72525413431dc04f039df9cf01842083bb8db0";
export const VERIFIED_RUN_ID = "9f6610dc-24e9-4e6c-b7c1-67574064d2ae";
export const EVIDENCE_DIR = `packages/golden-path/evidence/${VERIFIED_RUN_ID}`;
export const FROZEN_INTENT_CONTENT_HASH = "sha256:88a2ff855c145c95db613297441a5588094a83b349cd3d6e6fd3ea7112e9b35e";
export const FROZEN_MILESTONE_CONTENT_HASH = "sha256:89c2fc53393781b20403fe13d5cf4847fde85b1636935c09339a4487e13d898c";

const git = (args: string[]): string => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
export const gitBuf = (args: string[]): Buffer => execFileSync("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });

export function loadFrozenIdentity() {
  const show = (rel: string): Buffer => gitBuf(["show", `${IDENTITY_SOURCE_SHA}:${rel}`]);
  const intent = JSON.parse(show("packages/golden-path/identity/intent.json").toString("utf8"));
  const milestone = JSON.parse(show("packages/golden-path/identity/milestone.json").toString("utf8"));
  return { intent, milestone, intentContentHash: String(intent.content_hash), milestoneContentHash: String(milestone.content_hash) };
}

export function loadFrozenEvidence() {
  const show = (rel: string): Buffer => gitBuf(["show", `${EVIDENCE_SOURCE_SHA}:${rel}`]);
  const task = JSON.parse(show("packages/golden-path/fixtures/gp-001-task.json").toString("utf8"));
  const taskFreezeHash = sha256Hex(show("packages/golden-path/fixtures/gp-001-task.json"));
  const bundle = JSON.parse(show(`${EVIDENCE_DIR}/bundle.json`).toString("utf8"));
  const artifacts = JSON.parse(show(`${EVIDENCE_DIR}/artifacts.json`).toString("utf8"));
  const manifest = JSON.parse(show(`${EVIDENCE_DIR}/manifest.json`).toString("utf8"));
  const raw = new Map<string, Buffer>();
  for (const key of ["base-acceptance", "agent-patch", "patched-acceptance", "build", "policy-boundary", "execution-manifest"]) {
    raw.set(key, show(`${EVIDENCE_DIR}/raw/${key}.bin`));
  }
  return { task, taskFreezeHash, bundle, artifacts, manifest, raw };
}

export function bindingContext(identity: any, ev: any) {
  return {
    intent_hash: identity.intentContentHash,
    milestone_id: String(ev.bundle.milestone_id),
    milestone_revision: Number(ev.bundle.milestone_revision),
    bundle_id: String(ev.bundle.bundle_id),
    evidence_root: String(ev.bundle.merkle_root),
    policy_hash: String(ev.bundle.policy_hash),
  };
}

export interface CheckResult { id: string; pass: boolean; detail?: string; }
export function replayDigest(checks: CheckResult[]): Hash {
  return sha256Hex(canonicalize(checks.map((c) => [c.id, c.pass]))) as Hash;
}

export const FIXED_CLOCK = { decidedAt: "2026-09-24T10:00:00.000Z", issuedAt: "2026-09-24T10:00:01.000Z" };

/** Build a signed decision: seal the body, then sign content_hash with the verifier's Ed25519 key. */
export function buildSignedDecision(input: {
  verifierId: string;
  verifierDigestSeed: string;
  binding: any;
  result: "VALID" | "INVALID" | "INSUFFICIENT" | "DISPUTED";
  reasonCodes: string[];
  checks: CheckResult[];
  decisionIdSeed: string;
}): { decision: Record<string, any>; content_hash: string } {
  const body = {
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
  const sealed = seal(VerificationDecisionSchema as never, body) as Record<string, any>;
  const ch = String(sealed.content_hash);
  // B1: sign the content_hash with Ed25519
  const sig = signDecision(input.verifierId, ch);
  const decision = { ...sealed, signature: { scheme: "ed25519" as const, signer: input.verifierId, key_id: sig.key_id, value: sig.signature } };
  return { decision, content_hash: ch };
}
