/**
 * GP1 INDEPENDENT MODEL ORACLE (Builder D, Issue #12 §A).
 *
 * Derived ONLY from docs/GOLDEN-PATH-V1.md @ a1d9749 §3 (+ GATES.md GP1
 * bullets) — no Builder C code inspected or imported. Every guard carries its
 * contract citation. This module is the expected-behavior model the future
 * thin black-box adapter will drive Builder C's runtime against.
 */

export type BountyState = "CREATED" | "FUNDED" | "CLAIMED" | "EXECUTING" | "SUBMITTED" | "VERIFIED" | "SETTLED";
export type ExecutionState = "CREATED" | "RUNNING" | "SUBMITTED" | "CLOSED";
export type VerificationState = "PENDING" | "ACCEPTED" | "REJECTED";
export type SettlementState = "LOCKED" | "ELIGIBLE" | "RELEASED";

export type MachineName = "bounty" | "execution" | "verification" | "settlement";

/** Authority an edge requires BEFORE it may succeed. "none" = pure state machine legality. */
export type EdgeAuthority =
  | "none"
  | "claim-record" // §3 Claim binding: CLAIMED requires immutable ClaimRecord append
  | "sealed-evidence-bundle" // §3 invariant: no SEALED EvidenceBundle -> no verification acceptance (GATES GP1)
  | "accepted-outcome-receipt" // §3 invariant: no accepted OutcomeReceipt -> settlement cannot become ELIGIBLE (GATES GP1)
  ;

export interface Edge {
  machine: MachineName;
  from: string;
  to: string;
  authority: EdgeAuthority;
  citation: string;
}

/** §3 state graphs. Order is normative (linear chains). */
export const MACHINES: Record<MachineName, { states: string[]; terminal: string[] }> = {
  bounty: {
    states: ["CREATED", "FUNDED", "CLAIMED", "EXECUTING", "SUBMITTED", "VERIFIED", "SETTLED"],
    terminal: ["SETTLED"],
  },
  execution: {
    states: ["CREATED", "RUNNING", "SUBMITTED", "CLOSED"],
    terminal: ["CLOSED"],
  },
  verification: {
    states: ["PENDING", "ACCEPTED", "REJECTED"],
    // §3: PENDING -> ACCEPTED | REJECTED; both outcomes are terminal.
    terminal: ["ACCEPTED", "REJECTED"],
  },
  settlement: {
    states: ["LOCKED", "ELIGIBLE", "RELEASED"],
    terminal: ["RELEASED"],
  },
};

export const EDGES: Edge[] = [
  { machine: "bounty", from: "CREATED", to: "FUNDED", authority: "none", citation: "GP-V1 §3 Bounty" },
  { machine: "bounty", from: "FUNDED", to: "CLAIMED", authority: "claim-record", citation: "GP-V1 §3 Claim binding" },
  { machine: "bounty", from: "CLAIMED", to: "EXECUTING", authority: "none", citation: "GP-V1 §3 Bounty" },
  { machine: "bounty", from: "EXECUTING", to: "SUBMITTED", authority: "none", citation: "GP-V1 §3 Bounty" },
  { machine: "bounty", from: "SUBMITTED", to: "VERIFIED", authority: "sealed-evidence-bundle", citation: "GATES GP1 + GP-V1 §3 invariant" },
  { machine: "bounty", from: "VERIFIED", to: "SETTLED", authority: "accepted-outcome-receipt", citation: "GATES GP1 + GP-V1 §3 invariant" },
  { machine: "execution", from: "CREATED", to: "RUNNING", authority: "none", citation: "GP-V1 §3 Execution" },
  { machine: "execution", from: "RUNNING", to: "SUBMITTED", authority: "none", citation: "GP-V1 §3 Execution" },
  { machine: "execution", from: "SUBMITTED", to: "CLOSED", authority: "none", citation: "GP-V1 §3 Execution" },
  { machine: "verification", from: "PENDING", to: "ACCEPTED", authority: "sealed-evidence-bundle", citation: "GATES GP1 + GP-V1 §3 invariant (no SEALED bundle -> no acceptance)" },
  { machine: "verification", from: "PENDING", to: "REJECTED", authority: "none", citation: "GP-V1 §3 Verification" },
  { machine: "settlement", from: "LOCKED", to: "ELIGIBLE", authority: "accepted-outcome-receipt", citation: "GATES GP1 + GP-V1 §3 invariant" },
  { machine: "settlement", from: "ELIGIBLE", to: "RELEASED", authority: "accepted-outcome-receipt", citation: "GP-V1 §3 Settlement + §7 (release authority is the receipt)" },
];

export function edgeFor(machine: MachineName, from: string, to: string): Edge | undefined {
  return EDGES.find((e) => e.machine === machine && e.from === from && e.to === to);
}

export function isLegalPair(machine: MachineName, from: string, to: string): boolean {
  return edgeFor(machine, from, to) !== undefined;
}

export function isTerminal(machine: MachineName, state: string): boolean {
  return MACHINES[machine].terminal.includes(state);
}

/**
 * GP1 scope reality: authorities beyond the pure state graph (SEALED bundle,
 * accepted receipt) CANNOT exist inside GP1 scope (GATES GP1 forbids building
 * them), so their edges are negative-only at GP1 — every attempt without the
 * authority MUST be rejected. Positive reachability of those edges is a
 * GP2+/GP3 concern.
 */
export function authorityAvailableInGP1(a: EdgeAuthority): boolean {
  return a === "none" || a === "claim-record";
}

/** All legal edges. */
export function legalEdges(): Edge[] {
  return [...EDGES];
}

/** Every illegal ordered state pair per machine (from != to AND from == to are both illegal unless an edge exists). */
export function illegalPairs(): Array<{ machine: MachineName; from: string; to: string }> {
  const out: Array<{ machine: MachineName; from: string; to: string }> = [];
  for (const [machine, m] of Object.entries(MACHINES) as Array<[MachineName, { states: string[] }]>) {
    for (const from of m.states) {
      for (const to of m.states) {
        if (!isLegalPair(machine, from, to)) out.push({ machine, from, to });
      }
    }
  }
  return out;
}

/** Terminal states have NO legal outgoing edge — any transition attempt from them must be rejected. */
export function terminalNegatives(): Array<{ machine: MachineName; from: string }> {
  const out: Array<{ machine: MachineName; from: string }> = [];
  for (const [machine, m] of Object.entries(MACHINES) as Array<[MachineName, { states: string[]; terminal: string[] }]>) {
    for (const from of m.terminal) out.push({ machine, from });
  }
  return out;
}

export const MODEL_COUNTS = {
  machines: 4,
  states: Object.values(MACHINES).reduce((n, m) => n + m.states.length, 0),
  legalEdges: EDGES.length,
  illegalPairs: illegalPairs().length,
  terminalNegatives: terminalNegatives().length,
} as const;
