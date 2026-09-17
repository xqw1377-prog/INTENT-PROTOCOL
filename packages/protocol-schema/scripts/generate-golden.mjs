/**
 * Regenerates fixtures/golden-vectors.json from the *current* implementation.
 * Run: npm run build && node packages/protocol-schema/scripts/generate-golden.mjs
 *      ... --check   exits non-zero if recomputed vectors differ from the file (drift gate).
 */
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  canonicalize, hashObject, Domain, merkleRoot, settlementKey,
} from "../dist/index.js";
import * as F from "./fixtures.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/golden-vectors.json");

function strip(o) {
  const { content_hash, signature, ...rest } = o;
  return rest;
}
function entry(name, schemaVersion, input) {
  return {
    name,
    schema_version: schemaVersion,
    input,
    canonical: canonicalize(strip(input)),
    content_hash: hashObject(DOMAIN_OF[schemaVersion], schemaVersion, strip(input)),
  };
}
const DOMAIN_OF = {
  "intent.v1": Domain.Intent,
  "criterion.v1": Domain.Intent,
  "artifact.v1": Domain.EvidenceArtifact,
  "bundle.v1": Domain.EvidenceBundle,
  "decision.v1": Domain.VerificationDecision,
  "settlement.v1": Domain.SettlementInstruction,
};

const intent = F.intent();
const crit = F.criterion();
const art = F.artifact("8", "commit:deadbeef", F.H(0xb1));
const bundle = F.bundle();
const dec = F.decision();
const stl = F.settlement();

// Equivalence vectors: semantically identical objects produced through
// different constructions must serialize and hash identically.
const deepShuffle = (v) => Array.isArray(v)
  ? v.map(deepShuffle)
  : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, deepShuffle(x)]))
    : v;
const reordered = deepShuffle(intent);
const nfc = "café";            // U+00E9 composed
const nfd = "cafe\u0301";      // e + U+0301 decomposed — NFC normalize must unify
const intentNFC = F.intent({ goal: { ...intent.goal, statement: nfc } });
const intentNFD = F.intent({ goal: { ...intent.goal, statement: nfd } });
const intentFloatVersion = F.intent({ version: 1.0 }); // 1.0 === 1 after JSON parse → canonical "1"

const vectors = {
  $doc: "S0 golden vectors. Regenerate with scripts/generate-golden.mjs. Any digest change here is a protocol-breaking change.",
  valid: [
    entry("intent-contract-v1", "intent.v1", intent),
    entry("criterion-v1", "criterion.v1", crit),
    entry("evidence-artifact-v1", "artifact.v1", art),
    entry("evidence-bundle-v1-sealed", "bundle.v1", bundle),
    entry("verification-decision-v1", "decision.v1", dec),
    entry("settlement-instruction-v1", "settlement.v1", stl),
    entry("settlement-fractional-decimal", "settlement.v1", F.settlement({
      outputs: [
        { recipient: "agent:executor_01", asset: F.ASSET, amount: "0.01", reason: "a" },
        { recipient: "org:platform", asset: F.ASSET, amount: "0.02", reason: "b" },
      ],
      total_amount: "0.03",
    })),
  ],
  derived: {
    bundle_merkle_root: bundle.merkle_root,
    decision_proof_binding: dec.proof_binding,
    settlement_key: settlementKey({ proof_binding: stl.proof_binding, escrow_id: stl.escrow_ref, settlement_nonce: 0n }),
  },
  equivalence: [
    { name: "key-ordering", expect: "same digest", a: intent, b: reordered },
    { name: "unicode-nfc-vs-nfd", expect: "same digest", a: intentNFC, b: intentNFD },
    { name: "numeric-1.0-vs-1", expect: "same canonical bytes", a: F.intent({ version: 1 }), b: intentFloatVersion },
  ],
  negative: [
    { name: "unsupported-schema-version", input: F.intent({ schema_version: "intent.v2" }), expect: "schema_parse_error" },
    { name: "null-for-optional-field", input: F.intent({ deadline: null }), expect: "schema_parse_error" },
    { name: "missing-required-field", input: (() => { const o = F.intent(); delete o.owner_subject; return o; })(), expect: "schema_parse_error" },
    { name: "unknown-field", input: { ...F.intent(), surprise: 1 }, expect: "schema_parse_error" },
    { name: "non-integer-number", input: F.intent({ version: 1.5 }), expect: "schema_parse_error" },
    { name: "duplicate-artifact-hash", input: F.bundle({ artifact_hashes: [F.H(0xb1), F.H(0xb1)] }), expect: "schema_parse_error" },
    { name: "duplicate-criterion-id", input: F.intent({ success_criteria: [F.criterion("dup"), F.criterion("dup", "different assertion")] }), expect: "schema_parse_error" },
    { name: "duplicate-constraint-id", input: F.intent({ constraints: [
      { constraint_id: "c1", kind: "SCOPE", statement: "a" },
      { constraint_id: "c1", kind: "TIME", statement: "b" },
    ] }), expect: "schema_parse_error" },
    { name: "non-canonical-decimal", input: F.settlement({ total_amount: "1650.00" }), expect: "schema_parse_error" },
    { name: "settlement-total-mismatch", input: F.settlement({ total_amount: "1600" }), expect: "schema_parse_error" },
    { name: "bundle-merkle-mismatch", input: F.bundle({ artifact_hashes: [F.H(0xb1), F.H(0xcc)] }), expect: "schema_parse_error" },
    { name: "decision-binding-mismatch", input: F.decision({ milestone_revision: 2 }), expect: "schema_parse_error" },
    { name: "non-nfc-object-key", raw: { "\u00e9": 1, "e\u0301": 2 }, expect: "canonical_error" },
    { name: "sealed-bundle-without-merkle-root", input: F.bundle({ merkle_root: undefined }), expect: "schema_parse_error" },
    { name: "v1-with-parent-hash", input: F.intent({ parent_hash: F.H(0x99) }), expect: "schema_parse_error" },
    { name: "v2-without-change-reason", input: F.intent({ version: 2, parent_hash: F.H(0x99) }), expect: "schema_parse_error" },
    { name: "tampered-content-hash", input: { ...intent, content_hash: F.H(0xdead) }, expect: "hash_mismatch" },
    { name: "tampered-merkle-root", input: F.bundle({ merkle_root: F.H(0xdead) }), expect: "merkle_mismatch" },
    { name: "tampered-proof-binding", input: F.decision({ proof_binding: F.H(0xdead) }), expect: "binding_mismatch" },
  ],
  semantic_change: [
    {
      name: "changed-criterion-changes-intent-digest",
      base: intent,
      mutated: F.intent({ success_criteria: [F.criterion("crit-tests", "required test suite passes 29/30")] }),
      expect: "different digest",
    },
    {
      name: "tampered-evidence-root-changes-proof-binding",
      base: { intent_hash: dec.intent_hash, milestone_revision: 1, evidence_root: dec.evidence_root, policy_hash: dec.policy_hash },
      mutated: { intent_hash: dec.intent_hash, milestone_revision: 1, evidence_root: F.H(0xbeef), policy_hash: dec.policy_hash },
      expect: "different digest",
    },
  ],
};

const json = JSON.stringify(vectors, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== json) {
    console.error("GOLDEN VECTOR DRIFT: file differs from recomputed vectors");
    process.exit(1);
  }
  console.log("golden vectors up to date");
} else {
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT}`);
}
