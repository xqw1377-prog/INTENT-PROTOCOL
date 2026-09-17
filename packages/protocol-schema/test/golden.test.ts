import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  canonicalize, hashObject, Domain, merkleRoot, merkleProof, verifyMerkleProof,
  proofBinding, settlementKey, seal,
  IntentContractSchema, CriterionSchema, EvidenceArtifactSchema,
  EvidenceBundleSchema, VerificationDecisionSchema, SettlementInstructionSchema,
} from "../src/index.js";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const GOLDEN = JSON.parse(readFileSync(join(PKG, "fixtures/golden-vectors.json"), "utf8"));

const SCHEMAS: Record<string, (v: unknown) => unknown> = {
  "intent.v1": (v) => IntentContractSchema.parse(v),
  "criterion.v1": (v) => CriterionSchema.parse(v),
  "artifact.v1": (v) => EvidenceArtifactSchema.parse(v),
  "bundle.v1": (v) => EvidenceBundleSchema.parse(v),
  "decision.v1": (v) => VerificationDecisionSchema.parse(v),
  "settlement.v1": (v) => SettlementInstructionSchema.parse(v),
};
const DOMAIN_OF: Record<string, Domain> = {
  "intent.v1": Domain.Intent,
  "criterion.v1": Domain.Intent,
  "artifact.v1": Domain.EvidenceArtifact,
  "bundle.v1": Domain.EvidenceBundle,
  "decision.v1": Domain.VerificationDecision,
  "settlement.v1": Domain.SettlementInstruction,
};
const SEAL_SCHEMA: Record<string, any> = {
  "intent.v1": IntentContractSchema, "criterion.v1": CriterionSchema,
  "artifact.v1": EvidenceArtifactSchema, "bundle.v1": EvidenceBundleSchema,
  "decision.v1": VerificationDecisionSchema, "settlement.v1": SettlementInstructionSchema,
};

const strip = (o: any) => {
  const { content_hash, signature, ...rest } = o;
  return rest;
};

describe("golden vectors — valid", () => {
  for (const v of GOLDEN.valid) {
    test(`${v.name}: input parses, canonical + digest match`, () => {
      const parsed = SCHEMAS[v.schema_version]!(v.input);
      expect(canonicalize(strip(parsed))).toBe(v.canonical);
      expect(hashObject(DOMAIN_OF[v.schema_version]!, v.schema_version, strip(parsed))).toBe(v.content_hash);
    });
  }

  test("seal() reproduces every golden content_hash", () => {
    for (const v of GOLDEN.valid) {
      const sealed = seal(SEAL_SCHEMA[v.schema_version]!, v.input);
      expect(sealed.content_hash).toBe(v.content_hash);
    }
  });

  test("derived values: merkle root, proof binding, settlement key", () => {
    const bundle = GOLDEN.valid.find((v: any) => v.name === "evidence-bundle-v1-sealed")!.input;
    const decision = GOLDEN.valid.find((v: any) => v.name === "verification-decision-v1")!.input;
    const stl = GOLDEN.valid.find((v: any) => v.name === "settlement-instruction-v1")!.input;
    expect(merkleRoot(bundle.artifact_hashes)).toBe(GOLDEN.derived.bundle_merkle_root);
    expect(merkleRoot(bundle.artifact_hashes)).toBe(bundle.merkle_root);
    expect(proofBinding({
      intent_hash: decision.intent_hash,
      milestone_revision: decision.milestone_revision,
      evidence_root: decision.evidence_root,
      policy_hash: decision.policy_hash,
    })).toBe(GOLDEN.derived.decision_proof_binding);
    expect(settlementKey({ proof_binding: stl.proof_binding, escrow_id: stl.escrow_ref, settlement_nonce: 0n }))
      .toBe(GOLDEN.derived.settlement_key);
  });
});

describe("golden vectors — equivalence (same semantics → same digest)", () => {
  for (const v of GOLDEN.equivalence) {
    test(v.name, () => {
      const sa = v.a.schema_version;
      expect(canonicalize(strip(v.a))).toBe(canonicalize(strip(v.b)));
      expect(hashObject(DOMAIN_OF[sa]!, sa, strip(v.a))).toBe(hashObject(DOMAIN_OF[sa]!, sa, strip(v.b)));
    });
  }
});

describe("golden vectors — negative", () => {
  for (const v of GOLDEN.negative) {
    test(`${v.name} → ${v.expect}`, () => {
      switch (v.expect) {
        case "schema_parse_error": {
          const schema = SEAL_SCHEMA[v.input.schema_version];
          if (!schema) {
            // unsupported version: must fail to find/parse
            expect(() => IntentContractSchema.parse(v.input)).toThrow();
            return;
          }
          expect(() => schema.parse(v.input)).toThrow();
          return;
        }
        case "hash_mismatch":
          expect(() => seal(IntentContractSchema as any, v.input)).toThrow(/content_hash mismatch/);
          return;
        case "merkle_mismatch":
          expect(merkleRoot(v.input.artifact_hashes)).not.toBe(v.input.merkle_root);
          return;
        case "binding_mismatch":
          expect(proofBinding({
            intent_hash: v.input.intent_hash,
            milestone_revision: v.input.milestone_revision,
            evidence_root: v.input.evidence_root,
            policy_hash: v.input.policy_hash,
          })).not.toBe(v.input.proof_binding);
          return;
      }
    });
  }

  test("tampered artifact breaks sealed bundle merkle root", () => {
    const bundle = GOLDEN.valid.find((v: any) => v.name === "evidence-bundle-v1-sealed")!.input;
    const forged = [...bundle.artifact_hashes];
    forged[0] = "sha256:" + "ff".repeat(32);
    expect(merkleRoot(forged)).not.toBe(bundle.merkle_root);
  });

  test("merkle proof: valid leaf verifies, forged leaf rejected", () => {
    const bundle = GOLDEN.valid.find((v: any) => v.name === "evidence-bundle-v1-sealed")!.input;
    for (const h of bundle.artifact_hashes) {
      expect(verifyMerkleProof(bundle.merkle_root, merkleProof(bundle.artifact_hashes, h))).toBe(true);
    }
    const forged = { ...merkleProof(bundle.artifact_hashes, bundle.artifact_hashes[0]), leaf: "sha256:" + "ee".repeat(32) };
    expect(verifyMerkleProof(bundle.merkle_root, forged as any)).toBe(false);
  });
});

describe("golden vectors — semantic change changes digest", () => {
  for (const v of GOLDEN.semantic_change) {
    test(v.name, () => {
      if (v.name.includes("criterion")) {
        const h = (o: any) => hashObject(Domain.Intent, "intent.v1", strip(o));
        expect(h(v.base)).not.toBe(h(v.mutated));
      } else {
        expect(proofBinding(v.base)).not.toBe(proofBinding(v.mutated));
      }
    });
  }
});

describe("determinism evidence", () => {
  test("repeated serialization/hash is identical for 1000 iterations", () => {
    const v = GOLDEN.valid[0];
    const ref = hashObject(DOMAIN_OF[v.schema_version]!, v.schema_version, strip(v.input));
    for (let i = 0; i < 1000; i++) {
      const parsed = IntentContractSchema.parse(JSON.parse(JSON.stringify(v.input)));
      expect(hashObject(Domain.Intent, "intent.v1", strip(parsed))).toBe(ref);
      expect(canonicalize(strip(parsed))).toBe(v.canonical);
    }
  });

  test("cross-process: generator --check exits 0 (no drift)", () => {
    const out = execFileSync("node", [join(PKG, "scripts/generate-golden.mjs"), "--check"], { encoding: "utf8" });
    expect(out).toContain("up to date");
  });
});
