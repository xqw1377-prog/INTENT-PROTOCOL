/**
 * GP1 runtime ledger (Builder: Zcode). Append-only journal + deterministic
 * fold + command_id idempotency + crash/reload, per docs/GOLDEN-PATH-V1.md §3
 * and GATES GP1. All time is caller-supplied (`at`); the runtime never reads a
 * wall clock. GP1-R1: future-authority edges consume typed opaque prerequisite
 * refs (kind/shape only); ELIGIBLE->RELEASED is ledger reachability only —
 * there is NO escrow/payment code in this package by design.
 *
 * Public surface (black-box replay target):
 *   new GPRuntime({ dir })   — durable mode: journal appended after each commit
 *   GPRuntime.reload(dir)    — deterministic fold from the journal file
 *   submit / stateOf / claimOf / journalSnapshot
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as path from "node:path";
import {
  claimRecordShapeViolations, edgeFor, EDGES, INITIAL_STATE, isTerminal, MACHINES,
  prerequisiteKindOf, prerequisiteShapeViolations,
  CLAIM_ID_RE, PREREQ_KINDS, PREREQUISITE_REF_RE, RFC3339_UTC_RE, SUBJECT_REF_RE, TASK_FREEZE_HASH_RE,
  type ClaimRecord, type MachineName, type PrerequisiteRef,
} from "./machines.js";

export interface Command {
  command_id: string;
  machine: MachineName;
  entity: string;
  op: "transition";
  to: string;
  claim?: ClaimRecord;
  prerequisite?: PrerequisiteRef;
  at: string; // caller-supplied logical time (RFC3339 UTC)
}

export type Rejection =
  | "unknown-state-target"
  | "illegal-pair"
  | "terminal-source"
  | "prerequisite-required"
  | "prerequisite-wrong-kind"
  | "prerequisite-invalid-shape"
  | "claim-required"
  | "invalid-claim-shape"
  | "claim-record-immutable"
  | "conflicting-command";

export interface Decision {
  command_id: string;
  accepted: boolean;
  reason?: Rejection;
  machine: MachineName;
  entity: string;
  from: string;
  to?: string;
}

export interface JournalEntry {
  seq: number;
  at: string;
  decision: Decision;
  payloadFingerprint: string;
  claim?: ClaimRecord;
  prerequisite?: PrerequisiteRef;
}

export function fingerprint(c: Command): string {
  return JSON.stringify([c.machine, c.entity, c.op, c.to, c.claim ?? null, c.prerequisite ?? null]);
}

const key = (m: MachineName, e: string): string => `${m}:${e}`;
const JOURNAL_FILE = "journal.jsonl";

// ————————————————— PH-05R version envelope (sidecar; line format UNCHANGED) —————————————————
// The v1 journal line format is FROZEN (GP5 pack zero drift), so the version
// contract lives in a sidecar next to the journal. reload() refuses unknown
// versions and refuses ruleset drift — old journals replay under THEIR frozen
// ruleset, never silently under a different one.
const JOURNAL_SCHEMA_VERSION = "gp-journal-v1" as const;
const MACHINE_VERSION = 1 as const;
const FINGERPRINT_SCHEME = "json-array-v1" as const;
const SIDE_CAR = "journal.meta.json";

/**
 * RULESET_DESCRIPTOR_V1 — everything that determines replay legality, not
 * just the state tables. Any change to ANY of these must change the hash:
 * machines (state graph + terminals), initial states, the edge table with
 * authorities, the prerequisite kind set + ref grammar, the claim schema
 * version + every claim field grammar + the entity-binding rule, and the
 * claim-immutability semantic tag. Replacer-free deterministic
 * serialization: keys sorted at EVERY level, no whitespace.
 */
function deepSorted(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return Array.isArray(value) ? value.map(deepSorted) : value;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    out[k] = deepSorted((value as Record<string, unknown>)[k]);
  }
  return out;
}
// PH-05R3: SINGLE SOURCE OF TRUTH — every grammar/kind below is derived from
// the SAME exported constants the validators execute (regex .source, not a
// hand-copied string). Changing a validator rule now necessarily changes the
// RULESET_HASH; a stale hand-written copy is structurally impossible.
const RULESET_DESCRIPTOR_V1 = {
  descriptor_version: "ruleset-descriptor.v1",
  machine_version: MACHINE_VERSION,
  machines: MACHINES,                                  // state graph + terminals
  initial_states: INITIAL_STATE,
  edges: EDGES,                                        // from→to + authority per edge
  prerequisite_kinds: PREREQ_KINDS,                    // same array prerequisiteShapeViolations checks
  prerequisite_ref_grammar: PREREQUISITE_REF_RE.source,
  claim_schema_version: "gp-claim.v1",
  claim_claimant_grammar: SUBJECT_REF_RE.source,
  claim_id_grammar: CLAIM_ID_RE.source,
  claim_task_freeze_hash_grammar: TASK_FREEZE_HASH_RE.source,
  claim_claimed_at_grammar: RFC3339_UTC_RE.source,
  claim_bounty_id_rule: "non-empty string",
  claim_entity_binding: "claim.bounty_id === command.entity",
  claim_immutability_rule: "append-only: an existing claim for the entity may never be replaced or mutated",
} as const;
/** sha256 over the canonical (deep-sorted) RULESET_DESCRIPTOR_V1. */
function rulesetHashOf(descriptor: unknown): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(deepSorted(descriptor))).digest("hex");
}
export const RULESET_HASH = rulesetHashOf(RULESET_DESCRIPTOR_V1);
/** Test-only hooks for the counterfactual hash matrix (never used by production paths). */
export const RULESET_DESCRIPTOR_FOR_TEST: () => Record<string, unknown> = () => JSON.parse(JSON.stringify(RULESET_DESCRIPTOR_V1));
export const computeRulesetHashForTest: (mutation?: (d: Record<string, unknown>) => void) => string = (mutation) => {
  const d = JSON.parse(JSON.stringify(RULESET_DESCRIPTOR_V1)) as Record<string, unknown>;
  mutation?.(d);
  return rulesetHashOf(d);
};

interface JournalMeta {
  journal_schema_version: typeof JOURNAL_SCHEMA_VERSION;
  machine_version: typeof MACHINE_VERSION;
  ruleset_hash: string;
  fingerprint_scheme: typeof FINGERPRINT_SCHEME;
}

function readMeta(dir: string): JournalMeta | null {
  const f = path.join(dir, SIDE_CAR);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8")) as JournalMeta;
}

function writeMeta(dir: string): void {
  const meta: JournalMeta = { journal_schema_version: JOURNAL_SCHEMA_VERSION, machine_version: MACHINE_VERSION, ruleset_hash: RULESET_HASH, fingerprint_scheme: FINGERPRINT_SCHEME };
  writeFileSync(path.join(dir, SIDE_CAR), JSON.stringify(meta, null, 2) + "\n");
}

/** Enforce the version envelope on recovery: unknown version or ruleset drift → hard fail.
 *  PH-05R2: a NON-EMPTY journal missing its sidecar is a HARD FAIL under the
 *  default reader — deleting journal.meta.json must NOT silently downgrade a
 *  versioned ledger to "legacy". True legacy v1 journals load only via the
 *  EXPLICIT migration authority `reloadLegacyV1()`. */
function enforceMeta(dir: string, journalLineCount: number, allowLegacyV1: boolean): void {
  const meta = readMeta(dir);
  if (!meta) {
    if (journalLineCount === 0 || allowLegacyV1) return; // empty journal or explicit legacy authority
    throw new Error("journal version envelope: NON-EMPTY journal without journal.meta.json — sidecar deleted? refusing silent legacy downgrade (use reloadLegacyV1 for explicit v1 migration)");
  }
  if (meta.journal_schema_version !== JOURNAL_SCHEMA_VERSION) {
    throw new Error(`journal version envelope: unknown journal_schema_version ${String(meta.journal_schema_version)}`);
  }
  if (meta.machine_version !== MACHINE_VERSION) {
    throw new Error(`journal version envelope: unknown machine_version ${String(meta.machine_version)}`);
  }
  if (meta.fingerprint_scheme !== FINGERPRINT_SCHEME) {
    throw new Error(`journal version envelope: unknown fingerprint_scheme ${String(meta.fingerprint_scheme)}`);
  }
  if (meta.ruleset_hash !== RULESET_HASH) {
    throw new Error(`journal version envelope: RULESET DRIFT — journal was written under ${meta.ruleset_hash.slice(0, 20)}… but the frozen v1 ruleset hashes to ${RULESET_HASH.slice(0, 20)}…`);
  }
}

/** Reconstruct the Command view of a journal entry (for fingerprint re-verification). */
function commandOf(e: JournalEntry): Command {
  return {
    command_id: e.decision.command_id,
    machine: e.decision.machine,
    entity: e.decision.entity,
    op: "transition",
    to: e.decision.to ?? e.decision.from,
    ...(e.claim ? { claim: e.claim } : {}),
    ...(e.prerequisite ? { prerequisite: e.prerequisite } : {}),
    at: e.at,
  };
}

export class GPRuntime {
  private journal: JournalEntry[] = [];
  private byCommandId = new Map<string, JournalEntry>();
  private states = new Map<string, string>();
  private claims = new Map<string, ClaimRecord>();
  private dir: string | undefined;
  /** PH-05: true when reload discarded a torn FINAL journal line (crash edge). */
  tornTailDiscarded = false;

  constructor(opts: { dir?: string } = {}) {
    this.dir = opts.dir;
    if (this.dir) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /**
   * Deterministic fold (dedup by command_id keeps the first decision).
   * PH-05: every ACCEPTED transition is re-validated against the FROZEN
   * ruleset — an entry recording a transition that was never legal
   * (e.g. a forged RUNNING→CLOSED) fails the fold instead of folding in.
   */
  static fold(entries: JournalEntry[]): GPRuntime {
    const rt = new GPRuntime();
    for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
      if (rt.byCommandId.has(e.decision.command_id)) continue;
      if (e.decision.accepted && e.decision.to) {
        const from = rt.stateOf(e.decision.machine, e.decision.entity);
        if (from !== e.decision.from) {
          throw new Error(`journal replay violation at seq ${e.seq}: recorded from=${e.decision.from} but replay state=${from}`);
        }
        const edge = edgeFor(e.decision.machine, from, e.decision.to);
        if (!edge) {
          throw new Error(`journal replay violation at seq ${e.seq}: illegal transition ${from}→${e.decision.to} under the frozen ruleset`);
        }
        const needed = prerequisiteKindOf(edge.authority);
        if (needed) {
          if (!e.prerequisite) throw new Error(`journal replay violation at seq ${e.seq}: accepted transition lacks its prerequisite`);
          if (prerequisiteShapeViolations(e.prerequisite).length > 0) throw new Error(`journal replay violation at seq ${e.seq}: prerequisite shape invalid`);
          if (e.prerequisite.kind !== needed) throw new Error(`journal replay violation at seq ${e.seq}: prerequisite kind mismatch`);
        }
        if (edge.authority === "claim-record") {
          if (!e.claim) throw new Error(`journal replay violation at seq ${e.seq}: claim-record edge without a recorded claim`);
          if (claimRecordShapeViolations(e.claim).length > 0) throw new Error(`journal replay violation at seq ${e.seq}: claim shape invalid`);
          if (e.claim.bounty_id !== e.decision.entity) throw new Error(`journal replay violation at seq ${e.seq}: claim/entity mismatch`);
          const existing = rt.claims.get(e.decision.entity);
          if (existing && JSON.stringify(existing) !== JSON.stringify(e.claim)) throw new Error(`journal replay violation at seq ${e.seq}: claim record mutated`);
        }
        rt.states.set(key(e.decision.machine, e.decision.entity), e.decision.to);
        if (e.claim) rt.claims.set(e.decision.entity, { ...e.claim });
      }
      rt.journal.push(e);
      rt.byCommandId.set(e.decision.command_id, e);
    }
    return rt;
  }

  /**
   * PH-05 hardened crash recovery (write format byte-compatible — the
   * journal line format is UNCHANGED so existing clean runs and the GP5 pack
   * regenerate identically):
   *   · torn FINAL line → discarded with a recorded warning (append torn mid-write)
   *   · torn NON-final line → hard failure (corruption, not a crash edge)
   *   · fingerprint mismatch on any entry → hard failure (payload tamper)
   *   · every accepted transition re-validated against the FROZEN ruleset
   *     (edgeFor / prerequisite kind+shape / claim guard) — a forged entry
   *     that was never legal cannot fold silently
   */
  static reload(dir: string): GPRuntime {
    const file = path.join(dir, JOURNAL_FILE);
    if (!existsSync(file)) return new GPRuntime({ dir });
    const raw = readFileSync(file, "utf8").split("\n");
    // trailing empty chunk from the final newline is normal, not a torn line
    while (raw.length > 0 && raw[raw.length - 1]!.trim() === "") raw.pop();
    let discarded = false;
    const entries: JournalEntry[] = [];
    for (let i = 0; i < raw.length; i++) {
      try {
        entries.push(JSON.parse(raw[i]!) as JournalEntry);
      } catch (e) {
        if (i === raw.length - 1) { discarded = true; continue; } // torn crash edge
        throw new Error(`journal corrupt at line ${i + 1} (non-final torn line): ${String((e as Error).message).slice(0, 120)}`);
      }
    }
    // fingerprint consistency: each ACCEPTED entry's recorded fingerprint must
    // match a recomputation of its own decision payload (format unchanged —
    // verified, not rewritten). REJECTED entries are skipped by necessity:
    // the frozen write format does not persist the rejected command's
    // original `to`, so its fingerprint is not recomputable from the journal
    // alone; their machine/entity/op prefix is still covered by the replay
    // validation below.
    for (const e of entries) {
      if (!e.decision.accepted || !e.decision.to) continue;
      const recomputed = fingerprint(commandOf(e));
      if (recomputed !== e.payloadFingerprint) {
        throw new Error(`journal fingerprint mismatch at seq ${e.seq}: payload tamper or version drift`);
      }
    }
    enforceMeta(dir, entries.length, false); // PH-05R2: default reader refuses silent legacy downgrade
    const rt = GPRuntime.fold(entries);
    rt.tornTailDiscarded = discarded;
    rt.dir = dir;
    return rt;
  }

  /** EXPLICIT legacy migration authority (PH-05R2): load a pre-envelope v1
   *  journal under the one-and-only frozen v1 ruleset. Never the default. */
  static reloadLegacyV1(dir: string): GPRuntime {
    const file = path.join(dir, JOURNAL_FILE);
    if (!existsSync(file)) return new GPRuntime({ dir });
    const raw = readFileSync(file, "utf8").split("\n");
    while (raw.length > 0 && raw[raw.length - 1]!.trim() === "") raw.pop();
    const entries: JournalEntry[] = [];
    for (let i = 0; i < raw.length; i++) {
      entries.push(JSON.parse(raw[i]!) as JournalEntry);
    }
    enforceMeta(dir, entries.length, true); // legacy authority granted HERE only
    const rt = GPRuntime.fold(entries);
    rt.dir = dir;
    return rt;
  }

  stateOf(machine: MachineName, entity: string): string {
    return this.states.get(key(machine, entity)) ?? INITIAL_STATE[machine];
  }

  claimOf(bountyId: string): ClaimRecord | undefined {
    const c = this.claims.get(bountyId);
    return c ? { ...c } : undefined;
  }

  journalSnapshot(): JournalEntry[] {
    return this.journal.map((e) => ({ ...e }));
  }

  /** Discard the durable journal (used only by tests simulating a fresh process). */
  resetDurability(): void {
    if (this.dir && existsSync(path.join(this.dir, JOURNAL_FILE))) {
      writeFileSync(path.join(this.dir, JOURNAL_FILE), "");
    }
  }

  submit(c: Command): Decision {
    const prior = this.byCommandId.get(c.command_id);
    if (prior) {
      if (prior.payloadFingerprint === fingerprint(c)) return { ...prior.decision }; // idempotent replay
      return { command_id: c.command_id, accepted: false, reason: "conflicting-command", machine: c.machine, entity: c.entity, from: this.stateOf(c.machine, c.entity) };
    }

    const from = this.stateOf(c.machine, c.entity);
    const base = { command_id: c.command_id, machine: c.machine, entity: c.entity, from };
    const reject = (reason: Rejection): Decision => ({ ...base, accepted: false, reason });

    if (!(MACHINES[c.machine].states as string[]).includes(c.to)) return this.commit(c, reject("unknown-state-target"));
    if (isTerminal(c.machine, from)) return this.commit(c, reject("terminal-source"));

    const edge = edgeFor(c.machine, from, c.to);
    if (!edge) return this.commit(c, reject("illegal-pair"));

    // GP1-R1 prerequisite: kind + shape only, never semantic interpretation.
    const needed = prerequisiteKindOf(edge.authority);
    if (needed) {
      if (!c.prerequisite) return this.commit(c, reject("prerequisite-required"));
      if (prerequisiteShapeViolations(c.prerequisite).length > 0) return this.commit(c, reject("prerequisite-invalid-shape"));
      if (c.prerequisite.kind !== needed) return this.commit(c, reject("prerequisite-wrong-kind"));
    }

    let nextClaim: ClaimRecord | undefined;
    if (edge.authority === "claim-record") {
      if (!c.claim) return this.commit(c, reject("claim-required"));
      if (claimRecordShapeViolations(c.claim).length > 0) return this.commit(c, reject("invalid-claim-shape"));
      if (c.claim.bounty_id !== c.entity) return this.commit(c, reject("invalid-claim-shape"));
      const existing = this.claims.get(c.entity);
      if (existing && JSON.stringify(existing) !== JSON.stringify(c.claim)) {
        return this.commit(c, reject("claim-record-immutable")); // §3: append-only, never replaced/mutated
      }
      nextClaim = c.claim;
    }

    // PH-05R: VALIDATE → CONSTRUCT (nextState/nextClaim, no mutation yet) →
    // commit() appends the durable line FIRST and only then applies the
    // mutations. A failed append cannot leave the runtime ahead of its ledger.
    return this.commit(c, { ...base, accepted: true, to: c.to }, c.claim, c.prerequisite, nextClaim);
  }

  private commit(c: Command, decision: Decision, claim?: ClaimRecord, prerequisite?: PrerequisiteRef, nextClaim?: ClaimRecord): Decision {
    const entry: JournalEntry = {
      seq: this.journal.length + 1,
      at: c.at,
      decision,
      payloadFingerprint: fingerprint(c),
      ...(claim ? { claim: { ...claim } } : {}),
      ...(prerequisite ? { prerequisite: { ...prerequisite } } : {}),
    };
    // PH-05R atomic ordering: durable append FIRST (the only fallible step);
    // every in-memory mutation — states, claims, journal, byCommandId —
    // happens ONLY after the append succeeded. A thrown append leaves the
    // runtime EXACTLY as it was. The version sidecar is stamped on the first
    // durable write (line format unchanged).
    if (this.dir) {
      if (!existsSync(path.join(this.dir, SIDE_CAR))) writeMeta(this.dir);
      appendFileSync(path.join(this.dir, JOURNAL_FILE), JSON.stringify(entry) + "\n", "utf8");
    }
    if (decision.accepted && decision.to) {
      this.states.set(key(decision.machine, decision.entity), decision.to);
      if (nextClaim) this.claims.set(decision.entity, { ...nextClaim });
    }
    this.journal.push(entry);
    this.byCommandId.set(c.command_id, entry);
    return decision;
  }
}
