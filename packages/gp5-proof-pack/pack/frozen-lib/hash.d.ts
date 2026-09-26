export type Hash = `sha256:${string}`;
export declare const HASH_PREFIX = "sha256:";
export declare const HASH_RE: RegExp;
/** Domain separators are frozen strings; never reuse one for a different object kind. */
export declare const Domain: {
    readonly Intent: "intent-protocol/v1/intent";
    readonly Milestone: "intent-protocol/v1/milestone";
    readonly Plan: "intent-protocol/v1/plan";
    readonly ExecutionRun: "intent-protocol/v1/execution-run";
    readonly EvidenceArtifact: "intent-protocol/v1/evidence-artifact";
    readonly EvidenceBundle: "intent-protocol/v1/evidence-bundle";
    readonly VerificationPolicy: "intent-protocol/v1/verification-policy";
    readonly SettlementPolicy: "intent-protocol/v1/settlement-policy";
    readonly VerificationDecision: "intent-protocol/v1/verification-decision";
    readonly OutcomeReceipt: "intent-protocol/v1/outcome-receipt";
    readonly SettlementInstruction: "intent-protocol/v1/settlement-instruction";
    readonly ContributionEdge: "intent-protocol/v1/contribution-edge";
    readonly DisputeCase: "intent-protocol/v1/dispute-case";
    readonly CapabilityGrant: "intent-protocol/v1/capability-grant";
    readonly Event: "intent-protocol/v1/event";
    readonly MerkleLeaf: "intent-protocol/v1/merkle-leaf";
    readonly MerkleNode: "intent-protocol/v1/merkle-node";
};
export type Domain = (typeof Domain)[keyof typeof Domain];
export declare function sha256(...chunks: Uint8Array[]): Uint8Array;
export declare function toHash(bytes: Uint8Array): Hash;
export declare function fromHash(h: Hash): Uint8Array;
export declare function isHash(v: unknown): v is Hash;
export declare function hashInput(domain: Domain, schemaVersion: string, payload: unknown): Uint8Array;
/** content_hash for any protocol object. Callers must strip `content_hash` / `signature` first. */
export declare function hashObject(domain: Domain, schemaVersion: string, payload: unknown): Hash;
export declare function hashBytes(bytes: Uint8Array): Hash;
export declare function u32be(n: number): Uint8Array;
export declare function u64be(n: bigint | number): Uint8Array;
/**
 * Binds a decision to one frozen intent version, a specific milestone (id + revision),
 * a specific evidence bundle (id + root) and a specific policy (threat: Proof Replay, R9).
 * milestone_id / bundle_id enter the preimage as 16-byte binary UUIDs (B1), not UTF-8 text.
 */
export declare function proofBinding(p: {
    intent_hash: Hash;
    milestone_id: string;
    milestone_revision: number;
    bundle_id: string;
    evidence_root: Hash;
    policy_hash: Hash;
}): Hash;
/** Frozen parameterization (docs/TRUST-CHAIN.md): keyed by the OutcomeReceipt commitment. */
export interface SettlementKeyInput {
    outcome_receipt_hash: Hash;
    escrow_ref: string;
    nonce: bigint | number;
}
/**
 * Idempotency key for one settlement effect (threat: Settlement Double Spend).
 * FROZEN byte protocol: the key binds `outcome_receipt_hash` — the receipt is the
 * settlement authority; a raw decision / proof_binding never is. The preimage is
 * injective: UTF8(escrow_ref) is 0x00-terminated before the fixed-width u64 nonce.
 */
export declare function settlementKey(p: SettlementKeyInput): Hash;
//# sourceMappingURL=hash.d.ts.map