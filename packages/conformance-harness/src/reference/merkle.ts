/**
 * INDEPENDENT reference Merkle tree for evidence bundles (Builder B), written
 * from the documented rules (architecture doc §6.1: "Evidence Bundle 对
 * artifact hash 排序后构造 Merkle Root" and the leaf/node scheme stated in the
 * SUT's public spec header):
 *
 *   - Leaves are artifact content hashes, deduplicated, sorted bytewise ascending.
 *   - leaf = SHA256("intent-protocol/v1/merkle-leaf" || 0x00 || artifact_hash)
 *   - node = SHA256("intent-protocol/v1/merkle-node" || 0x00 || left || right)
 *   - Odd trailing node promoted unchanged (no duplicate-the-last-node).
 *   - Empty bundle has no root.
 *
 * Uses only node:crypto. MUST NOT import anything from @intent/protocol-schema.
 */
import { createHash } from "node:crypto";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const LEAF_PREFIX = Buffer.concat([utf8("intent-protocol/v1/merkle-leaf"), Uint8Array.from([0])]);
const NODE_PREFIX = Buffer.concat([utf8("intent-protocol/v1/merkle-node"), Uint8Array.from([0])]);

function sha256(...chunks: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return new Uint8Array(h.digest());
}

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function bytesOf(h: string): Uint8Array {
  if (!/^sha256:[0-9a-f]{64}$/.test(h)) throw new Error(`reference: malformed hash ${h}`);
  return Uint8Array.from(Buffer.from(h.slice(7), "hex"));
}

function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

export function refSortedLeafHashes(artifactHashes: readonly string[]): Uint8Array[] {
  if (artifactHashes.length === 0) throw new Error("reference: empty bundle has no root");
  const unique = new Map<string, Uint8Array>();
  for (const h of artifactHashes) unique.set(h, bytesOf(h));
  return [...unique.values()].sort(cmpBytes).map((b) => sha256(LEAF_PREFIX, b));
}

export function refMerkleRoot(artifactHashes: readonly string[]): string {
  let level = refSortedLeafHashes(artifactHashes);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i]!;
      const r = level[i + 1];
      next.push(r ? sha256(NODE_PREFIX, l, r) : l);
    }
    level = next;
  }
  return `sha256:${hex(level[0]!)}`;
}

export interface RefProofStep {
  sibling: string;
  side: "left" | "right";
}

export function refMerkleProof(artifactHashes: readonly string[], leaf: string): { leaf: string; steps: RefProofStep[] } {
  const leaves = refSortedLeafHashes(artifactHashes);
  const sortedUnique = [...new Set(artifactHashes)]
    .map((h) => ({ h, b: bytesOf(h) }))
    .sort((x, y) => cmpBytes(x.b, y.b));
  const leafIdx = sortedUnique.findIndex((x) => x.h === leaf);
  if (leafIdx < 0) throw new Error("reference: leaf not in bundle");
  const steps: RefProofStep[] = [];
  let level = leaves;
  let idx = leafIdx;
  while (level.length > 1) {
    const sibIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    const sib = level[sibIdx];
    if (sib) steps.push({ sibling: `sha256:${hex(sib)}`, side: sibIdx < idx ? "left" : "right" });
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i]!;
      const r = level[i + 1];
      next.push(r ? sha256(NODE_PREFIX, l, r) : l);
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return { leaf, steps };
}

export function refVerifyMerkleProof(root: string, leaf: string, steps: readonly RefProofStep[]): boolean {
  let acc = sha256(LEAF_PREFIX, bytesOf(leaf));
  for (const s of steps) {
    acc = s.side === "left" ? sha256(NODE_PREFIX, bytesOf(s.sibling), acc) : sha256(NODE_PREFIX, acc, bytesOf(s.sibling));
  }
  return `sha256:${hex(acc)}` === root;
}
