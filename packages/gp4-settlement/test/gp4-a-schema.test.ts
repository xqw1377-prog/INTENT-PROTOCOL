/**
 * GP4-A — settlement identity + persistence schema tests.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import {
  EscrowLedger, ESCROW_REF_RE, SETTLEMENT_EDGES, SettlementPolicySchema,
  EscrowEntrySchema, ReleaseRecordSchema, InstructionRecordSchema, settlementEdge,
} from "../src/index.ts";
import { FROZEN_ASSET, FROZEN_RH, freshLedger, frozenReceipt, makeInstruction } from "./util.ts";

describe("[GP4-A] settlement identity + persistence schema", () => {
  test("[A-01] escrow_ref grammar rejects traversal and unsafe refs", () => {
    expect(ESCROW_REF_RE.test("gp-001-escrow-1")).toBe(true);
    expect(ESCROW_REF_RE.test("e1")).toBe(true);
    for (const bad of ["", "../evil", "a/b", "a\\b", "UPPER", "-lead", ".lead", "a:b", "a b", "x".repeat(65)]) {
      expect(ESCROW_REF_RE.test(bad), bad).toBe(false);
    }
  });

  test("[A-02] createEscrow persists the exact documented layout with the exact frozen fields", () => {
    const { ledger, root } = freshLedger();
    const r = ledger.createEscrow({
      escrow_ref: "gp-001-escrow-1",
      asset: FROZEN_ASSET,
      amount: "10",
      outcome_receipt_hash: FROZEN_RH,
      release_enabled: true,
    });
    expect(r.status).toBe("CREATED");
    const dir = path.join(root, "escrows", "gp-001-escrow-1");
    expect(existsSync(path.join(dir, "escrow.json"))).toBe(true);
    expect(existsSync(path.join(dir, "releases"))).toBe(true);
    expect(existsSync(path.join(dir, "instructions"))).toBe(true);
    const onDisk = JSON.parse(readFileSync(path.join(dir, "escrow.json"), "utf8"));
    expect(onDisk).toEqual({
      schema_version: "gp4-escrow.v1",
      escrow_ref: "gp-001-escrow-1",
      asset: FROZEN_ASSET,
      amount: "10",
      outcome_receipt_hash: FROZEN_RH,
      state: "LOCKED",
      release_enabled: true,
      created_at: 1_700_000_000,
      updated_at: 1_700_000_000,
    });
  });

  test("[A-03] release_enabled DEFAULTS TO FALSE", () => {
    const { ledger } = freshLedger();
    const r = ledger.createEscrow({
      escrow_ref: "hold-escrow", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH,
    });
    expect(r.status).toBe("CREATED");
    if (r.status !== "CREATED") return;
    expect(r.entry.release_enabled).toBe(false);
    expect(ledger.readEscrow("hold-escrow")!.release_enabled).toBe(false);
  });

  test("[A-04] committed hold policy gp-001-settlement-hold-v1 parses to release_enabled=false", () => {
    const policy = JSON.parse(readFileSync(
      new URL("../../../packages/golden-path/identity/policies/gp-001-settlement-hold-v1.json", import.meta.url), "utf8"));
    const parsed = SettlementPolicySchema.parse(policy);
    expect(parsed.release_enabled).toBe(false);
    expect(parsed.authority).toBe("outcome-receipt-only");
    expect(parsed.gp4_gate).toBe("PASS_REQUIRED");
  });

  test("[A-05] record schemas are strict: unknown keys and wrong versions rejected", () => {
    const base = {
      schema_version: "gp4-release.v1",
      escrow_ref: "e1",
      outcome_receipt_hash: FROZEN_RH,
      settlement_key: FROZEN_RH,
      amount: "10",
      asset: FROZEN_ASSET,
      released_at: 1,
    };
    expect(ReleaseRecordSchema.safeParse(base).success).toBe(true);
    expect(ReleaseRecordSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(ReleaseRecordSchema.safeParse({ ...base, schema_version: "gp4-release.v2" }).success).toBe(false);
    expect(ReleaseRecordSchema.safeParse({ ...base, amount: 10 }).success).toBe(false); // amount is a decimal STRING
    const ibase = {
      schema_version: "gp4-instruction.v1",
      settlement_key: FROZEN_RH, escrow_ref: "e1",
      outcome_receipt_hash: FROZEN_RH, nonce: "7", first_seen_at: 1,
    };
    expect(InstructionRecordSchema.safeParse(ibase).success).toBe(true);
    expect(InstructionRecordSchema.safeParse({ ...ibase, nonce: 7 }).success).toBe(false); // nonce is a u64 STRING
    const ebase = {
      schema_version: "gp4-escrow.v1", escrow_ref: "e1", asset: FROZEN_ASSET, amount: "10",
      outcome_receipt_hash: FROZEN_RH, state: "LOCKED", created_at: 1, updated_at: 1,
    };
    expect(EscrowEntrySchema.safeParse(ebase).success).toBe(true);
    expect(EscrowEntrySchema.safeParse({ ...ebase, state: "FUNDED" }).success).toBe(false);
  });

  test("[A-06] frozen settlement machine: exact edges, no LOCKED→RELEASED shortcut", () => {
    expect(SETTLEMENT_EDGES).toEqual([
      { from: "LOCKED", to: "ELIGIBLE", authority: "accepted-receipt-ref" },
      { from: "ELIGIBLE", to: "RELEASED", authority: "release-observed-ref" },
    ]);
    expect(settlementEdge("LOCKED", "RELEASED")).toBeUndefined();
    expect(settlementEdge("ELIGIBLE", "RELEASED")).toBeDefined();
  });

  test("[A-07] duplicate escrow creation is rejected atomically", () => {
    const { ledger } = freshLedger();
    const input = { escrow_ref: "dup", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH };
    expect(ledger.createEscrow(input).status).toBe("CREATED");
    expect(ledger.createEscrow(input).status).toBe("ESCROW_EXISTS");
  });

  test("[A-08] invalid escrow input rejected at the schema boundary", () => {
    const { ledger } = freshLedger();
    const bad = ledger.createEscrow({
      escrow_ref: "../evil", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH,
    });
    expect(bad.status).toBe("REJECTED_INVALID");
    const badAmount = ledger.createEscrow({
      escrow_ref: "ok", asset: FROZEN_ASSET, amount: "10.1234567", outcome_receipt_hash: FROZEN_RH,
    });
    expect(badAmount.status).toBe("REJECTED_INVALID");
  });

  test("[A-09] crash recovery: stale escrow.json state re-syncs to RELEASED from the guard file", () => {
    const { ledger, root } = freshLedger();
    ledger.createEscrow({
      escrow_ref: "gp-001-escrow-1", asset: FROZEN_ASSET, amount: "10",
      outcome_receipt_hash: FROZEN_RH, release_enabled: true,
    });
    const first = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() });
    expect(first.status).toBe("RELEASED");
    // simulate a torn/stale state write: rewind escrow.json to ELIGIBLE
    const escrowFile = path.join(root, "escrows", "gp-001-escrow-1", "escrow.json");
    const stale = { ...JSON.parse(readFileSync(escrowFile, "utf8")), state: "ELIGIBLE" };
    writeFileSync(escrowFile, JSON.stringify(stale));
    // reopen: guard file is the authority → state repaired to RELEASED
    const reopened = EscrowLedger.open(root);
    expect(reopened.readEscrow("gp-001-escrow-1")!.state).toBe("RELEASED");
  });
});
