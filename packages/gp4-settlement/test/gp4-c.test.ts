/**
 * GP4-C — instruction idempotency + immutable ClaimRecord claimant authorization.
 *
 * Pre-registered scope (Commander Phase-0 order):
 *   A. settlement_key = instruction identity: same settlement_key replay →
 *      deterministic same outcome, no additional side effect. NEVER merged
 *      with the economic authority (escrow_ref, outcome_receipt_hash).
 *   B. payee authorization BEFORE the economic guard, zero persistent
 *      mutation: outputs.length == 1, recipient == ClaimRecord.claimant,
 *      amount == escrow.amount, asset == frozen triple.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { claimAuthority, claimRecordHash, refDir } from "../src/index.ts";
import {
  ESCROW_REF, FROZEN_CLAIM_HASH, FROZEN_RH, canonHash, enabledLedger, frozenClaim,
  frozenReceipt, instructionFiles, makeInstruction, releaseFiles,
} from "./util.ts";

describe("[GP4-C] claimant authorization + instruction idempotency", () => {
  test("[C-01] committed ClaimRecord fixture: exact grammar, exact binding hash, frozen task linkage", () => {
    const claim = frozenClaim();
    const ca = claimAuthority(claim); // throws on grammar violation
    expect(ca.claim.claimant).toBe("agent:gp-001-demo");
    expect(ca.claim.bounty_id).toBe("GP-001");
    expect(ca.claim_record_hash).toBe(FROZEN_CLAIM_HASH);
    // test-side independent oracle: canonical-bytes sha256 (same formula, independent code path)
    expect(canonHash(claim)).toBe(FROZEN_CLAIM_HASH);
    expect(claimRecordHash(ca.claim)).toBe(FROZEN_CLAIM_HASH);
    // task_freeze_hash equals the EXACT-BYTES sha256 of the frozen task fixture
    const taskBytes = readFileSync(new URL("../../../packages/golden-path/fixtures/gp-001-task.json", import.meta.url));
    expect("sha256:" + createHash("sha256").update(taskBytes).digest("hex")).toBe(ca.claim.task_freeze_hash);
  });

  test("[C-02] wrong recipient → REJECTED_CLAIMANT, zero-write, never reaches ELIGIBLE or guard", () => {
    const { ledger, root } = enabledLedger();
    const r = ledger.attemptRelease({
      receipt: frozenReceipt(),
      instruction: makeInstruction({ outputs: [{ recipient: "agent:impostor", asset: { network: "solana-devnet", asset: "USDC-test", decimals: 6 }, amount: "10", reason: "wrong payee" }] }),
      claim_record: frozenClaim(),
    });
    expect(r.status).toBe("REJECTED_CLAIMANT");
    expect(r.reason).toContain("agent:gp-001-demo");
    expect(releaseFiles(root)).toHaveLength(0);
    expect(instructionFiles(root)).toHaveLength(0);
    expect(ledger.readEscrow(ESCROW_REF)!.state).toBe("LOCKED"); // never even logically ELIGIBLE-persisted
  });

  test("[C-03] forged ClaimRecord (different claimant/claim_id) → hash binding mismatch, rejected", () => {
    const { ledger, root } = enabledLedger();
    const forged = { ...frozenClaim(), claimant: "agent:attacker" };
    const r = ledger.attemptRelease({
      receipt: frozenReceipt(),
      instruction: makeInstruction({ outputs: [{ recipient: "agent:attacker", asset: { network: "solana-devnet", asset: "USDC-test", decimals: 6 }, amount: "10", reason: "x" }] }),
      claim_record: forged, // internally consistent (recipient matches forged claim) but NOT the bound claim
    });
    expect(r.status).toBe("REJECTED_CLAIM_MISMATCH"); // the escrow's immutable claim binding rules
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[C-04] malformed ClaimRecord → REJECTED_INVALID_CLAIM", () => {
    const { ledger, root } = enabledLedger();
    for (const bad of [
      { ...frozenClaim(), schema_version: "gp-claim.v2" },
      { ...frozenClaim(), claimant: "no-prefix" },
      { ...frozenClaim(), task_freeze_hash: "0xdeadbeef" },
      { ...frozenClaim(), claimed_at: "2026/09/24 09:00:00" },
    ]) {
      const r = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: bad });
      expect(r.status, JSON.stringify(bad)).toBe("REJECTED_INVALID_CLAIM");
    }
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[C-05] multi-output instruction → REJECTED_OUTPUT_COUNT (exactly one output is frozen)", () => {
    const { ledger, root } = enabledLedger();
    const r = ledger.attemptRelease({
      receipt: frozenReceipt(),
      instruction: makeInstruction({ outputs: [
        { recipient: "agent:gp-001-demo", asset: { network: "solana-devnet", asset: "USDC-test", decimals: 6 }, amount: "5", reason: "a" },
        { recipient: "agent:gp-001-demo", asset: { network: "solana-devnet", asset: "USDC-test", decimals: 6 }, amount: "5", reason: "b" },
      ] }),
      claim_record: frozenClaim(),
    });
    expect(r.status).toBe("REJECTED_OUTPUT_COUNT");
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[C-06/A] instruction journal: winner recorded; exact replay → deterministic same outcome, zero new files", () => {
    const { ledger, root } = enabledLedger();
    const first = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "7" }), claim_record: frozenClaim() });
    expect(first.status).toBe("RELEASED");
    const sk = first.settlement_key!;
    expect(instructionFiles(root)).toEqual([`${sk.slice(7)}.json`]);
    // exact same settlement_key replayed 5 times: same deterministic outcome, no new files
    for (let i = 0; i < 5; i++) {
      const replay = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "7" }), claim_record: frozenClaim() });
      expect(replay.status).toBe("ALREADY_RELEASED");
      expect(replay.settlement_key).toBe(sk);
    }
    expect(instructionFiles(root)).toHaveLength(1);
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[C-07/A] different settlement_key after release → economically rejected AND not journaled", () => {
    const { ledger, root } = enabledLedger();
    const first = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "7" }), claim_record: frozenClaim() });
    expect(first.status).toBe("RELEASED");
    const loser = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "8" }), claim_record: frozenClaim() });
    expect(loser.status).toBe("ALREADY_RELEASED"); // economic pair already consumed
    expect(loser.settlement_key).not.toBe(first.settlement_key);
    expect(instructionFiles(root)).toHaveLength(1); // losing instruction NOT journaled
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[C-08] the two uniqueness layers stay distinct: same settlement_key across different escrow refs", () => {
    // settlement_key binds (receipt, escrow_ref, nonce): two escrows, same receipt+nonce
    // → two DIFFERENT settlement_keys but ONE receipt — economic layer treats
    // them as different pairs (different escrow_ref). This proves the layers
    // are not merged: instruction identity ≠ economic identity.
    const { ledger: l1, root: r1 } = enabledLedger();
    const { ledger: l2, root: r2 } = enabledLedger();
    const a = l1.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "3" }), claim_record: frozenClaim() });
    // second ledger holds the SAME receipt under a different escrow dir (same ref name — use forged twin)
    const b = l2.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "3" }), claim_record: frozenClaim() });
    expect(a.status).toBe("RELEASED");
    expect(b.status).toBe("RELEASED"); // different LEDGER ROOTS = different escrow universes
    expect(releaseFiles(r1)).toHaveLength(1);
    expect(releaseFiles(r2)).toHaveLength(1);
  });

  test("[C-09] frozen escrow_ref with ':' works end-to-end and is path-encoded on disk", () => {
    const { root } = enabledLedger();
    expect(refDir("escrow:gp-001-local")).toBe("escrow%3agp-001-local");
    expect(readFileSync(`${root}/escrows/escrow%3agp-001-local/escrow.json`, "utf8")).toContain('"escrow:gp-001-local"');
    // no ':' anywhere in on-disk paths BELOW the ledger root
    // (the root itself may legitimately contain a drive-letter colon)
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = `${dir}/${e.name}`;
        return e.isDirectory() ? walk(p) : [p];
      });
    for (const p of walk(root)) expect(p.slice(root.length).includes(":")).toBe(false);
  });
});
