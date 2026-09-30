#!/usr/bin/env node
/**
 * PRODUCTION-HARDENING-R0 / PH-03 — INDEPENDENT verifier for the frozen GP5
 * proof pack. THIRD-PARTY reimplementation: imports NOTHING from
 * protocol-schema / frozen-lib / any SUT code — only Node builtins. It
 * recomputes the cryptographic chain of the ORIGINAL committed pack bytes:
 *
 *   manifest file hashes → G1 object content hashes (IPC-JSON-1 + Domain
 *   framing) → evidence merkle root → proof binding → decision signatures
 *   (ed25519) → OutcomeReceipt 2-of-2 binding → SettlementInstruction hash +
 *   settlement key → economic exactly-once (one release record)
 *
 * Usage: node verify.mjs [path-to-pack]   (default: the committed GP5 pack)
 */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PACK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../gp5-proof-pack/pack");
const PACK = path.resolve(process.argv[2] ?? DEFAULT_PACK);
const failures = [];
const checks = [];
process.on("uncaughtException", (e) => {
  checks.push(`FAIL  verifier internal error — ${String(e.message).slice(0, 200)}`);
  failures.push("internal-error");
  console.log(checks.join("\n"));
  console.log(`\n${failures.length} CHECK(S) FAILED (tampered or malformed pack)`);
  process.exit(1);
});
const ok = (name, cond, detail = "") => {
  checks.push(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : ` — ${detail}`}`);
  if (!cond) failures.push(name);
};
const readJson = (rel) => JSON.parse(readFileSync(path.join(PACK, rel), "utf8"));

// ————————— independent G1 reimplementation (IPC-JSON-1 + Domain framing) —————————
function hasLoneSurrogate(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(i + 1); if (n >= 0xdc00 && n <= 0xdfff) { i++; continue; } return true; }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}
function g1(v, p) {
  if (v === null) return "null";
  switch (typeof v) {
    case "string": if (hasLoneSurrogate(v)) throw new Error(`surrogate at ${p}`); return JSON.stringify(v.normalize("NFC"));
    case "boolean": return v ? "true" : "false";
    case "number": if (Object.is(v, -0) || !Number.isSafeInteger(v)) throw new Error(`bad number at ${p}`); return String(v);
    case "undefined": throw new Error(`undefined at ${p}`);
    case "object": break;
    default: throw new Error(`type ${typeof v} at ${p}`);
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => g1(x, `${p}[${i}]`)).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const k of keys) if (hasLoneSurrogate(k) || k.normalize("NFC") !== k) throw new Error(`bad key at ${p}`);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${g1(v[k], p ? `${p}.${k}` : k)}`).join(",")}}`;
}
function g1Hash(domain, schemaVersion, payload) {
  const h = createHash("sha256");
  h.update(Buffer.from(domain, "utf8")); h.update(Buffer.from([0]));
  h.update(Buffer.from(schemaVersion, "utf8")); h.update(Buffer.from([0]));
  h.update(Buffer.from(g1(payload, ""), "utf8"));
  return "sha256:" + h.digest("hex");
}
/** merkle root per frozen G1 (merkle.ts): leaves are UNIQUE + byte-sorted;
 * leaf = sha256("intent-protocol/v1/merkle-leaf"||0x00||raw32);
 * node  = sha256("intent-protocol/v1/merkle-node"||0x00||l||r); odd → promote. */
function merkleRoot(leaves) {
  const raw = [...new Set(leaves)].map((l) => Buffer.from(l.slice(7), "hex"));
  raw.sort((a, b) => Buffer.compare(a, b));
  const pref = (tag) => Buffer.concat([Buffer.from(tag, "utf8"), Buffer.from([0])]);
  const LEAF = pref("intent-protocol/v1/merkle-leaf");
  const NODE = pref("intent-protocol/v1/merkle-node");
  let level = raw.map((h) => createHash("sha256").update(LEAF).update(h).digest());
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i], r = level[i + 1];
      next.push(r ? createHash("sha256").update(NODE).update(l).update(r).digest() : l);
    }
    level = next;
  }
  return "sha256:" + level[0].toString("hex");
}
/** proof_binding per frozen R9: domain || 0x00 || intent_hash_raw32 || milestone_uuid16 || rev u32BE || bundle_uuid16 || evidence_root_raw32 || policy_hash_raw32 */
function proofBinding(p) {
  const raw = (h) => Buffer.from(h.slice(7), "hex");
  const uuid = (u) => { const b = []; for (const part of u.split("-")) b.push(Buffer.from(part, "hex")); return Buffer.concat(b); };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b; };
  return "sha256:" + createHash("sha256").update(Buffer.from("intent-protocol/v1/proof-binding", "utf8")).update(Buffer.from([0]))
    .update(raw(p.intent_hash)).update(uuid(p.milestone_id)).update(u32(p.milestone_revision))
    .update(uuid(p.bundle_id)).update(raw(p.evidence_root)).update(raw(p.policy_hash)).digest("hex");
}
const ed25519Verify = (pubkey32, msg, sig) => {
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubkey32)]), format: "der", type: "spki" });
  return edVerify(null, Buffer.from(msg), key, Buffer.from(sig));
};

// ————————— load + manifest —————————
const manifest = readJson("pack-manifest.json");
for (const { file, sha256 } of manifest.files) {
  const actual = "sha256:" + createHash("sha256").update(readFileSync(path.join(PACK, file))).digest("hex");
  ok(`manifest hash: ${file}`, actual === sha256);
}

// ————————— G1 object chain —————————
const resealed = (label, rel, domain) => {
  const obj = readJson(rel);
  const { content_hash, signature, ...body } = obj;
  void signature;
  const recomputed = g1Hash(domain, obj.schema_version, body);
  ok(`${label} content_hash recomputes`, recomputed === content_hash, `${recomputed.slice(0, 18)} vs ${String(content_hash).slice(0, 18)}`);
  return obj;
};
const intent = resealed("intent", "objects/intent.json", "intent-protocol/v1/intent");
const milestone = resealed("milestone", "objects/milestone.json", "intent-protocol/v1/milestone");
const receipt = resealed("OutcomeReceipt", "receipt.json", "intent-protocol/v1/outcome-receipt");
const instruction = resealed("SettlementInstruction", "settlement/instruction.json", "intent-protocol/v1/settlement-instruction");
const dF = resealed("VerifierDecision A", "decisions/decision-functional.json", "intent-protocol/v1/verification-decision");
const dP = resealed("VerifierDecision B", "decisions/decision-policy.json", "intent-protocol/v1/verification-decision");
const bundle = readJson("evidence/bundle.json");
const artifacts = readJson("evidence/artifacts.json");
const registry = readJson("decisions/verifier-registry.json");

// bundle seal + merkle
ok("bundle is SEALED", bundle.state === "SEALED");
const recomputedRoot = merkleRoot(artifacts.map((a) => a.payload_hash));
ok("evidence merkle_root recomputes", recomputedRoot === bundle.merkle_root, `${recomputedRoot.slice(0, 18)} vs ${String(bundle.merkle_root).slice(0, 18)}`);

// proof binding recompute (R9) from frozen identities
const binding = proofBinding({ intent_hash: intent.content_hash, milestone_id: bundle.milestone_id, milestone_revision: bundle.milestone_revision, bundle_id: bundle.bundle_id, evidence_root: bundle.merkle_root, policy_hash: bundle.policy_hash });
ok("R9 proof_binding recomputes", binding === dF.proof_binding && binding === dP.proof_binding);

// decision signatures (ed25519, registry keys)
for (const [label, d, role] of [["A", dF, "verifier:gp3-functional"], ["B", dP, "verifier:gp3-policy"]]) {
  const key = registry.keys.find((k) => k.verifier_id === role);
  ok(`${label} registry key present`, !!key);
  if (key) {
    const pemBody = key.public_key_pem.replace(/-----(BEGIN|END) PUBLIC KEY-----|\s/g, "");
    const der = Buffer.from(pemBody, "base64");
    // raw 32B key = last 32 bytes of the SPKI DER
    // the frozen signing convention signs the UTF-8 form of "sha256:<hex>" (the
    // Hash STRING), not the raw 32 digest bytes
    ok(`${label} ed25519 signature verifies`, ed25519Verify(der.subarray(der.length - 32), Buffer.from(d.content_hash, "utf8"), Buffer.from(d.signature.value, "base64")));
    ok(`${label} decision result is VALID`, d.result === "VALID");
  }
}

// receipt 2-of-2 binding
ok("receipt binds BOTH decision hashes", JSON.stringify([...receipt.decision_hashes].sort()) === JSON.stringify([dF.content_hash, dP.content_hash].sort()));
ok("receipt binds the intent", receipt.intent_hash === intent.content_hash);
ok("receipt binds the milestone", receipt.milestone_id === milestone.milestone_id);

// settlement instruction + key
ok("instruction binds the receipt", instruction.outcome_receipt_hash === receipt.content_hash);
ok("instruction escrow_ref is the frozen pair partner", instruction.escrow_ref === "escrow:gp-001-local");
const nonceBE = Buffer.alloc(8); nonceBE.writeBigUInt64BE(BigInt(instruction.nonce));
const sKey = "sha256:" + createHash("sha256")
  .update(Buffer.from("intent-protocol/v1/settlement-key", "utf8")).update(Buffer.from([0]))
  .update(Buffer.from(instruction.outcome_receipt_hash.slice(7), "hex"))   // raw32, NOT the hex string
  .update(Buffer.from(instruction.escrow_ref, "utf8")).update(Buffer.from([0])).update(nonceBE).digest("hex");
const release = readJson("settlement/release.json");
ok("settlement_key recomputes (frozen formula)", sKey === release.settlement_key, `${sKey.slice(0, 18)}…`);
ok("economic exactly-once: the release record binds the same receipt", release.outcome_receipt_hash === receipt.content_hash);

// ————————— finish —————————
console.log(checks.join("\n"));
console.log("");
if (failures.length) { console.log(`${failures.length} CHECK(S) FAILED`); process.exit(1); }
console.log(`${checks.length}/${checks.length} checks passed`);
console.log("GP5 PROOF PACK INDEPENDENTLY VERIFIED — no protocol-schema, frozen-lib, or SUT code used; the cryptographic chain recomputes from the committed bytes alone.");
