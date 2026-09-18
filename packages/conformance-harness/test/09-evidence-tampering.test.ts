import { describe, expect, test } from "vitest";
import { refHashBytes, refMerkleRoot, refVerifyMerkleProof } from "../src/reference/index.js";
import { ARTIFACT_HASHES, RAW_ARTIFACTS, validArtifact } from "../src/lib/fixtures.js";
import { sut, contentHashOf } from "../src/sut.js";

const { merkleRoot, merkleProof, verifyMerkleProof } = sut.merkle;
const { hashBytes, hashObject, Domain } = sut.hash;
const { EvidenceArtifactSchema } = sut.objects;
const contentHash = contentHashOf;

const bundleArtifacts = [ARTIFACT_HASHES.a1, ARTIFACT_HASHES.a2, ARTIFACT_HASHES.a3] as const;

/** AREA 9 — Evidence content tampering must be detectable via recomputation. */
describe("[C-09] evidence tampering", () => {
  test("[C-09-01] flipping one byte of raw artifact bytes changes the content hash (SUT and reference agree)", () => {
    const tampered = Buffer.from(RAW_ARTIFACTS.a1);
    tampered[5] = (tampered[5] ?? 0) ^ 0x01;
    const recomputed = hashBytes(tampered);
    expect(recomputed).not.toBe(ARTIFACT_HASHES.a1);
    expect(recomputed).toBe(refHashBytes(tampered));
    expect(hashBytes(RAW_ARTIFACTS.a1)).toBe(ARTIFACT_HASHES.a1);
    expect(refHashBytes(RAW_ARTIFACTS.a1)).toBe(ARTIFACT_HASHES.a1);
  });

  test("[C-09-02] swapping one artifact hash in a sealed bundle breaks the declared merkle root", () => {
    const root = merkleRoot([...bundleArtifacts]);
    const fake = hashBytes(Buffer.from("fabricated artifact"));
    const tamperedRoot = merkleRoot([bundleArtifacts[0], fake, bundleArtifacts[2]]);
    expect(tamperedRoot).not.toBe(root);
    expect(tamperedRoot).toBe(refMerkleRoot([bundleArtifacts[0], fake, bundleArtifacts[2]]));
    expect(root).toBe(refMerkleRoot([...bundleArtifacts]));
  });

  test("[C-09-03] merkle root is deterministic under input reordering and duplication", () => {
    const root = merkleRoot([...bundleArtifacts]);
    expect(merkleRoot([bundleArtifacts[2], bundleArtifacts[0], bundleArtifacts[1]])).toBe(root);
    expect(merkleRoot([bundleArtifacts[0], bundleArtifacts[0], bundleArtifacts[1], bundleArtifacts[2]])).toBe(root);
    for (let n = 1; n <= 8; n++) {
      const many = Array.from({ length: n }, (_, i) => hashBytes(Buffer.from(`artifact-${i}`)));
      expect(merkleRoot(many)).toBe(refMerkleRoot(many));
    }
  });

  test("[C-09-04] valid merkle proof verifies under SUT and reference; tampered sibling or root fails", () => {
    const root = merkleRoot([...bundleArtifacts]);
    for (const leaf of bundleArtifacts) {
      const proof = merkleProof([...bundleArtifacts], leaf);
      expect(verifyMerkleProof(root, proof)).toBe(true);
      expect(refVerifyMerkleProof(root, leaf, proof.steps)).toBe(true);
      const badSibling = { ...proof, steps: proof.steps.map((s, i) => (i === 0 ? { sibling: hashBytes(Buffer.from("x")), side: s.side } : s)) };
      expect(verifyMerkleProof(root, badSibling)).toBe(false);
      expect(verifyMerkleProof(hashBytes(Buffer.from("wrong-root")), proof)).toBe(false);
    }
  });

  test("[C-09-05] proof for a leaf not in the bundle is rejected", () => {
    const notInBundle = hashBytes(Buffer.from("not-in-bundle"));
    expect(() => merkleProof([...bundleArtifacts], notInBundle)).toThrow();
  });

  test("[C-09-06] empty evidence bundle has no root", () => {
    expect(() => merkleRoot([])).toThrow();
    expect(() => refMerkleRoot([])).toThrow();
  });

  test("[C-09-07] tampering artifact METADATA (subject/locator/captured_at) changes the artifact content_hash", () => {
    const artifact = EvidenceArtifactSchema.parse(validArtifact());
    const h0 = contentHash(artifact);
    const tampered = EvidenceArtifactSchema.parse(validArtifact({ subject: "commit:DEFACED" }));
    expect(contentHash(tampered)).not.toBe(h0);
    const { signature: _s, ...payload0 } = artifact as Record<string, unknown> & { signature?: unknown };
    void _s;
    expect(h0).toBe(hashObject(Domain.EvidenceArtifact, "artifact.v1", payload0));
  });

  test("[C-09-08][GAP] EvidenceArtifact has no self-declared content_hash field — metadata tampering cannot be caught by comparing a declared digest (only by re-hashing the object)", () => {
    // payload_hash covers the CAS bytes only; the artifact object's own digest
    // is not a field, so a received artifact cannot prove its own integrity
    // the way a sealed Intent can. Detection = consumer recomputes contentHash.
    const parsed = EvidenceArtifactSchema.parse(validArtifact());
    expect("content_hash" in parsed).toBe(false);
    expect(() => EvidenceArtifactSchema.parse(validArtifact({ content_hash: "sha256:" + "ab".repeat(32) }))).toThrow(); // unknown key
  });

  test("[C-09-09][GAP] artifact.payload_hash is only FORMAT-checked by the schema; (bytes, hash) binding needs CAS recomputation outside the delivered layer", () => {
    expect(() => EvidenceArtifactSchema.parse(validArtifact({ payload_hash: "sha256:" + "00".repeat(32) }))).not.toThrow();
  });
});
