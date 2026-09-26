/**
 * Evidence Bundle Merkle root (§6.1).
 *
 *  - Leaves are artifact content hashes, deduplicated and sorted bytewise ascending.
 *  - leaf  = SHA256(Domain.MerkleLeaf || 0x00 || artifact_hash)
 *  - node  = SHA256(Domain.MerkleNode || 0x00 || left || right)
 *  - An odd trailing node is promoted unchanged to the next level (no duplication).
 *  - Empty bundles have no root: sealing requires at least one artifact.
 */
import { type Hash } from "./hash.js";
export interface MerkleProofStep {
    sibling: Hash;
    /** Position of the sibling relative to the running hash. */
    side: "left" | "right";
}
export interface MerkleProof {
    leaf: Hash;
    steps: MerkleProofStep[];
}
export declare function sortedLeaves(artifactHashes: readonly Hash[]): Hash[];
export declare function merkleRoot(artifactHashes: readonly Hash[]): Hash;
export declare function merkleProof(artifactHashes: readonly Hash[], leaf: Hash): MerkleProof;
export declare function verifyMerkleProof(root: Hash, proof: MerkleProof): boolean;
//# sourceMappingURL=merkle.d.ts.map