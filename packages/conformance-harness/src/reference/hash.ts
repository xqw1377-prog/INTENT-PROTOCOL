/**
 * INDEPENDENT reference hashing (Builder B), written from the documented rules
 * (architecture doc §6.1 and ADR-005):
 *
 *   hash_input     = DOMAIN || 0x00 || schema_version || 0x00 || canonical_json(payload)
 *   content_hash   = SHA256(hash_input)
 *   proof_binding  = SHA256(intent_hash || milestone_revision(u32 BE) || evidence_root || policy_hash)
 *   settlement_key = SHA256("intent-protocol/v1/settlement-key" || 0x00 || outcome_receipt_hash[32]
 *                           || UTF8(escrow_ref) || 0x00 || nonce(u64 BE))          [FROZEN @ e28a22e]
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
 * R9 (PROOF TARGET BINDING) — FROZEN byte protocol, implemented exactly:
 *
 *   proof_binding = SHA256(
 *     "intent-protocol/v1/proof-binding"   (domain separation)
 *     || 0x00
 *     || intent_hash          (32 bytes)
 *     || milestone_id         (UUID binary, 16 bytes)
 *     || milestone_revision   (u32 BE, 4 bytes)
 *     || bundle_id            (UUID binary, 16 bytes)
 *     || evidence_root        (32 bytes)
 *     || policy_hash          (32 bytes)
 *   )
 *
 * Cross-checked against an independent Python implementation
 * (scripts/kat-proof-binding.py) via the golden vector in
 * vectors/proof-binding-vector.json. This is a byte-exact oracle: any
 * disagreement with the SUT is a finding, and sensitivity alone is NOT
 * sufficient (a wrong-but-sensitive hash must still fail S-R9).
 */
const PROOF_BINDING_DOMAIN = utf8("intent-protocol/v1/proof-binding");

function uuidBytes16(uuid: string): Uint8Array {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    throw new Error(`reference: malformed canonical (lowercase hyphenated) UUID: ${uuid}`);
  }
  return Uint8Array.from(Buffer.from(uuid.replace(/-/g, ""), "hex"));
}

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
      PROOF_BINDING_DOMAIN,
      SEP,
      hashBytes32(p.intent_hash),
      uuidBytes16(p.milestone_id),
      refU32be(p.milestone_revision),
      uuidBytes16(p.bundle_id),
      hashBytes32(p.evidence_root),
      hashBytes32(p.policy_hash),
    ),
  )}`;
}

/**
 * SETTLEMENT KEY — FROZEN byte protocol (docs/TRUST-CHAIN.md @ e28a22e),
 * implemented exactly:
 *
 *   settlement_key = SHA256(
 *     "intent-protocol/v1/settlement-key"  (domain separation)
 *     || 0x00
 *     || outcome_receipt_hash  (32 bytes — the receipt IS the settlement
 *                              authority; a raw decision / proof_binding is not)
 *     || UTF8(escrow_ref)
 *     || 0x00                  (explicit terminator before the fixed-width nonce)
 *     || nonce                 (u64 BE, 8 bytes)
 *   )
 *
 * The encoding is injective: the nonce is fixed-width and the byte 9 positions
 * from the end is always the explicit 0x00 terminator, so escrow_ref always
 * recovers exactly. Cross-checked against an independent Python implementation
 * (scripts/kat-settlement-key.py) via the golden vector in
 * vectors/settlement-key-vector.json. Any disagreement with the SUT is a
 * finding; a wrong-but-sensitive key must still fail.
 */
const SETTLEMENT_KEY_DOMAIN = utf8("intent-protocol/v1/settlement-key");

export function refSettlementKey(p: {
  outcome_receipt_hash: string;
  escrow_ref: string;
  nonce: bigint | number;
}): string {
  return `sha256:${hex(
    sha256(
      SETTLEMENT_KEY_DOMAIN,
      SEP,
      hashBytes32(p.outcome_receipt_hash),
      utf8(p.escrow_ref),
      SEP,
      refU64be(p.nonce),
    ),
  )}`;
}
