#!/usr/bin/env node
/**
 * TESTNET-R1 / T5 proof-pack builder (explicit builder command; READ-ONLY
 * chain queries — no new payments, no T2 rerun, no T4 changes, no T6).
 *
 * Assembles the cross-layer evidence chain for the ONE real economic release
 * (T2-01) into t5-proof-pack/, verifiable OFFLINE by any third party:
 *
 *   Devnet tx signature → deployed Program ID → release PDA →
 *   ChainReleaseV1 fact → EconomicReleaseDigest → escrow_ref +
 *   outcome_receipt_hash → frozen OutcomeReceipt → GP4 authorization
 *
 * Run: node --experimental-strip-types scripts/t5-build-pack.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { devnetConnection, observeSettlement } from "../src/chain.ts";
import { FROZEN, PINNED } from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const PACK = path.join(pkgDir, "t5-proof-pack");
const TARGETS = { escrowRef: FROZEN.anchors.escrowRef, outcomeReceiptHash: FROZEN.anchors.outcomeReceiptHash };
const connection = devnetConnection();

// ————————————————— the one real release (T2-01) —————————————————
const t2 = JSON.parse(readFileSync(path.join(pkgDir, "t2-evidence/report.json"), "utf8"));
const t201 = t2.scenarios.find((s) => s.name === "T2-01-normal-release");
if (!t201?.signature) throw new Error("T2-01 signature missing from the committed T2 evidence");
const TX_SIGNATURE = t201.signature;

const tx = await connection.getTransaction(TX_SIGNATURE, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
if (!tx) throw new Error(`release tx not queryable on devnet: ${TX_SIGNATURE}`);
if (tx.meta.err !== null) throw new Error("release tx has an on-chain error — refusing to pack");

// token balance deltas straight from tx meta
const preBal = new Map((tx.meta.preTokenBalances ?? []).map((b) => [b.accountIndex ?? -1, b]));
const postBal = new Map((tx.meta.postTokenBalances ?? []).map((b) => [b.accountIndex ?? -1, b]));
const keys = tx.transaction.message.accountKeys.map((k) => k.toString());
function deltaFor(account) {
  for (const [idx, b] of postBal) {
    if (keys[idx] === account) {
      const pre = preBal.get(idx);
      return { pre: pre ? String(pre.uiTokenAmount.amount) : "0", post: String(b.uiTokenAmount.amount), mint: b.mint };
    }
  }
  return null;
}
const claimantDelta = deltaFor(PINNED.claimantTokenAccount);
const treasuryDelta = deltaFor("B7zaiMDacLZr93ERW882CZ8pK2BrQdj7UP845JpFDEUm");

// ————————————————— the on-chain release fact —————————————————
// release PDA address derivation must be done WITHOUT the repo here? We can
// import from src (this is the builder, not the third-party verifier).
const { releasePda, toHex, economicReleaseDigest } = await import("../src/index.ts");
const { pda: releasePdaAddress } = releasePda(TARGETS.escrowRef, TARGETS.outcomeReceiptHash, PINNED.programId);
const pdaAccount = await connection.getAccountInfo(new PublicKey(releasePdaAddress), "confirmed");
if (!pdaAccount) throw new Error("release PDA account missing on chain");
const d = pdaAccount.data;
if (d.length < 146 || d[0] !== 1) throw new Error("release PDA not an initialized ChainReleaseV1");
const chainRelease = {
  schema_version: "chain-release.v1 (adapter-local FACT record — NOT a G1 object, NOT an authority)",
  escrow_ref_hash: toHex2(d.subarray(1, 33)),
  outcome_receipt_hash: "sha256:" + toHex2(d.subarray(33, 65)),
  claimant: Buffer.from(d.subarray(65, 97)).toString("utf8").replace(/\0+$/, ""),
  mint: new PublicKey(d.subarray(97, 129)).toBase58(),
  amount_base_units: d.readBigUInt64LE(129).toString(),
  released_at_slot: d.readBigUInt64LE(137).toString(),
  pda_bump: d[145],
  account_owner: pdaAccount.owner.toBase58(),
  raw_account_data_hex: Buffer.from(d).toString("hex"),
};
function toHex2(u8) { return Buffer.from(u8).toString("hex"); }

// caps PDA
const capsAddress = PublicKey.findProgramAddressSync([Buffer.from("caps")], new PublicKey(PINNED.programId))[0].toBase58();
const capsAccount = await connection.getAccountInfo(new PublicKey(capsAddress), "confirmed");
const capsCycleReleased = capsAccount ? capsAccount.data.readBigUInt64LE(1).toString() : null;

// current observation (for the pack's "world now" panel)
const now = await observeSettlement(connection, PINNED.programId, TARGETS);

// ————————————————— frozen off-chain anchors —————————————————
const receipt = JSON.parse(readFileSync(path.join(repoRootOf(), "packages/gp3-verification/artifacts/receipt.json"), "utf8"));
const claim = JSON.parse(readFileSync(path.join(repoRootOf(), "packages/gp4-settlement/fixtures/gp-001-claim.json"), "utf8"));
function repoRootOf() { return path.resolve(pkgDir, "../.."); }

// ————————————————— pack assembly —————————————————
mkdirSync(PACK, { recursive: true });
const put = (rel, data) => { writeFileSync(path.join(PACK, rel), data); };
const sha256 = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");

const digestHex = toHex(economicReleaseDigest(TARGETS.escrowRef, TARGETS.outcomeReceiptHash));
const authorization = {
  schema_version: "t5-authorization-binding.v1",
  authorization_root: {
    object: "OutcomeReceipt (frozen GP3 artifact)",
    content_hash: receipt.content_hash,
    wire: "OutcomeReceiptV1 (G1 frozen; 2-of-2 VerificationDecisions)",
    note: "OutcomeReceipt is THE authorization root; ChainReleaseV1 is a FACT; tx_signature is observation evidence only",
  },
  economic_release_key: {
    definition: "(escrow_ref, outcome_receipt_hash)",
    escrow_ref: TARGETS.escrowRef,
    outcome_receipt_hash: TARGETS.outcomeReceiptHash,
    economic_release_digest: digestHex,
    digest_formula: "SHA256(UTF8('intent-protocol/testnet-r1/economic-release') || 0x00 || UTF8(escrow_ref) || 0x00 || receipt_raw32)",
    exactly_once_authority: "deterministic release PDA per key; program rejects duplicates with Custom(108)",
  },
  payee_binding: {
    claim_record: "ClaimRecordV1 fixture (gp-001-claim.json)",
    claim_id: claim.claim_id,
    claimant: claim.claimant,
    payout_binding: "ClaimantPayoutBindingV1 (T3 Appendix A): claimant → wallet → ATA, immutable",
    claimant_wallet: PINNED.claimantWallet,
    claimant_ata: PINNED.claimantTokenAccount,
  },
  gp4_authorization_chain: [
    "GP2: isolated execution + SEALED EvidenceBundle (9f6610dc)",
    "GP3: 2-of-2 VerificationDecisions → OutcomeReceipt (content_hash da577b3d…)",
    "GP4: OutcomeReceipt-gated local settlement proven (GP4 PASS/FROZEN; exactly-once link(2) guard)",
    "TESTNET-R1: adapter consumes the SAME authorization; program re-validated all frozen constants on chain",
  ],
};

const txEvidence = {
  schema_version: "t5-tx-evidence.v1",
  signature: TX_SIGNATURE,
  slot: tx.slot,
  blockTime: tx.blockTime ?? null,
  err: tx.meta.err,
  fee_payer: keys[0],
  program_invoked: PINNED.programId,
  account_keys: keys,
  instruction_program_ids: (tx.transaction.message.instructions ?? []).map((i) => keys[i.programIdIndex]),
  token_balance_changes: { claimant_ata: claimantDelta, treasury_ata: treasuryDelta },
};

put("receipt.json", JSON.stringify(receipt, null, 2) + "\n");
put("claim.json", JSON.stringify(claim, null, 2) + "\n");
put("authorization.json", JSON.stringify(authorization, null, 2) + "\n");
put("tx.json", JSON.stringify(txEvidence, null, 2) + "\n");
put("release-pda.json", JSON.stringify({
  schema_version: "t5-release-pda.v1",
  address: releasePdaAddress,
  derived_from: { program_id: PINNED.programId, seeds: "['release', EconomicReleaseDigest]", economic_release_digest: digestHex },
  chain_release: chainRelease,
  caps: { address: capsAddress, cycle_released_base_units: capsCycleReleased },
}, null, 2) + "\n");
put("world-now.json", JSON.stringify({
  schema_version: "t5-world-now.v1",
  observed_at_slot: now.slot,
  claimant_ata_balance: now.claimantAtaBalance,
  treasury_ata_balance: now.treasuryAtaBalance,
  release_pda: now.releasePda,
  caps: now.capsPda,
}, null, 2) + "\n");
put("verify.mjs", readFileSync(path.join(pkgDir, "scripts/t5-verify.mjs"), "utf8"));

// manifest LAST, hashing the FINAL bytes of every file
const manifest = {
  schema_version: "t5-pack-manifest.v1",
  files: ["receipt.json", "claim.json", "authorization.json", "tx.json", "release-pda.json", "world-now.json"].map((f) => ({
    file: f, sha256: sha256(readFileSync(path.join(PACK, f))),
  })),
  binding_summary: {
    tx_signature: TX_SIGNATURE,
    program_id: PINNED.programId,
    release_pda: releasePdaAddress,
    economic_release_digest: digestHex,
    outcome_receipt_hash: receipt.content_hash,
    claimant: claim.claimant,
    amount_base_units: "10000000",
    mint: PINNED.mint,
  },
};
put("pack-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`T5 proof pack written to ${PACK}`);
console.log(JSON.stringify(manifest.binding_summary, null, 2));
