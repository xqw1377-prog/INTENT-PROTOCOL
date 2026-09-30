#!/usr/bin/env node
/**
 * TESTNET-R1 / T5 — THIRD-PARTY OFFLINE verifier for the Testnet Proof Pack
 * (T5-R1 hardened).
 *
 *   node verify.mjs      (from inside the pack directory)
 *
 * Self-contained: Node builtins only. NO network, NO repository, NO builder
 * claims. Evidence model, stated honestly in two layers:
 *
 *   LAYER 1 — OFFLINE-VERIFIABLE (cryptographic/semantic, from pack bytes alone):
 *     · signed transaction authenticity: message re-serialized, Ed25519
 *       signatures verified over it, signer-prefix role layout sealed
 *       (2 required: Treasury fee payer, Operator), instruction payload
 *       decoded from the signed bytes, EconomicReleaseDigest and release PDA
 *       re-derived, PDA membership checked
 *     · the SUPPLIED ChainReleaseV1 raw bytes decode fully (146-byte frozen
 *       layout) and bind to receipt / claimant / amount / PDA
 *     · OutcomeReceipt content_hash RECOMPUTED via the frozen G1 rules
 *     · GP4 SettlementInstruction binding recomputed (its own content_hash)
 *     · cross-layer equality: raw bytes ⇄ semantic fields ⇄ frozen anchors
 *
 *   LAYER 2 — RPC-OBSERVED EVIDENCE (trusted to the pack builder/RPC, labeled):
 *     · the tx's chain inclusion (slot, err) and token balance deltas
 *     · that the supplied ChainReleaseV1 bytes were observed AT the Devnet
 *       release-PDA account (getAccountInfo — no account inclusion/state
 *       proof is claimed; the BYTES' semantics are Layer 1, their on-chain
 *       ORIGIN is Layer 2)
 *     · the "world now" snapshot (caps=10, balances)
 *
 * Future-second-release denial comes from the ON-CHAIN program semantics
 * (T2 evidence: duplicate → Custom(108)), NOT from this snapshot.
 */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const failures = [];
const checks = [];
process.on("uncaughtException", (e) => {
  checks.push(`FAIL  verifier internal error — ${String(e.message).slice(0, 200)}`);
  failures.push("internal-error");
  console.log(checks.join("\n"));
  console.log(`\n${failures.length} CHECK(S) FAILED (tampered or malformed pack)`);
  process.exit(1);
});
function ok(name, cond, detail = "") {
  checks.push(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : ` — ${detail}`}`);
  if (!cond) failures.push(name);
}
function readJson(rel) {
  try { return JSON.parse(readFileSync(path.join(HERE, rel), "utf8")); }
  catch (e) { ok(`pack file readable: ${rel}`, false, String(e.message).slice(0, 120)); return undefined; }
}

// ————————————————— self-contained crypto (no repo imports) —————————————————
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s) {
  let n = 0n;
  for (const ch of s) { const v = B58.indexOf(ch); if (v < 0) throw new Error(`bad base58 ${ch}`); n = n * 58n + BigInt(v); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch === "1") bytes.unshift(0); else break; }
  return new Uint8Array(bytes);
}
function b58encode(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}
const P = 2n ** 255n - 19n;
function modPow(b, e, m) { b %= m; let r = 1n; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
const D = ((P - 121665n % P) * modPow(121666n, P - 2n, P)) % P;
function isOnCurve(bytes) { // curve25519-dalek decompress semantics (runtime authority)
  if (bytes.length !== 32) return false;
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  y &= (1n << 255n) - 1n; y %= P;
  const yy = y * y % P, u = (yy - 1n + P) % P, v = (D * yy + 1n) % P;
  if (v === 0n) return u === 0n;
  const x2 = u * modPow(v, P - 2n, P) % P;
  if (x2 === 0n) return true;
  return modPow(x2, (P - 1n) / 2n, P) === 1n;
}
function findProgramAddress(seeds, programId) {
  // OFFICIAL preimage (T1-R1 frozen): seed1 || … || seedN || bump || programId || "ProgramDerivedAddress"
  for (let bump = 255; bump >= 1; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Buffer.from([bump])); h.update(programId); h.update(Buffer.from("ProgramDerivedAddress", "utf8"));
    const c = new Uint8Array(h.digest());
    if (!isOnCurve(c)) return { address: c, bump };
  }
  throw new Error("no PDA");
}

// ————————————————— frozen G1 hashing (IPC-JSON-1 + Domain framing) —————————————————
// Vendored THIRD-PARTY reimplementation, byte-compatible with the frozen rules.
function hasLoneSurrogate(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = s.charCodeAt(i + 1); if (n >= 0xdc00 && n <= 0xdfff) { i++; continue; } return true; }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}
function g1Serialize(v, p) {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      if (hasLoneSurrogate(v)) throw new Error(`unpaired surrogate at ${p}`);
      return JSON.stringify(v.normalize("NFC"));
    case "boolean": return v ? "true" : "false";
    case "number":
      if (Object.is(v, -0)) throw new Error(`-0 at ${p}`);
      if (!Number.isSafeInteger(v)) throw new Error(`unsafe number at ${p}`);
      return String(v);
    case "undefined": throw new Error(`undefined at ${p}`);
    case "object": break;
    default: throw new Error(`type ${typeof v} at ${p}`);
  }
  if (Array.isArray(v)) return `[${v.map((x, i) => g1Serialize(x, `${p}[${i}]`)).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const k of keys) { if (hasLoneSurrogate(k) || k.normalize("NFC") !== k) throw new Error(`bad key at ${p}`); }
  return `{${keys.map((k) => `${JSON.stringify(k)}:${g1Serialize(v[k], p ? `${p}.${k}` : k)}`).join(",")}}`;
}
/** Frozen G1 object hash: DOMAIN || 0x00 || schema_version || 0x00 || canonical_json(payload). */
function g1HashObject(domain, schemaVersion, payload) {
  const h = createHash("sha256");
  h.update(Buffer.from(domain, "utf8")); h.update(Buffer.from([0]));
  h.update(Buffer.from(schemaVersion, "utf8")); h.update(Buffer.from([0]));
  h.update(Buffer.from(g1Serialize(payload, ""), "utf8"));
  return "sha256:" + h.digest("hex");
}

// ————————————————— compact-u16 + legacy message decoding + ed25519 —————————————————
function readCompactU16(bytes, off) {
  let val = 0, shift = 0, i = off;
  for (;;) {
    const b = bytes[i]; i++;
    val += (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 21) throw new Error("compact-u16 overflow");
  }
  return [val, i];
}
function decodeLegacyMessage(msg) {
  let i = 0;
  const numRequiredSignatures = msg[i]; i++;
  i++; i++; // readonly headers
  const [numKeys, j] = readCompactU16(msg, i); i = j;
  const accountKeys = [];
  for (let k = 0; k < numKeys; k++) { accountKeys.push(b58encode(msg.subarray(i, i + 32))); i += 32; }
  const recentBlockhash = b58encode(msg.subarray(i, i + 32)); i += 32;
  const [numIx, j2] = readCompactU16(msg, i); i = j2;
  const instructions = [];
  for (let n = 0; n < numIx; n++) {
    const programIdIndex = msg[i]; i++;
    const [numAccounts, j3] = readCompactU16(msg, i); i = j3;
    const accounts = Array.from(msg.subarray(i, i + numAccounts)); i += numAccounts;
    const [dataLen, j4] = readCompactU16(msg, i); i = j4;
    const data = msg.subarray(i, i + dataLen); i += dataLen;
    instructions.push({ programIdIndex, accounts, data });
  }
  return { numRequiredSignatures, accountKeys, recentBlockhash, instructions };
}
const DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
function ed25519Verify(pubkey32, msgBytes, sig64) {
  const key = createPublicKey({ key: Buffer.concat([DER_PREFIX, Buffer.from(pubkey32)]), format: "der", type: "spki" });
  return edVerify(null, Buffer.from(msgBytes), key, Buffer.from(sig64));
}

// ————————————————— load the pack —————————————————
for (const f of ["pack-manifest.json", "tx.json", "release-pda.json", "receipt.json", "claim.json", "authorization.json", "world-now.json", "gp4-instruction.json"]) {
  ok(`pack file present: ${f}`, existsSync(path.join(HERE, f)));
}
const manifest = readJson("pack-manifest.json") ?? { files: [], binding_summary: {} };
const tx = readJson("tx.json") ?? {};
const pda = readJson("release-pda.json") ?? { chain_release: {}, caps: {}, derived_from: {} };
const receipt = readJson("receipt.json") ?? {};
const claim = readJson("claim.json") ?? {};
const auth = readJson("authorization.json") ?? { economic_release_key: {}, authorization_root: {}, payee_binding: {} };
const world = readJson("world-now.json") ?? {};
const gp4 = readJson("gp4-instruction.json") ?? {};
const bs = manifest.binding_summary ?? {};

// manifest integrity over FINAL bytes
for (const { file, sha256 } of manifest.files ?? []) {
  const actual = "sha256:" + createHash("sha256").update(readFileSync(path.join(HERE, file))).digest("hex");
  ok(`manifest hash: ${file}`, actual === sha256);
}

// ————————————————— LAYER 1a: signed transaction authenticity (OFFLINE) —————————————————
function writeCompactU16(val) {
  const out = [];
  let v = val;
  for (;;) {
    let b = v & 0x7f;
    v >>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
    if (v === 0) break;
  }
  return Buffer.from(out);
}
/** Deterministic legacy-message serialization (the bytes signatures cover). */
function serializeLegacyMessage(m) {
  const parts = [];
  parts.push(Buffer.from([m.header.numRequiredSignatures, m.header.numReadonlySignedAccounts, m.header.numReadonlyUnsignedAccounts]));
  const keyBufs = m.accountKeys.map((k) => Buffer.from(b58decode(k)));
  parts.push(writeCompactU16(keyBufs.length));
  for (const kb of keyBufs) parts.push(kb);
  parts.push(Buffer.from(b58decode(m.recentBlockhash)));
  parts.push(writeCompactU16(m.instructions.length));
  for (const ix of m.instructions) {
    parts.push(Buffer.from([ix.programIdIndex]));
    parts.push(writeCompactU16(ix.accounts.length));
    parts.push(Buffer.from(ix.accounts));
    const data = Buffer.from(b58decode(ix.data));
    parts.push(writeCompactU16(data.length));
    parts.push(data);
  }
  return Buffer.concat(parts);
}
ok("L1 tx carries structured message + signatures", !!tx.raw_message_structured?.accountKeys && Array.isArray(tx.raw_signatures_base58) && tx.raw_signatures_base58.length >= 1);
if (tx.raw_message_structured?.accountKeys) {
  const msgBytes = serializeLegacyMessage(tx.raw_message_structured);
  const decodedKeys = tx.raw_message_structured.accountKeys;
  const sigs = (tx.raw_signatures_base58 ?? []).map((s) => b58decode(s));
  let allSigs = true;
  for (let sIdx = 0; sIdx < tx.raw_message_structured.header.numRequiredSignatures; sIdx++) {
    const pub = b58decode(decodedKeys[sIdx]);
    if (sigs[sIdx] && sigs[sIdx].length === 64 && ed25519Verify(pub, msgBytes, sigs[sIdx])) continue;
    allSigs = false;
  }
  ok("L1 Ed25519 signatures verify over the RE-SERIALIZED message", allSigs);
  ok("L1 pack tx signature == first signature", tx.signature === b58encode(sigs[0]));
  // Signer set of a legacy message is EXACTLY accountKeys[0..numRequiredSignatures-1];
  // presence later in the list proves nothing. Seal the frozen role layout:
  // 2 required signatures, signer[0]=Treasury (fee payer), signer[1]=Operator.
  const signerKeys = decodedKeys.slice(0, tx.raw_message_structured.header.numRequiredSignatures);
  ok("L1 exactly TWO required signatures (frozen role layout)", tx.raw_message_structured.header.numRequiredSignatures === 2);
  ok("L1 Treasury is fee-payer signer [signer[0]]", signerKeys[0] === auth.payee_binding.treasury);
  ok("L1 Operator is a REQUIRED signer [signer[1]]", signerKeys[1] === auth.payee_binding.operator);
  const progId = bs.program_id;
  const ix = tx.raw_message_structured.instructions.find((x) => decodedKeys[x.programIdIndex] === progId);
  ok("L1 the frozen TESTNET-R1 program is invoked in the signed message", !!ix);
  if (ix) {
    const d = Buffer.from(b58decode(ix.data));
    const escrowLen = d.readUInt16LE(1);
    const escrowRefRaw = d.subarray(3, 3 + escrowLen).toString("utf8");
    const receiptRaw = d.subarray(3 + escrowLen, 3 + escrowLen + 32);
    ok("L1 instruction payload is the frozen authorized pair", escrowRefRaw === auth.economic_release_key.escrow_ref && "sha256:" + receiptRaw.toString("hex") === receipt.content_hash);
    const h = createHash("sha256");
    h.update(Buffer.from("intent-protocol/testnet-r1/economic-release", "utf8")); h.update(Buffer.from([0]));
    h.update(Buffer.from(escrowRefRaw, "utf8")); h.update(Buffer.from([0])); h.update(receiptRaw);
    const digestHex = h.digest("hex");
    ok("L1 EconomicReleaseDigest recomputed from the SIGNED INSTRUCTION BYTES", digestHex === bs.economic_release_digest);
    const { address } = findProgramAddress([Buffer.from("release", "utf8"), Buffer.from(digestHex, "hex")], b58decode(progId));
    const pdaB58 = b58encode(address);
    ok("L1 release PDA re-derived from the instruction bytes", pdaB58 === bs.release_pda && pdaB58 === pda.address);
    ok("L1 release PDA is an account of the signed tx", decodedKeys.includes(pdaB58));
  }
}

// ————————————————— LAYER 1b: SUPPLIED ChainReleaseV1 bytes — full decode + bindings (OFFLINE) —————————————————
// (the on-chain ORIGIN of these bytes at the release-PDA account is Layer 2, RPC-OBSERVED)
const cr = pda.chain_release ?? {};
const rawOk = typeof cr.raw_account_data_hex === "string" && Buffer.from(cr.raw_account_data_hex, "hex").length === 146;
ok("L1 raw account data is EXACTLY the frozen 146-byte layout", rawOk);
if (rawOk) {
  const raw = Buffer.from(cr.raw_account_data_hex, "hex");
  const dcr = {
    marker: raw[0],
    escrow_ref_hash: raw.subarray(1, 33).toString("hex"),
    outcome_receipt_hash: "sha256:" + raw.subarray(33, 65).toString("hex"),
    claimant: raw.subarray(65, 97).toString("utf8").replace(/\0+$/, ""),
    mint: b58encode(raw.subarray(97, 129)),
    amount_base_units: raw.readBigUInt64LE(129).toString(),
    released_at_slot: raw.readBigUInt64LE(137).toString(),
    pda_bump: raw[145],
  };
  ok("L1 marker initialized", dcr.marker === 1);
  ok("L1 semantic escrow_ref_hash == raw decode", cr.escrow_ref_hash === dcr.escrow_ref_hash);
  ok("L1 semantic receipt hash == raw decode", cr.outcome_receipt_hash === dcr.outcome_receipt_hash);
  ok("L1 semantic claimant == raw decode", cr.claimant === dcr.claimant);
  ok("L1 semantic mint == raw decode", cr.mint === dcr.mint);
  ok("L1 semantic amount == raw decode", cr.amount_base_units === dcr.amount_base_units);
  ok("L1 semantic slot == raw decode", cr.released_at_slot === dcr.released_at_slot);
  ok("L1 semantic bump == raw decode", Number(cr.pda_bump) === dcr.pda_bump);
  ok("L1 escrow_ref_hash == sha256(escrow_ref)", dcr.escrow_ref_hash === createHash("sha256").update(String(auth.economic_release_key.escrow_ref)).digest("hex"));
  ok("L1 raw receipt hash binds the OutcomeReceipt authorization root", dcr.outcome_receipt_hash === receipt.content_hash);
  ok("L1 raw claimant == frozen ClaimRecord claimant", dcr.claimant === claim.claimant);
  ok("L1 raw amount is exactly 10 USDC-test", dcr.amount_base_units === "10000000");
}

// ————————————————— LAYER 1c: OutcomeReceipt content_hash RECOMPUTED (frozen G1) —————————————————
{
  const { content_hash, signature, ...body } = receipt;
  void signature;
  let recomputed = null;
  try { recomputed = g1HashObject("intent-protocol/v1/outcome-receipt", receipt.schema_version ?? "outcome-receipt.v1", body); }
  catch (e) { ok("L1 OutcomeReceipt content_hash recomputation", false, String(e.message).slice(0, 120)); }
  if (recomputed !== null) {
    ok("L1 OutcomeReceipt content_hash RECOMPUTES via frozen G1 rules", recomputed === content_hash, `recomputed ${recomputed.slice(0, 20)} vs recorded ${String(content_hash).slice(0, 20)}`);
    ok("L1 recomputed receipt hash == ChainReleaseV1 raw binding", recomputed === cr.outcome_receipt_hash && recomputed === bs.outcome_receipt_hash);
  }
  ok("L1 authorization narrative root == recomputed receipt hash", auth.authorization_root.content_hash === receipt.content_hash);
  ok("L1 decision_hashes: exactly two, unique, ascending (2-of-2 policy shape)",
    Array.isArray(receipt.decision_hashes) && receipt.decision_hashes.length === 2 && new Set(receipt.decision_hashes).size === 2 && receipt.decision_hashes[0] < receipt.decision_hashes[1]);
}

// ————————————————— LAYER 1d: GP4 authorization machine binding (artifact, not prose) —————————————————
{
  ok("L1 GP4 SettlementInstruction artifact present", gp4.schema_version === "settlement.v1");
  ok("L1 GP4 instruction binds the SAME OutcomeReceipt", gp4.outcome_receipt_hash === receipt.content_hash);
  ok("L1 GP4 instruction binds the SAME escrow_ref", gp4.escrow_ref === auth.economic_release_key.escrow_ref);
  const out = (gp4.outputs ?? [])[0] ?? {};
  ok("L1 GP4 output recipient == frozen claimant", out.recipient === claim.claimant);
  ok("L1 GP4 output amount == 10 / frozen asset triple", out.amount === "10" && out.asset?.network === "solana-devnet" && out.asset?.asset === "USDC-test" && out.asset?.decimals === 6);
  const { content_hash: g4ch, ...g4body } = gp4;
  let g4re = null;
  try { g4re = g1HashObject("intent-protocol/v1/settlement-instruction", gp4.schema_version, g4body); } catch { g4re = null; }
  ok("L1 GP4 instruction content_hash RECOMPUTES", g4re !== null && g4re === g4ch, `recomputed ${g4re?.slice(0, 20)} vs recorded ${String(g4ch).slice(0, 20)}`);
}

// ————————————————— LAYER 2: RPC-OBSERVED evidence (labeled, NOT offline-proven) —————————————————
ok("L2 tx executed without error [RPC-OBSERVED]", tx.err === null);
ok("L2 tx slot recorded [RPC-OBSERVED]", Number.isInteger(tx.slot) && tx.slot > 0);
{
  const rawAmount = typeof cr.raw_account_data_hex === "string" ? Buffer.from(cr.raw_account_data_hex, "hex").readBigUInt64LE(129) : null;
  const cd = tx.token_balance_changes?.claimant_ata ? BigInt(tx.token_balance_changes.claimant_ata.post) - BigInt(tx.token_balance_changes.claimant_ata.pre) : null;
  const td = tx.token_balance_changes?.treasury_ata ? BigInt(tx.token_balance_changes.treasury_ata.pre) - BigInt(tx.token_balance_changes.treasury_ata.post) : null;
  ok("L2 token deltas cross-checked against the RAW ChainRelease amount [RPC-OBSERVED]",
    rawAmount !== null && cd === rawAmount && td === rawAmount && rawAmount === 10_000_000n,
    `claimant ${cd} treasury ${td} raw ${rawAmount}`);
}
ok(`L2 no second payment OBSERVED as of slot ${world.observed_at_slot} [RPC-OBSERVED]`,
  BigInt(world.claimant_ata_balance ?? "-1") === 10_000_000n && (pda.caps?.cycle_released_base_units ?? "") === "10000000" && (world.caps?.cycleReleasedBase ?? "") === "10000000");
ok("L2 honesty: future second-release denial attributed to program semantics (T2), not this snapshot",
  typeof manifest.exactly_once_note === "string" && manifest.exactly_once_note.includes("Custom(108)"));

// ————————————————— finish —————————————————
console.log(checks.join("\n"));
console.log("");
if (failures.length) { console.log(`${failures.length} CHECK(S) FAILED`); process.exit(1); }
console.log(`${checks.length}/${checks.length} checks passed`);
console.log("TESTNET PROOF PACK VERIFIED — signed-tx authenticity (incl. signer-prefix role layout), SUPPLIED ChainReleaseV1 byte semantics, recomputed OutcomeReceipt + GP4 bindings all verified OFFLINE; the tx chain inclusion, the release-account origin of the ChainRelease bytes, and balances are RPC-OBSERVED evidence; no second payment observed as of the recorded slot.");
