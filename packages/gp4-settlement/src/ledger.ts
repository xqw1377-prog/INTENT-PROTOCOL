/**
 * GP4-B — local escrow ledger with the atomic economic release guard.
 *
 * Two independent uniqueness layers (GOLDEN-PATH-V1.md §4):
 *
 *   A. ECONOMIC exactly-once: one release file per
 *      (escrow_ref, outcome_receipt_hash) — enforced by kernel-atomic
 *      link() in guard.ts:atomicPublish. Same pair + different nonce
 *      (different settlement_key) MUST NOT and CANNOT release twice.
 *
 *   B. INSTRUCTION idempotency: one instruction record per settlement_key
 *      — same primitive, advisory layer only.
 *
 * TRANSACTION BOUNDARY: the single linkSync() inside atomicPublish for the
 * release file is the commit point of economic release. Everything before it
 * is read-only validation; everything after it (state flip, instruction
 * record) is idempotent post-commit bookkeeping that open() repairs after a
 * crash. The guard file is the authority; escrow.json state is a cache.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { canonicalize, settlementKey, SettlementInstructionSchema } from "@intent/protocol-schema";
import type { Hash, SettlementInstruction } from "@intent/protocol-schema";
import { frozenSeal } from "./frozen.ts";
import { atomicPublish, atomicReplace } from "./guard.ts";
import {
  ESCROW_REF_RE, EscrowEntrySchema, InstructionRecordSchema, ReleaseRecordSchema,
  assetTripleKey, hashBody, networkAllowed, settlementEdge,
} from "./schema.ts";
import type { EscrowEntry, InstructionRecord, ReleaseRecord } from "./schema.ts";
import { receiptAuthority } from "./receipt.ts";

export type ReleaseStatus =
  | "RELEASED"
  | "ALREADY_RELEASED"
  | "REJECTED_INVALID_RECEIPT"
  | "REJECTED_INVALID_INSTRUCTION"
  | "REJECTED_UNKNOWN_ESCROW"
  | "REJECTED_RECEIPT_MISMATCH"
  | "REJECTED_HOLD"
  | "DENIED_NETWORK"
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
  release_enabled?: boolean;
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
  private readonly now: () => number;

  constructor(root: string, opts?: { now?: () => number }) {
    this.root = root;
    this.now = opts?.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Open (and repair) a ledger root.
   *
   * NOTE: open() deliberately does NOT sweep `.tmp-*` files: a concurrent
   * publisher in another process owns its in-flight temp, and sweeping here
   * would delete it mid-publish (proven by the multi-process race test).
   * Crash-recovery correctness comes from publish atomicity, not from
   * sweeping; stale temps are inert (never read, filtered out of listings)
   * and may be cleaned offline via the exported sweepTemp().
   */
  static open(root: string, opts?: { now?: () => number }): EscrowLedger {
    const ledger = new EscrowLedger(root, opts);
    const escrowsDir = ledger.escrowsDir();
    if (!existsSync(escrowsDir)) return ledger;
    for (const ref of readdirEscrows(escrowsDir)) {
      try {
        ledger.syncReleasedState(ref);
      } catch {
        /* corrupt entries surface via readEscrow */
      }
    }
    return ledger;
  }

  private escrowsDir(): string {
    return path.join(this.root, "escrows");
  }
  private escrowDir(ref: string): string {
    return path.join(this.escrowsDir(), ref);
  }
  private releasesDir(ref: string): string {
    return path.join(this.escrowDir(ref), "releases");
  }
  private instructionsDir(ref: string): string {
    return path.join(this.escrowDir(ref), "instructions");
  }

  /**
   * Create an escrow entry atomically. release_enabled DEFAULTS TO FALSE
   * (hold-by-default). The outcome_receipt_hash binding is fixed here and can
   * never be changed afterwards.
   */
  createEscrow(input: CreateEscrowInput):
    | { status: "CREATED"; entry: EscrowEntry }
    | { status: "ESCROW_EXISTS" }
    | { status: "REJECTED_INVALID"; reason: string } {
    const at = this.now();
    const parsed = EscrowEntrySchema.safeParse({
      schema_version: "gp4-escrow.v1",
      escrow_ref: input.escrow_ref,
      asset: input.asset,
      amount: input.amount,
      outcome_receipt_hash: input.outcome_receipt_hash,
      state: "LOCKED",
      ...(input.release_enabled === undefined ? {} : { release_enabled: input.release_enabled }),
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
    // materialize the documented layout eagerly (empty until first release)
    readdirSorted(path.join(dir, "releases"));
    readdirSorted(path.join(dir, "instructions"));
    return { status: "CREATED", entry };
  }

  /** Read an escrow entry. Returns null for unknown/unsafe refs. */
  readEscrow(ref: string): EscrowEntry | null {
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

  /** Read the release record for (ref, receiptHash), or null. */
  readRelease(ref: string, receiptHash: string): ReleaseRecord | null {
    const file = path.join(this.releasesDir(ref), `${hashBody(receiptHash)}.json`);
    if (!existsSync(file)) return null;
    return ReleaseRecordSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  }

  /** Read the instruction record for a settlement_key, or null. */
  readInstruction(ref: string, settlementKeyHash: string): InstructionRecord | null {
    const file = path.join(this.instructionsDir(ref), `${hashBody(settlementKeyHash)}.json`);
    if (!existsSync(file)) return null;
    return InstructionRecordSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  }

  listReleaseFiles(ref: string): string[] {
    const dir = this.releasesDir(ref);
    if (!existsSync(dir)) return [];
    return readdirSorted(dir).filter((f) => f.endsWith(".json"));
  }

  listInstructionFiles(ref: string): string[] {
    const dir = this.instructionsDir(ref);
    if (!existsSync(dir)) return [];
    return readdirSorted(dir).filter((f) => f.endsWith(".json"));
  }

  /**
   * ATOMIC ECONOMIC RELEASE.
   *
   * Validation order is normative (cheap rejects before any write; the guard
   * is the only authority write):
   *   1. frozen-G1 seal of the receipt            → REJECTED_INVALID_RECEIPT
   *   2. frozen-G1 seal of the instruction        → REJECTED_INVALID_INSTRUCTION
   *   3. instruction binds the same receipt       → REJECTED_RECEIPT_MISMATCH
   *   4. escrow exists + bound to this receipt    → REJECTED_UNKNOWN_ESCROW / REJECTED_RECEIPT_MISMATCH
   *   5. release_enabled (default false)          → REJECTED_HOLD
   *   6. network allowlist (MAINNET DENIED)       → DENIED_NETWORK
   *   7. amount / asset triple equality           → REJECTED_AMOUNT_MISMATCH / REJECTED_ASSET_MISMATCH
   *   8. settlement_key derived by the ENGINE (never trusted from input)
   *   9. LOCKED→ELIGIBLE state walk (frozen edges, idempotent)
   *  10. GUARD: atomicPublish(releases/<hex>.json) — TRANSACTION BOUNDARY
   *  11. post-commit idempotent bookkeeping
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

    // 3 — instruction must bind the same receipt it settles
    if (inst.outcome_receipt_hash !== rh) {
      return { status: "REJECTED_RECEIPT_MISMATCH", outcome_receipt_hash: rh, reason: "instruction.outcome_receipt_hash differs from sealed receipt" };
    }

    // 4 — escrow lookup (readEscrow grammar-guards the ref against traversal)
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

    // 5 — hold-by-default gate
    if (!entry.release_enabled) {
      return { status: "REJECTED_HOLD", outcome_receipt_hash: rh, reason: "release_enabled=false (hold policy)" };
    }

    // 6 — MAINNET DENIED allowlist
    if (!networkAllowed(entry.asset.network)) {
      return { status: "DENIED_NETWORK", outcome_receipt_hash: rh, reason: `network '${entry.asset.network}' is not in the GP4 local allowlist` };
    }

    // 7 — economic equality of instruction vs escrow
    if (inst.total_amount !== entry.amount) {
      return { status: "REJECTED_AMOUNT_MISMATCH", outcome_receipt_hash: rh, reason: `instruction total ${inst.total_amount} != escrow amount ${entry.amount}` };
    }
    if (assetTripleKey(inst.outputs[0]!.asset) !== assetTripleKey(entry.asset)) {
      return { status: "REJECTED_ASSET_MISMATCH", outcome_receipt_hash: rh, reason: "instruction asset triple differs from escrow asset" };
    }

    // 8 — settlement_key is DERIVED, never accepted from the caller
    let sk: Hash;
    try {
      sk = settlementKey({ outcome_receipt_hash: rh, escrow_ref: entry.escrow_ref, nonce: BigInt(inst.nonce) });
    } catch (e) {
      return { status: "REJECTED_INVALID_INSTRUCTION", outcome_receipt_hash: rh, reason: `nonce not representable as u64: ${(e as Error).message}` };
    }

    // 9 — frozen state walk: LOCKED→ELIGIBLE under accepted-receipt authority
    if (entry.state === "LOCKED") {
      if (!settlementEdge("LOCKED", "ELIGIBLE")) {
        return { status: "LEDGER_CORRUPT", outcome_receipt_hash: rh, reason: "frozen settlement machine lacks LOCKED→ELIGIBLE" };
      }
      this.writeEscrowState(entry, "ELIGIBLE");
    } else if (entry.state !== "ELIGIBLE" && entry.state !== "RELEASED") {
      return { status: "LEDGER_CORRUPT", outcome_receipt_hash: rh, reason: `unknown escrow state ${entry.state}` };
    }

    // 10 — ECONOMIC GUARD: one link() per (escrow_ref, outcome_receipt_hash)
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
      this.syncReleasedState(entry.escrow_ref);
      return { status: "ALREADY_RELEASED", outcome_receipt_hash: rh, settlement_key: sk, existing };
    }

    // 11 — post-commit bookkeeping (idempotent; repaired by open() if torn)
    this.syncReleasedState(entry.escrow_ref);
    const instructionRecord: InstructionRecord = {
      schema_version: "gp4-instruction.v1",
      settlement_key: sk,
      escrow_ref: entry.escrow_ref,
      outcome_receipt_hash: rh,
      nonce: inst.nonce,
      first_seen_at: this.now(),
    };
    atomicPublish(this.instructionsDir(entry.escrow_ref), `${hashBody(sk)}.json`, canonicalBytes(instructionRecord));

    return { status: "RELEASED", outcome_receipt_hash: rh, settlement_key: sk, release: record };
  }

  /** Re-sync escrow.json state to RELEASED from the guard file (authority). */
  private syncReleasedState(refOrEntry: string | EscrowEntry): void {
    const entry = typeof refOrEntry === "string" ? this.readEscrow(refOrEntry) : refOrEntry;
    if (!entry) return;
    if (entry.state === "RELEASED") return;
    const guardExists = existsSync(path.join(this.releasesDir(entry.escrow_ref), `${hashBody(entry.outcome_receipt_hash)}.json`));
    if (!guardExists) return;
    this.writeEscrowState(entry, "RELEASED");
  }

  private writeEscrowState(entry: EscrowEntry, state: EscrowEntry["state"]): void {
    const updated: EscrowEntry = { ...entry, state, updated_at: this.now() };
    atomicReplace(path.join(this.escrowDir(entry.escrow_ref), "escrow.json"), canonicalBytes(updated));
  }
}

// ———————————————————————————————————————————————————————————————— helpers

function readdirEscrows(escrowsDir: string): string[] {
  if (!existsSync(escrowsDir)) return [];
  return readdirSorted(escrowsDir);
}

function readdirSorted(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  return readdirSync(dir).sort();
}
