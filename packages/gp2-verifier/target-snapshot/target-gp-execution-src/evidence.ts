/**
 * GP2 evidence packaging (Issue #25 §D/§E).
 *
 * Raw execution bytes -> EvidenceArtifactV1 (frozen G1 schema, payload_hash =
 * sha256 of the actual raw bytes) -> SEALED EvidenceBundleV1 via the frozen
 * seal()/merkle from @intent/protocol-schema. No new hash domain, no schema
 * change; deterministic IDs derived from the execution manifest.
 */
import { sha256 } from "./task.js";
import { deriveUuid, type ExecutionManifest, type RawEvidence } from "./runner.js";
// LIVE frozen G1 wire: main's @intent/protocol-schema is now materialized to
// the Commander-signed G1 target subtree (bb14d937...). preflight() hard-gates
// the subtree SHA before any evidence may be generated.
import { canonicalize, EvidenceArtifactSchema, EvidenceBundleSchema, seal, merkleRoot } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

export const ARTIFACT_KINDS = {
  "base-acceptance": { kind: "acceptance-suite-run", level: "E1", subject: (m: ExecutionManifest) => `commit:${m.base_commit_sha.slice(0, 12)}#base` },
  "agent-patch": { kind: "agent-patch-diff", level: "E2", subject: (m: ExecutionManifest) => `patch:${m.patch_sha256.slice(7, 19)}` },
  "patched-acceptance": { kind: "acceptance-suite-run", level: "E1", subject: (m: ExecutionManifest) => `commit:${m.base_commit_sha.slice(0, 12)}#patched` },
  "build": { kind: "build-typecheck", level: "E1", subject: (m: ExecutionManifest) => `commit:${m.base_commit_sha.slice(0, 12)}#patched` },
  "policy-boundary": { kind: "policy-boundary-report", level: "E2", subject: (m: ExecutionManifest) => `patch:${m.patch_sha256.slice(7, 19)}` },
  "execution-manifest": { kind: "execution-manifest", level: "E1", subject: (m: ExecutionManifest) => `execution:${m.execution_ref}` },
} as const;

export interface PackagedArtifact {
  key: string;
  artifact: Record<string, unknown>;
  payloadHash: string;
  rawBytes: Buffer;
}

export function packageArtifacts(manifest: ExecutionManifest, raw: Map<string, RawEvidence>): PackagedArtifact[] {
  const out: PackagedArtifact[] = [];
  let n = 0;
  for (const [key, meta] of Object.entries(ARTIFACT_KINDS)) {
    const ev = raw.get(key);
    if (!ev) throw new Error(`missing raw evidence: ${key}`);
    const payloadHash = sha256(ev.bytes) as Hash;
    const artifactId = deriveUuid(`gp2:artifact:${manifest.run_id}:${key}`);
    const artifact = {
      schema_version: "artifact.v1",
      artifact_id: artifactId,
      kind: meta.kind,
      level: meta.level,
      source: "runner:gp-execution",
      subject: meta.subject(manifest),
      captured_at: ev.at,
      payload_hash: payloadHash,
      // GP2-R2: content-addressed locator — one byte of payload change => hash segment change
      locator: `cas://gp2/${manifest.run_id}/${key}/${payloadHash.slice(7)}`,
      privacy_class: "INTERNAL",
    };
    // conformance check against the FROZEN schema before it may enter the bundle
    EvidenceArtifactSchema.parse(artifact);
    out.push({ key, artifact, payloadHash, rawBytes: ev.bytes });
    n++;
  }
  if (n !== 6) throw new Error(`expected 6 artifact kinds, packaged ${n}`);
  return out;
}

export interface SealedBundle {
  bundle: Record<string, unknown>;
  bundle_id: string;
  content_hash: string;
  merkle_root: string;
  artifact_hashes: string[];
}

/**
 * Milestone identity for GP-001: deterministic derivation from the frozen task
 * hash (identity ASSIGNMENT, not a new hash primitive; documented in README).
 * policy_hash records the frozen verification policy that GP3 will apply.
 */
export function gp001MilestoneId(taskFreezeHash: string): string {
  return deriveUuid(`gp2:milestone:${taskFreezeHash}`);
}

export function gp001PolicyHash(taskFreezeHash: string, verificationPolicy: string): Hash {
  return sha256(`gp2:policy-binding:${taskFreezeHash}:${verificationPolicy}`) as Hash;
}

export function buildSealedBundle(
  manifest: ExecutionManifest,
  artifacts: PackagedArtifact[],
  taskFreezeHash: string,
  verificationPolicy: string,
): SealedBundle {
  // deterministic artifact ordering per frozen rules: the bundle carries the
  // artifact payload hashes; the frozen merkle sorts+dedupes leaves, and the
  // ARRAY ITSELF is covered by the bundle content_hash.
  const artifactHashes = artifacts.map((a) => a.payloadHash) as Hash[];
  const root = merkleRoot(artifactHashes);
  // GP2-R3: bundle identity binds the COMPLETE pre-seal body (canonicalized,
  // bundle_id excluded) — not just run+root. The frozen merkle is order-
  // invariant BY DESIGN, so artifact_hashes order differences MUST be caught
  // here: same root + different order => DIFFERENT bundle_id.
  const preSealBody = {
    schema_version: "bundle.v1",
    milestone_id: gp001MilestoneId(taskFreezeHash),
    milestone_revision: 1,
    run_ids: [manifest.run_id],
    artifact_hashes: artifactHashes,
    merkle_root: root,
    submitter: "agent:gp-execution-runner",
    policy_hash: gp001PolicyHash(taskFreezeHash, verificationPolicy),
    sealed_at: manifest.ended_at,
    state: "SEALED",
  };
  const bundleId = deriveUuid(`gp2:bundle-id:${sha256(canonicalize(preSealBody))}`);
  const bundle: Record<string, unknown> = {
    schema_version: "bundle.v1",
    bundle_id: bundleId,
    milestone_id: preSealBody.milestone_id,
    milestone_revision: preSealBody.milestone_revision,
    run_ids: preSealBody.run_ids,
    artifact_hashes: preSealBody.artifact_hashes,
    merkle_root: preSealBody.merkle_root,
    submitter: preSealBody.submitter,
    policy_hash: preSealBody.policy_hash,
    sealed_at: preSealBody.sealed_at,
    state: preSealBody.state,
  };
  const sealed = seal(EvidenceBundleSchema as never, bundle) as Record<string, unknown> & { content_hash: Hash; bundle_id: string };
  return {
    bundle: sealed,
    bundle_id: sealed.bundle_id,
    content_hash: sealed.content_hash as string,
    merkle_root: root as string,
    artifact_hashes: artifactHashes as string[],
  };
}

/** Persist raw evidence + artifacts + bundle under an evidence directory (CAS locator root). */
export function persistEvidence(dir: string, manifest: ExecutionManifest, artifacts: PackagedArtifact[], bundle: SealedBundle): void {
  mkdirSync(path.join(dir, "raw"), { recursive: true });
  for (const a of artifacts) {
    writeFileSync(path.join(dir, "raw", `${a.key}.bin`), a.rawBytes);
  }
  writeFileSync(path.join(dir, "artifacts.json"), JSON.stringify(artifacts.map((a) => ({ key: a.key, artifact: a.artifact, payload_hash: a.payloadHash })), null, 2) + "\n");
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle.bundle, null, 2) + "\n");
}

export { path };

/**
 * Independent re-verification of a sealed bundle against the execution facts:
 * frozen-schema reparse (SEALED merkle superRefine fires on any root/manifest
 * drift), milestone/policy/run binding to the frozen task + manifest.
 * Throws on ANY mismatch — used by positive checks and tamper negatives.
 */
export function verifySealedBundle(input: {
  bundle: Record<string, unknown>;
  manifest: ExecutionManifest;
  taskFreezeHash: string;
  verificationPolicy: string;
  artifactPayloadHashes: string[];
}): { content_hash: string } {
  const reparsed = seal(EvidenceBundleSchema as never, input.bundle) as Record<string, unknown> & { content_hash: Hash };
  if (input.bundle.milestone_id !== gp001MilestoneId(input.taskFreezeHash)) {
    throw new Error("milestone binding mismatch (task drift)");
  }
  if (input.bundle.policy_hash !== gp001PolicyHash(input.taskFreezeHash, input.verificationPolicy)) {
    throw new Error("policy binding mismatch (task drift)");
  }
  if (!(input.bundle.run_ids as string[]).includes(input.manifest.run_id)) {
    throw new Error("run binding mismatch (execution drift)");
  }
  const recomputedRoot = merkleRoot(input.artifactPayloadHashes as Hash[]);
  if (String(input.bundle.merkle_root) !== recomputedRoot) {
    throw new Error("evidence root mismatch");
  }
  return { content_hash: reparsed.content_hash as string };
}
