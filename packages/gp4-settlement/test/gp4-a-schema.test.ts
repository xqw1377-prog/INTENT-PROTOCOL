/**
 * GP4-A — settlement identity + persistence schema tests (R1/R2 remediated).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import {
  EscrowLedger, ESCROW_REF_RE, SETTLEMENT_EDGES, SettlementPolicySchema,
  EscrowEntrySchema, ReleaseRecordSchema, settlementEdge, LocalVerificationLedger,
} from "../src/index.ts";
import { FROZEN_ASSET, FROZEN_RH, frozenReceipt, makeInstruction, productionLedger, verificationLedger } from "./util.ts";
import type { CreateEscrowInput } from "../src/index.ts";

function mkdtempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "gp4-repair-"));
}

describe("[GP4-A] settlement identity + persistence schema", () => {
  test("[A-01] escrow_ref grammar rejects traversal and unsafe refs", () => {
    expect(ESCROW_REF_RE.test("gp-001-escrow-1")).toBe(true);
    expect(ESCROW_REF_RE.test("e1")).toBe(true);
    for (const bad of ["", "../evil", "a/b", "a\\b", "UPPER", "-lead", ".lead", "a:b", "a b", "x".repeat(65)]) {
      expect(ESCROW_REF_RE.test(bad), bad).toBe(false);
    }
  });

  test("[A-02] production createEscrow persists the exact layout — release_enabled ALWAYS false, NO instructions/ dir", () => {
    const { ledger, root } = productionLedger();
    const r = ledger.createEscrow({
      escrow_ref: "gp-001-escrow-1", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH,
    });
    expect(r.status).toBe("CREATED");
    const dir = path.join(root, "escrows", "gp-001-escrow-1");
    expect(existsSync(path.join(dir, "escrow.json"))).toBe(true);
    expect(existsSync(path.join(dir, "releases"))).toBe(true);
    expect(existsSync(path.join(dir, "instructions"))).toBe(false); // instruction ledger = GP4-C, absent by design
    const onDisk = JSON.parse(readFileSync(path.join(dir, "escrow.json"), "utf8"));
    expect(onDisk).toEqual({
      schema_version: "gp4-escrow.v1",
      escrow_ref: "gp-001-escrow-1",
      asset: FROZEN_ASSET,
      amount: "10",
      outcome_receipt_hash: FROZEN_RH,
      state: "LOCKED",
      release_enabled: false, // production API can produce NOTHING else
      created_at: 1_700_000_000,
      updated_at: 1_700_000_000,
    });
  });

  test("[A-03/R1] production API is hold-by-construction: no input can enable release", () => {
    const { ledger } = productionLedger();
    // (a) normal production input → release_enabled false on disk
    const r = ledger.createEscrow({ escrow_ref: "hold-1", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH });
    expect(r.status).toBe("CREATED");
    if (r.status !== "CREATED") return;
    expect(r.entry.release_enabled).toBe(false);
    expect(ledger.readEscrow("hold-1")!.release_enabled).toBe(false);
    // (b) a plain caller smuggling `release_enabled: true` past the type system
    //     (JS has no compile-time types) is REJECTED at the API boundary.
    const smuggled = ledger.createEscrow({
      escrow_ref: "hold-2", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH,
      release_enabled: true,
    } as unknown as CreateEscrowInput);
    expect(smuggled.status).toBe("REJECTED_INVALID");
    expect(ledger.readEscrow("hold-2")).toBeNull();
  });

  test("[A-04/R1] committed HOLD policy + ANY plain caller input → release can never be enabled", () => {
    // the committed hold policy (the authority the sponsor froze for GP-001)
    const policy = SettlementPolicySchema.parse(JSON.parse(readFileSync(
      new URL("../../../packages/golden-path/identity/policies/gp-001-settlement-hold-v1.json", import.meta.url), "utf8")));
    expect(policy.release_enabled).toBe(false);
    expect(policy.authority).toBe("outcome-receipt-only");
    // every production escrow, whatever the caller does, stays HOLD
    const { ledger, root } = productionLedger();
    for (const ref of ["a", "b", "c"]) {
      const r = ledger.createEscrow({ escrow_ref: ref, asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH });
      expect(r.status).toBe("CREATED");
    }
    for (const ref of ["a", "b", "c"]) {
      const rel = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ escrow_ref: ref }) });
      expect(rel.status).toBe("REJECTED_HOLD");
      expect(ledger.readEscrow(ref)!.release_enabled).toBe(false);
    }
    expect(existsSync(path.join(root, "escrows", "a", "releases", `${FROZEN_RH.slice(7)}.json`))).toBe(false);
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
    const ebase = {
      schema_version: "gp4-escrow.v1", escrow_ref: "e1", asset: FROZEN_ASSET, amount: "10",
      outcome_receipt_hash: FROZEN_RH, state: "LOCKED", release_enabled: false, created_at: 1, updated_at: 1,
    };
    expect(EscrowEntrySchema.safeParse(ebase).success).toBe(true);
    expect(EscrowEntrySchema.safeParse({ ...ebase, state: "FUNDED" }).success).toBe(false);
    // ELIGIBLE parses (legacy on-disk tolerance) but is never WRITTEN by this package
    expect(EscrowEntrySchema.safeParse({ ...ebase, state: "ELIGIBLE" }).success).toBe(true);
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
    const { ledger } = productionLedger();
    const input = { escrow_ref: "dup", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH };
    expect(ledger.createEscrow(input).status).toBe("CREATED");
    expect(ledger.createEscrow(input).status).toBe("ESCROW_EXISTS");
  });

  test("[A-08/R2] non-frozen asset triples are rejected at CREATION (the only frozen triple is solana-devnet/USDC-test/6)", () => {
    const { ledger } = productionLedger();
    for (const bad of [
      { network: "solana-devnet", asset: "USDT-test", decimals: 6 },
      { network: "solana-devnet", asset: "USDC-test", decimals: 9 },
      { network: "local-ledger", asset: "USDC-test", decimals: 6 },
      { network: "solana-mainnet", asset: "USDC", decimals: 6 },
    ]) {
      const r = ledger.createEscrow({ escrow_ref: "bad-asset", asset: bad, amount: "10", outcome_receipt_hash: FROZEN_RH });
      expect(r.status, JSON.stringify(bad)).toBe("REJECTED_INVALID");
    }
    const traversal = ledger.createEscrow({ escrow_ref: "../evil", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH });
    expect(traversal.status).toBe("REJECTED_INVALID");
    const badScale = ledger.createEscrow({ escrow_ref: "ok", asset: FROZEN_ASSET, amount: "10.1234567", outcome_receipt_hash: FROZEN_RH });
    expect(badScale.status).toBe("REJECTED_INVALID");
  });

  test("[A-09/R3] crash-state repair: ELIGIBLE is never an authority — guard present ⇒ RELEASED, guard absent ⇒ LOCKED", () => {
    const { ledger, root } = verificationLedger();
    ledger.createEscrowForVerification({
      escrow_ref: "gp-001-escrow-1", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH,
    });
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() }).status).toBe("RELEASED");
    // (a) torn cache AFTER the guard (crash between guard and state write):
    //     rewind escrow.json to legacy ELIGIBLE — the guard file rules.
    const escrowFile = path.join(root, "escrows", "gp-001-escrow-1", "escrow.json");
    writeFileSync(escrowFile, JSON.stringify({ ...JSON.parse(readFileSync(escrowFile, "utf8")), state: "ELIGIBLE" }));
    expect(EscrowLedger.open(root).readEscrow("gp-001-escrow-1")!.state).toBe("RELEASED");
    // (b) legacy ELIGIBLE with NO guard (a crash BEFORE the guard under the old
    //     boundary — impossible under the R3 boundary, but must repair correctly):
    //     no guard ⇒ no release ever happened ⇒ demote to LOCKED.
    const root2 = mkdtempRoot();
    mkdirSync(path.join(root2, "escrows", "legacy-1", "releases"), { recursive: true });
    writeFileSync(path.join(root2, "escrows", "legacy-1", "escrow.json"), JSON.stringify({
      schema_version: "gp4-escrow.v1", escrow_ref: "legacy-1", asset: FROZEN_ASSET, amount: "10",
      outcome_receipt_hash: FROZEN_RH, state: "ELIGIBLE", release_enabled: true,
      created_at: 1, updated_at: 1,
    }));
    const reopened = EscrowLedger.open(root2);
    expect(reopened.readEscrow("legacy-1")!.state).toBe("LOCKED"); // demoted: no guard ⇒ not released
    expect(reopened.listReleaseFiles("legacy-1")).toHaveLength(0);
    // ...and the escrow can still be released exactly once afterwards
    expect(reopened.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ escrow_ref: "legacy-1" }) }).status).toBe("RELEASED");
    expect(reopened.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ escrow_ref: "legacy-1", nonce: "2" }) }).status).toBe("ALREADY_RELEASED");
  });

  test("[A-10/R1] LocalVerificationLedger is the ONLY enable path — distinct class, distinct method", async () => {
    const { ledger } = verificationLedger();
    const r = ledger.createEscrowForVerification({
      escrow_ref: "verify-1", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH,
    });
    expect(r.status).toBe("CREATED");
    if (r.status !== "CREATED") return;
    expect(r.entry.release_enabled).toBe(true);
    // the override is a DIFFERENT class: the production surface has no such method
    const prod = productionLedger().ledger;
    expect((prod as unknown as LocalVerificationLedger).createEscrowForVerification).toBeUndefined();
  });
});
