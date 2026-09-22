/**
 * GP3 verification context: loads the FROZEN GP2 evidence from the git object
 * database (never a smudgeable working tree) at the GP2-passed merge, plus the
 * frozen task truth, and derives the R9 binding inputs.
 *
 * Identity conventions (documented, deterministic):
 *   intent_hash        = task_freeze_hash — the frozen task record IS the
 *                        GP-001 V1 intent commitment (full IntentContractV1
 *                        materialization is a Proof Pack enrichment, later).
 *   milestone_id       = the GP2 bundle's own milestone_id (frozen anchor).
 *   milestone_revision = 1 (bundle.v1 carries revision 1).
 *   policy_hash        = the frozen bundle's policy_hash (2-of-2 commitment).
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, seal, VerificationDecisionSchema } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import { deriveUuid, proofBinding, sha256Hex } from "./r9.js";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** The GP2-passed merge carrying the verified evidence subtree. */
export const EVIDENCE_SOURCE_SHA = "3fbef701165a86d3ad6fd95af695b78ebe74fee7";
export const VERIFIED_RUN_ID = "9f6610dc-24e9-4e6c-b7c1-67574064d2ae";
export const EVIDENCE_DIR = `packages/golden-path/evidence/${VERIFIED_RUN_ID}`;
export const REQUIRED_LIVE_SUBTREE = "bb14d9375c92d64072f3e8c2f2dd65d794008422";

const git = (args: string[]): string => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
export const gitBuf = (args: string[]): Buffer => execFileSync("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });

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

export function bindingContext(ev: FrozenEvidence): BindingContext {
  return {
    intent_hash: ev.taskFreezeHash, // GP-001 V1 intent commitment (documented convention)
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

/** Deterministic replay digest over a verifier's observed check list. */
export function replayDigest(checks: CheckResult[]): Hash {
  return sha256Hex(canonicalize(checks.map((c) => [c.id, c.pass]))) as Hash;
}

/** Caller-supplied logical clock (protocol timestamps never read wall clocks). */
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
