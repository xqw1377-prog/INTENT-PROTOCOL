/**
 * GP4-B — atomic economic release guard tests.
 *
 * Hard constraint under test (Commander GP4 order):
 *
 *   EconomicReleaseKey = (escrow_ref, outcome_receipt_hash)
 *   same economic result + different settlement_key / nonce
 *   = MUST NOT RELEASE TWICE
 *
 * The uniqueness must come from the persistence layer (kernel-atomic link),
 * never from an application-layer exists→insert. Proven here by an
 * in-process concurrent storm AND a true multi-process race.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { settlementKey } from "@intent/protocol-schema";
import { EscrowLedger, receiptAuthority } from "../src/index.ts";
import { FROZEN_ASSET, FROZEN_RH, freshLedger, frozenReceipt, makeInstruction } from "./util.ts";

const execFileP = promisify(execFile);

function enabledLedger(): { ledger: EscrowLedger; root: string } {
  const { ledger, root } = freshLedger();
  ledger.createEscrow({
    escrow_ref: "gp-001-escrow-1", asset: FROZEN_ASSET, amount: "10",
    outcome_receipt_hash: FROZEN_RH, release_enabled: true,
  });
  return { ledger, root };
}

function releaseFiles(root: string): string[] {
  const dir = path.join(root, "escrows", "gp-001-escrow-1", "releases");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
}

function instructionFiles(root: string): string[] {
  const dir = path.join(root, "escrows", "gp-001-escrow-1", "instructions");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
}

describe("[GP4-B] atomic economic release guard", () => {
  test("[B-01] valid frozen receipt → exactly one RELEASE + one guard file + instruction record", () => {
    const { ledger, root } = enabledLedger();
    const r = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() });
    expect(r.status).toBe("RELEASED");
    expect(r.outcome_receipt_hash).toBe(FROZEN_RH);
    expect(releaseFiles(root)).toEqual([`${FROZEN_RH.slice(7)}.json`]);
    expect(instructionFiles(root)).toEqual([`${r.settlement_key!.slice(7)}.json`]);
    expect(ledger.readEscrow("gp-001-escrow-1")!.state).toBe("RELEASED");
    const rec = ledger.readRelease("gp-001-escrow-1", FROZEN_RH)!;
    expect(rec.escrow_ref).toBe("gp-001-escrow-1");
    expect(rec.outcome_receipt_hash).toBe(FROZEN_RH);
    expect(rec.amount).toBe("10");
  });

  test("[B-02] exact instruction replay (same nonce) → ALREADY_RELEASED, still one release file", () => {
    const { ledger, root } = enabledLedger();
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() }).status).toBe("RELEASED");
    const replay = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() });
    expect(replay.status).toBe("ALREADY_RELEASED");
    expect(replay.existing!.outcome_receipt_hash).toBe(FROZEN_RH);
    expect(releaseFiles(root)).toHaveLength(1);
    expect(instructionFiles(root)).toHaveLength(1);
  });

  test("[B-03] SAME receipt + DIFFERENT nonce (different settlement_key) → NO second release", () => {
    const { ledger, root } = enabledLedger();
    const first = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "1" }) });
    expect(first.status).toBe("RELEASED");
    const sk1 = first.settlement_key!;
    const second = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "2" }) });
    expect(second.status).toBe("ALREADY_RELEASED");
    const sk2 = second.settlement_key!;
    expect(sk2).not.toBe(sk1); // the two attempts really carried different instruction identities
    expect(releaseFiles(root)).toHaveLength(1); // exactly one economic release, forever
  });

  test("[B-04] tampered receipt → rejected before the guard, no release file", () => {
    const { ledger, root } = freshLedger();
    ledger.createEscrow({
      escrow_ref: "gp-001-escrow-1", asset: FROZEN_ASSET, amount: "10",
      outcome_receipt_hash: FROZEN_RH, release_enabled: true,
    });
    const tampered = { ...frozenReceipt() as Record<string, unknown>, issued_at: "2020-01-01T00:00:01.000Z" };
    const r = ledger.attemptRelease({ receipt: tampered, instruction: makeInstruction() });
    expect(r.status).toBe("REJECTED_INVALID_RECEIPT"); // frozen seal caught the stale content_hash
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[B-05] different VALID receipt against the same escrow → binding mismatch, no release", () => {
    const { ledger, root } = enabledLedger();
    // a genuinely valid second receipt: same fields, new receipt_id, NO stale content_hash
    const { content_hash: _stale, ...rest } = frozenReceipt() as { content_hash?: string };
    const secondRaw = { ...rest, receipt_id: "99999999-9999-4999-8999-999999999999" };
    const second = receiptAuthority(secondRaw);
    expect(second.outcome_receipt_hash).not.toBe(FROZEN_RH);
    const r = ledger.attemptRelease({
      receipt: secondRaw,
      instruction: makeInstruction({ outcome_receipt_hash: second.outcome_receipt_hash }),
    });
    expect(r.status).toBe("REJECTED_RECEIPT_MISMATCH");
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[B-06] instruction not binding the receipt it settles → rejected", () => {
    const { ledger, root } = enabledLedger();
    const r = ledger.attemptRelease({
      receipt: frozenReceipt(),
      instruction: makeInstruction({ outcome_receipt_hash: "sha256:" + "ab".repeat(32) }),
    });
    expect(r.status).toBe("REJECTED_RECEIPT_MISMATCH"); // no declared content_hash → seal passes; binding check rejects
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[B-07] release_enabled=false (default hold) → REJECTED_HOLD, no release file", () => {
    const { ledger, root } = freshLedger();
    ledger.createEscrow({
      escrow_ref: "gp-001-escrow-1", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH,
    });
    const r = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() });
    expect(r.status).toBe("REJECTED_HOLD");
    expect(releaseFiles(root)).toHaveLength(0);
    expect(ledger.readEscrow("gp-001-escrow-1")!.state).toBe("LOCKED");
  });

  test("[B-08] MAINNET DENIED: non-allowlisted network refuses release", () => {
    const { ledger, root } = freshLedger();
    ledger.createEscrow({
      escrow_ref: "gp-001-escrow-1",
      asset: { network: "solana-mainnet", asset: "USDC", decimals: 6 },
      amount: "10", outcome_receipt_hash: FROZEN_RH, release_enabled: true,
    });
    const r = ledger.attemptRelease({
      receipt: frozenReceipt(),
      instruction: makeInstruction({
        outputs: [{ recipient: "agent:gp-001-demo", asset: { network: "solana-mainnet", asset: "USDC", decimals: 6 }, amount: "10", reason: "mainnet attempt" }],
      }),
    });
    expect(r.status).toBe("DENIED_NETWORK");
    expect(releaseFiles(root)).toHaveLength(0);
    expect(ledger.readEscrow("gp-001-escrow-1")!.state).toBe("LOCKED");
  });

  test("[B-09] amount / asset mismatch → rejected", () => {
    const { ledger, root } = enabledLedger();
    const amt = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ total_amount: "11", outputs: [{ recipient: "agent:gp-001-demo", asset: FROZEN_ASSET, amount: "11", reason: "x" }] }) });
    expect(amt.status).toBe("REJECTED_AMOUNT_MISMATCH");
    const ast = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ outputs: [{ recipient: "agent:gp-001-demo", asset: { network: "local-ledger", asset: "USDC-test", decimals: 6 }, amount: "10", reason: "x" }] }) });
    expect(ast.status).toBe("REJECTED_ASSET_MISMATCH");
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[B-10] corrupt existing guard file → LEDGER_CORRUPT, never overwritten, never a second file", () => {
    const { ledger, root } = enabledLedger();
    const guardPath = path.join(root, "escrows", "gp-001-escrow-1", "releases", `${FROZEN_RH.slice(7)}.json`);
    writeFileSync(guardPath, Buffer.from("not-json"));
    const r = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() });
    expect(r.status).toBe("LEDGER_CORRUPT");
    expect(readFileSync(guardPath, "utf8")).toBe("not-json"); // untouched
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "9" }) }).status).toBe("LEDGER_CORRUPT");
  });

  test("[B-11] nonce exceeding u64 → rejected as invalid instruction", () => {
    const { ledger, root } = enabledLedger();
    const r = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "18446744073709551616" }) });
    expect(r.status).toBe("REJECTED_INVALID_INSTRUCTION");
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[B-12] in-process concurrent storm (16 attempts, 16 distinct nonces) → exactly one RELEASED", async () => {
    const { ledger, root } = enabledLedger();
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) =>
      Promise.resolve().then(() =>
        ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: String(i + 1) }) }))));
    expect(results.filter((r) => r.status === "RELEASED")).toHaveLength(1);
    expect(results.filter((r) => r.status === "ALREADY_RELEASED")).toHaveLength(15);
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[B-13] MULTI-PROCESS race (10 concurrent OS processes, distinct nonces) → exactly one RELEASED", { timeout: 90_000 }, async () => {
    const { root } = enabledLedger();
    const scriptPath = fileURLToPath(new URL("../scripts/attempt-release.ts", import.meta.url));
    const receiptPath = fileURLToPath(new URL("../../../packages/gp3-verification/artifacts/receipt.json", import.meta.url));
    const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const nonces = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    const run = (nonce: number) => execFileP(
      process.execPath,
      ["--experimental-strip-types", scriptPath, root, "gp-001-escrow-1", receiptPath, String(nonce), "10", "solana-devnet", "USDC-test", "6"],
      { cwd: repoRoot, timeout: 60_000 },
    ).then(
      ({ stdout }) => JSON.parse(stdout.trim().split("\n").at(-1)!) as { status: string },
      (e: Error & { stderr?: string; code?: string }) => {
        throw new Error(`child nonce=${nonce} failed code=${e.code} stderr=${(e.stderr ?? "").slice(0, 2000)}`);
      },
    );

    const results = await Promise.all(nonces.map(run));
    const released = results.filter((r) => r.status === "RELEASED");
    const already = results.filter((r) => r.status === "ALREADY_RELEASED");
    expect(released).toHaveLength(1);
    expect(already).toHaveLength(9);
    expect(releaseFiles(root)).toHaveLength(1); // one economic release across the whole OS
    // second wave, after the winner: everything is idempotently already-released
    const wave2 = await Promise.all(nonces.map((n) => run(n + 100)));
    expect(wave2.every((r) => r.status === "ALREADY_RELEASED")).toBe(true);
    expect(releaseFiles(root)).toHaveLength(1);
  });

  test("[B-14] receipt canonical source: frozen GP3 artifact seals to the frozen ledger hash (single identity)", () => {
    const a = receiptAuthority(frozenReceipt());
    expect(a.outcome_receipt_hash).toBe("sha256:da577b3d04bc53dac6ace4c200679ab36bc1fa21e8be31e2e5c7197cc7706380");
    // determinism: same artifact, same authority hash, forever
    expect(receiptAuthority(frozenReceipt()).outcome_receipt_hash).toBe(a.outcome_receipt_hash);
  });

  test("[B-15] settlement_key derivation is the frozen G1 function and is recorded under its hex name", () => {
    const { ledger, root } = enabledLedger();
    const r = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "42" }) });
    expect(r.status).toBe("RELEASED");
    const frozen = settlementKey({ outcome_receipt_hash: FROZEN_RH, escrow_ref: "gp-001-escrow-1", nonce: 42n });
    expect(r.settlement_key).toBe(frozen);
    expect(instructionFiles(root)).toEqual([`${frozen.slice(7)}.json`]);
    const rec = ledger.readInstruction("gp-001-escrow-1", frozen)!;
    expect(rec.nonce).toBe("42");
    expect(rec.settlement_key).toBe(frozen);
  });

  test("[B-16] unknown escrow / traversal escrow_ref → rejected before any path operation", () => {
    const { ledger, root } = freshLedger();
    ledger.createEscrow({
      escrow_ref: "gp-001-escrow-1", asset: FROZEN_ASSET, amount: "10",
      outcome_receipt_hash: FROZEN_RH, release_enabled: true,
    });
    const unknown = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ escrow_ref: "no-such-escrow" }) });
    expect(unknown.status).toBe("REJECTED_UNKNOWN_ESCROW");
    const traversal = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ escrow_ref: "../../etc" }) });
    expect(traversal.status).toBe("REJECTED_UNKNOWN_ESCROW");
    expect(existsSync(path.join(root, "escrows", "no-such-escrow"))).toBe(false);
  });

  test("[B-17] code independence: src/ imports no GP1/GP2/GP3 package code", () => {
    const srcDir = fileURLToPath(new URL("../src", import.meta.url));
    for (const f of readdirSync(srcDir)) {
      const text = readFileSync(path.join(srcDir, f), "utf8");
      for (const line of text.split("\n")) {
        if (/^\s*import\b/.test(line) || /^\s*export\b.*\bfrom\b/.test(line)) {
          expect(line, `${f}: ${line}`).not.toMatch(/gp[0-9]|verification|conformance|golden-path|gp-runtime|gp-execution/);
        }
      }
    }
  });
});
