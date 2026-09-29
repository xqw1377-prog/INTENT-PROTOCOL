#!/usr/bin/env node
/**
 * Regenerate vectors/golden.json from the JS implementation.
 * Run: node --experimental-strip-types scripts/generate-t1-vectors.mjs
 *
 * The committed file also records the Rust cross-verification result; the
 * vitest suite re-verifies both languages against it (and re-runs the Rust
 * binary when a cargo toolchain is available).
 */
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { releasePda, FROZEN } from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

const cases = [
  { name: "r1-anchor", escrow_ref: FROZEN.anchors.escrowRef, outcome_receipt_hash: FROZEN.anchors.outcomeReceiptHash },
  { name: "alt-escrow", escrow_ref: "escrow:gp-002-alt", outcome_receipt_hash: FROZEN.anchors.outcomeReceiptHash },
  { name: "alt-receipt", escrow_ref: FROZEN.anchors.escrowRef, outcome_receipt_hash: "sha256:" + "ab".repeat(32) },
].map((c) => {
  const r = releasePda(c.escrow_ref, c.outcome_receipt_hash, FROZEN.fixtureProgramId);
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
  formula: "EconomicReleaseDigest = SHA256(UTF8('intent-protocol/testnet-r1/economic-release') || 0x00 || UTF8(escrow_ref) || 0x00 || receipt_raw32); release PDA = findProgramAddress([UTF8('release'), digest], program_id)",
  cases,
};

const out = path.join(here, "../vectors/golden.json");
writeFileSync(out, JSON.stringify(golden, null, 2) + "\n");
console.log(`wrote ${out} (${cases.length} cases)`);
