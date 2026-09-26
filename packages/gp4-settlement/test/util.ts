/** Shared GP4 test fixtures (imported by test files; not a test module). */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { canonicalize } from "@intent/protocol-schema";
import { EscrowLedger, LocalVerificationLedger } from "../src/index.ts";

/** Frozen GP3 OutcomeReceipt content_hash (GP3 closed ledger). */
export const FROZEN_RH = "sha256:da577b3d04bc53dac6ace4c200679ab36bc1fa21e8be31e2e5c7197cc7706380";

/** Frozen GP-001 asset triple (GOLDEN-PATH-V1.md §2) — the ONLY releasable triple. */
export const FROZEN_ASSET = { network: "solana-devnet", asset: "USDC-test", decimals: 6 } as const;

/** Frozen GP-001 escrow_ref (from the frozen task fixture — contains ':'). */
export const ESCROW_REF = "escrow:gp-001-local";

/** Frozen GP-001 ClaimRecord binding hash (canonical bytes of the committed fixture). */
export const FROZEN_CLAIM_HASH = "sha256:c80e0c34b63c986109a804b6cd32e57fac80ecaa60f0733393e0a937c903be0c";

/** Production ledger — hold-by-construction (no way to enable release). */
export function productionLedger(): { ledger: EscrowLedger; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "gp4-prod-"));
  return { ledger: EscrowLedger.open(root, { now: () => 1_700_000_000 }), root };
}

/** Local verification ledger — the EXPLICIT release-enabled override (R1). */
export function verificationLedger(): { ledger: LocalVerificationLedger; root: string } {
  const root = mkdtempSync(path.join(tmpdir(), "gp4-verify-"));
  return { ledger: LocalVerificationLedger.open(root, { now: () => 1_700_000_000 }), root };
}

/** Verification ledger with one release-enabled escrow already created. */
export function enabledLedger(): { ledger: LocalVerificationLedger; root: string } {
  const { ledger, root } = verificationLedger();
  const r = ledger.createEscrowForVerification({
    escrow_ref: ESCROW_REF, asset: FROZEN_ASSET, amount: "10",
    outcome_receipt_hash: FROZEN_RH, claim_record_hash: FROZEN_CLAIM_HASH,
  });
  if (r.status !== "CREATED") throw new Error(`verification escrow not created: ${JSON.stringify(r)}`);
  return { ledger, root };
}

/** The frozen canonical receipt artifact (GP2/GP3 output) as untrusted data. */
export function frozenReceipt(): unknown {
  return JSON.parse(readFileSync(new URL("../../../packages/gp3-verification/artifacts/receipt.json", import.meta.url), "utf8"));
}

/** The committed GP-001 ClaimRecord fixture as untrusted data. */
export function frozenClaim(): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL("../fixtures/gp-001-claim.json", import.meta.url), "utf8"));
}

export function makeInstruction(over?: Record<string, unknown>): Record<string, unknown> {
  return {
    schema_version: "settlement.v1",
    settlement_id: "11111111-1111-4111-8111-111111111111",
    escrow_ref: ESCROW_REF,
    outcome_receipt_hash: FROZEN_RH,
    nonce: "1",
    outputs: [{ recipient: "agent:gp-001-demo", asset: FROZEN_ASSET, amount: "10", reason: "GP4" }],
    total_amount: "10",
    ...over,
  };
}

/**
 * Hand-forge an escrow.json straight to disk (bypassing every API) — proves
 * RELEASE-layer gates independently of CREATION-layer gates.
 */
export function forgeEscrow(root: string, over?: {
  escrow_ref?: string; asset?: { network: string; asset: string; decimals: number };
  amount?: string; outcome_receipt_hash?: string; claim_record_hash?: string;
  state?: string; release_enabled?: boolean;
}): void {
  const ref = over?.escrow_ref ?? ESCROW_REF;
  const dir = path.join(root, "escrows", "escrow%3agp-001-local");
  const entry = {
    schema_version: "gp4-escrow.v2",
    escrow_ref: ref,
    asset: over?.asset ?? FROZEN_ASSET,
    amount: over?.amount ?? "10",
    outcome_receipt_hash: over?.outcome_receipt_hash ?? FROZEN_RH,
    claim_record_hash: over?.claim_record_hash ?? FROZEN_CLAIM_HASH,
    state: over?.state ?? "LOCKED",
    release_enabled: over?.release_enabled ?? true,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
  };
  mkdirSync(path.join(dir, "releases"), { recursive: true });
  writeFileSync(path.join(dir, "escrow.json"), JSON.stringify(entry));
}

/** canonical-bytes sha256 of an arbitrary value (test-side oracle). */
export function canonHash(v: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalize(v), "utf8").digest("hex");
}

/**
 * Byte-exact digest of an entire ledger tree (paths + contents) — the
 * zero-write oracle for the pre-guard read-only proof (R3).
 */
export function treeDigest(root: string): string {
  const h = createHash("sha256");
  if (!existsSync(root)) return "empty";
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const p = path.join(dir, e.name);
      h.update(p.slice(root.length).replaceAll("\\", "/"));
      if (e.isDirectory()) walk(p);
      else h.update(readFileSync(p));
    }
  };
  walk(root);
  return h.digest("hex");
}

export function releaseFiles(root: string, ref = ESCROW_REF): string[] {
  return listJson(path.join(root, "escrows", "escrow%3agp-001-local", "releases"));
}

export function instructionFiles(root: string, ref = ESCROW_REF): string[] {
  return listJson(path.join(root, "escrows", "escrow%3agp-001-local", "instructions"));
}

function listJson(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
}
