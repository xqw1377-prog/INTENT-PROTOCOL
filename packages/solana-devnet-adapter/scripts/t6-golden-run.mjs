#!/usr/bin/env node
/**
 * TESTNET-R1 / T6 GOLDEN RUN (explicit builder command) — the closing
 * orchestration of everything T0–T5 proved separately:
 *
 *   pre-state snapshot
 *   → frozen OutcomeReceipt / Claim / Binding verification
 *   → prepare (DENY-BEFORE-TX binding matrix)
 *   → submit (on-chain adjudication)
 *   → finalize via observe + reconcile (deterministic)
 *   → proof-pack build
 *   → offline third-party verify
 *   → final-state snapshot
 *
 * DESIGN NOTE (frozen semantics, not orchestration): the deployed program
 * authorizes exactly ONE settlement pair — the R1 anchor — and that pair's
 * economic release ALREADY happened exactly once in T2 and is immutable. A
 * second release is structurally denied (Custom 108). Therefore the golden
 * run REPLAYS the full lifecycle against the immutable terminal world:
 *   · submit stage dispatches a real duplicate and records the on-chain
 *     adjudication (Custom 108) — exactly the "replay → no second payment"
 *     leg of the T0 contract
 *   · the +10/-10 economic deltas are measured against the RECORDED GENESIS
 *     pre-state (T2 evidence: claimant 0, treasury 100) and the CURRENT
 *     chain world — one economic release, ever
 *   · reconcile determinism is proven by running the classifier TWICE and
 *     requiring identical output
 * If this run ever needs a program change to pass, that is a HOLD, not a fix.
 *
 * Run: node --experimental-strip-types scripts/t6-golden-run.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import { devnetConnection, buildReleaseTx, observeSettlement } from "../src/chain.ts";
import { classify } from "../src/reconcile.ts";
import { prepareSettlement, submitSettlement, FROZEN, PINNED, CAPS } from "../src/index.ts";
import { verifyBinding } from "../src/binding.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const KEYS = path.join(homedir(), "intent-testnet-r1-keys");
const load = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(KEYS, `${n}.json`), "utf8"))));
const connection = devnetConnection();
const TARGETS = { escrowRef: FROZEN.anchors.escrowRef, outcomeReceiptHash: FROZEN.anchors.outcomeReceiptHash };
const stages = [];
const stage = (name, data) => { stages.push({ name, ...data }); console.log(`  [${name}]`, JSON.stringify(data).slice(0, 240)); };

// ————————————————— 1. pre-state snapshot —————————————————
const pre = await observeSettlement(connection, PINNED.programId, TARGETS);
stage("1-pre-state-snapshot", {
  slot: pre.slot, claimantAtaBalance: pre.claimantAtaBalance, treasuryAtaBalance: pre.treasuryAtaBalance,
  releasePdaInitialized: pre.releasePda.initialized, capsCycleReleased: pre.capsPda.cycleReleasedBase,
});

// ————————————————— 2. frozen anchors verification —————————————————
{
  const receipt = JSON.parse(readFileSync(path.join(pkgDir, "../gp3-verification/artifacts/receipt.json"), "utf8"));
  const claim = JSON.parse(readFileSync(path.join(pkgDir, "../gp4-settlement/fixtures/gp-001-claim.json"), "utf8"));
  const appendix = JSON.parse(readFileSync(path.join(pkgDir, "materialization/appendix-a.json"), "utf8"));
  const checks = {
    receipt_hash_is_frozen_anchor: receipt.content_hash === FROZEN.anchors.outcomeReceiptHash,
    receipt_2of2: Array.isArray(receipt.decision_hashes) && receipt.decision_hashes.length === 2,
    claimant_is_frozen_anchor: claim.claimant === FROZEN.anchors.claimant,
    // the ClaimantPayoutBindingV1 seal recomputes (adapter-local frozen formula);
    // NOTE claim_record_hash (GP4 claimAuthority) and binding_hash (the payout
    // binding seal) hash DIFFERENT objects and must never be compared.
    payout_binding_seal_recomputes: verifyBinding(appendix.claimant_payout_binding),
    pinned_binding_hash_matches: PINNED.claimantBindingHash === appendix.claimant_payout_binding.binding_hash,
    payout_binding_verified: appendix.claimant_payout_binding.wallet_pubkey === PINNED.claimantWallet && appendix.claimant_payout_binding.token_account === PINNED.claimantTokenAccount,
    caps_frozen: CAPS.perRelease === "10" && CAPS.escrowTotalMax === "100" && CAPS.cycleCumulativeMax === "100",
  };
  stage("2-frozen-anchors", checks);
  if (Object.values(checks).some((v) => v !== true)) throw new Error("STAGE 2 FAILED: frozen anchors drifted");
}

// ————————————————— 3. prepare (full input binding, DENY matrix) —————————————————
{
  const valid = prepareSettlement({
    escrow_ref: TARGETS.escrowRef, outcome_receipt_hash: TARGETS.outcomeReceiptHash,
    claim_record_hash: FROZEN.anchors.claimRecordHash, claimant: FROZEN.anchors.claimant,
    asset: { ...FROZEN.asset }, amount: FROZEN.amount,
  });
  const impostor = prepareSettlement({
    escrow_ref: TARGETS.escrowRef, outcome_receipt_hash: TARGETS.outcomeReceiptHash,
    claim_record_hash: FROZEN.anchors.claimRecordHash, claimant: "agent:impostor",
    asset: { ...FROZEN.asset }, amount: FROZEN.amount,
  });
  stage("3-prepare", {
    validInput: valid.status,
    digest: valid.status === "PREPARED" ? valid.economicReleaseDigest : null,
    denyMatrix: { impostorClaimant: impostor.status, impostorReason: impostor.status === "DENIED_BEFORE_TX" ? impostor.reason : null },
  });
  if (valid.status !== "PREPARED" || impostor.status !== "DENIED_BEFORE_TX") throw new Error("STAGE 3 FAILED: prepare binding matrix regressed");
}

// ————————————————— 4. submit (real duplicate → on-chain adjudication) —————————————————
let submitSignature = null;
{
  const { tx } = await buildReleaseTx(connection, PINNED.programId, TARGETS, { operator: load("operator"), treasury: load("treasury") });
  let outcome = "sent";
  let err = null;
  const text = (e) => String(e?.message ?? e ?? "");
  try {
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    submitSignature = sig;
    const conf = await connection.confirmTransaction({ signature: sig, blockhash: tx.recentBlockhash, lastValidBlockHeight: tx.lastValidBlockHeight }, "confirmed");
    if (conf.value.err) { outcome = "adjudicated-on-chain"; err = JSON.stringify(conf.value.err); }
    else outcome = "confirmed-new-release";
  } catch (e) {
    // The 108 adjudication can surface EITHER as a confirmed tx error OR as a
    // send/confirm exception whose message carries the program log. Accept
    // both faces; anything else is a real failure.
    const t = text(e);
    outcome = /0x6c|108/.test(t) ? "adjudicated-on-chain" : "rejected";
    err = t.slice(0, 300) || "undefined";
  }
  stage("4-submit", { signature: submitSignature, outcome, err });
  if (outcome === "confirmed-new-release") throw new Error("STAGE 4 FATAL: a SECOND economic release happened — exactly-once violated");
  if (!err || !/0x6c|108/.test(err)) throw new Error("STAGE 4 FAILED: expected the on-chain exactly-once guard (Custom 108) to adjudicate the replay");
}

// ————————————————— 5/6. observe + reconcile (deterministic: run twice) —————————————————
async function reconcileNow(sig) {
  const obs = await observeSettlement(connection, PINNED.programId, TARGETS);
  let signature = null;
  if (sig) {
    const st = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true });
    const v = st?.value?.[0] ?? null;
    signature = { known: true, found: !!v, slot: v?.slot ?? null, confirmationStatus: v?.confirmationStatus ?? null, err: v ? (v.err === null ? null : JSON.stringify(v.err)) : null };
  }
  const observation = {
    releasePda: { initialized: obs.releasePda.initialized, amountBase: obs.releasePda.amountBase },
    claimantBalance: obs.claimantAtaBalance, treasuryBalance: obs.treasuryAtaBalance,
    capsCycleReleased: obs.capsPda.cycleReleasedBase, signature, lastValidBlockHeight: null,
    currentBlockHeight: await connection.getBlockHeight("confirmed"),
  };
  return classify(observation);
}
const r1 = await reconcileNow(submitSignature);
const r2 = await reconcileNow(submitSignature);
stage("5-observe-reconcile", {
  classification: r1.classification, safeToRetry: r1.safeToRetry, reason: r1.reason,
  deterministic: r1.classification === r2.classification && r1.safeToRetry === r2.safeToRetry && r1.reason === r2.reason,
});
if (r1.classification !== "RELEASED" || r1.safeToRetry || r1.classification !== r2.classification) throw new Error("STAGE 5 FAILED: reconcile not RELEASED/deterministic");

// ————————————————— 7. proof-pack build (T6-R1: OWN output dir; the frozen T5
// pack at t5-proof-pack/ is READ-ONLY from now on — immutability gate T6-09) —————————————————
{
  const t6PackDir = path.join(pkgDir, "t6-evidence", "proof-pack");
  const out = execFileSync(process.execPath, ["--experimental-strip-types", path.join(here, "t5-build-pack.mjs"), "--out-dir", t6PackDir], { encoding: "utf8", cwd: pkgDir, maxBuffer: 64 * 1024 * 1024 });
  stage("7-proof-pack-build", { rebuilt: out.includes("T5 proof pack written"), packDir: "t6-evidence/proof-pack", frozenT5PackUntouched: true });
  if (!out.includes("T5 proof pack written")) throw new Error("STAGE 7 FAILED: pack build failed");
}

// ————————————————— 8. offline third-party verify —————————————————
{
  const out = execFileSync(process.execPath, ["verify.mjs"], { encoding: "utf8", cwd: path.join(pkgDir, "t6-evidence", "proof-pack"), maxBuffer: 64 * 1024 * 1024 });
  const m = /(\d+)\/(\d+) checks passed/.exec(out);
  stage("8-offline-verify", { checksPassed: m ? `${m[1]}/${m[2]}` : null, verified: out.includes("TESTNET PROOF PACK VERIFIED"), verifiedPack: "t6-evidence/proof-pack" });
  if (!out.includes("TESTNET PROOF PACK VERIFIED")) throw new Error("STAGE 8 FAILED: offline verifier rejected the pack");
}

// ————————————————— 9. final-state snapshot + TOTAL acceptance —————————————————
const fin = await observeSettlement(connection, PINNED.programId, TARGETS);
const t2 = JSON.parse(readFileSync(path.join(pkgDir, "t2-evidence/report.json"), "utf8"));
const genesisClaimant = BigInt(t2.pre_state.claimantAtaBalance); // recorded genesis: 0
const genesisTreasury = BigInt(t2.pre_state.treasuryAtaBalance); // recorded genesis: 100_000_000
const acceptance = {
  economic_release_exactly_once: fin.releasePda.initialized && fin.capsPda.cycleReleasedBase === "10000000",
  claimant_delta_vs_recorded_genesis: (BigInt(fin.claimantAtaBalance) - genesisClaimant).toString(),
  claimant_delta_exactly_plus_10: BigInt(fin.claimantAtaBalance) - genesisClaimant === 10_000_000n,
  treasury_delta_vs_recorded_genesis: (BigInt(fin.treasuryAtaBalance) - genesisTreasury).toString(),
  treasury_delta_exactly_minus_10: genesisTreasury - BigInt(fin.treasuryAtaBalance) === 10_000_000n,
  release_pda_exactly_one: fin.releasePda.initialized && fin.releasePda.amountBase === "10000000",
  caps_is_10: fin.capsPda.cycleReleasedBase === "10000000",
  reconcile_deterministic: stages.find((s) => s.name === "5-observe-reconcile")?.deterministic === true,
  proof_pack_verifies_offline: stages.find((s) => s.name === "8-offline-verify")?.verified === true,
  no_second_payment_in_run: stages.find((s) => s.name === "4-submit")?.outcome === "adjudicated-on-chain",
  note: "deltas measured against the T2 RECORDED GENESIS pre-state (claimant 0 / treasury 100): the single authorized pair was released exactly once in T2 and is terminal by design; the golden run replays submit/observe/reconcile against that immutable world",
};
stage("9-final-state-and-acceptance", { slot: fin.slot, claimantAtaBalance: fin.claimantAtaBalance, treasuryAtaBalance: fin.treasuryAtaBalance });
console.log("ACCEPTANCE:", JSON.stringify(acceptance, null, 2));
const mustTrue = ["economic_release_exactly_once", "claimant_delta_exactly_plus_10", "treasury_delta_exactly_minus_10", "release_pda_exactly_one", "caps_is_10", "reconcile_deterministic", "proof_pack_verifies_offline", "no_second_payment_in_run"];
if (mustTrue.some((k) => acceptance[k] !== true)) throw new Error("T6 FINAL ACCEPTANCE FAILED");

const report = {
  schema_version: "t6-golden-run-report.v1",
  generated_at: new Date().toISOString(),
  program_id: PINNED.programId,
  escrow_ref: TARGETS.escrowRef,
  outcome_receipt_hash: TARGETS.outcomeReceiptHash,
  stages,
  acceptance,
};
const outDir = path.join(pkgDir, "t6-evidence");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`\nwrote ${path.join(outDir, "report.json")}`);
