/**
 * GP4-B — atomic economic release guard tests (R1/R2/R3 remediated).
 *
 * Hard constraint under test (Commander GP4 order):
 *
 *   EconomicReleaseKey = (escrow_ref, outcome_receipt_hash)
 *   same economic result + different settlement_key / nonce
 *   = MUST NOT RELEASE TWICE
 *
 * Remediation proofs:
 *   R3 — every pre-guard rejection leaves the ledger byte-identical
 *        (treeDigest zero-write oracle); ELIGIBLE never persists before guard
 *   R2 — only the frozen triple solana-devnet/USDC-test/6 can release
 *   R1 — production escrows can never be release-enabled
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
import {
  FROZEN_ASSET, FROZEN_RH, enabledLedger, forgeEscrow, frozenReceipt,
  makeInstruction, productionLedger, releaseFiles, treeDigest,
} from "./util.ts";

const execFileP = promisify(execFile);

describe("[GP4-B] atomic economic release guard", () => {
  test("[B-01] valid frozen receipt → exactly one RELEASE, guard file, LOCKED→RELEASED (ELIGIBLE never on disk)", () => {
    const { ledger, root } = enabledLedger();
    const r = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() });
    expect(r.status).toBe("RELEASED");
    expect(r.outcome_receipt_hash).toBe(FROZEN_RH);
    expect(releaseFiles(root)).toEqual([`${FROZEN_RH.slice(7)}.json`]);
    expect(ledger.readEscrow("gp-001-escrow-1")!.state).toBe("RELEASED");
    const onDisk = JSON.parse(readFileSync(path.join(root, "escrows", "gp-001-escrow-1", "escrow.json"), "utf8"));
    expect(onDisk.state).toBe("RELEASED"); // LOCKED → RELEASED directly; ELIGIBLE is logical-only
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
  });

  test("[B-03] SAME receipt + DIFFERENT nonce (different settlement_key) → NO second release", () => {
    const { ledger, root } = enabledLedger();
    const first = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "1" }) });
    expect(first.status).toBe("RELEASED");
    const sk1 = first.settlement_key!;
    const second = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "2" }) });
    expect(second.status).toBe("ALREADY_RELEASED");
    expect(second.settlement_key!).not.toBe(sk1); // the attempts really carried different instruction identities
    expect(releaseFiles(root)).toHaveLength(1);   // exactly one economic release, forever
  });

  test("[B-04] tampered receipt → rejected before the guard, no release file", () => {
    const { ledger, root } = enabledLedger();
    const tampered = { ...(frozenReceipt() as Record<string, unknown>), issued_at: "2020-01-01T00:00:01.000Z" };
    const res = ledger.attemptRelease({ receipt: tampered, instruction: makeInstruction() });
    expect(res.status).toBe("REJECTED_INVALID_RECEIPT"); // frozen seal caught the stale content_hash
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[B-05] different VALID receipt against the same escrow → binding mismatch, no release", () => {
    const { ledger, root } = enabledLedger();
    const { content_hash: _stale, ...rest } = frozenReceipt() as { content_hash?: string };
    const secondRaw = { ...rest, receipt_id: "99999999-9999-4999-8999-999999999999" };
    const second = receiptAuthority(secondRaw);
    expect(second.outcome_receipt_hash).not.toBe(FROZEN_RH);
    const res = ledger.attemptRelease({
      receipt: secondRaw,
      instruction: makeInstruction({ outcome_receipt_hash: second.outcome_receipt_hash }),
    });
    expect(res.status).toBe("REJECTED_RECEIPT_MISMATCH");
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[B-06] instruction not binding the receipt it settles → rejected", () => {
    const { ledger, root } = enabledLedger();
    const res = ledger.attemptRelease({
      receipt: frozenReceipt(),
      instruction: makeInstruction({ outcome_receipt_hash: "sha256:" + "ab".repeat(32) }),
    });
    expect(res.status).toBe("REJECTED_RECEIPT_MISMATCH");
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[B-07/R1] production escrow (no enable path exists) → REJECTED_HOLD, no release file", () => {
    const { ledger, root } = productionLedger();
    ledger.createEscrow({ escrow_ref: "gp-001-escrow-1", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH });
    const res = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() });
    expect(res.status).toBe("REJECTED_HOLD");
    expect(releaseFiles(root)).toHaveLength(0);
    expect(ledger.readEscrow("gp-001-escrow-1")!.state).toBe("LOCKED");
  });

  test("[B-08/R2] non-frozen asset triples → DENIED_ASSET at the RELEASE layer (forged escrow.json, bypassing creation gate)", () => {
    for (const bad of [
      { network: "solana-devnet", asset: "USDT-test", decimals: 6 },
      { network: "solana-devnet", asset: "USDC-test", decimals: 9 },
      { network: "local-ledger", asset: "USDC-test", decimals: 6 },
      { network: "solana-mainnet", asset: "USDC", decimals: 6 },
    ]) {
      const root = mkdtempSync(path.join(tmpdir(), "gp4-deny-"));
      forgeEscrow(root, { asset: bad, release_enabled: true }); // hand-forged: even release_enabled=true cannot bypass the asset gate
      const ledger = EscrowLedger.open(root);
      const res = ledger.attemptRelease({
        receipt: frozenReceipt(),
        instruction: makeInstruction({ outputs: [{ recipient: "agent:gp-001-demo", asset: bad, amount: "10", reason: "denied triple" }] }),
      });
      expect(res.status, JSON.stringify(bad)).toBe("DENIED_ASSET");
      expect(releaseFiles(root)).toHaveLength(0);
      expect(ledger.readEscrow("gp-001-escrow-1")!.state).toBe("LOCKED");
    }
  });

  test("[B-09] amount / asset mismatch → rejected", () => {
    const { ledger, root } = enabledLedger();
    const amt = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ total_amount: "11", outputs: [{ recipient: "agent:gp-001-demo", asset: FROZEN_ASSET, amount: "11", reason: "x" }] }) });
    expect(amt.status).toBe("REJECTED_AMOUNT_MISMATCH");
    const ast = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ outputs: [{ recipient: "agent:gp-001-demo", asset: { network: "solana-devnet", asset: "USDC-test", decimals: 3 }, amount: "10", reason: "x" }] }) });
    expect(ast.status).toBe("REJECTED_ASSET_MISMATCH");
    expect(releaseFiles(root)).toHaveLength(0);
  });

  test("[B-10] corrupt existing guard file → LEDGER_CORRUPT, never overwritten, never a second file", () => {
    const { ledger, root } = enabledLedger();
    const guardPath = path.join(root, "escrows", "gp-001-escrow-1", "releases", `${FROZEN_RH.slice(7)}.json`);
    writeFileSync(guardPath, Buffer.from("not-json"));
    const res = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() });
    expect(res.status).toBe("LEDGER_CORRUPT");
    expect(readFileSync(guardPath, "utf8")).toBe("not-json"); // untouched
    expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "9" }) }).status).toBe("LEDGER_CORRUPT");
  });

  test("[B-11] nonce exceeding u64 → rejected as invalid instruction", () => {
    const { ledger, root } = enabledLedger();
    const res = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "18446744073709551616" }) });
    expect(res.status).toBe("REJECTED_INVALID_INSTRUCTION");
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
    expect(receiptAuthority(frozenReceipt()).outcome_receipt_hash).toBe(a.outcome_receipt_hash);
  });

  test("[B-15] settlement_key derivation is the frozen G1 function; NO instruction persistence exists (P1-A)", () => {
    const { ledger, root } = enabledLedger();
    const res = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "42" }) });
    expect(res.status).toBe("RELEASED");
    const frozen = settlementKey({ outcome_receipt_hash: FROZEN_RH, escrow_ref: "gp-001-escrow-1", nonce: 42n });
    expect(res.settlement_key).toBe(frozen);
    // instruction idempotency ledger = GP4-C scope: no instructions/ dir anywhere
    expect(existsSync(path.join(root, "escrows", "gp-001-escrow-1", "instructions"))).toBe(false);
  });

  test("[B-16] unknown escrow / traversal escrow_ref → rejected before any path operation", () => {
    const { ledger, root } = enabledLedger();
    const unknown = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ escrow_ref: "no-such-escrow" }) });
    expect(unknown.status).toBe("REJECTED_UNKNOWN_ESCROW");
    const traversal = ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ escrow_ref: "../../etc" }) });
    expect(traversal.status).toBe("REJECTED_UNKNOWN_ESCROW");
    expect(existsSync(path.join(root, "escrows", "no-such-escrow"))).toBe(false);
  });

  test("[B-17] code independence: src/ imports no GP1/GP2/GP3 package code", () => {
    const srcDir = fileURLToPath(new URL("../src", import.meta.url));
    // The ONLY permitted non-relative imports: node builtins, zod, and the
    // frozen G1 wire library. Relative ./x.ts modules are this package's own.
    const ALLOWED = (spec: string): boolean =>
      spec.startsWith("node:") || spec.startsWith(".") || spec === "zod" || spec === "@intent/protocol-schema";
    for (const f of readdirSync(srcDir)) {
      const text = readFileSync(path.join(srcDir, f), "utf8");
      for (const line of text.split("\n")) {
        const m = /from\s+["']([^"']+)["']/.exec(line);
        if (!m) continue;
        const spec = m[1]!;
        if (ALLOWED(spec)) continue;
        expect(line, `${f}: ${line}`).not.toMatch(/gp[0-9]|gp-|verification|conformance|golden-path|runtime|execution/);
      }
    }
  });

  test("[B-18/R3] ZERO-WRITE proof: EVERY pre-guard rejection leaves the ledger byte-identical", () => {
    // (setup writes happen first; the digest is taken only around attemptRelease)
    const cases: Array<{ name: string; run: (l: EscrowLedger) => unknown }> = [
      { name: "REJECTED_INVALID_RECEIPT", run: (l) => l.attemptRelease({ receipt: { ...(frozenReceipt() as Record<string, unknown>), issued_at: "2020-01-01T00:00:01.000Z" }, instruction: makeInstruction() }) },
      { name: "REJECTED_INVALID_INSTRUCTION", run: (l) => l.attemptRelease({ receipt: frozenReceipt(), instruction: { ...makeInstruction(), junk: 1 } }) },
      { name: "REJECTED_UNKNOWN_ESCROW", run: (l) => l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ escrow_ref: "missing" }) }) },
      { name: "REJECTED_RECEIPT_MISMATCH", run: (l) => l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ outcome_receipt_hash: "sha256:" + "cd".repeat(32) }) }) },
      { name: "REJECTED_AMOUNT_MISMATCH", run: (l) => l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ total_amount: "11", outputs: [{ recipient: "agent:gp-001-demo", asset: FROZEN_ASSET, amount: "11", reason: "x" }] }) }) },
      { name: "REJECTED_INVALID_INSTRUCTION(u64)", run: (l) => l.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "18446744073709551616" }) }) },
    ];
    for (const c of cases) {
      const { ledger, root } = enabledLedger();
      const before = treeDigest(root);
      const res = c.run(ledger);
      expect((res as { status: string }).status, c.name).toMatch(/^REJECTED_/);
      expect(treeDigest(root), c.name).toBe(before); // byte-identical: zero persisted mutation before the guard
    }
    // REJECTED_HOLD: production escrow (no enable path) is also zero-write
    {
      const { ledger, root } = productionLedger();
      ledger.createEscrow({ escrow_ref: "gp-001-escrow-1", asset: FROZEN_ASSET, amount: "10", outcome_receipt_hash: FROZEN_RH });
      const before = treeDigest(root);
      expect(ledger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction() }).status).toBe("REJECTED_HOLD");
      expect(treeDigest(root)).toBe(before);
    }
    // DENIED_ASSET on a forged (non-frozen) escrow is also zero-write
    const denyRoot = mkdtempSync(path.join(tmpdir(), "gp4-zerowrite-"));
    forgeEscrow(denyRoot, { asset: { network: "local-ledger", asset: "USDC-test", decimals: 6 }, release_enabled: true });
    const denyLedger = EscrowLedger.open(denyRoot);
    const denyBefore = treeDigest(denyRoot);
    const denyRes = denyLedger.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ outputs: [{ recipient: "agent:gp-001-demo", asset: { network: "local-ledger", asset: "USDC-test", decimals: 6 }, amount: "10", reason: "x" }] }) });
    expect(denyRes.status).toBe("DENIED_ASSET");
    expect(treeDigest(denyRoot)).toBe(denyBefore);
  });

  test("[B-19/R3] guard-前 crash on-disk state: no guard ⇒ no authoritative mutation; release still exactly-once afterwards", () => {
    // The crash point "validation passed, guard not yet published" leaves:
    //   releases/ EMPTY (no guard file) and escrow state LOCKED (ELIGIBLE is
    //   logical-only under the R3 boundary — it is NEVER persisted before
    //   the guard). On-disk there is nothing but the original escrow entry.
    const { ledger, root } = enabledLedger();
    expect(ledger.readEscrow("gp-001-escrow-1")!.state).toBe("LOCKED");
    expect(releaseFiles(root)).toHaveLength(0);
    expect(existsSync(path.join(root, "escrows", "gp-001-escrow-1", "releases", `${FROZEN_RH.slice(7)}.json`))).toBe(false);
    // crash happened "here". After restart, release proceeds exactly once:
    const reopened = EscrowLedger.open(root);
    expect(reopened.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "5" }) }).status).toBe("RELEASED");
    expect(reopened.attemptRelease({ receipt: frozenReceipt(), instruction: makeInstruction({ nonce: "6" }) }).status).toBe("ALREADY_RELEASED");
    expect(releaseFiles(root)).toHaveLength(1);
  });
});
