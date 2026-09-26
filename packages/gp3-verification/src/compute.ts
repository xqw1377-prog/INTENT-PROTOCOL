/**
 * Verifier COMPUTE layer: produces deterministic unsigned sealed decisions.
 * No private keys involved — fresh clones can reproduce these exactly.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, seal, IntentContractSchema, MilestoneSchema, EvidenceBundleSchema, VerificationDecisionSchema } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const git = (args: string[]): string => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const gitBuf = (args: string[]): Buffer => execFileSync("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
export const sha256Hex = (b: Buffer | string): string => "sha256:" + createHash("sha256").update(b).digest("hex");

export const FROZEN_INTENT_HASH = "sha256:88a2ff855c145c95db613297441a5588094a83b349cd3d6e6fd3ea7112e9b35e";
export const FROZEN_MILESTONE_HASH = "sha256:89c2fc53393781b20403fe13d5cf4847fde85b1636935c09339a4487e13d898c";
export const REQUIRED_LIVE_SUBTREE = "bb14d9375c92d64072f3e8c2f2dd65d794008422";
const IDENTITY_SHA = "5a72525413431dc04f039df9cf01842083bb8db0";
const EVIDENCE_SHA = "3fbef701165a86d3ad6fd95af695b78ebe74fee7";
const EVID = "packages/golden-path/evidence/9f6610dc-24e9-4e6c-b7c1-67574064d2ae";

function uuidBytes16(u: string): Uint8Array {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u)) throw new Error(`bad UUID ${u}`);
  return Uint8Array.from(Buffer.from(u.replace(/-/g, ""), "hex"));
}
function hash32(h: string): Uint8Array { return Uint8Array.from(Buffer.from(h.slice(7), "hex")); }
const utf8 = (s: string) => new TextEncoder().encode(s);
function sha256b(...c: Uint8Array[]): Uint8Array { const h = createHash("sha256"); for (const x of c) h.update(x); return new Uint8Array(h.digest()); }
function u32be(n: number): Uint8Array { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return new Uint8Array(b); }

export function proofBinding(p: { intent_hash: string; milestone_id: string; milestone_revision: number; bundle_id: string; evidence_root: string; policy_hash: string }): string {
  return `sha256:${Buffer.from(sha256b(utf8("intent-protocol/v1/proof-binding"), Uint8Array.from([0]), hash32(p.intent_hash), uuidBytes16(p.milestone_id), u32be(p.milestone_revision), uuidBytes16(p.bundle_id), hash32(p.evidence_root), hash32(p.policy_hash))).toString("hex")}`;
}
export function deriveUuid(seed: string): string {
  const b = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const h = b.slice(0, 12) + "4" + b.slice(13, 16) + "8" + b.slice(17, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function loadFrozenIdentity() {
  const show = (rel: string) => gitBuf(["show", `${IDENTITY_SHA}:${rel}`]);
  return {
    intent: JSON.parse(show("packages/golden-path/identity/intent.json").toString()),
    milestone: JSON.parse(show("packages/golden-path/identity/milestone.json").toString()),
  };
}
export function loadFrozenEvidence() {
  const show = (rel: string) => gitBuf(["show", `${EVIDENCE_SHA}:${rel}`]);
  const task = JSON.parse(show("packages/golden-path/fixtures/gp-001-task.json").toString());
  const taskFreezeHash = sha256Hex(show("packages/golden-path/fixtures/gp-001-task.json"));
  const bundle = JSON.parse(show(`${EVID}/bundle.json`).toString());
  const artifacts = JSON.parse(show(`${EVID}/artifacts.json`).toString());
  const manifest = JSON.parse(show(`${EVID}/manifest.json`).toString());
  const raw = new Map<string, Buffer>();
  for (const k of ["base-acceptance", "agent-patch", "patched-acceptance", "build", "policy-boundary", "execution-manifest"]) raw.set(k, show(`${EVID}/raw/${k}.bin`));
  return { task, taskFreezeHash, bundle, artifacts, manifest, raw };
}
export function bindingContext(identity: any, ev: any) {
  return {
    intent_hash: String(identity.intent.content_hash),
    milestone_id: String(ev.bundle.milestone_id),
    milestone_revision: Number(ev.bundle.milestone_revision),
    bundle_id: String(ev.bundle.bundle_id),
    evidence_root: String(ev.bundle.merkle_root),
    policy_hash: String(ev.bundle.policy_hash),
  };
}

export interface Check { id: string; pass: boolean; detail?: string; }
export const FIXED_CLOCK = { decidedAt: "2026-09-24T10:00:00.000Z", issuedAt: "2026-09-24T10:00:01.000Z" };

/** Deterministic unsigned decision body (no signature — signing is offline). */
export function computeDecision(input: { verifierId: string; digestSeed: string; binding: any; result: "VALID" | "INVALID"; checks: Check[]; seed: string }) {
  const body = {
    schema_version: "decision.v1",
    decision_id: deriveUuid(input.seed),
    verifier_id: input.verifierId,
    verifier_digest: sha256Hex(input.digestSeed) as Hash,
    intent_hash: input.binding.intent_hash as Hash,
    milestone_id: input.binding.milestone_id,
    milestone_revision: input.binding.milestone_revision,
    bundle_id: input.binding.bundle_id,
    evidence_root: input.binding.evidence_root as Hash,
    policy_hash: input.binding.policy_hash as Hash,
    proof_binding: proofBinding(input.binding) as Hash,
    result: input.result,
    reason_codes: input.result === "VALID" ? ["ALL_CHECKS_PASSED"] : input.checks.filter((c) => !c.pass).map((c) => `FAILED_${c.id}`),
    replay_digest: sha256Hex(canonicalize(input.checks.map((c) => [c.id, c.pass]))) as Hash,
    decided_at: FIXED_CLOCK.decidedAt,
  };
  const sealed = seal(VerificationDecisionSchema as never, body) as Record<string, any>;
  return { decision: sealed, content_hash: String(sealed.content_hash), checks: input.checks };
}
