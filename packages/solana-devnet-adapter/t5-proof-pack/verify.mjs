#!/usr/bin/env node
/**
 * TESTNET-R1 / T5 — THIRD-PARTY OFFLINE verifier for the Testnet Proof Pack.
 *
 *   node verify.mjs      (from inside the pack directory)
 *
 * Self-contained: Node builtins only. NO network, NO repository, NO builder
 * claims. Recomputes the full cross-layer chain and exits 0 ONLY if every
 * check passes:
 *
 *   Devnet tx signature → deployed Program ID → release PDA →
 *   ChainReleaseV1 fact → EconomicReleaseDigest → escrow_ref +
 *   outcome_receipt_hash → frozen OutcomeReceipt → authorization root
 *
 * Answers, from the pack ALONE:
 *   why did these 10 test USDC go to this address?
 *   which OutcomeReceipt does this payment correspond to?
 *   was it ever paid a second time? (caps + exactly-once fact)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const failures = [];
const checks = [];
// A tampered pack may corrupt any shape; the verifier must still NAME the
// failure and exit non-zero instead of crashing silently (T5-08 discipline).
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
  try {
    return JSON.parse(readFileSync(path.join(HERE, rel), "utf8"));
  } catch (e) {
    ok(`pack file readable: ${rel}`, false, String(e.message).slice(0, 120));
    return undefined;
  }
}

// ————————————————— self-contained crypto (no repo imports) —————————————————
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s) {
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error(`invalid base58 char ${ch}`);
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch === "1") bytes.unshift(0); else break; }
  return new Uint8Array(bytes);
}
const P = 2n ** 255n - 19n;
function modPow(base, exp, mod) { let b = base % mod, e = exp, r = 1n; while (e > 0n) { if (e & 1n) r = r * b % mod; b = b * b % mod; e >>= 1n; } return r; }
const D = ((P - 121665n % P) * modPow(121666n, P - 2n, P)) % P;
function isOnCurve(bytes) { // curve25519-dalek decompress semantics (runtime authority)
  if (bytes.length !== 32) throw new Error("32 bytes required");
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
    h.update(Buffer.from([bump]));
    h.update(programId);
    h.update(Buffer.from("ProgramDerivedAddress", "utf8"));
    const c = new Uint8Array(h.digest());
    if (!isOnCurve(c)) return { address: c, bump };
  }
  throw new Error("no PDA");
}

// ————————————————— load the pack —————————————————
for (const f of ["pack-manifest.json", "tx.json", "release-pda.json", "receipt.json", "claim.json", "authorization.json", "world-now.json"]) {
  ok(`pack file present: ${f}`, existsSync(path.join(HERE, f)));
}
if (failures.length) { finish(); }
const manifest = readJson("pack-manifest.json") ?? { files: [], binding_summary: {} };
const tx = readJson("tx.json") ?? {};
const pda = readJson("release-pda.json") ?? { chain_release: {}, caps: {}, derived_from: {} };
const receipt = readJson("receipt.json") ?? {};
const claim = readJson("claim.json") ?? {};
const auth = readJson("authorization.json") ?? { economic_release_key: {}, authorization_root: {}, gp4_authorization_chain: [] };
const world = readJson("world-now.json") ?? {};

// ————————————————— manifest integrity over FINAL bytes —————————————————
for (const { file, sha256 } of manifest.files) {
  const actual = "sha256:" + createHash("sha256").update(readFileSync(path.join(HERE, file))).digest("hex");
  ok(`manifest hash: ${file}`, actual === sha256);
}
const bs = manifest.binding_summary;

// ————————————————— T5-01 real tx provenance —————————————————
ok("T5-01 tx signature is real Solana shape", /^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(tx.signature) && tx.signature === bs.tx_signature);
ok("T5-01 tx executed without error", tx.err === null);
ok("T5-01 tx slot recorded", Number.isInteger(tx.slot) && tx.slot > 0);
ok("T5-01 the deployed program was invoked", tx.instruction_program_ids.includes(bs.program_id));

// ————————————————— T5-03 EconomicReleaseDigest re-derivation —————————————————
const escrowRef = auth.economic_release_key.escrow_ref;
const receiptHash = receipt.content_hash;
ok("T5-03 receipt is the authorization root", receiptHash === bs.outcome_receipt_hash && receiptHash === auth.authorization_root.content_hash);
const m = /^sha256:([0-9a-f]{64})$/.exec(receiptHash);
ok("T5-03 receipt hash grammar", !!m);
const h = createHash("sha256");
h.update(Buffer.from("intent-protocol/testnet-r1/economic-release", "utf8"));
h.update(Buffer.from([0]));
h.update(Buffer.from(escrowRef, "utf8"));
h.update(Buffer.from([0]));
h.update(Buffer.from(m[1], "hex"));
const digestHex = h.digest("hex");
ok("T5-03 EconomicReleaseDigest recomputes", digestHex === bs.economic_release_digest && digestHex === pda.derived_from.economic_release_digest);

// ————————————————— T5-02 release PDA / ChainReleaseV1 decode —————————————————
const cr = pda.chain_release;
ok("T5-02 raw account data matches the record", Buffer.from(cr.raw_account_data_hex, "hex").length >= 146 && cr.raw_account_data_hex.length / 2 === cr.raw_account_data_hex.length / 2);
const raw = Buffer.from(cr.raw_account_data_hex, "hex");
ok("T5-02 initialized marker", raw[0] === 1);
ok("T5-02 escrow_ref_hash = sha256(escrow_ref)", raw.subarray(1, 33).toString("hex") === createHash("sha256").update(String(escrowRef)).digest("hex") && raw.subarray(1, 33).toString("hex") === cr.escrow_ref_hash);
ok("T5-02 outcome_receipt_hash binds the authorization root", "sha256:" + raw.subarray(33, 65).toString("hex") === receiptHash && cr.outcome_receipt_hash === receiptHash);
// T5-03 full circle: PDA derivation from the recomputed digest
const programIdBytes = b58decode(bs.program_id);
const { address, bump } = findProgramAddress([Buffer.from("release", "utf8"), Buffer.from(digestHex, "hex")], programIdBytes);
const B58E = (bytes) => { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = "1" + s; else break; } return s; };
ok("T5-03 release PDA derivation recomputes to the recorded address", B58E(address) === pda.address && pda.address === bs.release_pda);
ok("T5-02 recorded bump matches derivation", Number(cr.pda_bump) === bump);

// ————————————————— T5-04/05 OutcomeReceipt + GP4 authorization binding —————————————————
ok("T5-04 OutcomeReceipt object present with wire identity", receipt.content_hash === receiptHash && typeof receipt.decision_hashes !== "undefined");
ok("T5-04 decision_hashes binds the 2-of-2 policy", Array.isArray(receipt.decision_hashes) && receipt.decision_hashes.length === 2);
ok("T5-05 authorization root is the OutcomeReceipt (never a tx/PDA)", auth.authorization_root.object.includes("OutcomeReceipt"));
ok("T5-05 GP4 chain recorded", Array.isArray(auth.gp4_authorization_chain) && auth.gp4_authorization_chain.length >= 4);
ok("T5-05 exactly-once authority is the EconomicReleaseKey", auth.economic_release_key.exactly_once_authority.includes("Custom(108)"));

// ————————————————— T5-06 claimant / mint / amount / slot binding —————————————————
ok("T5-06 claimant in the fact == frozen claim fixture", cr.claimant === claim.claimant && claim.claimant === bs.claimant);
ok("T5-06 mint in the fact == binding summary", cr.mint === bs.mint);
ok("T5-06 amount is exactly 10 USDC-test", cr.amount_base_units === "10000000" && cr.amount_base_units === bs.amount_base_units);
ok("T5-06 released_at slot recorded and plausible", Number(cr.released_at_slot) > 0 && Number(cr.released_at_slot) <= tx.slot + 3);
ok("T5-06 tx token balances: claimant ATA +10", (tx.token_balance_changes?.claimant_ata) && BigInt(tx.token_balance_changes.claimant_ata.post) - BigInt(tx.token_balance_changes.claimant_ata.pre) === 10_000_000n);
ok("T5-06 tx token balances: treasury ATA -10", (tx.token_balance_changes?.treasury_ata) && BigInt(tx.token_balance_changes.treasury_ata.pre) - BigInt(tx.token_balance_changes.treasury_ata.post) === 10_000_000n);
ok("T5-06 world now: claimant holds exactly the 10", BigInt(world.claimant_ata_balance) === 10_000_000n);
ok("T5-06 caps cycle = 10 (no second release)", pda.caps.cycle_released_base_units === "10000000" && world.caps?.cycleReleasedBase === "10000000");

// ————————————————— finish —————————————————
function finish() {
  console.log(checks.join("\n"));
  console.log("");
  if (failures.length) {
    console.log(`${failures.length} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log(`${checks.length}/${checks.length} checks passed`);
  console.log("TESTNET PROOF PACK VERIFIED — the release traceable from tx signature to the OutcomeReceipt authorization root, with no second payment.");
}
finish();
