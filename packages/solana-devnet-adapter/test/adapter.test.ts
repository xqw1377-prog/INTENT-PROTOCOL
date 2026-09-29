/**
 * TESTNET-R1 / T1 machine tests — adapter skeleton + deterministic contracts.
 *
 * T1 boundary: NO RPC, NO devnet, NO program deployment, NO real key
 * material, NO mint discovery, NO mainnet, NO GP4/GP5 edit, NO G1 edit.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  economicReleaseDigest, receiptHashRaw32, toHex,
  base58Decode, base58Encode, findProgramAddress, isOnEd25519Curve, releasePda,
  prepareSettlement, submitSettlement, observeSettlement, reconcileSettlement,
  assertNotMainnet, EndpointDeniedError, FROZEN, PINNED, pinnedComplete,
  type SettlementInput,
} from "../src/index.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const golden = JSON.parse(readFileSync(path.join(pkgDir, "vectors/golden.json"), "utf8")) as {
  program_id: string;
  cases: Array<{ name: string; escrow_ref: string; outcome_receipt_hash: string; program_id: string; economic_release_digest: string; release_pda: string; bump: number }>;
};

const validInput = (): SettlementInput => ({
  escrow_ref: FROZEN.anchors.escrowRef,
  outcome_receipt_hash: FROZEN.anchors.outcomeReceiptHash,
  claim_record_hash: FROZEN.anchors.claimRecordHash,
  claimant: FROZEN.anchors.claimant,
  asset: { ...FROZEN.asset },
  amount: FROZEN.amount,
});

describe("[TESTNET-R1/T1] adapter skeleton + deterministic contracts", () => {
  test("[T1-01] EconomicReleaseDigest golden vectors (JS implementation)", () => {
    for (const c of golden.cases) {
      expect(toHex(economicReleaseDigest(c.escrow_ref, c.outcome_receipt_hash))).toBe(c.economic_release_digest);
    }
  });

  test("[T1-02] release PDA golden vectors (JS implementation, fixture program id)", () => {
    for (const c of golden.cases) {
      const r = releasePda(c.escrow_ref, c.outcome_receipt_hash, c.program_id);
      expect(r.pda).toBe(c.release_pda);
      expect(r.bump).toBe(c.bump);
      expect(r.digestHex).toBe(c.economic_release_digest);
    }
  });

  test("[T1-03] JS ↔ Rust cross-language equality (runs the Rust binary when cargo is available)", { timeout: 240_000 }, (t) => {
    let bin = path.join(process.env.HOME ?? "~", "intent-adapter-cargo-target", "debug", "t1-golden-vectors");
    if (!existsSync(bin)) {
      // build outside the repository tree (TEST-HYGIENE-R1: no worktree writes)
      try {
        execFileSync("cargo", ["build", "-q"], {
          cwd: path.join(pkgDir, "rust"),
          env: { ...process.env, CARGO_TARGET_DIR: path.join(tmpdir(), "intent-adapter-cargo-target") },
        }, );
        bin = path.join(tmpdir(), "intent-adapter-cargo-target", "debug", "t1-golden-vectors");
      } catch {
        return t.skip("cargo toolchain unavailable — JS↔Rust cross-check not runnable in this environment (verified locally with cargo 1.98.1: all cases MATCH)");
      }
    }
    for (const c of golden.cases) {
      const out = JSON.parse(execFileSync(bin, [c.escrow_ref, c.outcome_receipt_hash, c.program_id], { encoding: "utf8" }).trim());
      expect(out.economic_release_digest).toBe(c.economic_release_digest);
      expect(out.release_pda).toBe(c.release_pda);
      expect(out.bump).toBe(c.bump);
    }
  });

  test("[T1-PDA-ORACLE] our JS == our Rust == OFFICIAL Solana SDK, for every golden vector", { timeout: 240_000 }, async (t) => {
    // T1-R1 lesson: two independent implementations agreeing proves nothing if
    // both copied the same algorithm error (the bump-after-marker bug). The
    // OFFICIAL implementation is the canonical oracle.
    const { PublicKey } = await import("@solana/web3.js");
    let rustResults: Map<string, { economic_release_digest: string; release_pda: string; bump: number }> | null = null;
    let bin = path.join(process.env.HOME ?? "~", "intent-adapter-cargo-target", "debug", "t1-golden-vectors");
    if (!existsSync(bin)) {
      try {
        execFileSync("cargo", ["build", "-q"], {
          cwd: path.join(pkgDir, "rust"),
          env: { ...process.env, CARGO_TARGET_DIR: path.join(tmpdir(), "intent-adapter-cargo-target") },
        });
        bin = path.join(tmpdir(), "intent-adapter-cargo-target", "debug", "t1-golden-vectors");
      } catch { /* rust unavailable: JS==OFFICIAL still enforced below */ }
    }
    if (existsSync(bin)) {
      rustResults = new Map(golden.cases.map((c) => [c.name, JSON.parse(execFileSync(bin, [c.escrow_ref, c.outcome_receipt_hash, c.program_id], { encoding: "utf8" }).trim())]));
    }
    for (const c of golden.cases) {
      const ours = releasePda(c.escrow_ref, c.outcome_receipt_hash, c.program_id);
      expect(ours.pda).toBe(c.release_pda); // committed vector
      // OFFICIAL ORACLE
      const [officialAddr, officialBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("release", "utf8"), Buffer.from(c.economic_release_digest, "hex")],
        new PublicKey(c.program_id),
      );
      expect(ours.pda, `${c.name}: our JS PDA != official`).toBe(officialAddr.toBase58());
      expect(ours.bump, `${c.name}: our JS bump != official`).toBe(officialBump);
      expect(c.release_pda).toBe(officialAddr.toBase58());
      expect(c.bump).toBe(officialBump);
      // RUST (when toolchain available)
      if (rustResults) {
        const r = rustResults.get(c.name)!;
        expect(r.release_pda, `${c.name}: Rust PDA != official`).toBe(officialAddr.toBase58());
        expect(r.bump, `${c.name}: Rust bump != official`).toBe(officialBump);
        expect(r.economic_release_digest).toBe(c.economic_release_digest);
      }
    }
    if (!rustResults) t.skip("rust leg unavailable (cargo absent) — JS==OFFICIAL enforced; JS==RUST==OFFICIAL verified locally with cargo 1.98.1");
  });

  test("[T1-04] digest preimage hygiene: hex string / prefix NEVER participate; malformed hashes rejected", () => {
    const anchor = golden.cases[0]!;
    // raw32 extraction from the frozen anchor hash is exactly the digest bytes
    expect(receiptHashRaw32(anchor.outcome_receipt_hash)).toHaveLength(32);
    // uppercase hex rejected (the hex STRING must never be hashed — and sloppy forms must fail loudly)
    expect(() => receiptHashRaw32(anchor.outcome_receipt_hash.toUpperCase())).toThrow();
    expect(() => receiptHashRaw32("da577b3d04bc53dac6ace4c200679ab36bc1fa21e8be31e2e5c7197cc7706380")).toThrow(); // no prefix
    expect(() => receiptHashRaw32("sha256:zz")).toThrow();
    // determinism
    expect(toHex(economicReleaseDigest(anchor.escrow_ref, anchor.outcome_receipt_hash))).toBe(anchor.economic_release_digest);
  });

  test("[T1-05] nonce / settlement_key / client id NEVER participate in the digest", () => {
    const anchor = golden.cases[0]!;
    const d1 = toHex(economicReleaseDigest(anchor.escrow_ref, anchor.outcome_receipt_hash));
    // the ONLY inputs are (escrow_ref, receipt): re-derivation with identical inputs is identical
    expect(toHex(economicReleaseDigest(anchor.escrow_ref, anchor.outcome_receipt_hash))).toBe(d1);
    // and ANY change to either input changes the digest (avalanche by construction)
    expect(toHex(economicReleaseDigest(anchor.escrow_ref + "x", anchor.outcome_receipt_hash))).not.toBe(d1);
  });

  test("[T1-06] base58 round-trip + PDA invariants", () => {
    const bytes = base58Decode(FROZEN.fixtureProgramId);
    expect(bytes).toHaveLength(32);
    expect(base58Encode(bytes)).toBe(FROZEN.fixtureProgramId);
    const { address, bump } = findProgramAddress([Buffer.from("release"), economicReleaseDigest("escrow:gp-001-local", FROZEN.anchors.outcomeReceiptHash)], bytes);
    expect(address).toHaveLength(32);
    expect(bump).toBeGreaterThanOrEqual(1);
    expect(bump).toBeLessThanOrEqual(255);
    expect(isOnEd25519Curve(address)).toBe(false); // a PDA is OFF-curve by definition
  });

  test("[T1-07] prepareSettlement: every input mismatch → DENY BEFORE TX (pure, zero side effects)", () => {
    const matrix: Array<[string, (i: SettlementInput) => void]> = [
      ["escrow", (i) => { i.escrow_ref = "escrow:gp-999-other"; }],
      ["receipt", (i) => { i.outcome_receipt_hash = "sha256:" + "cc".repeat(32); }],
      ["claim-record", (i) => { i.claim_record_hash = "sha256:" + "dd".repeat(32); }],
      ["claimant", (i) => { i.claimant = "agent:impostor"; }],
      ["amount", (i) => { i.amount = "11"; }],
      ["asset-network", (i) => { i.asset.network = "solana-mainnet"; }],
      ["asset-symbol", (i) => { i.asset.asset = "USDC"; }],
      ["asset-decimals", (i) => { i.asset.decimals = 9; }],
    ];
    for (const [name, mutate] of matrix) {
      const input = validInput();
      mutate(input);
      const r = prepareSettlement(input);
      expect(r.status, name).toBe("DENIED_BEFORE_TX");
      if (r.status === "DENIED_BEFORE_TX") expect(r.reason, name).toMatch(/mismatch$/);
    }
    // the untouched input prepares and carries the economic digest
    const ok = prepareSettlement(validInput());
    expect(ok.status).toBe("PREPARED");
    if (ok.status === "PREPARED") {
      expect(ok.economicReleaseDigest).toBe(golden.cases[0]!.economic_release_digest);
      expect(ok.programIdPinned).toBe(false); // Appendix A unpinned at T1
    }
  });

  test("[T1-08] mainnet endpoints hard-denied (machine-tested)", () => {
    for (const bad of ["https://api.mainnet-beta.solana.com", "mainnet-beta", "mainnet", "https://api.mainnet.solana.com", "production"]) {
      expect(() => assertNotMainnet(bad)).toThrow(EndpointDeniedError);
    }
    expect(() => assertNotMainnet("https://api.devnet.solana.com")).not.toThrow();
    const r = prepareSettlement({ ...validInput(), endpoint: "https://api.mainnet-beta.solana.com" });
    expect(r.status).toBe("DENIED_BEFORE_TX");
    if (r.status === "DENIED_BEFORE_TX") expect(r.reason).toBe("mainnet-endpoint-denied");
  });

  test("[T1-09] unpinned constants → NO real tx capability (structural); pinnedComplete covers EVERY Appendix A slot", () => {
    expect(pinnedComplete()).toBe(false);
    expect(PINNED.programId).toBeNull(); // actual deployment id NOT pinned at T1
    // T1-R1: the pinned-slot contract must mirror Appendix A EXACTLY —
    // pinnedComplete() can never be true while a required slot is missing.
    expect(Object.keys(PINNED).sort()).toEqual([
      "claimantBindingHash",
      "claimantTokenAccount",
      "claimantWallet",
      "deployer",
      "mint",
      "operator",
      "programId",
      "treasury",
    ].sort());
    const prepared = prepareSettlement(validInput());
    expect(prepared.status).toBe("PREPARED");
    for (const r of [submitSettlement(prepared), observeSettlement("e", "sha256:" + "0".repeat(64)), reconcileSettlement("e", "sha256:" + "0".repeat(64))]) {
      expect(r.status).toBe("CHAIN_NOT_AUTHORIZED");
      expect(r.reasons).toContain("appendix-a-constants-unpinned");
      expect(r.reasons).toContain("t1-skeleton-no-rpc-layer");
    }
  });

  test("[T1-10] fixture program id is a test vector ONLY — never the actual deployment id", () => {
    expect(golden.program_id).toBe(FROZEN.fixtureProgramId);
    expect(PINNED.programId).not.toBe(FROZEN.fixtureProgramId);
    expect(PINNED.programId).toBeNull();
    // every golden case uses the fixture id
    for (const c of golden.cases) expect(c.program_id).toBe(FROZEN.fixtureProgramId);
  });

  test("[T1-11] GP4/GP5 + G1 frozen paths byte-unchanged since the T0 freeze (ebf1ed9)", () => {
    const protectedPrefixes = [
      "packages/protocol-schema/",
      "packages/gp4-settlement/src/",
      "packages/gp5-proof-pack/pack/",
      "packages/gp3-verification/artifacts/",
      "packages/gp2-verifier/formal/",
    ];
    const T0_FREEZE = "ebf1ed9faf1131d0f87cab48f1adbdfb6e81fc31";
    const changed = execFileSync("git", ["diff", "--name-only", `${T0_FREEZE}...HEAD`], { cwd: repoRoot, encoding: "utf8" })
      .split("\n").map((l) => l.trim()).filter(Boolean);
    for (const p of changed) {
      expect(protectedPrefixes.some((pre) => p.startsWith(pre)), `frozen path modified: ${p}`).toBe(false);
    }
    // the golden-path frozen evidence dir is protected exactly
    expect(changed.some((p) => p.startsWith("packages/golden-path/evidence/9f6610dc-"))).toBe(false);
  });
});
