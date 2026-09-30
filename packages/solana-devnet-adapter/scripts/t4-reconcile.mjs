#!/usr/bin/env node
/**
 * TESTNET-R1 / T4 evidence builder (explicit builder command).
 *
 * Runs the UNKNOWN → RECONCILE scenarios on devnet. The EconomicReleaseKey
 * is ALREADY released (T2-01) — every scenario here is a recovery of an
 * UNKNOWN client against a terminal chain world; NONE may move funds:
 *   acceptance: claimant/treasury balances unchanged across the whole run.
 *
 * Scenarios:
 *   T4-A  timeout/disconnect: submit a duplicate, discard the response,
 *         then reconcile WITH the signature → expect REJECTED (Custom 108)
 *   T4-B  crash / missing local state: reconcile with NO signature →
 *         expect RELEASED (chain fact only)
 *   T4-C  expired tx: build with a dead blockhash window, submit, reconcile
 *         with lastValidBlockHeight in the past → expect NOT_LANDED + safeToRetry
 *   T4-D  in-flight window: reconcile against a synthetic not-yet-landed
 *         signature within its validity → expect STILL_UNKNOWN, no retry
 *
 * Run: node --experimental-strip-types scripts/t4-reconcile.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import { devnetConnection, buildReleaseTx, observeSettlement } from "../src/chain.ts";
import { classify } from "../src/reconcile.ts";
import { base58Encode } from "../src/index.ts";
import { FROZEN, PINNED } from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const KEYS = path.join(homedir(), "intent-testnet-r1-keys");
const load = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(KEYS, `${n}.json`), "utf8"))));

const connection = devnetConnection();
const TARGETS = { escrowRef: FROZEN.anchors.escrowRef, outcomeReceiptHash: FROZEN.anchors.outcomeReceiptHash };
const KEYS2 = { operator: load("operator"), treasury: load("treasury") };
const scenarios = [];
const record = (name, data) => { scenarios.push({ name, ...data }); console.log(`  [${name}]`, JSON.stringify(data).slice(0, 260)); };

// fixture pair that has NEVER been released: its release PDA does not exist,
// so the signature-driven rules (R4 NOT_LANDED / R5 STILL_UNKNOWN) are the
// live decider — the only honest way to exercise them against the terminal
// real pair being already RELEASED
const FIXTURE_PAIR = { escrowRef: "escrow:t4-fixture-unreleased", outcomeReceiptHash: FROZEN.anchors.outcomeReceiptHash };

async function chainObservation(signatureInput, lastValidBlockHeight, pair = TARGETS) {
  const obs = await observeSettlement(connection, PINNED.programId, pair);
  let signature = null;
  if (signatureInput) {
    const st = await connection.getSignatureStatuses([signatureInput], { searchTransactionHistory: true });
    const v = st?.value?.[0] ?? null;
    signature = { known: true, found: !!v, slot: v?.slot ?? null, confirmationStatus: v?.confirmationStatus ?? null, err: v ? (v.err === null ? null : JSON.stringify(v.err)) : null };
  }
  return {
    releasePda: { initialized: obs.releasePda.initialized, amountBase: obs.releasePda.amountBase },
    claimantBalance: obs.claimantAtaBalance,
    treasuryBalance: obs.treasuryAtaBalance,
    capsCycleReleased: obs.capsPda.cycleReleasedBase,
    signature,
    lastValidBlockHeight,
    currentBlockHeight: await connection.getBlockHeight("confirmed"),
  };
}

const pre = await observeSettlement(connection, PINNED.programId, TARGETS);
console.log("T4 reconcile — pre-state:", JSON.stringify({ claimant: pre.claimantAtaBalance, treasury: pre.treasuryAtaBalance, released: pre.releasePda.initialized }));

// T4-A timeout/disconnect: submit duplicate, DISCARD response, reconcile with signature
{
  const { tx } = await buildReleaseTx(connection, PINNED.programId, TARGETS, KEYS2);
  const raw = tx.serialize();
  const sigPromise = connection.sendRawTransaction(raw, { skipPreflight: true });
  const signature = await sigPromise; // we keep the signature but the CLIENT "did not" (lost-response world); parent reconciles with it
  await new Promise((r) => setTimeout(r, 9000)); // let it land & be adjudicated
  const observation = await chainObservation(signature, tx.lastValidBlockHeight ?? null);
  const r = classify(observation);
  record("T4-A-timeout-disconnect", { signature, classification: r.classification, safeToRetry: r.safeToRetry, reason: r.reason, signatureStatus: observation.signature });
  // the pair is ALREADY terminal (T2-01): the recovery answer is RELEASED —
  // and the lost-response duplicate itself must be adjudicated 108 on chain
  if (r.classification !== "RELEASED" || r.safeToRetry) throw new Error("T4-A FAILED: expected RELEASED terminal with no retry");
  if (!observation.signature?.found || !(observation.signature.err ?? "").includes("108")) throw new Error("T4-A FAILED: submitted duplicate not adjudicated Custom(108) on chain");
}

// T4-B crash / missing local state: NO signature at all — chain fact only
{
  const observation = await chainObservation(null, null);
  const r = classify(observation);
  record("T4-B-missing-local-state", { classification: r.classification, safeToRetry: r.safeToRetry, reason: r.reason, releaseAmount: observation.releasePda.amountBase, caps: observation.capsCycleReleased });
  if (r.classification !== "RELEASED" || r.safeToRetry) throw new Error("T4-B FAILED: expected RELEASED with no retry");
}

// T4-C REAL transaction expiry (T4-R1): build a genuinely signed fixture
// transaction with its REAL validity window, DO NOT submit it, wait for the
// window to permanently expire, then prove from chain truth that THIS exact
// signature never landed — the only world entitled to retry permission.
{
  const { tx } = await buildReleaseTx(connection, PINNED.programId, FIXTURE_PAIR, KEYS2);
  const realSignature = base58Encode(new Uint8Array(tx.signature)); // real signature of the never-submitted tx
  const lastValid = tx.lastValidBlockHeight; // REAL window from getLatestBlockhash
  console.log(`  fixture tx signed (NOT submitted): ${realSignature.slice(0, 16)}… lastValid=${lastValid}; waiting for expiry…`);
  let current = await connection.getBlockHeight("confirmed");
  while (current <= lastValid) {
    await new Promise((r) => setTimeout(r, 5_000));
    current = await connection.getBlockHeight("confirmed");
  }
  const observation = await chainObservation(realSignature, lastValid, FIXTURE_PAIR);
  const r = classify(observation);
  record("T4-C-expired-not-landed", {
    fixtureUnreleasedPair: true,
    fixtureTransaction: { signed: true, submitted: false, realSignature, realLastValidBlockHeight: lastValid },
    classification: r.classification,
    safeToRetry: r.safeToRetry,
    reason: r.reason,
    signatureFoundOnChain: observation.signature?.found,
  });
  if (observation.signature?.found) throw new Error("T4-C FAILED: the never-submitted fixture tx somehow appears on chain");
  if (r.classification !== "NOT_LANDED" || !r.safeToRetry) throw new Error("T4-C FAILED: expected NOT_LANDED with safeToRetry from REAL expiry");
}

// T4-D in-flight window (REAL tx, window still open): STILL_UNKNOWN, no retry
{
  const { tx } = await buildReleaseTx(connection, PINNED.programId, FIXTURE_PAIR, KEYS2);
  const realSignature = base58Encode(new Uint8Array(tx.signature));
  const lastValid = tx.lastValidBlockHeight;
  const observation = await chainObservation(realSignature, lastValid, FIXTURE_PAIR);
  const r = classify(observation);
  record("T4-D-still-unknown", {
    fixtureUnreleasedPair: true,
    fixtureTransaction: { signed: true, submitted: false, realSignature, realLastValidBlockHeight: lastValid },
    currentBlockHeight: observation.currentBlockHeight,
    classification: r.classification,
    safeToRetry: r.safeToRetry,
    reason: r.reason,
  });
  if (r.classification !== "STILL_UNKNOWN" || r.safeToRetry) throw new Error("T4-D FAILED: expected STILL_UNKNOWN with NO retry — the frozen invariant");
}

// FINAL ACCEPTANCE: nothing moved across the whole T4 run
const fin = await observeSettlement(connection, PINNED.programId, TARGETS);
const acceptance = {
  claimant_unchanged: fin.claimantAtaBalance === pre.claimantAtaBalance,
  treasury_unchanged: fin.treasuryAtaBalance === pre.treasuryAtaBalance,
  release_pda_still_the_one: fin.releasePda.initialized && fin.releasePda.amountBase === "10000000",
  caps_still_10: fin.capsPda.cycleReleasedBase === "10000000",
  unknown_never_permits_resubmission: scenarios.every((s) => s.safeToRetry === (s.classification === "NOT_LANDED")),
};
console.log("ACCEPTANCE:", JSON.stringify(acceptance, null, 2));
if (!acceptance.claimant_unchanged || !acceptance.treasury_unchanged || !acceptance.unknown_never_permits_resubmission) {
  throw new Error("T4 FINAL ACCEPTANCE FAILED");
}

const report = {
  schema_version: "t4-reconcile-report.v1",
  generated_at: new Date().toISOString(),
  program_id: PINNED.programId,
  escrow_ref: TARGETS.escrowRef,
  outcome_receipt_hash: TARGETS.outcomeReceiptHash,
  pre_state: { claimantAtaBalance: pre.claimantAtaBalance, treasuryAtaBalance: pre.treasuryAtaBalance },
  final_state: { claimantAtaBalance: fin.claimantAtaBalance, treasuryAtaBalance: fin.treasuryAtaBalance, releasePda: fin.releasePda, capsPda: fin.capsPda },
  scenarios,
  acceptance,
  note: "T4 scope only: UNKNOWN → RECONCILE → terminal state. No verification re-run, no OutcomeReceipt reformation, no T5 proof pack, no T6 claims. UNKNOWN never grants blind resubmission; only NOT_LANDED is safe-retryable.",
};
const outDir = path.join(pkgDir, "t4-evidence");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`\nwrote ${path.join(outDir, "report.json")}`);
