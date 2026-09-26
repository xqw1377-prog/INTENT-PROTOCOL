/**
 * GP4-B — local escrow ledger with the atomic economic release guard.
 *
 * ECONOMIC exactly-once (GOLDEN-PATH-V1.md §4A): one release file per
 * (escrow_ref, outcome_receipt_hash) — enforced by kernel-atomic link() in
 * guard.ts:atomicPublish. Same pair + different nonce (different
 * settlement_key) MUST NOT and CANNOT release twice.
 *
 * HOLD AUTHORITY ISOLATION (R1 remediation): the production API
 * (EscrowLedger.createEscrow) has NO parameter that can enable release —
 * every production escrow is created with release_enabled=false and every
 * attemptRelease on it returns REJECTED_HOLD. The ONLY way to create a
 * release-enabled escrow is the explicit, separately-named verification
 * entry point LocalVerificationLedger.createEscrowForVerification()
 * (verification.ts) for local gate testing. A plain caller passing
 * `release_enabled` to the production API is REJECTED_INVALID.
 *
 * TRANSACTION BOUNDARY (R3 remediation): the linkSync() that publishes the
 * release file is the FIRST authoritative mutation of attemptRelease.
 * Before it: read-only validation — NO escrow.json state is persisted, and
 * ELIGIBLE is an in-attempt LOGICAL state of the frozen state-machine walk,
 * never a crash-visible persisted authority before the guard. After it:
 * idempotent cache bookkeeping only (escrow.json state → RELEASED via
 * atomic rename-replace), repaired by open() after a crash. The guard file
 * is the authority; escrow.json state is a cache.
 *
 * INSTRUCTION LEDGER: intentionally absent (GP4-C scope, P1-A remediation).
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { canonicalize, settlementKey, SettlementInstructionSchema } from "@intent/protocol-schema";
import type { Hash, SettlementInstruction } from "@intent/protocol-schema";
import { frozenSeal } from "./frozen.ts";
import { atomicPublish, atomicReplace } from "./guard.ts";
import {
  ESCROW_REF_RE, EscrowEntrySchema, ReleaseRecordSchema,
  frozenAssetTripleOk, hashBody, settlementEdge,
} from "./schema.ts";
import type { EscrowEntry, EscrowState, ReleaseRecord } from "./schema.ts";
import { receiptAuthority } from "./receipt.ts";

export type ReleaseStatus =
  | "RELEASED"
  | "ALREADY_RELEASED"
  | "REJECTED_INVALID_RECEIPT"
  | "REJECTED_INVALID_INSTRUCTION"
  | "REJECTED_UNKNOWN_ESCROW"
  | "REJECTED_RECEIPT_MISMATCH"
  | "REJECTED_HOLD"
  | "DENIED_ASSET"
  | "REJECTED_AMOUNT_MISMATCH"
  | "REJECTED_ASSET_MISMATCH"
  | "LEDGER_CORRUPT"
  | "ESCROW_EXISTS";

export interface ReleaseResult {
  status: ReleaseStatus;
  outcome_receipt_hash?: Hash;
  settlement_key?: Hash;
  release?: ReleaseRecord;
  existing?: ReleaseRecord;
  reason?: string;
}

export interface CreateEscrowInput {
  escrow_ref: string;
  asset: { network: string; asset: string; decimals: number };
  amount: string;
  outcome_receipt_hash: string;
}

export class LedgerCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerCorruptError";
  }
}

function canonicalBytes(v: unknown): Buffer {
  return Buffer.from(canonicalize(v), "utf8");
}

export class EscrowLedger {
  readonly root: string;
  protected readonly now: () => number;

  constructor(root: string, opts?: { now?: () => number }) {
    this.root = root;
    this.now = opts?.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Open (and repair) a ledger root.
   *
   * Repair rules — the guard file is the authority, escrow.json is a cache:
   *   guard file present  + state ≠ RELEASED → state re-synced to RELEASED
   *   guard file absent   + state = ELIGIBLE (legacy/torn) → demoted to LOCKED:
   *     no guard ⇒ no economic release ever happened ⇒ the escrow is LOCKED.
   *
   * open() deliberately does NOT sweep `.tmp-*` files: a concurrent publisher
   * in another process owns its in-flight temp (proven by the multi-process
   * race test). Stale temps are inert; sweepTemp() is offline maintenance.
   */
  static open(root: string, opts?: { now?: () => number }): EscrowLedger {
    const ledger = new EscrowLedger(root, opts);
    ledger.repairStates();
    return ledger;
  }

  /** Re-open an existing EscrowLedger (constructor does not repair). */
  reopen(): void {
    this.repairStates();
  }

  protected repairStates(): void {
    const escrowsDir = this.escrowsDir();
    if (!existsSync(escrowsDir)) return;
    for (const ref of readdirEscrows(escrowsDir)) {
      try {
        const raw = this.readEscrowRaw(ref);
        if (!raw) continue;
        const normalized = this.normalizeState(raw);
        if (normalized.state !== raw.state) {
          this.writeEscrowState(normalized, normalized.state);
        }
      } catch {
        /* corrupt entries surface via readEscrow */
      }
    }
  }

  private escrowsDir(): string {
    return path.join(this.root, "escrows");
  }
  escrowDir(ref: string): string {
    return path.join(this.escrowsDir(), ref);
  }
  releasesDir(ref: string): string {
    return path.join(this.escrowDir(ref), "releases");
  }

  /**
   * PRODUCTION escrow creation — release_enabled is ALWAYS false.
   * The input has no field that can enable release; passing one is rejected.
   * Only the frozen GP-001 asset triple is accepted (R2).
   */
  createEscrow(input: CreateEscrowInput):
    | { status: "CREATED"; entry: EscrowEntry }
    | { status: "ESCROW_EXISTS" }
    | { status: "REJECTED_INVALID"; reason: string } {
    if (input !== null && typeof input === "object" && "release_enabled" in input) {
      return { status: "REJECTED_INVALID", reason: "release_enabled is not a caller-settable field on the production API (hold-by-construction; see LocalVerificationLedger)" };
    }
    return this.createEscrowWithPolicy(input, false);
  }

  /** Internal creation path; releaseEnabled=true is reachable ONLY via the verification subclass. */
  protected createEscrowWithPolicy(input: CreateEscrowInput, releaseEnabled: boolean):
    | { status: "CREATED"; entry: EscrowEntry }
    | { status: "ESCROW_EXISTS" }
    | { status: "REJECTED_INVALID"; reason: string } {
    if (!frozenAssetTripleOk(input.asset)) {
      return { status: "REJECTED_INVALID", reason: `asset triple must be exactly the frozen GP-001 triple (solana-devnet/USDC-test/6), got ${input.asset.network}/${input.asset.asset}/${input.asset.decimals}` };
    }
    const at = this.now();
    const parsed = EscrowEntrySchema.safeParse({
      schema_version: "gp4-escrow.v1",
      escrow_ref: input.escrow_ref,
      asset: input.asset,
      amount: input.amount,
      outcome_receipt_hash: input.outcome_receipt_hash,
      state: "LOCKED",
      release_enabled: releaseEnabled,
      created_at: at,
      updated_at: at,
    });
    if (!parsed.success) {
      return { status: "REJECTED_INVALID", reason: parsed.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("; ") };
    }
    const entry = parsed.data;
    const dir = this.escrowDir(entry.escrow_ref);
    const pub = atomicPublish(dir, "escrow.json", canonicalBytes(entry));
    if (pub.status === "EXISTS") return { status: "ESCROW_EXISTS" };
    // materialize the release directory eagerly (empty until first release)
    mkdirRecursive(path.join(dir, "releases"));
    return { status: "CREATED", entry };
  }

  /** Raw (un-normalized) escrow entry, or null for unknown/unsafe refs. */
  private readEscrowRaw(ref: string): EscrowEntry | null {
    if (!ESCROW_REF_RE.test(ref)) return null; // traversal grammar guard
    const file = path.join(this.escrowDir(ref), "escrow.json");
    if (!existsSync(file)) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new LedgerCorruptError(`escrow.json unparseable for ${ref}: ${(e as Error).message}`);
    }
    const parsed = EscrowEntrySchema.safeParse(raw);
    if (!parsed.success) {
      throw new LedgerCorruptError(`escrow.json schema violation for ${ref}: ${parsed.error.issues[0]?.message ?? ""}`);
    }
    return parsed.data;
  }

  /**
   * Normalized state: the guard file is the authority. ELIGIBLE is never a
   * legal persisted state under the R3 boundary — it is demoted to LOCKED
   * when no guard file exists (no guard ⇒ no release), and promoted to
   * RELEASED when one does.
   */
  private normalizeState(entry: EscrowEntry): EscrowEntry {
    if (entry.state !== "ELIGIBLE") return entry;
    const guardExists = existsSync(path.join(this.releasesDir(entry.escrow_ref), `${hashBody(entry.outcome_receipt_hash)}.json`));
    return { ...entry, state: guardExists ? "RELEASED" : "LOCKED" };
  }

  /** Read an escrow entry with state normalized against the guard file. */
  readEscrow(ref: string): EscrowEntry | null {
    const raw = this.readEscrowRaw(ref);
    return raw ? this.normalizeState(raw) : null;
  }

  /** Read the release record for (ref, receiptHash), or null. */
  readRelease(ref: string, receiptHash: string): ReleaseRecord | null {
    const file = path.join(this.releasesDir(ref), `${hashBody(receiptHash)}.json`);
    if (!existsSync(file)) return null;
    return ReleaseRecordSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  }

  listReleaseFiles(ref: string): string[] {
    const dir = this.releasesDir(ref);
    if (!existsSync(dir)) return [];
    return readdirSorted(dir).filter((f) => f.endsWith(".json"));
  }

  /**
   * ATOMIC ECONOMIC RELEASE.
   *
   * Validation order is normative. Steps 1–9 are READ-ONLY (no persisted
   * mutation): every rejection below leaves the on-disk ledger byte-identical
   * (proven by the rejection-path snapshot test). Step 10 is the FIRST
   * authoritative mutation — the transaction boundary.
   *   1. frozen-G1 seal of the receipt            → REJECTED_INVALID_RECEIPT
   *   2. frozen-G1 seal of the instruction        → REJECTED_INVALID_INSTRUCTION
   *   3. instruction binds the same receipt       → REJECTED_RECEIPT_MISMATCH
   *   4. escrow exists + bound to this receipt    → REJECTED_UNKNOWN_ESCROW / REJECTED_RECEIPT_MISMATCH
   *   5. release_enabled (production = never)     → REJECTED_HOLD
   *   6. frozen asset triple (R2)                 → DENIED_ASSET
   *   7. amount / asset triple equality           → REJECTED_AMOUNT_MISMATCH / REJECTED_ASSET_MISMATCH
   *   8. settlement_key derived by the ENGINE (never trusted from input)
   *   9. LOGICAL state walk LOCKED→ELIGIBLE→RELEASED over the frozen edges —
   *      ELIGIBLE is never persisted before the guard (R3)
   *  10. GUARD: atomicPublish(releases/<hex>.json) — TRANSACTION BOUNDARY
   *  11. post-commit idempotent cache bookkeeping (state → RELEASED)
   */
  attemptRelease(input: { receipt: unknown; instruction: unknown }): ReleaseResult {
    // 1 — canonical receipt authority (frozen seal; tamper-checked inside)
    let rh: Hash;
    try {
      rh = receiptAuthority(input.receipt).outcome_receipt_hash;
    } catch (e) {
      return { status: "REJECTED_INVALID_RECEIPT", reason: (e as Error).message };
    }

    // 2 — instruction wire validation (frozen seal: totals, single-asset, scale)
    let inst: SettlementInstruction & { content_hash: Hash };
    try {
      inst = frozenSeal(SettlementInstructionSchema, input.instruction);
    } catch (e) {
      return { status: "REJECTED_INVALID_INSTRUCTION", reason: (e as Error).message };
    }

    // 3 — instruction must bind the receipt it settles
    if (inst.outcome_receipt_hash !== rh) {
      return { status: "REJECTED_RECEIPT_MISMATCH", outcome_receipt_hash: rh, reason: "instruction.outcome_receipt_hash differs from sealed receipt" };
    }

    // 4 — escrow lookup (readEscrowRaw grammar-guards the ref against traversal)
    let entry: EscrowEntry;
    try {
      const found = this.readEscrow(inst.escrow_ref);
      if (!found) return { status: "REJECTED_UNKNOWN_ESCROW", outcome_receipt_hash: rh };
      entry = found;
    } catch (e) {
      return { status: "LEDGER_CORRUPT", outcome_receipt_hash: rh, reason: (e as Error).message };
    }
    if (entry.outcome_receipt_hash !== rh) {
      return { status: "REJECTED_RECEIPT_MISMATCH", outcome_receipt_hash: rh, reason: "escrow is bound to a different receipt" };
    }

    // 5 — hold-by-construction gate (production escrows can never pass this)
    if (!entry.release_enabled) {
      return { status: "REJECTED_HOLD", outcome_receipt_hash: rh, reason: "release_enabled=false (hold policy; no production API can set it)" };
    }

    // 6 — frozen asset triple closure (R2): MAINNET and every other label DENIED
    if (!frozenAssetTripleOk(entry.asset)) {
      return { status: "DENIED_ASSET", outcome_receipt_hash: rh, reason: `escrow asset ${entry.asset.network}/${entry.asset.asset}/${entry.asset.decimals} is not the frozen GP-001 triple solana-devnet/USDC-test/6` };
    }

    // 7 — economic equality of instruction vs escrow
    if (inst.total_amount !== entry.amount) {
      return { status: "REJECTED_AMOUNT_MISMATCH", outcome_receipt_hash: rh, reason: `instruction total ${inst.total_amount} != escrow amount ${entry.amount}` };
    }
    if (inst.outputs[0]!.asset.network !== entry.asset.network
      || inst.outputs[0]!.asset.asset !== entry.asset.asset
      || inst.outputs[0]!.asset.decimals !== entry.asset.decimals) {
      return { status: "REJECTED_ASSET_MISMATCH", outcome_receipt_hash: rh, reason: "instruction asset triple differs from escrow asset" };
    }

    // 8 — settlement_key is DERIVED, never accepted from the caller
    let sk: Hash;
    try {
      sk = settlementKey({ outcome_receipt_hash: rh, escrow_ref: entry.escrow_ref, nonce: BigInt(inst.nonce) });
    } catch (e) {
      return { status: "REJECTED_INVALID_INSTRUCTION", outcome_receipt_hash: rh, reason: `nonce not representable as u64: ${(e as Error).message}` };
    }

    // 9 — LOGICAL frozen-machine walk. entry.state is normalized (LOCKED or
    // RELEASED — ELIGIBLE never persists under the R3 boundary). LOCKED walks
    // LOCKED→ELIGIBLE→RELEASED in logic only; no write happens here.
    if (entry.state === "LOCKED") {
      if (!settlementEdge("LOCKED", "ELIGIBLE") || !settlementEdge("ELIGIBLE", "RELEASED")) {
        return { status: "LEDGER_CORRUPT", outcome_receipt_hash: rh, reason: "frozen settlement machine lacks LOCKED→ELIGIBLE→RELEASED walk" };
      }
    } else if (entry.state !== "RELEASED") {
      return { status: "LEDGER_CORRUPT", outcome_receipt_hash: rh, reason: `unknown escrow state ${entry.state}` };
    }

    // 10 — ECONOMIC GUARD: the FIRST authoritative mutation. One link() per
    // (escrow_ref, outcome_receipt_hash) — the transaction boundary.
    const record: ReleaseRecord = {
      schema_version: "gp4-release.v1",
      escrow_ref: entry.escrow_ref,
      outcome_receipt_hash: rh,
      settlement_key: sk,
      amount: entry.amount,
      asset: entry.asset,
      released_at: this.now(),
    };
    const guard = atomicPublish(this.releasesDir(entry.escrow_ref), `${hashBody(rh)}.json`, canonicalBytes(record));
    if (guard.status === "EXISTS") {
      let existing: ReleaseRecord | undefined;
      try {
        const parsed = ReleaseRecordSchema.safeParse(JSON.parse(guard.existing.toString("utf8")));
        if (parsed.success) existing = parsed.data;
      } catch {
        /* unreadable → corrupt below */
      }
      if (!existing) {
        return { status: "LEDGER_CORRUPT", outcome_receipt_hash: rh, settlement_key: sk, reason: "release guard file exists but is unreadable" };
      }
      if (existing.escrow_ref !== entry.escrow_ref || existing.outcome_receipt_hash !== rh) {
        return { status: "LEDGER_CORRUPT", outcome_receipt_hash: rh, settlement_key: sk, reason: "release guard pair mismatch" };
      }
      // Idempotent replay — INCLUDING a different settlement_key/nonce:
      // the pair (escrow_ref, outcome_receipt_hash) already consumed the
      // single economic release. No second transfer can ever be created.
      this.markReleased(entry);
      return { status: "ALREADY_RELEASED", outcome_receipt_hash: rh, settlement_key: sk, existing };
    }

    // 11 — post-commit cache bookkeeping (idempotent; repaired by open() if torn)
    this.markReleased(entry);
    return { status: "RELEASED", outcome_receipt_hash: rh, settlement_key: sk, release: record };
  }

  /** escrow.json cache update to RELEASED — ONLY ever called after the guard. */
  private markReleased(entry: EscrowEntry): void {
    if (entry.state === "RELEASED") return;
    this.writeEscrowState(entry, "RELEASED");
  }

  private writeEscrowState(entry: EscrowEntry, state: EscrowState): void {
    const updated: EscrowEntry = { ...entry, state, updated_at: this.now() };
    atomicReplace(path.join(this.escrowDir(entry.escrow_ref), "escrow.json"), canonicalBytes(updated));
  }
}

// ———————————————————————————————————————————————————————————————— helpers

import { mkdirSync, readdirSync } from "node:fs";

function readdirEscrows(escrowsDir: string): string[] {
  if (!existsSync(escrowsDir)) return [];
  return readdirSorted(escrowsDir);
}

function readdirSorted(dir: string): string[] {
  mkdirRecursive(dir);
  return readdirSync(dir).sort();
}

function mkdirRecursive(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
