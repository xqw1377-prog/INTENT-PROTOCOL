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
import { releasePda, FROZEN, PINNED } from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

const inputs = [
  { name: "r1-anchor", escrow_ref: FROZEN.anchors.escrowRef, outcome_receipt_hash: FROZEN.anchors.outcomeReceiptHash },
  { name: "alt-escrow", escrow_ref: "escrow:gp-002-alt", outcome_receipt_hash: FROZEN.anchors.outcomeReceiptHash },
  { name: "alt-receipt", escrow_ref: FROZEN.anchors.escrowRef, outcome_receipt_hash: "sha256:" + "ab".repeat(32) },
];

// T3: every input pair is ALSO derived against the ACTUAL pinned program id
// (TESTNET_R1_PROGRAM_ID, pinned pre-deployment) — T1's oracle proof covered
// the fixture id only; the Commander requires the real id re-proven.
const programIds = [
  { id: FROZEN.fixtureProgramId, label: "fixture", note: "FIXTURE-ONLY vector program id — never the deployment id" },
];
if (PINNED.programId) {
  programIds.push({ id: PINNED.programId, label: "actual", note: "ACTUAL TESTNET_R1_PROGRAM_ID, pinned at T3 BEFORE deployment (not yet deployed)" });
}

const cases = [];
const emit = (name, c, p, extra = {}) => {
  const r = releasePda(c.escrow_ref, c.outcome_receipt_hash, p.id);
  // OFFICIAL ORACLE GATE — refuse to emit vectors our implementation cannot reproduce
  const [officialAddr, officialBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("release", "utf8"), Buffer.from(r.digestHex, "hex")],
    new PublicKey(p.id),
  );
  if (r.pda !== officialAddr.toBase58() || r.bump !== officialBump) {
    throw new Error(`ORACLE MISMATCH for ${name}/${p.label}: ours=(${r.pda},${r.bump}) official=(${officialAddr.toBase58()},${officialBump}) — NOT writing vectors`);
  }
  cases.push({
    name: `${name}-${p.label}`,
    escrow_ref: c.escrow_ref,
    outcome_receipt_hash: c.outcome_receipt_hash,
    program_id: p.id,
    program_id_class: p.label,
    program_id_note: p.note,
    economic_release_digest: r.digestHex,
    release_pda: r.pda,
    bump: r.bump,
    ...extra,
  });
  return r.bump;
};

const bumpDescentNote = "bump-descent regression: bump=255 candidate hashes ON-curve and is rejected; the first OFF-curve candidate at the committed bump is accepted — the 255→bump descent path must actually execute";
for (const p of programIds) {
  for (const c of inputs) {
    emit(c.name, c, p);
  }
  // PDA-CONFORMANCE-R1: committed descent vectors (Commander requirement:
  // one bump=254, one bump≤252 per program id). Deterministic scan over
  // escrow:bump-descent-<i> — fixed inputs → fixed output.
  const receipt = FROZEN.anchors.outcomeReceiptHash;
  let i = 0;
  let got254 = false;
  let gotLe252 = false;
  while (!(got254 && gotLe252)) {
    const escrow_ref = `escrow:bump-descent-${i}`;
    const r = releasePda(escrow_ref, receipt, p.id);
    if (r.bump === 254 && !got254) {
      emit("descent-254", { escrow_ref, outcome_receipt_hash: receipt }, p, { bump_descent: bumpDescentNote });
      got254 = true;
    } else if (r.bump <= 252 && !gotLe252) {
      emit("descent-le252", { escrow_ref, outcome_receipt_hash: receipt }, p, { bump_descent: bumpDescentNote });
      gotLe252 = true;
    }
    i++;
  }
}

const golden = {
  schema_version: "t1-golden-vectors.v1",
  fixture_program_id: FROZEN.fixtureProgramId,
  actual_program_id: PINNED.programId,
  formula: "EconomicReleaseDigest = SHA256(UTF8('intent-protocol/testnet-r1/economic-release') || 0x00 || UTF8(escrow_ref) || 0x00 || receipt_raw32); release PDA = findProgramAddress([UTF8('release'), digest], program_id) with the OFFICIAL preimage seed1||…||seedN||bump||programId||'ProgramDerivedAddress'",
  oracle: "every case verified at generation time against the official @solana/web3.js PublicKey.findProgramAddressSync; T1-R1 invalidated the previous vector set (bump-after-marker preimage error); T3 adds the actual-program-id cases",
  cases,
};

const out = path.join(here, "../vectors/golden.json");
writeFileSync(out, JSON.stringify(golden, null, 2) + "\n");
console.log(`wrote ${out} (${cases.length} cases across ${programIds.length} program ids, official-oracle verified)`);
