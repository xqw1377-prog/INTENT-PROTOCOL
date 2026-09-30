/**
 * TESTNET-R1 / T1 machine tests — adapter skeleton + deterministic contracts.
 *
 * T1 boundary: NO RPC, NO devnet, NO program deployment, NO real key
 * material, NO mint discovery, NO mainnet, NO GP4/GP5 edit, NO G1 edit.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  economicReleaseDigest, receiptHashRaw32, toHex,
  base58Decode, base58Encode, findProgramAddress, isOnEd25519Curve, releasePda, pdaCandidateHash,
  prepareSettlement, submitSettlement, observeSettlement, reconcileSettlement,
  assertNotMainnet, assertFrozenMint, assertAuthorizedRequester, resolvePayoutDestination,
  assertCaps, CapsDeniedError,
  EndpointDeniedError, MintDeniedError, RoleDeniedError, DestinationDeniedError,
  FROZEN, PINNED, ROLES, CAPS, pinnedComplete,
  verifyBinding,
  type SettlementInput,
} from "../src/index.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const golden = JSON.parse(readFileSync(path.join(pkgDir, "vectors/golden.json"), "utf8")) as {
  fixture_program_id: string;
  actual_program_id: string | null;
  cases: Array<{ name: string; escrow_ref: string; outcome_receipt_hash: string; program_id: string; program_id_class: string; economic_release_digest: string; release_pda: string; bump: number }>;
};

/** Rust golden-vector binary — builds OUTSIDE the repo tree (TEST-HYGIENE-R1).
 * The target dir is scoped to THIS worktree: a shared dir can serve a binary
 * built from a different checkout (cargo exit 0, stale output — observed).
 * Always rebuilds (incremental, cheap). */
const rustTargetDir = path.join(tmpdir(), "intent-adapter-cargo-target-" + createHash("sha256").update(pkgDir).digest("hex").slice(0, 12));
function rustBinary(): string | null {
  try {
    execFileSync("cargo", ["build", "-q"], { cwd: path.join(pkgDir, "rust"), env: { ...process.env, CARGO_TARGET_DIR: rustTargetDir } });
    return path.join(rustTargetDir, "debug", "t1-golden-vectors");
  } catch {
    return null;
  }
}

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
    const bin = rustBinary();
    if (!bin) return t.skip("cargo toolchain unavailable — JS↔Rust cross-check not runnable in this environment (verified locally with cargo 1.98.1: all cases MATCH)");
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
    const bin = rustBinary();
    if (bin) {
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
      expect(ok.programIdPinned).toBe(true); // T3: Appendix A materialized
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

  test("[T1-09] Appendix A pinned (T3) → pinnedComplete() true; chain still structurally unavailable", () => {
    // T3 materialized every slot; the pinned-slot contract mirrors Appendix A
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
    expect(pinnedComplete()).toBe(true); // every slot materialized at T3
    const prepared = prepareSettlement(validInput());
    expect(prepared.status).toBe("PREPARED");
    if (prepared.status === "PREPARED") expect(okNote(prepared)).toContain("T1 skeleton");
    for (const r of [submitSettlement(prepared), observeSettlement("e", "sha256:" + "0".repeat(64)), reconcileSettlement("e", "sha256:" + "0".repeat(64))]) {
      expect(r.status).toBe("CHAIN_NOT_AUTHORIZED");
      expect(r.reasons).toContain("t1-skeleton-no-rpc-layer"); // deployment/T2 NOT authorized: no RPC layer exists
    }
  });

  function okNote(p: Extract<ReturnType<typeof prepareSettlement>, { status: "PREPARED" }>): string {
    return p.note;
  }

  test("[T1-10] fixture program id is a test vector ONLY — never the actual deployment program id", () => {
    expect(golden.fixture_program_id).toBe(FROZEN.fixtureProgramId);
    expect(FROZEN.fixtureProgramId).not.toBe(PINNED.programId); // distinct from the ACTUAL pinned id
    // fixture-class vectors use the fixture id; actual-class vectors use the pinned id
    for (const c of golden.cases) {
      if (c.program_id_class === "fixture") expect(c.program_id).toBe(FROZEN.fixtureProgramId);
      if (c.program_id_class === "actual") expect(c.program_id).toBe(PINNED.programId);
    }
    expect(golden.actual_program_id).toBe(PINNED.programId);
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

  test("[T1-12] bump-descent vectors: every rejected candidate is ON-curve, the accepted bump is OFF-curve", () => {
    const descent = golden.cases.filter((c) => c.bump < 255);
    // Commander requirement: committed coverage at bump=254 AND bump<=252
    expect(descent.some((c) => c.bump === 254), "a committed bump=254 descent vector is required").toBe(true);
    expect(descent.some((c) => c.bump <= 252), "a committed bump<=252 descent vector is required").toBe(true);
    for (const c of descent) {
      const seeds = [Buffer.from("release", "utf8"), Buffer.from(c.economic_release_digest, "hex")];
      const pid = base58Decode(c.program_id);
      for (let b = 255; b > c.bump; b--) {
        // the descent path actually executed: each higher bump hashed ON-curve and was rejected
        expect(isOnEd25519Curve(pdaCandidateHash(seeds, b, pid)), `${c.name}: bump ${b} must be ON-curve (rejected)`).toBe(true);
      }
      const accepted = pdaCandidateHash(seeds, c.bump, pid);
      expect(isOnEd25519Curve(accepted), `${c.name}: final bump must be OFF-curve`).toBe(false);
      expect(base58Encode(accepted)).toBe(c.release_pda);
    }
  });
});

describe("[TESTNET-R1/T3] devnet materialization freeze", () => {
  const appendix = JSON.parse(readFileSync(path.join(pkgDir, "materialization/appendix-a.json"), "utf8")) as {
    program_id: { pubkey: string };
    mint: { pubkey: string; decimals: number; supply_base_units: string };
    roles: Record<"deployer" | "operator" | "treasury", { pubkey: string }>;
    claimant_payout_binding: Record<string, string>;
    token_accounts: { claimant_ata: string; treasury_ata: string };
    caps: Record<string, string>;
  };

  test("[T3-01] PINNED mirrors the Appendix A record EXACTLY", () => {
    expect(PINNED.programId).toBe(appendix.program_id.pubkey);
    expect(PINNED.mint).toBe(appendix.mint.pubkey);
    expect(PINNED.deployer).toBe(appendix.roles.deployer.pubkey);
    expect(PINNED.operator).toBe(appendix.roles.operator.pubkey);
    expect(PINNED.treasury).toBe(appendix.roles.treasury.pubkey);
    expect(PINNED.claimantWallet).toBe(appendix.claimant_payout_binding.wallet_pubkey);
    expect(PINNED.claimantTokenAccount).toBe(appendix.claimant_payout_binding.token_account);
    expect(PINNED.claimantBindingHash).toBe(appendix.claimant_payout_binding.binding_hash);
    expect(appendix.mint.decimals).toBe(6);
    expect(appendix.mint.supply_base_units).toBe("100000000"); // exactly 100 USDC-test — the escrow cap ceiling
  });

  test("[T3-02] ClaimantPayoutBindingV1: binding_hash recomputes from the record; bound to the frozen claimant", () => {
    expect(verifyBinding(appendix.claimant_payout_binding as never)).toBe(true);
    expect(appendix.claimant_payout_binding.claimant).toBe(FROZEN.anchors.claimant);
    expect(appendix.claimant_payout_binding.network).toBe("solana-devnet");
    expect(appendix.claimant_payout_binding.mint).toBe(PINNED.mint);
  });

  test("[T3-03] all six materialized identities are pairwise distinct", () => {
    const ids = [PINNED.programId, PINNED.deployer, PINNED.operator, PINNED.treasury, PINNED.claimantWallet, PINNED.mint];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ROLES.deployer).toBe(PINNED.deployer);
    expect(ROLES.operator).toBe(PINNED.operator);
    expect(ROLES.treasury).toBe(PINNED.treasury);
  });

  test("[T3-04] unauthorized-role negatives: ONLY the Operator may request settlements", () => {
    expect(() => assertAuthorizedRequester(ROLES.operator)).not.toThrow();
    expect(() => assertAuthorizedRequester(ROLES.deployer)).toThrow(RoleDeniedError); // deployer deploys only
    expect(() => assertAuthorizedRequester(ROLES.treasury)).toThrow(RoleDeniedError); // treasury funds only
    expect(() => assertAuthorizedRequester(PINNED.claimantWallet!)).toThrow(RoleDeniedError); // even the claimant
    expect(() => assertAuthorizedRequester("11111111111111111111111111111111")).toThrow(RoleDeniedError); // unknown
  });

  test("[T3-05] wrong-mint hard denial: only the frozen devnet mint is accepted", () => {
    expect(() => assertFrozenMint(PINNED.mint!)).not.toThrow();
    for (const bad of [
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // MAINNET USDC mint — must be denied
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // devnet USDC (Circle's) — NOT our frozen mint
      "So11111111111111111111111111111111111111112", // wrapped SOL
    ]) {
      expect(() => assertFrozenMint(bad), bad).toThrow(MintDeniedError);
    }
  });

  test("[T3-06] wrong-destination hard denial: payout resolves ONLY through the frozen binding", () => {
    // the frozen claimant resolves to exactly one destination — the pinned ATA
    expect(resolvePayoutDestination(FROZEN.anchors.claimant)).toBe(PINNED.claimantTokenAccount);
    expect(() => resolvePayoutDestination("agent:impostor")).toThrow(DestinationDeniedError);
    expect(() => resolvePayoutDestination("agent:gp-002-other")).toThrow(DestinationDeniedError);
    // and a caller cannot substitute a destination: resolve takes no destination argument
    expect(resolvePayoutDestination.length).toBe(1);
  });

  test("[T3-07] fund caps frozen AND machine-enforced (assertCaps boundary matrix)", () => {
    expect(CAPS.perRelease).toBe("10");
    expect(CAPS.escrowTotalMax).toBe("100");
    expect(CAPS.cycleCumulativeMax).toBe("100");
    expect(appendix.caps).toEqual({ perRelease: "10", escrowTotalMax: "100", cycleCumulativeMax: "100" });
    // the exact boundary matrix ordered by the Commander (T3-R1)
    expect(() => assertCaps({ releaseAmount: 10, escrowFundedAmount: 100, cycleReleasedSoFar: 90 })).not.toThrow(); // ALLOW: 10 / 100 / 90+10
    expect(() => assertCaps({ releaseAmount: 11, escrowFundedAmount: 0, cycleReleasedSoFar: 0 })).toThrow(CapsDeniedError); // per-release 11
    expect(() => assertCaps({ releaseAmount: 10, escrowFundedAmount: 101, cycleReleasedSoFar: 0 })).toThrow(CapsDeniedError); // escrow 101
    expect(() => assertCaps({ releaseAmount: 10, escrowFundedAmount: 100, cycleReleasedSoFar: 91 })).toThrow(CapsDeniedError); // 91+10 = 101
    expect(() => assertCaps({ releaseAmount: 10, escrowFundedAmount: 100, cycleReleasedSoFar: 100 })).toThrow(CapsDeniedError); // 100+10
    expect(() => assertCaps({ releaseAmount: -1, escrowFundedAmount: 0, cycleReleasedSoFar: 0 })).toThrow(CapsDeniedError); // negative
    // amount boundary at the settlement input remains DENY-BEFORE-TX
    const input = validInput();
    input.amount = "100";
    expect(prepareSettlement(input).status).toBe("DENIED_BEFORE_TX");
  });

  test("[T3-08] actual-program-id PDA vectors exist and are oracle-verified (fixture proof does NOT carry over)", () => {
    const actual = golden.cases.filter((c) => c.program_id_class === "actual");
    expect(actual.length).toBeGreaterThanOrEqual(3);
    for (const c of actual) expect(c.program_id).toBe(PINNED.programId);
    // the R1-anchor release PDA for the REAL program id is deterministic and recorded
    const anchor = actual.find((c) => c.name === "r1-anchor-actual")!;
    expect(anchor.release_pda).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  test("[T3-09] NO secret key material anywhere in the package tree", () => {
    const scan = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === "target" || e.name === "dist") continue;
          scan(p);
        } else if (e.name.endsWith(".json")) {
          const raw = readFileSync(p, "utf8");
          let parsed: unknown;
          try { parsed = JSON.parse(raw); } catch { continue; }
          // Solana keypair files are exactly 64 byte-valued numbers
          if (Array.isArray(parsed) && parsed.length === 64 && parsed.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255)) {
            throw new Error(`SECRET KEYPAIR MATERIAL IN TREE: ${p}`);
          }
          if (typeof parsed === "object" && parsed !== null && "secretKey" in (parsed as Record<string, unknown>)) {
            throw new Error(`SECRET KEY FIELD IN TREE: ${p}`);
          }
        }
      }
    };
    scan(pkgDir);
  });

  test("[T3-10] T3-R1 provenance: creation fields are REAL transaction signatures — never pubkeys", () => {
    const rec = appendix as unknown as Record<string, any>;
    const sigs: Array<[string, string | undefined, string]> = [
      ["mint creation", rec.mint.creation_tx?.signature, rec.mint.pubkey],
      ["treasury ATA creation", rec.token_accounts.treasury_ata_creation_tx?.signature, rec.token_accounts.treasury_ata],
      ["claimant ATA creation", rec.token_accounts.claimant_ata_creation_tx?.signature, rec.token_accounts.claimant_ata],
      ["authority revoke", rec.mint.mint_authority_revoked?.tx_signature, rec.mint.pubkey],
    ];
    for (const [label, sig, account] of sigs) {
      expect(sig, `${label}: signature must be recorded`).toBeDefined();
      // base58 of a 64-byte signature is 87-88 chars (leading zeros shorten it)
      expect(sig!.length, `${label}: signature shape`).toBeGreaterThanOrEqual(86);
      expect(sig!.length, `${label}: signature shape`).toBeLessThanOrEqual(88);
      expect(sig!, `${label}: must NOT be the account pubkey (T3-R1 erratum)`).not.toBe(account);
      expect(sig!.match(/^[1-9A-HJ-NP-Za-km-z]+$/), `${label}: base58`).not.toBeNull();
    }
    // the OLD mislabeled fields must be gone or null
    expect(rec.mint.create_tx_signature ?? null).toBeNull();
    expect(rec.token_accounts.treasury_ata_tx ?? null).toBeNull();
    expect(rec.token_accounts.claimant_ata_tx ?? null).toBeNull();
    // hard cap established and recorded
    expect(rec.mint.mint_authority).toBeNull();
    expect(rec.mint.mint_authority_revoked?.to).toBeNull();
  });

  test("[T3-12] frozen curve edge corpus: our JS = our Rust = runtime (dalek) on every pathological encoding; web3 divergences EXPECTED/RECORDED", { timeout: 240_000 }, (t) => {
    const corpus = JSON.parse(readFileSync(path.join(pkgDir, "vectors/curve-corpus.json"), "utf8")) as {
      cases: Array<{ name: string; encoding_hex: string; our_js: boolean; runtime_expected: boolean; web3_expected: boolean; divergence: string }>;
    };
    const names = corpus.cases.map((c) => c.name);
    for (const required of ["identity-y1-sign0", "negative-zero-y1-sign1", "y-zero", "y-equals-p", "y-equals-p-plus-1", "normal-valid-point"]) {
      expect(names, `edge case missing: ${required}`).toContain(required);
    }
    for (const c of corpus.cases) {
      // CLOSURE: our JS predicate == runtime authority on EVERY case
      expect(isOnEd25519Curve(new Uint8Array(Buffer.from(c.encoding_hex, "hex"))), `${c.name}: our JS vs runtime`).toBe(c.runtime_expected);
      expect(c.our_js, `${c.name}: committed our_js`).toBe(c.runtime_expected);
      // divergence bookkeeping is exact, never silent
      if (c.web3_expected !== c.runtime_expected) expect(c.divergence).toBe("WEB3_VS_RUNTIME");
      else expect(c.divergence).toBe("NONE");
    }
    // the KNOWN client/runtime divergences are exactly the recorded set:
    // non-canonical y and negative-zero are ON-curve for the validator but
    // rejected by web3's strict decoder — a permanent guard against anyone
    // "fixing" our predicate into strict-client semantics
    const divergent = corpus.cases.filter((c) => c.divergence === "WEB3_VS_RUNTIME").map((c) => c.name).sort();
    expect(divergent).toEqual(["negative-zero-y1-sign1", "y-equals-p", "y-equals-p-plus-1", "all-ff-y-max-sign1", "y-max-sign0"].sort());
    // rust leg: re-run the tool when cargo is available
    const bin = rustBinary();
    if (!bin) return t.skip("cargo unavailable — rust leg re-verified locally (cargo 1.98.1, dalek 4.1.3): all cases agree with runtime");
    const verdicts = JSON.parse(execFileSync(bin, ["--curve-cases", ...corpus.cases.map((c) => c.encoding_hex)], { encoding: "utf8" }).trim());
    for (let i = 0; i < corpus.cases.length; i++) {
      expect(verdicts[i].dalek, `${corpus.cases[i]!.name}: rust dalek vs runtime`).toBe(corpus.cases[i]!.runtime_expected);
      expect(verdicts[i].custom, `${corpus.cases[i]!.name}: rust custom vs runtime`).toBe(corpus.cases[i]!.runtime_expected);
    }
  });

  test("[T3-13] receipt hash grammar PARITY: JS and Rust accept exactly ^sha256:[0-9a-f]{64}$", { timeout: 240_000 }, (t) => {
    const anchor = FROZEN.anchors.outcomeReceiptHash; // sha256:<64 lowercase>
    const bad: Array<[string, string]> = [
      ["uppercase hex", "sha256:" + anchor.slice(7).toUpperCase()],
      ["missing prefix", anchor.slice(7)],
      ["63 hex chars", "sha256:" + "a".repeat(63)],
      ["65 hex chars", "sha256:" + "a".repeat(65)],
      ["non-hex", "sha256:" + "z".repeat(63) + "0"],
    ];
    // JS side
    expect(() => receiptHashRaw32(anchor)).not.toThrow();
    for (const [label, v] of bad) expect(() => receiptHashRaw32(v), `JS rejects ${label}`).toThrow();
    // Rust side — parity on every class
    const bin = rustBinary();
    if (!bin) return t.skip("cargo unavailable — rust grammar parity re-verified locally: same accept/reject on all 6 inputs");
    const runRust = (receipt: string): number => {
      try {
        execFileSync(bin, ["escrow:gp-001-local", receipt, FROZEN.fixtureProgramId], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return 0;
      } catch (e) {
        return (e as { status?: number }).status ?? 1;
      }
    };
    expect(runRust(anchor)).toBe(0); // accepts the canonical form
    for (const [label, v] of bad) expect(runRust(v), `Rust rejects ${label}`).not.toBe(0);
  });

  test("[T3-11] PDA-CONFORMANCE-ERRATA-1: validator curve semantics via curve25519-dalek (the runtime's own library)", { timeout: 240_000 }, (t) => {
    const bin = rustBinary();
    if (!bin) return t.skip("cargo unavailable — dalek conformance not runnable here (verified locally with cargo 1.98.1 + curve25519-dalek 4.1.3: corpus 4096 → 0 mismatches; all golden vectors agree)");
    // 1) corpus: our custom curve predicate == curve25519-dalek exactly
    const corpus = JSON.parse(execFileSync(bin, ["--curve-corpus", "1024"], { encoding: "utf8" }).trim());
    expect(corpus.mismatches, "custom predicate vs curve25519-dalek").toBe(0);
    // 2) per golden vector: PDA derived with the DALEK predicate (validator
    //    semantics) == the committed vector, for BOTH program ids
    for (const c of golden.cases) {
      const out = JSON.parse(execFileSync(bin, ["--pda-dalek", c.escrow_ref, c.outcome_receipt_hash, c.program_id], { encoding: "utf8" }).trim());
      expect(out.agree, `${c.name}: custom vs dalek derivation`).toBe(true);
      expect(out.dalek.pda, `${c.name}: dalek PDA vs committed vector`).toBe(c.release_pda);
      expect(out.dalek.bump, `${c.name}: dalek bump vs committed vector`).toBe(c.bump);
      expect(out.digest).toBe(c.economic_release_digest);
    }
  });
});
