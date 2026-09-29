#!/usr/bin/env node
/**
 * Regenerate vectors/golden.json from the JS implementation.
 * Run: node --experimental-strip-types scripts/generate-t1-vectors.mjs
 *
 * T1-R1: generation REFUSES to write vectors unless every case also matches
 * the OFFICIAL Solana SDK oracle (@solana/web3.js findProgramAddressSync).
 * Two implementations agreeing proves nothing if both copied the same
 * algorithm error — the official implementation is the canonical oracle.
 */
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { releasePda, FROZEN } from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

const cases = [
  { name: "r1-anchor", escrow_ref: FROZEN.anchors.escrowRef, outcome_receipt_hash: FROZEN.anchors.outcomeReceiptHash },
  { name: "alt-escrow", escrow_ref: "escrow:gp-002-alt", outcome_receipt_hash: FROZEN.anchors.outcomeReceiptHash },
  { name: "alt-receipt", escrow_ref: FROZEN.anchors.escrowRef, outcome_receipt_hash: "sha256:" + "ab".repeat(32) },
].map((c) => {
  const r = releasePda(c.escrow_ref, c.outcome_receipt_hash, FROZEN.fixtureProgramId);
  // OFFICIAL ORACLE GATE — refuse to emit vectors our implementation cannot reproduce
  const [officialAddr, officialBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("release", "utf8"), Buffer.from(r.digestHex, "hex")],
    new PublicKey(FROZEN.fixtureProgramId),
  );
  if (r.pda !== officialAddr.toBase58() || r.bump !== officialBump) {
    throw new Error(`ORACLE MISMATCH for ${c.name}: ours=(${r.pda},${r.bump}) official=(${officialAddr.toBase58()},${officialBump}) — NOT writing vectors`);
  }
  return {
    name: c.name,
    escrow_ref: c.escrow_ref,
    outcome_receipt_hash: c.outcome_receipt_hash,
    program_id: FROZEN.fixtureProgramId,
    economic_release_digest: r.digestHex,
    release_pda: r.pda,
    bump: r.bump,
  };
});

const golden = {
  schema_version: "t1-golden-vectors.v1",
  program_id: FROZEN.fixtureProgramId,
  program_id_note: "FIXTURE-ONLY (base58(sha256('intent-protocol/testnet-r1/fixture-program-id'))): test vector input, NEVER the actual deployment program id (pinned at T3 before deployment).",
  formula: "EconomicReleaseDigest = SHA256(UTF8('intent-protocol/testnet-r1/economic-release') || 0x00 || UTF8(escrow_ref) || 0x00 || receipt_raw32); release PDA = findProgramAddress([UTF8('release'), digest], program_id) with the OFFICIAL preimage seed1||…||seedN||bump||programId||'ProgramDerivedAddress'",
  oracle: "every case verified at generation time against the official @solana/web3.js PublicKey.findProgramAddressSync; T1-R1 invalidated the previous vector set (bump-after-marker preimage error)",
  cases,
};

const out = path.join(here, "../vectors/golden.json");
writeFileSync(out, JSON.stringify(golden, null, 2) + "\n");
console.log(`wrote ${out} (${cases.length} cases, official-oracle verified)`);
