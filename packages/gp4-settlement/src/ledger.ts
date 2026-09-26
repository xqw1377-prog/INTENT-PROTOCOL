/**
 * GP4-B/C — local escrow ledger: atomic economic release guard + payee
 * authorization + instruction journal.
 *
 * ECONOMIC exactly-once (§4A): one release file per
 * (escrow_ref, outcome_receipt_hash) — kernel-atomic link() in
 * guard.ts:atomicPublish. Same pair + different nonce cannot release twice.
 *
 * INSTRUCTION idempotency (§4B, GP4-C part A): one journal record per
 * settlement_key (same primitive). Advisory layer only — NEVER merged with
 * the economic authority.
 *
 * PAYEE AUTHORIZATION (GP4-C part B): escrow binds ONE immutable
 * claim_record_hash at funding; attemptRelease consumes the ClaimRecord as
 * untrusted input and enforces recipient == claimant BEFORE the state walk
 * and BEFORE the guard (zero-write rejection).
 *
 * HOLD AUTHORITY ISOLATION (R1): production createEscrow has no enable
 * field; the only enable path is LocalVerificationLedger
 * .createEscrowForVerification() (verification.ts).
 *
 * TRANSACTION BOUNDARY (R3): the release-file linkSync() is the FIRST
 * authoritative mutation. Before it: read-only validation. After it:
 * idempotent cache bookkeeping (state RELEASED + instruction journal).
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { canonicalize, settlementKey, SettlementInstructionSchema } from "@intent/protocol-schema";
import type { Hash, SettlementInstruction } from "@intent/protocol-schema";
import { frozenSeal } from "./frozen.ts";
import { atomicPublish, atomicReplace } from "./guard.ts";
import {
  ESCROW_REF_RE, EscrowEntrySchema, InstructionRecordSchema, ReleaseRecordSchema,
  frozenAssetTripleOk, hashBody, refDir, settlementEdge,
} from "./schema.ts";
import type { EscrowEntry, EscrowState, InstructionRecord, ReleaseRecord } from "./schema.ts";
import { receiptAuthority } from "./receipt.ts";
import { claimAuthority } from "./claim.ts";

export type ReleaseStatus =
  | "RELEASED"
  | "ALREADY_RELEASED"
  | "REJECTED_INVALID_RECEIPT"
  | "REJECTED_INVALID_INSTRUCTION"
  | "REJECTED_INVALID_CLAIM"
  | "REJECTED_CLAIM_MISMATCH"
  | "REJECTED_CLAIMANT"
  | "REJECTED_OUTPUT_COUNT"
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
  claim_record_hash: string;
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
   *   guard file absent   + state = ELIGIBLE (legacy/torn) → demoted to LOCKED
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

  /** Re-run the open-time repair (constructor does not repair). */
  reopen(): void {
    this.repairStates();
  }

  protected repairStates(): void {
    const escrowsDir = this.escrowsDir();
    if (!existsSync(escrowsDir)) return;
    for (const dirName of readdirEscrows(escrowsDir)) {
      try {
        const raw = this.readEscrowRawByDir(dirName);
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
  private escrowDir(ref: string): string {
    return path.join(this.escrowsDir(), refDir(ref));
  }
  releasesDir(ref: string): string {
    return path.join(this.escrowDir(ref), "releases");
  }
  instructionsDir(ref: string): string {
    return path.join(this.escrowDir(ref), "instructions");
  }

  /**
   * PRODUCTION escrow creation — release_enabled is ALWAYS false.
   * The input has no field that can enable release; passing one is rejected.
   * Only the frozen GP-001 asset triple is accepted (R2). The escrow binds
   * BOTH authorities at funding: outcome_receipt_hash + claim_record_hash.
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
      schema_version: "gp4-escrow.v2",
      escrow_ref: input.escrow_ref,
      asset: input.asset,
      amount: input.amount,
      outcome_receipt_hash: input.outcome_receipt_hash,
      claim_record_hash: input.claim_record_hash,
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

  /** Raw (un-normalized) escrow entry by directory name, or null if absent. */
  private readEscrowRawByDir(dirName: string): EscrowEntry | null {
    const file = path.join(this.escrowsDir(), dirName, "escrow.json");
    if (!existsSync(file)) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new LedgerCorruptError(`escrow.json unparseable for ${dirName}: ${(e as Error).message}`);
    }
    const parsed = EscrowEntrySchema.safeParse(raw);
    if (!parsed.success) {
      throw new LedgerCorruptError(`escrow.json schema violation for ${dirName}: ${parsed.error.issues[0]?.message ?? ""}`);
    }
    return parsed.data;
  }

  /** Read an escrow entry. Returns null for unknown/unsafe refs. */
  readEscrow(ref: string): EscrowEntry | null {
    if (!ESCROW_REF_RE.test(ref)) return null; // traversal grammar guard
    const raw = this.readEscrowRawByDir(refDir(ref));
    return raw ? this.normalizeState(raw) : null;
  }

  /**
   * Normalized state: the guard file is the authority. ELIGIBLE is never a
   * legal persisted state under the R3 boundary — demoted to LOCKED when no
   * guard exists, promoted to RELEASED when one does.
   */
  private normalizeState(entry: EscrowEntry): EscrowEntry {
    if (entry.state !== "ELIGIBLE") return entry;
    const guardExists = existsSync(path.join(this.releasesDir(entry.escrow_ref), `${hashBody(entry.outcome_receipt_hash)}.json`));
    return { ...entry, state: guardExists ? "RELEASED" : "LOCKED" };
  }

  /** Read the release record for (ref, receiptHash), or null. */
  readRelease(ref: string, receiptHash: string): ReleaseRecord | null {
    const file = path.join(this.releasesDir(ref), `${hashBody(receiptHash)}.json`);
    if (!existsSync(file)) return null;
    return ReleaseRecordSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  }

  /** Read the instruction journal record for a settlement_key, or null. */
  readInstruction(ref: string, settlementKeyHash: string): InstructionRecord | null {
    const file = path.join(this.instructionsDir(ref), `${hashBody(settlementKeyHash)}.json`);
    if (!existsSync(file)) return null;
    return InstructionRecordSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  }

  listReleaseFiles(ref: string): string[] {
    return listJsonFiles(this.releasesDir(ref));
  }

  listInstructionFiles(ref: string): string[] {
    return listJsonFiles(this.instructionsDir(ref));
  }

  /**
   * ATOMIC ECONOMIC RELEASE.
   *
   * Steps 1–11 are READ-ONLY (zero persisted mutation; proven by the
   * treeDigest zero-write test). Step 12 is the FIRST authoritative
   * mutation — the transaction boundary.
   *   1. frozen-G1 seal of the receipt            → REJECTED_INVALID_RECEIPT
   *   2. frozen-G1 seal of the instruction        → REJECTED_INVALID_INSTRUCTION
   *   3. instruction binds the same receipt       → REJECTED_RECEIPT_MISMATCH
   *   4. escrow exists + bound to this receipt    → REJECTED_UNKNOWN_ESCROW / REJECTED_RECEIPT_MISMATCH
   *   5. release_enabled (production = never)     → REJECTED_HOLD
   *   6. frozen asset triple (R2)                 → DENIED_ASSET
   *   7. amount / asset triple equality           → REJECTED_AMOUNT_MISMATCH / REJECTED_ASSET_MISMATCH
   *   8. CLAIM payee authorization (GP4-C/B):
   *      claim shape                              → REJECTED_INVALID_CLAIM
   *      claim_record_hash binding                → REJECTED_CLAIM_MISMATCH
   *      outputs.length == 1                      → REJECTED_OUTPUT_COUNT
   *      recipient == claimant                    → REJECTED_CLAIMANT
   *   9. settlement_key derived by the ENGINE (never trusted from input)
   *  10. LOGICAL state walk LOCKED→ELIGIBLE→RELEASED (frozen edges, no write)
   *  11. (reserved ordering anchor: all above is read-only)
   *  12. GUARD: atomicPublish(releases/<hex>.json) — TRANSACTION BOUNDARY
   *  13. post-commit idempotent bookkeeping: state RELEASED + instruction journal
   */
  attemptRelease(input: { receipt: unknown; instruction: unknown; claim_record: unknown }): ReleaseResult {
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

    // 4 — escrow lookup (grammar-guarded against traversal)
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

    // 5 — hold-by-construction gate
    if (!entry.release_enabled) {
      return { status: "REJECTED_HOLD", outcome_receipt_hash: rh, reason: "release_enabled=false (hold policy; no production API can set it)" };
    }

    // 6 — frozen asset triple closure (R2)
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

    // 8 — CLAIM PAYEE AUTHORIZATION (GP4-C part B): all read-only, all
    // BEFORE the logical walk and the guard — a wrong recipient can never
    // reach ELIGIBLE or the release file (GATES.md GP4).
    let claimant: string;
    try {
      const ca = claimAuthority(input.claim_record);
      if (ca.claim_record_hash !== entry.claim_record_hash) {
        return { status: "REJECTED_CLAIM_MISMATCH", outcome_receipt_hash: rh, reason: "claim_record_hash does not match the escrow's immutable claim binding" };
      }
      claimant = ca.claim.claimant;
    } catch (e) {
      return { status: "REJECTED_INVALID_CLAIM", outcome_receipt_hash: rh, reason: (e as Error).message };
    }
    if (inst.outputs.length !== 1) {
      return { status: "REJECTED_OUTPUT_COUNT", outcome_receipt_hash: rh, reason: `GP-001 settlement must have exactly one output, got ${inst.outputs.length}` };
    }
    if (inst.outputs[0]!.recipient !== claimant) {
      return { status: "REJECTED_CLAIMANT", outcome_receipt_hash: rh, reason: `output recipient ${inst.outputs[0]!.recipient} != immutable ClaimRecord.claimant ${claimant}` };
    }

    // 9 — settlement_key is DERIVED, never accepted from the caller
    let sk: Hash;
    try {
      sk = settlementKey({ outcome_receipt_hash: rh, escrow_ref: entry.escrow_ref, nonce: BigInt(inst.nonce) });
    } catch (e) {
      return { status: "REJECTED_INVALID_INSTRUCTION", outcome_receipt_hash: rh, reason: `nonce not representable as u64: ${(e as Error).message}` };
    }

    // 10 — LOGICAL frozen-machine walk (no persisted ELIGIBLE, ever)
    if (entry.state === "LOCKED") {
      if (!settlementEdge("LOCKED", "ELIGIBLE") || !settlementEdge("ELIGIBLE", "RELEASED")) {
        return { status: "LEDGER_CORRUPT", outcome_receipt_hash: rh, reason: "frozen settlement machine lacks LOCKED→ELIGIBLE→RELEASED walk" };
      }
    } else if (entry.state !== "RELEASED") {
      return { status: "LEDGER_CORRUPT", outcome_receipt_hash: rh, reason: `unknown escrow state ${entry.state}` };
    }

    // 12 — ECONOMIC GUARD: the FIRST authoritative mutation. One link() per
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
      // Idempotent replay — INCLUDING a different settlement_key/nonce.
      this.markReleased(entry);
      return { status: "ALREADY_RELEASED", outcome_receipt_hash: rh, settlement_key: sk, existing };
    }

    // 13 — post-commit bookkeeping (idempotent; repaired by open() if torn):
    // cache state, then the instruction journal (link-atomic, advisory).
    this.markReleased(entry);
    const journal: InstructionRecord = {
      schema_version: "gp4-instruction.v1",
      settlement_key: sk,
      escrow_ref: entry.escrow_ref,
      outcome_receipt_hash: rh,
      nonce: inst.nonce,
      first_seen_at: this.now(),
    };
    atomicPublish(this.instructionsDir(entry.escrow_ref), `${hashBody(sk)}.json`, canonicalBytes(journal));

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
  return readdirSync(escrowsDir).sort();
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
}

function mkdirRecursive(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
