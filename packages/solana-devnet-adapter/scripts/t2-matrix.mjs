#!/usr/bin/env node
/**
 * TESTNET-R1 / T2 evidence matrix (explicit builder command).
 *
 * Runs T2-01..T2-08 against the deployed frozen program on devnet. THE
 * acceptance criterion (docs/TESTNET-R1.md §6):
 *
 *   claimant ATA pre balance → full matrix → claimant ATA final balance
 *   delta = exactly +10 USDC-test  (not +20, not +30)
 *   release PDA count = 1; EconomicReleaseKey = exactly one economic release
 *
 * T2 scope discipline: crash/timeout/lost-response scenarios prove ONLY
 * "no second economic release"; the full UNKNOWN→reconcile lifecycle is T4.
 *
 * Run: node --experimental-strip-types scripts/t2-matrix.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import { devnetConnection, buildReleaseTx, observeSettlement } from "../src/chain.ts";
import { FROZEN, PINNED } from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const KEYS = path.join(homedir(), "intent-testnet-r1-keys");
const load = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(KEYS, `${n}.json`), "utf8"))));

const connection = devnetConnection();
const TARGETS = { escrowRef: FROZEN.anchors.escrowRef, outcomeReceiptHash: FROZEN.anchors.outcomeReceiptHash };
const KEYS2 = { operator: load("operator"), treasury: load("treasury") };
const scenarios = [];
const record = (name, data) => { scenarios.push({ name, ...data }); console.log(`  [${name}]`, JSON.stringify(data).slice(0, 220)); };

async function attempt(variation) {
  const { tx } = await buildReleaseTx(connection, PINNED.programId, TARGETS, KEYS2, variation);
  try {
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const latest = await connection.confirmTransaction({ signature, blockhash: tx.recentBlockhash, lastValidBlockHeight: tx.lastValidBlockHeight }, "confirmed");
    const failed = latest.value.err !== null;
    return { outcome: failed ? "tx-failed-on-chain" : "confirmed", signature, err: JSON.stringify(latest.value.err) };
  } catch (e) {
    return { outcome: "rejected", error: String(e.message).slice(0, 300) };
  }
}

async function observe() {
  return observeSettlement(connection, PINNED.programId, TARGETS);
}

console.log("T2 matrix — pre-state:");
const pre = await observe();
record("pre-state", pre);

// T2-01 normal release — the ONE economic release
{
  const r = await attempt(1n);
  const post = await observe();
  const delta = BigInt(post.claimantAtaBalance) - BigInt(pre.claimantAtaBalance);
  record("T2-01-normal-release", { ...r, deltaBase: delta.toString(), released: post.releasePda.initialized, caps: post.capsPda.cycleReleasedBase });
  if (r.outcome !== "confirmed" || delta !== 10_000_000n || !post.releasePda.initialized) throw new Error("T2-01 FAILED: the single authorized release did not land exactly once");
}

// T2-02 exact retry — same authorized pair again
{
  const before = await observe();
  const r = await attempt(2n);
  const after = await observe();
  const delta = BigInt(after.claimantAtaBalance) - BigInt(before.claimantAtaBalance);
  record("T2-02-exact-retry", { ...r, deltaBase: delta.toString() });
  if (delta !== 0n) throw new Error("T2-02 FAILED: exact retry moved funds");
}

// T2-03 different nonce (auxiliary client data must not create a second release)
{
  const before = await observe();
  const r = await attempt(3n);
  const after = await observe();
  const delta = BigInt(after.claimantAtaBalance) - BigInt(before.claimantAtaBalance);
  record("T2-03-different-nonce", { ...r, deltaBase: delta.toString() });
  if (delta !== 0n) throw new Error("T2-03 FAILED: nonce variant moved funds");
}

// T2-04 RPC response lost — submit, NEVER read the response, then observe
{
  const before = await observe();
  const { tx } = await buildReleaseTx(connection, PINNED.programId, TARGETS, KEYS2, 4n);
  const sendP = connection.sendRawTransaction(tx.serialize(), { skipPreflight: true }).catch((e) => String(e.message).slice(0, 200));
  void sendP; // response intentionally discarded (lost-response world)
  await new Promise((r) => setTimeout(r, 8000));
  const after = await observe();
  const delta = BigInt(after.claimantAtaBalance) - BigInt(before.claimantAtaBalance);
  record("T2-04-response-lost", { note: "response discarded; state read from chain only", deltaBase: delta.toString() });
  if (delta !== 0n) throw new Error("T2-04 FAILED: lost-response world caused a second release");
}

// T2-05 process crash after submit — child sends and exits instantly; parent kills mid-flight
{
  const before = await observe();
  const child = spawn(process.execPath, ["--experimental-strip-types", path.join(here, "t2-send-once.mjs"), "t2-05-crash"], { cwd: pkgDir, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d.toString(); });
  setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } }, 300); // crash mid-flight
  await new Promise((r) => child.on("close", r));
  await new Promise((r) => setTimeout(r, 8000));
  const after = await observe();
  const delta = BigInt(after.claimantAtaBalance) - BigInt(before.claimantAtaBalance);
  record("T2-05-crash-after-submit", { childSaid: out.trim().slice(0, 120), killed: true, deltaBase: delta.toString() });
  if (delta !== 0n) throw new Error("T2-05 FAILED: crashed client caused a second release");
}

// T2-06 tx landed but local state unknown — re-derive EVERYTHING from chain truth
{
  const o = await observe();
  const deltaFromPre = BigInt(o.claimantAtaBalance) - BigInt(pre.claimantAtaBalance);
  record("T2-06-local-unknown-chain-truth", {
    note: "no local state consulted; observation is chain-only",
    releasePdaInitialized: o.releasePda.initialized,
    recordedAmount: o.releasePda.amountBase,
    capsCycleReleased: o.capsPda.cycleReleasedBase,
    deltaFromPreBase: deltaFromPre.toString(),
  });
  if (!o.releasePda.initialized || o.releasePda.amountBase !== "10000000" || deltaFromPre !== 10_000_000n) {
    throw new Error("T2-06 FAILED: chain-only reconciliation does not show exactly one release of 10");
  }
}

// T2-07 duplicate client — a second, independent client attempts the same settlement
{
  const before = await observe();
  const dupConnection = devnetConnection(); // independent client instance
  const { tx } = await buildReleaseTx(dupConnection, PINNED.programId, TARGETS, KEYS2, 7n);
  let outcome = "sent";
  try {
    const sig = await dupConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const conf = await dupConnection.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash, lastValidBlockHeight: tx.lastValidBlockHeight }, "confirmed");
    if (conf.value.err) outcome = `tx-failed-on-chain: ${JSON.stringify(conf.value.err)}`;
  } catch (e) {
    outcome = `rejected: ${String(e.message).slice(0, 200)}`;
  }
  const after = await observe();
  const delta = BigInt(after.claimantAtaBalance) - BigInt(before.claimantAtaBalance);
  record("T2-07-duplicate-client", { outcome, deltaBase: delta.toString() });
  if (delta !== 0n) throw new Error("T2-07 FAILED: duplicate client moved funds");
}

// T2-08 concurrent clients — 4 distinct transactions racing in one burst
{
  const before = await observe();
  const burst = await Promise.allSettled(
    [11n, 12n, 13n, 14n].map((v) => attempt(v)),
  );
  await new Promise((r) => setTimeout(r, 6000));
  const after = await observe();
  const delta = BigInt(after.claimantAtaBalance) - BigInt(before.claimantAtaBalance);
  record("T2-08-concurrent-clients", {
    outcomes: burst.map((b) => (b.status === "fulfilled" ? b.value.outcome : "threw")),
    deltaBase: delta.toString(),
  });
  if (delta !== 0n) throw new Error("T2-08 FAILED: concurrent clients caused a second release");
}

// ————————————————— FINAL ACCEPTANCE —————————————————
const fin = await observe();
const deltaTotal = BigInt(fin.claimantAtaBalance) - BigInt(pre.claimantAtaBalance);
const treasuryDelta = BigInt(fin.treasuryAtaBalance) - BigInt(pre.treasuryAtaBalance);
const acceptance = {
  claimant_delta_base: deltaTotal.toString(),
  claimant_delta_equals_exactly_10: deltaTotal === 10_000_000n,
  treasury_delta_base: treasuryDelta.toString(),
  treasury_delta_equals_exactly_minus_10: treasuryDelta === -10_000_000n,
  release_pda_initialized: fin.releasePda.initialized,
  release_pda_amount: fin.releasePda.amountBase,
  caps_cycle_released: fin.capsPda.cycleReleasedBase,
  second_economic_release: false, // proven by delta === exactly 10 across ALL scenarios
};
console.log("ACCEPTANCE:", JSON.stringify(acceptance, null, 2));
if (!acceptance.claimant_delta_equals_exactly_10 || !acceptance.treasury_delta_equals_exactly_minus_10 || !fin.releasePda.initialized) {
  throw new Error("T2 FINAL ACCEPTANCE FAILED");
}

const report = {
  schema_version: "t2-matrix-report.v1",
  generated_at: new Date().toISOString(),
  program_id: PINNED.programId,
  escrow_ref: TARGETS.escrowRef,
  outcome_receipt_hash: TARGETS.outcomeReceiptHash,
  pre_state: pre,
  final_state: fin,
  scenarios,
  acceptance,
  note: "T2 scope only: crash/timeout/lost-response scenarios prove NO SECOND ECONOMIC RELEASE; the full UNKNOWN→reconcile lifecycle is T4 and is not claimed here.",
};
const outDir = path.join(pkgDir, "t2-evidence");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`\nwrote ${path.join(outDir, "report.json")}`);
