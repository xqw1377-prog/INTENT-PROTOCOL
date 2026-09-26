/**
 * Domain-separated hashing (§6.1, ADR-005).
 *
 *   hash_input     = DOMAIN || 0x00 || schema_version || 0x00 || canonical_json(payload)
 *   content_hash   = SHA256(hash_input)
 *   proof_binding  = SHA256("intent-protocol/v1/proof-binding" || 0x00 ||
 *                           intent_hash || milestone_id(16-byte UUID) || milestone_revision(u32 BE) ||
 *                           bundle_id(16-byte UUID) || evidence_root || policy_hash)
 *                    (R9: binds the *identity* of milestone and bundle, not just revision/root;
 *                     UUIDs enter the preimage as their 16 binary bytes, not UTF-8 text)
 *   settlement_key = SHA256("intent-protocol/v1/settlement-key" || 0x00 ||
 *                           outcome_receipt_hash || UTF8(escrow_ref) || 0x00 || nonce(u64 BE))
 *                    (receipt-gated: binds the OutcomeReceipt — settlement authority —
 *                     never a raw VerificationDecision / proof_binding)
 *
 * All hashes are rendered as `sha256:<64 lowercase hex>`.
 */
import { createHash } from "node:crypto";
import { canonicalBytes } from "./canonical.js";
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
    OutcomeReceipt: "intent-protocol/v1/outcome-receipt",
    SettlementInstruction: "intent-protocol/v1/settlement-instruction",
    ContributionEdge: "intent-protocol/v1/contribution-edge",
    DisputeCase: "intent-protocol/v1/dispute-case",
    CapabilityGrant: "intent-protocol/v1/capability-grant",
    Event: "intent-protocol/v1/event",
    MerkleLeaf: "intent-protocol/v1/merkle-leaf",
    MerkleNode: "intent-protocol/v1/merkle-node",
};
const enc = new TextEncoder();
const SEP = new Uint8Array([0]);
export function sha256(...chunks) {
    const h = createHash("sha256");
    for (const c of chunks)
        h.update(c);
    return new Uint8Array(h.digest());
}
export function toHash(bytes) {
    if (bytes.length !== 32)
        throw new Error("hash must be 32 bytes");
    return `${HASH_PREFIX}${Buffer.from(bytes).toString("hex")}`;
}
export function fromHash(h) {
    if (!HASH_RE.test(h))
        throw new Error(`malformed hash: ${h}`);
    return new Uint8Array(Buffer.from(h.slice(HASH_PREFIX.length), "hex"));
}
export function isHash(v) {
    return typeof v === "string" && HASH_RE.test(v);
}
export function hashInput(domain, schemaVersion, payload) {
    return Buffer.concat([enc.encode(domain), SEP, enc.encode(schemaVersion), SEP, canonicalBytes(payload)]);
}
/** content_hash for any protocol object. Callers must strip `content_hash` / `signature` first. */
export function hashObject(domain, schemaVersion, payload) {
    return toHash(sha256(hashInput(domain, schemaVersion, payload)));
}
export function hashBytes(bytes) {
    return toHash(sha256(bytes));
}
export function u32be(n) {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff)
        throw new RangeError(`u32 out of range: ${n}`);
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n);
    return b;
}
export function u64be(n) {
    const v = BigInt(n);
    if (v < 0n || v > 0xffffffffffffffffn)
        throw new RangeError(`u64 out of range: ${n}`);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, v);
    return b;
}
const PROOF_BINDING_DOMAIN = Buffer.concat([enc.encode("intent-protocol/v1/proof-binding"), SEP]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Canonical lowercase-hyphenated UUID → its 16 binary bytes (R9/B1: never UTF-8 text). */
function uuidBytes16(uuid) {
    if (!UUID_RE.test(uuid))
        throw new Error(`malformed canonical (lowercase hyphenated) UUID: ${uuid}`);
    return new Uint8Array(Buffer.from(uuid.replace(/-/g, ""), "hex"));
}
/**
 * Binds a decision to one frozen intent version, a specific milestone (id + revision),
 * a specific evidence bundle (id + root) and a specific policy (threat: Proof Replay, R9).
 * milestone_id / bundle_id enter the preimage as 16-byte binary UUIDs (B1), not UTF-8 text.
 */
export function proofBinding(p) {
    return toHash(sha256(PROOF_BINDING_DOMAIN, fromHash(p.intent_hash), uuidBytes16(p.milestone_id), u32be(p.milestone_revision), uuidBytes16(p.bundle_id), fromHash(p.evidence_root), fromHash(p.policy_hash)));
}
const SETTLEMENT_KEY_DOMAIN = Buffer.concat([enc.encode("intent-protocol/v1/settlement-key"), SEP]);
/**
 * Idempotency key for one settlement effect (threat: Settlement Double Spend).
 * FROZEN byte protocol: the key binds `outcome_receipt_hash` — the receipt is the
 * settlement authority; a raw decision / proof_binding never is. The preimage is
 * injective: UTF8(escrow_ref) is 0x00-terminated before the fixed-width u64 nonce.
 */
export function settlementKey(p) {
    return toHash(sha256(SETTLEMENT_KEY_DOMAIN, fromHash(p.outcome_receipt_hash), enc.encode(p.escrow_ref), SEP, u64be(p.nonce)));
}
//# sourceMappingURL=hash.js.map