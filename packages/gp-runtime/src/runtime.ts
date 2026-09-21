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
import * as path from "node:path";
import {
  claimRecordShapeViolations, edgeFor, INITIAL_STATE, isTerminal, MACHINES,
  prerequisiteKindOf, prerequisiteShapeViolations,
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

export class GPRuntime {
  private journal: JournalEntry[] = [];
  private byCommandId = new Map<string, JournalEntry>();
  private states = new Map<string, string>();
  private claims = new Map<string, ClaimRecord>();
  private dir: string | undefined;

  constructor(opts: { dir?: string } = {}) {
    this.dir = opts.dir;
    if (this.dir) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /** Deterministic fold of a journal (dedup by command_id keeps the first decision). */
  static fold(entries: JournalEntry[]): GPRuntime {
    const rt = new GPRuntime();
    for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
      if (rt.byCommandId.has(e.decision.command_id)) continue;
      rt.journal.push(e);
      rt.byCommandId.set(e.decision.command_id, e);
      if (e.decision.accepted && e.decision.to) {
        rt.states.set(key(e.decision.machine, e.decision.entity), e.decision.to);
        if (e.claim) rt.claims.set(e.decision.entity, { ...e.claim });
      }
    }
    return rt;
  }

  /** Crash recovery: rebuild the full runtime from a durable journal directory. */
  static reload(dir: string): GPRuntime {
    const file = path.join(dir, JOURNAL_FILE);
    if (!existsSync(file)) return new GPRuntime({ dir });
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0);
    const entries = lines.map((l) => JSON.parse(l) as JournalEntry);
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

    if (edge.authority === "claim-record") {
      if (!c.claim) return this.commit(c, reject("claim-required"));
      if (claimRecordShapeViolations(c.claim).length > 0) return this.commit(c, reject("invalid-claim-shape"));
      if (c.claim.bounty_id !== c.entity) return this.commit(c, reject("invalid-claim-shape"));
      const existing = this.claims.get(c.entity);
      if (existing && JSON.stringify(existing) !== JSON.stringify(c.claim)) {
        return this.commit(c, reject("claim-record-immutable")); // §3: append-only, never replaced/mutated
      }
      this.claims.set(c.entity, { ...c.claim });
    }

    this.states.set(key(c.machine, c.entity), c.to);
    return this.commit(c, { ...base, accepted: true, to: c.to }, c.claim, c.prerequisite);
  }

  private commit(c: Command, decision: Decision, claim?: ClaimRecord, prerequisite?: PrerequisiteRef): Decision {
    const entry: JournalEntry = {
      seq: this.journal.length + 1,
      at: c.at,
      decision,
      payloadFingerprint: fingerprint(c),
      ...(claim ? { claim: { ...claim } } : {}),
      ...(prerequisite ? { prerequisite: { ...prerequisite } } : {}),
    };
    this.journal.push(entry);
    this.byCommandId.set(c.command_id, entry);
    if (this.dir) {
      appendFileSync(path.join(this.dir, JOURNAL_FILE), JSON.stringify(entry) + "\n", "utf8");
    }
    return decision;
  }
}
