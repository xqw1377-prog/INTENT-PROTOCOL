/**
 * Domain-separated hashing (§6.1, ADR-005).
 *
 *   hash_input     = DOMAIN || 0x00 || schema_version || 0x00 || canonical_json(payload)
 *   content_hash   = SHA256(hash_input)
 *   proof_binding  = SHA256("intent-protocol/v1/proof-binding" || 0x00 ||
 *                           intent_hash || milestone_id || milestone_revision(u32 BE) ||
 *                           bundle_id || evidence_root || policy_hash)
 *                    (R9: binds the *identity* of milestone and bundle, not just revision/root)
 *   settlement_key = SHA256(proof_binding || escrow_id || 0x00 || settlement_nonce(u64 BE))
 *
 * All hashes are rendered as `sha256:<64 lowercase hex>`.
 */
import { createHash } from "node:crypto";
import { canonicalBytes } from "./canonical.js";

export type Hash = `sha256:${string}`;

export const HASH_PREFIX = "sha256:";
export const HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** Domain separators are frozen strings; never reuse one for a different object kind. */
export const Domain = {
  Intent: "intent-protocol/v1/intent",
  Milestone: "intent-protocol/v1/milestone",
  Plan: "intent-protocol/v1/plan",
  ExecutionRun: "intent-protocol/v1/execution-run",
  EvidenceArtifact: "intent-protocol/v1/evidence-artifact",
  EvidenceBundle: "intent-protocol/v1/evidence-bundle",
  VerificationPolicy: "intent-protocol/v1/verification-policy",
  SettlementPolicy: "intent-protocol/v1/settlement-policy",
  VerificationDecision: "intent-protocol/v1/verification-decision",
  SettlementInstruction: "intent-protocol/v1/settlement-instruction",
  ContributionEdge: "intent-protocol/v1/contribution-edge",
  DisputeCase: "intent-protocol/v1/dispute-case",
  CapabilityGrant: "intent-protocol/v1/capability-grant",
  Event: "intent-protocol/v1/event",
  MerkleLeaf: "intent-protocol/v1/merkle-leaf",
  MerkleNode: "intent-protocol/v1/merkle-node",
} as const;
export type Domain = (typeof Domain)[keyof typeof Domain];

const enc = new TextEncoder();
const SEP = new Uint8Array([0]);

export function sha256(...chunks: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return new Uint8Array(h.digest());
}

export function toHash(bytes: Uint8Array): Hash {
  if (bytes.length !== 32) throw new Error("hash must be 32 bytes");
  return `${HASH_PREFIX}${Buffer.from(bytes).toString("hex")}`;
}

export function fromHash(h: Hash): Uint8Array {
  if (!HASH_RE.test(h)) throw new Error(`malformed hash: ${h}`);
  return new Uint8Array(Buffer.from(h.slice(HASH_PREFIX.length), "hex"));
}

export function isHash(v: unknown): v is Hash {
  return typeof v === "string" && HASH_RE.test(v);
}

export function hashInput(domain: Domain, schemaVersion: string, payload: unknown): Uint8Array {
  return Buffer.concat([enc.encode(domain), SEP, enc.encode(schemaVersion), SEP, canonicalBytes(payload)]);
}

/** content_hash for any protocol object. Callers must strip `content_hash` / `signature` first. */
export function hashObject(domain: Domain, schemaVersion: string, payload: unknown): Hash {
  return toHash(sha256(hashInput(domain, schemaVersion, payload)));
}

export function hashBytes(bytes: Uint8Array): Hash {
  return toHash(sha256(bytes));
}

export function u32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError(`u32 out of range: ${n}`);
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

export function u64be(n: bigint | number): Uint8Array {
  const v = BigInt(n);
  if (v < 0n || v > 0xffffffffffffffffn) throw new RangeError(`u64 out of range: ${n}`);
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v);
  return b;
}

const PROOF_BINDING_DOMAIN = Buffer.concat([enc.encode("intent-protocol/v1/proof-binding"), SEP]);

/**
 * Binds a decision to one frozen intent version, a specific milestone (id + revision),
 * a specific evidence bundle (id + root) and a specific policy (threat: Proof Replay, R9).
 * milestone_id / bundle_id are canonical lowercase UUID strings hashed as UTF-8.
 */
export function proofBinding(p: {
  intent_hash: Hash;
  milestone_id: string;
  milestone_revision: number;
  bundle_id: string;
  evidence_root: Hash;
  policy_hash: Hash;
}): Hash {
  return toHash(sha256(
    PROOF_BINDING_DOMAIN,
    fromHash(p.intent_hash),
    enc.encode(p.milestone_id),
    u32be(p.milestone_revision),
    enc.encode(p.bundle_id),
    fromHash(p.evidence_root),
    fromHash(p.policy_hash),
  ));
}

/** Idempotency key for one settlement effect (threat: Settlement Double Spend). */
export function settlementKey(p: { proof_binding: Hash; escrow_id: string; settlement_nonce: bigint | number }): Hash {
  return toHash(sha256(fromHash(p.proof_binding), enc.encode(p.escrow_id), SEP, u64be(p.settlement_nonce)));
}
