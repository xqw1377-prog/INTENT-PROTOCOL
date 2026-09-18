/**
 * INDEPENDENT reference hashing (Builder B), written from the documented rules
 * (architecture doc §6.1 and ADR-005):
 *
 *   hash_input     = DOMAIN || 0x00 || schema_version || 0x00 || canonical_json(payload)
 *   content_hash   = SHA256(hash_input)
 *   proof_binding  = SHA256(intent_hash || milestone_revision(u32 BE) || evidence_root || policy_hash)
 *   settlement_key = SHA256(proof_binding || escrow_id || 0x00 || settlement_nonce(u64 BE))
 *
 * Hashes rendered as `sha256:<64 lowercase hex>`.
 *
 * Uses only node:crypto. MUST NOT import anything from @intent/protocol-schema.
 * The domain literals below are protocol constants transcribed from the spec
 * text, deliberately not imported from the SUT.
 */
import { createHash } from "node:crypto";
import { refCanonicalize } from "./canonical.js";

export const REF_DOMAINS = {
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

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const SEP = Uint8Array.from([0]);

function sha256(...chunks: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return new Uint8Array(h.digest());
}

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function refHashBytes(bytes: Uint8Array): string {
  return `sha256:${hex(sha256(bytes))}`;
}

export function refHashObject(domain: string, schemaVersion: string, payload: unknown): string {
  const canonical = refCanonicalize(payload);
  const input = Buffer.concat([utf8(domain), SEP, utf8(schemaVersion), SEP, utf8(canonical)]);
  return `sha256:${hex(sha256(input))}`;
}

function hashBytes32(h: string): Uint8Array {
  if (!/^sha256:[0-9a-f]{64}$/.test(h)) throw new Error(`reference: malformed hash ${h}`);
  return Uint8Array.from(Buffer.from(h.slice(7), "hex"));
}

export function refU32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError(`u32 out of range: ${n}`);
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return new Uint8Array(b);
}

export function refU64be(n: bigint | number): Uint8Array {
  const v = BigInt(n);
  if (v < 0n || v > 0xffffffffffffffffn) throw new RangeError(`u64 out of range: ${n}`);
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(v, 0);
  return new Uint8Array(b);
}

/**
 * R9 (PROOF TARGET BINDING), frozen formula:
 *
 *   proof_binding = SHA256(
 *     intent_hash            (32B)
 *     || milestone_id        (UTF-8, UUID text, fixed length 36)
 *     || bundle_id           (UTF-8, UUID text, fixed length 36)
 *     || milestone_revision  (u32 BE)
 *     || evidence_root       (32B)
 *     || policy_hash         (32B)
 *   )
 *
 * Field order is this oracle's independent choice following the ruling's
 * enumeration order; UUID fields are fixed-length so the concatenation is
 * unambiguous. If Builder A's R9 implementation chooses a different order,
 * cross-checks will disagree and the discrepancy goes to Commander
 * adjudication — it must not be silently absorbed.
 */
export function refProofBinding(p: {
  intent_hash: string;
  milestone_id: string;
  bundle_id: string;
  milestone_revision: number;
  evidence_root: string;
  policy_hash: string;
}): string {
  return `sha256:${hex(
    sha256(
      hashBytes32(p.intent_hash),
      utf8(p.milestone_id),
      utf8(p.bundle_id),
      refU32be(p.milestone_revision),
      hashBytes32(p.evidence_root),
      hashBytes32(p.policy_hash),
    ),
  )}`;
}

export function refSettlementKey(p: {
  proof_binding: string;
  escrow_id: string;
  settlement_nonce: bigint | number;
}): string {
  return `sha256:${hex(
    sha256(hashBytes32(p.proof_binding), utf8(p.escrow_id), SEP, refU64be(p.settlement_nonce)),
  )}`;
}
