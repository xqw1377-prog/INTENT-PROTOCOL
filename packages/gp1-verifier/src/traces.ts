/**
 * Seeded deterministic trace generator (Builder D, Issue #12 §A).
 *
 * Fixed seeds => byte-reproducible command traces with expected decisions
 * computed by the independent reference runtime. The committed
 * vectors/gp1-traces.json must regenerate exactly; the future adapter replays
 * the same commands against Builder C's runtime and must reproduce the same
 * decision sequence.
 */
import { edgeFor, MACHINES, prerequisiteKindOf, type MachineName, type PrerequisiteKind, type PrerequisiteRef } from "./model.js";
import { ReferenceRuntime, type Command, type Decision } from "./reference.js";

/** mulberry32 — small deterministic PRNG (no dependencies). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TRACE_SEEDS = [20260921, 20260922, 20260923, 20260924, 20260925, 20260926, 20260927, 20260928] as const;
export const OPS_PER_TRACE = 48;

const MACHINE_NAMES = Object.keys(MACHINES) as MachineName[];
const hex = (n: number, w: number): string => n.toString(16).padStart(w, "0");

function rfc3339(step: number): string {
  // caller-supplied logical clock: fixed epoch + step seconds — never wall-clock
  return new Date(Date.UTC(2026, 8, 21, 0, 0, 0) + step * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function genCommand(rnd: () => number, i: number, entityId: string, machine: MachineName, states: string[], current: () => string): Command {
  const roll = rnd();
  const at = rfc3339(i);
  const to = states[Math.floor(rnd() * states.length)]!;
  const base = { command_id: `cmd-${hex(i, 4)}`, machine, entity: entityId, op: "transition" as const, to, at };
  if (roll < 0.55) {
    // aim at a plausible next state (may still be illegal — the model decides)
    const cur = current();
    const idx = states.indexOf(cur);
    return { ...base, to: states[Math.min(idx + 1 + Math.floor(rnd() * 2) - (rnd() < 0.3 ? 1 : 0), states.length - 1)]! };
  }
  if (roll < 0.65) {
    // terminal-source attempt: force a terminal target so the source eventually becomes terminal-tested too
    return { ...base, to: states[states.length - 1]! };
  }
  if (roll < 0.75) {
    // duplicate command_id => idempotent replay probe (reuse a previous id with same payload shape)
    return { ...base, command_id: `cmd-${hex(Math.max(0, i - 1), 4)}`, to };
  }
  if (roll < 0.82) {
    // conflicting payload under an old command_id (id differs; the runtime may or may not have it — model decides)
    return { ...base, command_id: `cmd-${hex(Math.max(0, i - 2), 4)}` };
  }
  return base;
}

/**
 * GP1-R1: attach a prerequisite probe to commands targeting a future-authority
 * edge. Deterministic mix per seed: correct typed ref (ACCEPT), missing
 * (prerequisite-required), wrong kind (prerequisite-wrong-kind), malformed
 * shape (prerequisite-invalid-shape). Never semantically interpreted.
 */
const WRONG_KINDS: Record<PrerequisiteKind, PrerequisiteKind> = {
  "sealed-evidence-ref": "policy-satisfied-ref",
  "policy-satisfied-ref": "accepted-receipt-ref",
  "accepted-receipt-ref": "release-observed-ref",
  "release-observed-ref": "sealed-evidence-ref",
};

function attachPrerequisiteProbe(rnd: () => number, machine: MachineName, to: string, from: () => string, c: Command): Command {
  const edge = edgeFor(machine, from(), to);
  const needed = edge ? prerequisiteKindOf(edge.authority) : undefined;
  if (!needed) return c;
  const roll = rnd();
  const token = (kind: PrerequisiteKind): PrerequisiteRef => ({ kind, ref: `op:gp1.${kind}.seed-token-0123` });
  if (roll < 0.6) return { ...c, prerequisite: token(needed) };                       // correct -> ACCEPT
  if (roll < 0.72) return c;                                                          // missing -> prerequisite-required
  if (roll < 0.86) return { ...c, prerequisite: token(WRONG_KINDS[needed]) };          // wrong kind
  return { ...c, prerequisite: { kind: needed, ref: "OP-INVALID-SHORT!" } };          // invalid shape
}

export interface TraceVector {
  seed: number;
  description: string;
  commands: Command[];
  expected: Decision[];
}

export function generateTrace(seed: number): TraceVector {
  const rnd = mulberry32(seed);
  const rt = new ReferenceRuntime();
  const bountyId = "GP-001";
  const executionId = "exec-1";
  const verificationId = "verif-1";
  const settlementId = "settle-1";
  const entityByMachine: Record<MachineName, string> = {
    bounty: bountyId,
    execution: executionId,
    verification: verificationId,
    settlement: settlementId,
  };
  const commands: Command[] = [];
  const expected: Decision[] = [];

  // seed a valid ClaimRecord for claim attempts (shape-valid; immutability probed later)
  const claim = {
    schema_version: "gp-claim.v1" as const,
    claim_id: `aaaaaaaa-0000-4000-8000-${hex(seed & 0xffff, 12).padStart(12, "0")}`.slice(0, 36),
    bounty_id: bountyId,
    claimant: "agent:gp-agent",
    task_freeze_hash: `sha256:${hex(seed, 8).repeat(8).slice(0, 64)}`,
    claimed_at: rfc3339(0),
  };

  for (let i = 0; i < OPS_PER_TRACE; i++) {
    const machine = MACHINE_NAMES[Math.floor(rnd() * MACHINE_NAMES.length)]!;
    const states = MACHINES[machine].states;
    const c0 = genCommand(rnd, i, entityByMachine[machine], machine, states, () => rt.stateOf(machine, entityByMachine[machine]));
    const c = attachPrerequisiteProbe(rnd, machine, c0.to, () => rt.stateOf(machine, entityByMachine[machine]), c0);
    // attach claim on bounty transitions targeting CLAIMED (claim-record edge)
    if (machine === "bounty" && c.to === "CLAIMED") c.claim = { ...claim };
    commands.push(c);
    expected.push(rt.submit(c));
  }
  return {
    seed,
    description: `seeded mixed legal/illegal/idempotent/conflict/terminal trace (seed ${seed}, ${OPS_PER_TRACE} ops)`,
    commands,
    expected,
  };
}

export function generateAllTraces(): TraceVector[] {
  return TRACE_SEEDS.map((s) => generateTrace(s));
}
