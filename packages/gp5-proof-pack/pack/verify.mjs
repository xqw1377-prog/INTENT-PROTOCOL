#!/usr/bin/env node
/**
 * GP5 Proof Pack — ONE-COMMAND third-party verifier.
 *
 *   node verify.mjs          (from inside the pack directory)
 *
 * Self-contained: node builtins + the VENDORED frozen G1 wire library
 * (pack/frozen-lib, a byte-copy of packages/protocol-schema/dist, subtree
 * bb14d937). No repository, no builder claims, no network. Recomputes the
 * complete chain and exits 0 ONLY if every check passes.
 */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const lib = await import(pathToFileURL(path.join(HERE, "frozen-lib", "index.js")).href);
const { canonicalize, contentHash, proofBinding, settlementKey, merkleRoot } = lib;

const sha256 = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
const failures = [];
const checks = [];
function ok(name, cond, detail = "") {
  checks.push(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : ` — ${detail}`}`);
  if (!cond) failures.push(name);
}
const readJson = (rel) => JSON.parse(readFileSync(path.join(HERE, rel), "utf8"));
const readRaw = (rel) => readFileSync(path.join(HERE, rel));

// ————————————————————————— 0. pack manifest integrity
if (!existsSync(path.join(HERE, "pack-manifest.json"))) {
  console.error("pack-manifest.json missing");
  process.exit(1);
}
const manifest = readJson("pack-manifest.json");
for (const entry of manifest.files) {
  ok(`manifest:${entry.file}`, sha256(readRaw(entry.file)) === entry.sha256, entry.file);
}

// ————————————————————————— 1. frozen protocol objects
const intent = readJson("objects/intent.json");
const milestone = readJson("objects/milestone.json");
const claim = readJson("objects/claim.json");
const receipt = readJson("receipt.json");
const dA = readJson("decisions/decision-functional.json");
const dB = readJson("decisions/decision-policy.json");
const registry = readJson("decisions/verifier-registry.json");
const bundle = readJson("evidence/bundle.json");
const artifacts = readJson("evidence/artifacts.json");

ok("intent: content_hash recomputes (frozen G1 seal)", contentHash(intent) === intent.content_hash);
ok("milestone: content_hash recomputes (frozen G1 seal)", contentHash(milestone) === milestone.content_hash);
ok("milestone binds the frozen intent", milestone.intent_hash === intent.content_hash);

// task freeze: EXACT-BYTES hash (gp-execution preflight formula)
ok("task-freeze: exact-bytes sha256 == claim.task_freeze_hash",
  sha256(readRaw("objects/task-freeze.json")) === claim.task_freeze_hash);

// claim: canonical-bytes binding hash (GP4-C formula)
ok("claim: canonical-bytes sha256 == escrow claim binding",
  sha256(Buffer.from(canonicalize(claim), "utf8")) === readJson("settlement/escrow.json").claim_record_hash);

// ————————————————————————— 2. evidence bundle (SEALED; merkle over artifact payload hashes)
ok("evidence bundle: content_hash recomputes", contentHash(bundle) === bundle.content_hash);
ok("evidence bundle: state SEALED", bundle.state === "SEALED");
const artifactList = Array.isArray(artifacts) ? artifacts : (artifacts.artifacts ?? []);
const payloadHashes = artifactList.map((e) => e.artifact?.payload_hash).filter(Boolean);
// raw evidence: each artifact's payload hash recomputes from the pack's raw
// bytes AND is pinned in its cas:// locator
ok("evidence artifacts: payload_hash recomputes from raw bytes + locator pins it",
  artifactList.every((e) => {
    const raw = readRaw(`evidence/raw/${e.key}.bin`);
    const h = sha256(raw);
    return h === e.artifact.payload_hash && String(e.artifact.locator).endsWith(h.slice(7));
  }));
ok("evidence bundle: merkle root recomputes from artifact payload hashes",
  merkleRoot(payloadHashes) === bundle.merkle_root,
  `expected ${bundle.merkle_root}`);
ok("evidence bundle: artifact_hashes list == the sealed payload hashes",
  JSON.stringify([...bundle.artifact_hashes].sort()) === JSON.stringify([...payloadHashes].sort()));
ok("evidence bundle: merkle root == receipt.evidence_root", bundle.merkle_root === receipt.evidence_root);

// ————————————————————————— 3. both verification decisions (R9 + Ed25519)
const REQUIRED_ROLES = new Set(["verifier:gp3-functional", "verifier:gp3-policy"]);
const BINDING_KEYS = ["intent_hash", "milestone_id", "milestone_revision", "bundle_id", "evidence_root", "policy_hash"];
for (const [tag, d] of [["functional", dA], ["policy", dB]]) {
  const { content_hash: _s, signature: _g, ...body } = d;
  ok(`decision/${tag}: content_hash recomputes (seal-stripped)`, contentHash(body) === d.content_hash);
  ok(`decision/${tag}: result == VALID`, d.result === "VALID");
  const expectedBinding = proofBinding({
    intent_hash: d.intent_hash, milestone_id: d.milestone_id, milestone_revision: d.milestone_revision,
    bundle_id: d.bundle_id, evidence_root: d.evidence_root, policy_hash: d.policy_hash,
  });
  ok(`decision/${tag}: R9 proof_binding recomputes`, d.proof_binding === expectedBinding);
  // Ed25519: signature over the UTF-8 bytes of the content_hash STRING, V3 registry key
  const sig = d.signature;
  const keyEntry = (registry.keys ?? []).find((k) => k.verifier_id === d.verifier_id && k.key_id === sig?.key_id);
  ok(`decision/${tag}: signer/key_id resolve in frozen V3 registry`, !!keyEntry && sig.signer === d.verifier_id);
  if (keyEntry) {
    const sigOk = edVerify(null, Buffer.from(d.content_hash, "utf8"), createPublicKey(keyEntry.public_key_pem), Buffer.from(sig.value, "base64"));
    ok(`decision/${tag}: Ed25519 signature verifies`, sigOk);
  }
  ok(`decision/${tag}: distinct verifier role`, REQUIRED_ROLES.has(d.verifier_id));
}
for (const k of BINDING_KEYS) {
  ok(`decisions agree on ${k} (same frozen target)`, dA[k] === dB[k]);
}
// cross-object binding anchors (names differ per frozen schema)
ok("decision bundle_id == sealed bundle", dA.bundle_id === bundle.bundle_id);
ok("decision evidence_root == bundle merkle root", dA.evidence_root === bundle.merkle_root);
ok("decision intent_hash == frozen intent", dA.intent_hash === intent.content_hash);
ok("decision milestone == frozen milestone", dA.milestone_id === milestone.milestone_id && dA.milestone_revision === milestone.milestone_revision);
ok("decision policy_hash == receipt.verification_policy_hash", dA.policy_hash === receipt.verification_policy_hash);
ok("decisions: two DISTINCT content_hashes (two independent verifiers)", dA.content_hash !== dB.content_hash);

// ————————————————————————— 4. OutcomeReceipt
ok("receipt: content_hash recomputes (frozen G1 seal)", contentHash(receipt) === receipt.content_hash);
ok("receipt: accepted_result == ACCEPTED", receipt.accepted_result === "ACCEPTED");
ok("receipt: decision_hashes are unique + strictly ascending",
  receipt.decision_hashes.every((h, i, a) => i === 0 || a[i - 1] < h));
ok("receipt: decision_hashes == exactly the two sealed decisions",
  JSON.stringify(receipt.decision_hashes) === JSON.stringify([dA.content_hash, dB.content_hash].sort()));
ok("receipt: binds the frozen intent", receipt.intent_hash === intent.content_hash);
ok("receipt: binds the frozen milestone", receipt.milestone_id === milestone.milestone_id && receipt.milestone_revision === milestone.milestone_revision);

// ————————————————————————— 5. settlement chain
const escrow = readJson("settlement/escrow.json");
const release = readJson("settlement/release.json");
const journalFiles = existsSync(path.join(HERE, "settlement/journal"))
  ? readdirSync(path.join(HERE, "settlement/journal")).filter((f) => f.endsWith(".json")) : [];
const evidence = readJson("settlement/settlement-evidence.json");
const instruction = readJson("settlement/instruction.json");

ok("escrow: bound to the accepted receipt", escrow.outcome_receipt_hash === receipt.content_hash);
ok("escrow: state RELEASED", escrow.state === "RELEASED");
ok("instruction: content_hash recomputes (frozen G1 seal)", contentHash(instruction) === instruction.content_hash);
ok("instruction: outcome_receipt_hash == receipt hash (receipt is the ONLY authority)",
  instruction.outcome_receipt_hash === receipt.content_hash);
ok("instruction: EXACTLY one output", instruction.outputs.length === 1);
ok("payee: output recipient == immutable ClaimRecord.claimant", instruction.outputs[0].recipient === claim.claimant, claim.claimant);
ok("payee: amount == 10 (frozen GP-001 reward)", instruction.total_amount === "10" && instruction.outputs[0].amount === "10");
ok("asset: frozen triple solana-devnet/USDC-test/6",
  instruction.outputs[0].asset.network === "solana-devnet" && instruction.outputs[0].asset.asset === "USDC-test" && instruction.outputs[0].asset.decimals === 6);

const sk = settlementKey({ outcome_receipt_hash: receipt.content_hash, escrow_ref: escrow.escrow_ref, nonce: BigInt(instruction.nonce) });
ok("settlement_key: frozen G1 derivation recomputes", sk === release.settlement_key);
ok("release: pair == (escrow_ref, outcome_receipt_hash)",
  release.escrow_ref === escrow.escrow_ref && release.outcome_receipt_hash === receipt.content_hash);
ok("release: amount/asset match the frozen reward",
  release.amount === "10" && release.asset.network === "solana-devnet" && release.asset.asset === "USDC-test" && release.asset.decimals === 6);

// economic exactly-once: exactly ONE release file on disk in the pack
const releaseFilesOnDisk = existsSync(path.join(HERE, "settlement/releases"))
  ? readdirSync(path.join(HERE, "settlement/releases")).filter((f) => f.endsWith(".json")) : ["release.json"];
ok("economic exactly-once: exactly one release record in the pack", releaseFilesOnDisk.length === 1);

// journal: the winning instruction is journaled under its settlement_key hex
const journalHex = journalFiles.map((f) => f.replace(/\.json$/, ""));
ok("instruction journal: winner recorded under hex(settlement_key)", journalHex.includes(sk.slice(7)));

// sealed settlement evidence (GP4-F)
const { evidence_hash: _eh, ...evPreimage } = evidence;
ok("settlement-evidence: seal recomputes (canonical-bytes sha256)",
  sha256(Buffer.from(canonicalize(evPreimage), "utf8")) === evidence.evidence_hash);
ok("settlement-evidence: links bind receipt + claim + frozen artifacts",
  evidence.links.intent_hash === intent.content_hash
  && evidence.links.milestone_id === milestone.milestone_id
  && evidence.links.evidence_root === bundle.merkle_root
  && evidence.links.task_freeze_hash === claim.task_freeze_hash
  && evidence.links.claimant === claim.claimant);
ok("settlement-evidence: exactly one release recorded", evidence.release !== null && evidence.release.outcome_receipt_hash === receipt.content_hash);

// ————————————————————————— 6. runtime journal (frozen state machines)
const journalLines = readRaw("runtime-journal.jsonl").toString("utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
const states = new Map();
const claims = new Map();
for (const e of [...journalLines].sort((a, b) => a.seq - b.seq)) {
  if (!e.decision.accepted || !e.decision.to) continue;
  states.set(`${e.decision.machine}:${e.decision.entity}`, e.decision.to);
  if (e.claim) claims.set(e.decision.entity, e.claim);
}
ok("runtime: bounty GP-001 reached SETTLED", states.get("bounty:GP-001") === "SETTLED");
ok("runtime: settlement machine reached RELEASED", states.get("settlement:escrow:gp-001-local") === "RELEASED");
ok("runtime: immutable ClaimRecord == pack claim.json", JSON.stringify(claims.get("GP-001")) === JSON.stringify(claim));
// no illegal shortcut: settlement never jumped LOCKED→RELEASED (walk recorded through ELIGIBLE)
const settlementWalk = journalLines
  .filter((e) => e.decision.machine === "settlement" && e.decision.accepted)
  .map((e) => `${e.decision.from}->${e.decision.to}`);
ok("runtime: settlement walked LOCKED→ELIGIBLE→RELEASED (no shortcut)",
  JSON.stringify(settlementWalk) === JSON.stringify(["LOCKED->ELIGIBLE", "ELIGIBLE->RELEASED"]));

// ————————————————————————— summary
console.log(checks.join("\n"));
const passed = checks.length - failures.length;
console.log(`\n${passed}/${checks.length} checks passed`);
if (failures.length > 0) {
  console.error(`FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("PROOF PACK VERIFIED — the complete chain recomputes without trusting any builder claim.");
