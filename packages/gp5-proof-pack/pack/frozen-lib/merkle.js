/**
 * Evidence Bundle Merkle root (§6.1).
 *
 *  - Leaves are artifact content hashes, deduplicated and sorted bytewise ascending.
 *  - leaf  = SHA256(Domain.MerkleLeaf || 0x00 || artifact_hash)
 *  - node  = SHA256(Domain.MerkleNode || 0x00 || left || right)
 *  - An odd trailing node is promoted unchanged to the next level (no duplication).
 *  - Empty bundles have no root: sealing requires at least one artifact.
 */
import { Domain, fromHash, sha256, toHash } from "./hash.js";
const enc = new TextEncoder();
const LEAF = Buffer.concat([enc.encode(Domain.MerkleLeaf), new Uint8Array([0])]);
const NODE = Buffer.concat([enc.encode(Domain.MerkleNode), new Uint8Array([0])]);
function compareBytes(a, b) {
    return Buffer.compare(Buffer.from(a), Buffer.from(b));
}
export function sortedLeaves(artifactHashes) {
    if (artifactHashes.length === 0)
        throw new Error("evidence bundle must contain at least one artifact");
    const unique = [...new Set(artifactHashes)].map(fromHash).sort(compareBytes);
    return unique.map(toHash);
}
function leafHash(h) {
    return sha256(LEAF, fromHash(h));
}
function nodeHash(l, r) {
    return sha256(NODE, l, r);
}
function levels(artifactHashes) {
    const out = [sortedLeaves(artifactHashes).map(leafHash)];
    while (out[out.length - 1].length > 1) {
        const prev = out[out.length - 1];
        const next = [];
        for (let i = 0; i < prev.length; i += 2) {
            const l = prev[i];
            const r = prev[i + 1];
            next.push(r ? nodeHash(l, r) : l);
        }
        out.push(next);
    }
    return out;
}
export function merkleRoot(artifactHashes) {
    const lv = levels(artifactHashes);
    return toHash(lv[lv.length - 1][0]);
}
export function merkleProof(artifactHashes, leaf) {
    const leaves = sortedLeaves(artifactHashes);
    let idx = leaves.indexOf(leaf);
    if (idx < 0)
        throw new Error("leaf not in bundle");
    const steps = [];
    for (const level of levels(artifactHashes)) {
        if (level.length === 1)
            break;
        const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
        const sibling = level[siblingIdx];
        if (sibling)
            steps.push({ sibling: toHash(sibling), side: siblingIdx < idx ? "left" : "right" });
        idx = Math.floor(idx / 2);
    }
    return { leaf, steps };
}
export function verifyMerkleProof(root, proof) {
    let acc = leafHash(proof.leaf);
    for (const s of proof.steps) {
        const sib = fromHash(s.sibling);
        acc = s.side === "left" ? nodeHash(sib, acc) : nodeHash(acc, sib);
    }
    return toHash(acc) === root;
}
//# sourceMappingURL=merkle.js.map