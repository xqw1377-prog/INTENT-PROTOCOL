/**
 * GP4-A — settlement identity + persistence schema tests (R1/R2 + GP4-C v2).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import {
  EscrowLedger, ESCROW_REF_RE, SETTLEMENT_EDGES, SettlementPolicySchema,
  EscrowEntrySchema, ReleaseRecordSchema, InstructionRecordSchema, ClaimRecordSchema, settlementEdge,
  LocalVerificationLedger,
} from "../src/index.ts";
import {
  ESCROW_REF, FROZEN_ASSET, FROZEN_CLAIM_HASH, FROZEN_RH, frozenClaim, frozenReceipt,
  makeInstruction, productionLedger, verificationLedger,
} from "./util.ts";
import type { CreateEscrowInput } from "../src/index.ts";

function escrowInput(over?: Partial<CreateEscrowInput>): CreateEscrowInput {
  return {
    escrow_ref: ESCROW_REF, asset: FROZEN_ASSET, amount: "10",
    outcome_receipt_hash: FROZEN_RH, claim_record_hash: FROZEN_CLAIM_HASH, ...over,
  };
}

function mkdtempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "gp4-repair-"));
}

describe("[GP4-A] settlement identity + persistence schema", () => {
  test("[A-01] escrow_ref grammar: frozen GP-001 ref legal, traversal/unsafe rejected", () => {
    expect(ESCROW_REF_RE.test("escrow:gp-001-local")).toBe(true); // frozen task value — ':' legal
    expect(ESCROW_REF_RE.test("e1")).toBe(true);
    for (const bad of ["", "../evil", "a/b", "a\\b", "UPPER", "-lead", ".lead", "a b", "x".repeat(65), "a%b"]) {
      expect(ESCROW_REF_RE.test(bad), bad).toBe(false);
    }
  });

  test("[A-02] production createEscrow persists the exact layout — v2 entry, release_enabled ALWAYS false", () => {
    const { ledger, root } = productionLedger();
    const r = ledger.createEscrow(escrowInput());
    expect(r.status).toBe("CREATED");
    const dir = path.join(root, "escrows", "escrow%3agp-001-local");
    expect(existsSync(path.join(dir, "escrow.json"))).toBe(true);
    expect(existsSync(path.join(dir, "releases"))).toBe(true);
    expect(existsSync(path.join(dir, "instructions"))).toBe(false); // journal created lazily on first win
    const onDisk = JSON.parse(readFileSync(path.join(dir, "escrow.json"), "utf8"));
    expect(onDisk).toEqual({
      schema_version: "gp4-escrow.v2",
      escrow_ref: ESCROW_REF,
      asset: FROZEN_ASSET,
      amount: "10",
      outcome_receipt_hash: FROZEN_RH,
      claim_record_hash: FROZEN_CLAIM_HASH,
      state: "LOCKED",
      release_enabled: false, // production API can produce NOTHING else
      created_at: 1_700_000_000,
      updated_at: 1_700_000_000,
    });
  });

  test("[A-03/R1] production API is hold-by-construction: no input can enable release", () => {
    const { ledger } = productionLedger();
    const r = ledger.createEscrow(escrowInput({ escrow_ref: "hold-1" }));
    expect(r.status).toBe("CREATED");
    if (r.status !== "CREATED") return;
    expect(r.entry.release_enabled).toBe(false);
    expect(ledger.readEscrow("hold-1")!.release_enabled).toBe(false);
    const smuggled = ledger.createEscrow({
      ...escrowInput({ escrow_ref: "hold-2" }), release_enabled: true,
    } as unknown as CreateEscrowInput);
    expect(smuggled.status).toBe("REJECTED_INVALID");
    expect(ledger.readEscrow("hold-2")).toBeNull();
  });

  test("[A-04/R1] committed HOLD policy + ANY plain caller input → release can never be enabled", () => {
    const policy = SettlementPolicySchema.parse(JSON.parse(readFileSync(
      new URL("../../../packages/golden-path/identity/policies/gp-001-settlement-hold-v1.json", import.meta.url), "utf8")));
    expect(policy.release_enabled).toBe(false);
    expect(policy.authority).toBe("outcome-receipt-only");
    const { ledger, root } = productionLedger();
    for (const ref of ["a", "b", "c"]) {
      expect(ledger.createEscrow(escrowInput({ escrow_ref: ref })).status).toBe("CREATED");
    }
    for (const ref of ["a", "b", "c"]) {
      const rel = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ escrow_ref: ref }), claim_record: frozenClaim() });
      expect(rel.status).toBe("REJECTED_HOLD");
    }
    expect(existsSync(path.join(root, "escrows", "a"))).toBe(true);
  });

  test("[A-05] record schemas are strict: unknown keys and wrong versions rejected", () => {
    const base = {
      schema_version: "gp4-release.v1", escrow_ref: "e1", outcome_receipt_hash: FROZEN_RH,
      settlement_key: FROZEN_RH, amount: "10", asset: FROZEN_ASSET, released_at: 1,
    };
    expect(ReleaseRecordSchema.safeParse(base).success).toBe(true);
    expect(ReleaseRecordSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(ReleaseRecordSchema.safeParse({ ...base, amount: 10 }).success).toBe(false);
    const ibase = {
      schema_version: "gp4-instruction.v1", settlement_key: FROZEN_RH, escrow_ref: "e1",
      outcome_receipt_hash: FROZEN_RH, nonce: "7", first_seen_at: 1,
    };
    expect(InstructionRecordSchema.safeParse(ibase).success).toBe(true);
    expect(InstructionRecordSchema.safeParse({ ...ibase, nonce: 7 }).success).toBe(false);
    const ebase = {
      schema_version: "gp4-escrow.v2", escrow_ref: "e1", asset: FROZEN_ASSET, amount: "10",
      outcome_receipt_hash: FROZEN_RH, claim_record_hash: FROZEN_CLAIM_HASH,
      state: "LOCKED", release_enabled: false, created_at: 1, updated_at: 1,
    };
    expect(EscrowEntrySchema.safeParse(ebase).success).toBe(true);
    expect(EscrowEntrySchema.safeParse({ ...ebase, state: "FUNDED" }).success).toBe(false);
    expect(EscrowEntrySchema.safeParse({ ...ebase, schema_version: "gp4-escrow.v1" }).success).toBe(false);
    expect(EscrowEntrySchema.safeParse({ ...ebase, state: "ELIGIBLE" }).success).toBe(true); // legacy read tolerance
    expect(ClaimRecordSchema.safeParse(frozenClaim()).success).toBe(true);
    expect(ClaimRecordSchema.safeParse({ ...frozenClaim(), claimant: "not-a-subject" }).success).toBe(false);
  });

  test("[A-06] frozen settlement machine: exact edges, no LOCKED→RELEASED shortcut", () => {
    expect(SETTLEMENT_EDGES).toEqual([
      { from: "LOCKED", to: "ELIGIBLE", authority: "accepted-receipt-ref" },
      { from: "ELIGIBLE", to: "RELEASED", authority: "release-observed-ref" },
    ]);
    expect(settlementEdge("LOCKED", "RELEASED")).toBeUndefined();
  });

  test("[A-07] duplicate escrow creation is rejected atomically", () => {
    const { ledger } = productionLedger();
    expect(ledger.createEscrow(escrowInput()).status).toBe("CREATED");
    expect(ledger.createEscrow(escrowInput()).status).toBe("ESCROW_EXISTS");
  });

  test("[A-08/R2] non-frozen asset triples are rejected at CREATION", () => {
    const { ledger } = productionLedger();
    for (const bad of [
      { network: "solana-devnet", asset: "USDT-test", decimals: 6 },
      { network: "solana-devnet", asset: "USDC-test", decimals: 9 },
      { network: "local-ledger", asset: "USDC-test", decimals: 6 },
      { network: "solana-mainnet", asset: "USDC", decimals: 6 },
    ]) {
      const r = ledger.createEscrow(escrowInput({ asset: bad }));
      expect(r.status, JSON.stringify(bad)).toBe("REJECTED_INVALID");
    }
    expect(ledger.createEscrow(escrowInput({ escrow_ref: "../evil" })).status).toBe("REJECTED_INVALID");
    expect(ledger.createEscrow(escrowInput({ amount: "10.1234567" })).status).toBe("REJECTED_INVALID");
  });

  test("[A-09/R3] crash-state repair: guard present ⇒ RELEASED, guard absent ⇒ LOCKED", () => {
    const { ledger, root } = verificationLedger();
    ledger.createEscrowForVerification(escrowInput());
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() }).status).toBe("RELEASED");
    // (a) torn cache AFTER the guard: rewind escrow.json to legacy ELIGIBLE — guard rules
    const escrowFile = path.join(root, "escrows", "escrow%3agp-001-local", "escrow.json");
    writeFileSync(escrowFile, JSON.stringify({ ...JSON.parse(readFileSync(escrowFile, "utf8")), state: "ELIGIBLE" }));
    expect(EscrowLedger.open(root).readEscrow(ESCROW_REF)!.state).toBe("RELEASED");
    // (b) legacy ELIGIBLE with NO guard: demoted to LOCKED, still releasable exactly once
    const root2 = mkdtempRoot();
    mkdirSync(path.join(root2, "escrows", "escrow%3agp-001-local", "releases"), { recursive: true });
    writeFileSync(path.join(root2, "escrows", "escrow%3agp-001-local", "escrow.json"), JSON.stringify({
      schema_version: "gp4-escrow.v2", escrow_ref: ESCROW_REF, asset: FROZEN_ASSET, amount: "10",
      outcome_receipt_hash: FROZEN_RH, claim_record_hash: FROZEN_CLAIM_HASH,
      state: "ELIGIBLE", release_enabled: true, created_at: 1, updated_at: 1,
    }));
    const reopened = EscrowLedger.open(root2);
    expect(reopened.readEscrow(ESCROW_REF)!.state).toBe("LOCKED"); // no guard ⇒ not released
    expect(reopened.listReleaseFiles(ESCROW_REF)).toHaveLength(0);
    expect(reopened.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction(), claim_record: frozenClaim() }).status).toBe("RELEASED");
    expect(reopened.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "2" }), claim_record: frozenClaim() }).status).toBe("ALREADY_RELEASED");
  });

  test("[A-10/R1] LocalVerificationLedger is the ONLY enable path", () => {
    const { ledger } = verificationLedger();
    const r = ledger.createEscrowForVerification(escrowInput({ escrow_ref: "verify-1" }));
    expect(r.status).toBe("CREATED");
    if (r.status !== "CREATED") return;
    expect(r.entry.release_enabled).toBe(true);
    const prod = productionLedger().ledger;
    expect((prod as unknown as LocalVerificationLedger).createEscrowForVerification).toBeUndefined();
  });
});
