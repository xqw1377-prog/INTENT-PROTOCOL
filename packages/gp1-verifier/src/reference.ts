/**
 * GP1 INDEPENDENT REFERENCE RUNTIME (Builder D, Issue #12 §B).
 *
 * Builder D's own model of the CONTRACT-correct runtime ledger semantics:
 * append-only journal, command_id idempotency, conflict rejection,
 * deterministic fold/replay, crash semantics, ClaimRecord immutability.
 * The future black-box adapter drives Builder C's runtime through the SAME
 * command vocabulary and compares against this reference's decisions.
 *
 * Derived only from GP-V1 §3 + GATES GP1 bullets. No Builder C code.
 */
import { authorityAvailableInGP1, edgeFor, isTerminal, MACHINES, type MachineName } from "./model.js";
import { claimRecordShapeViolations, type ClaimRecord } from "./subject.js";

export const INITIAL_STATE: Record<MachineName, string> = {
  bounty: "CREATED",
  execution: "CREATED",
  verification: "PENDING",
  settlement: "LOCKED",
};

export interface Command {
  command_id: string;
  machine: MachineName;
  entity: string;
  op: "transition";
  to: string;
  /** Required only for bounty FUNDED->CLAIMED (GP-V1 §3 Claim binding). */
  claim?: ClaimRecord;
  /** Caller-supplied logical time (GATES GP1 determinism; wall-clock is not evidence). */
  at: string;
}

export type Rejection =
  | "unknown-state-target"
  | "illegal-pair"
  | "not-current-state"
  | "terminal-source"
  | "missing-authority"
  | "claim-required"
  | "invalid-claim-shape"
  | "claim-record-immutable"
  | "conflicting-command"
  ;

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
  /** Committed side-effect: the ClaimRecord appended by an accepted FUNDED->CLAIMED edge. */
  claim?: ClaimRecord;
}

/** Stable fingerprint of a command's EFFECTIVE payload (command_id excluded). */
export function fingerprint(c: Command): string {
  return JSON.stringify([c.machine, c.entity, c.op, c.to, c.claim ?? null]);
}

const entityKey = (machine: MachineName, entity: string): string => `${machine}:${entity}`;

export class ReferenceRuntime {
  private journal: JournalEntry[] = [];
  private byCommandId = new Map<string, JournalEntry>();
  private states = new Map<string, string>();
  private claims = new Map<string, ClaimRecord>(); // bounty_id -> immutable record

  stateOf(machine: MachineName, entity: string): string {
    return this.states.get(entityKey(machine, entity)) ?? INITIAL_STATE[machine];
  }

  claimOf(bountyId: string): ClaimRecord | undefined {
    return this.claims.get(bountyId);
  }

  journalSnapshot(): JournalEntry[] {
    return this.journal.map((e) => ({ ...e }));
  }

  submit(c: Command): Decision {
    // (1) idempotent replay: same command_id + same payload => same recorded decision, NO new entry
    const prior = this.byCommandId.get(c.command_id);
    if (prior) {
      if (prior.payloadFingerprint === fingerprint(c)) return { ...prior.decision };
      // (2) conflicting command: same command_id, different payload => rejected, no entry
      const d: Decision = { command_id: c.command_id, accepted: false, reason: "conflicting-command", machine: c.machine, entity: c.entity, from: this.stateOf(c.machine, c.entity) };
      return d;
    }

    const from = this.stateOf(c.machine, c.entity);
    const base = { command_id: c.command_id, machine: c.machine, entity: c.entity, from };
    const reject = (reason: Rejection): Decision => ({ ...base, accepted: false, reason });

    if (!MACHINES[c.machine].states.includes(c.to)) return this.commit(c, reject("unknown-state-target"), from);
    if (isTerminal(c.machine, from)) return this.commit(c, reject("terminal-source"), from);

    const edge = edgeFor(c.machine, from, c.to);
    if (!edge) return this.commit(c, reject("illegal-pair"), from);

    // authority guards (contract-cited, see model.ts)
    if (!authorityAvailableInGP1(edge.authority)) {
      // GP1 scope: sealed-bundle / accepted-receipt authorities cannot exist (GATES GP1)
      return this.commit(c, reject("missing-authority"), from);
    }
    if (edge.authority === "claim-record") {
      if (!c.claim) return this.commit(c, reject("claim-required"), from);
      const shape = claimRecordShapeViolations(c.claim);
      if (shape.length > 0) return this.commit(c, reject("invalid-claim-shape"), from);
      const existing = this.claims.get(c.entity);
      if (existing) {
        // immutability: neither replacement nor field mutation is permitted (GP-V1 §3)
        if (JSON.stringify(existing) !== JSON.stringify(c.claim)) return this.commit(c, reject("claim-record-immutable"), from);
      }
      if (c.claim.bounty_id !== c.entity) return this.commit(c, reject("invalid-claim-shape"), from);
      this.claims.set(c.entity, { ...c.claim });
      this.states.set(entityKey(c.machine, c.entity), c.to);
      return this.commit(c, { ...base, accepted: true, to: c.to }, from, c.claim);
    }

    this.states.set(entityKey(c.machine, c.entity), c.to);
    return this.commit(c, { ...base, accepted: true, to: c.to }, from);
  }

  private commit(c: Command, decision: Decision, _from: string, claim?: ClaimRecord): Decision {
    const entry: JournalEntry = { seq: this.journal.length + 1, at: c.at, decision, payloadFingerprint: fingerprint(c), ...(claim ? { claim: { ...claim } } : {}) };
    this.journal.push(entry);
    this.byCommandId.set(c.command_id, entry);
    return decision;
  }

  // ---- crash / recovery oracle ------------------------------------------------

  /** Simulate a crash AFTER exactly k committed entries: fold the prefix deterministically. */
  static fromJournalPrefix(entries: JournalEntry[]): ReferenceRuntime {
    const rt = new ReferenceRuntime();
    // deterministic fold: replay in seq order; deduplicated command_ids keep their first decision
    for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
      if (rt.byCommandId.has(e.decision.command_id)) continue; // no duplicate event on recovery replay
      rt.journal.push(e);
      rt.byCommandId.set(e.decision.command_id, e);
      if (e.decision.accepted && e.decision.to) {
        rt.states.set(entityKey(e.decision.machine, e.decision.entity), e.decision.to);
        if (e.claim) rt.claims.set(e.decision.entity, { ...e.claim });
      }
    }
    return rt;
  }

  /** Full reload: deterministic replay of the whole journal must reproduce identical state + claims + journal. */
  reload(): ReferenceRuntime {
    return ReferenceRuntime.fromJournalPrefix(this.journal);
  }

  /** crash-before-commit: the command never entered the journal; state must be unchanged. */
  static crashBeforeCommit(rt: ReferenceRuntime, c: Command): { before: string; after: string } {
    return { before: rt.stateOf(c.machine, c.entity), after: rt.stateOf(c.machine, c.entity) };
  }
}
