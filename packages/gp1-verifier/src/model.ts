/**
 * GP1 INDEPENDENT MODEL ORACLE (Builder D, Issue #12 §A).
 *
 * Derived ONLY from docs/GOLDEN-PATH-V1.md @ a1d9749 §3 (+ GATES.md GP1
 * bullets) and the Commander ruling **GP1-R1 (Reachability ≠ Authority
 * Implementation)**: all 13 legal edges MUST be positively reachable inside
 * GP1; future-authority edges (verification acceptance, eligibility, release,
 * settle) are exercised through TYPED OPAQUE PREREQUISITE REFS. GP1 validates
 * only ref existence / kind / shape / replay stability — NEVER the semantic
 * validity of the referenced authority (that is GP2–GP4's job). No Builder C
 * code inspected or imported.
 */

export type BountyState = "CREATED" | "FUNDED" | "CLAIMED" | "EXECUTING" | "SUBMITTED" | "VERIFIED" | "SETTLED";
export type ExecutionState = "CREATED" | "RUNNING" | "SUBMITTED" | "CLOSED";
export type VerificationState = "PENDING" | "ACCEPTED" | "REJECTED";
export type SettlementState = "LOCKED" | "ELIGIBLE" | "RELEASED";

export type MachineName = "bounty" | "execution" | "verification" | "settlement";

/**
 * Typed opaque prerequisite refs (GP1-R1). `ref` payload is opaque — GP1 never
 * interprets it; only kind + shape are checked.
 */
export type PrerequisiteKind =
  | "sealed-evidence-ref" // §3 invariant: no SEALED EvidenceBundle -> no verification acceptance
  | "policy-satisfied-ref" // §3: verification-policy satisfaction precedes the VERIFIED verdict
  | "accepted-receipt-ref" // §3 invariant + §7: no accepted OutcomeReceipt -> no ELIGIBLE
  | "release-observed-ref" // §7/§3: release/settlement completion observation (ledger reachability only — ZERO real side effects)
  ;

/** Authority an edge requires BEFORE it may succeed. "none" = pure state machine legality. */
export type EdgeAuthority =
  | "none"
  | "claim-record" // §3 Claim binding: CLAIMED requires immutable ClaimRecord append
  | PrerequisiteKind // typed opaque prerequisite ref (GP1-R1)
  ;

export const PREREQUISITE_KINDS: readonly PrerequisiteKind[] = [
  "sealed-evidence-ref",
  "policy-satisfied-ref",
  "accepted-receipt-ref",
  "release-observed-ref",
];

/** Opaque token grammar: kind-checked, shape-checked, never semantically interpreted at GP1. */
export const PREREQUISITE_REF_RE = /^op:[a-z0-9._-]{8,128}$/;

export interface PrerequisiteRef {
  kind: PrerequisiteKind;
  ref: string;
}

export function prerequisiteShapeViolations(p: unknown): string[] {
  const v: string[] = [];
  const o = p as Partial<PrerequisiteRef> | null | undefined;
  if (!o || typeof o !== "object") return ["not-an-object"];
  if (!PREREQUISITE_KINDS.includes(o.kind as PrerequisiteKind)) v.push("kind");
  if (typeof o.ref !== "string" || !PREREQUISITE_REF_RE.test(o.ref)) v.push("ref");
  return v;
}

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
  { machine: "bounty", from: "SUBMITTED", to: "VERIFIED", authority: "policy-satisfied-ref", citation: "GP-V1 §3 invariant 2 + GP1-R1 (opaque policy-satisfied ref)" },
  { machine: "bounty", from: "VERIFIED", to: "SETTLED", authority: "release-observed-ref", citation: "GP-V1 §3/§7 + GP1-R1 (opaque release-observed ref; ledger reachability only)" },
  { machine: "execution", from: "CREATED", to: "RUNNING", authority: "none", citation: "GP-V1 §3 Execution" },
  { machine: "execution", from: "RUNNING", to: "SUBMITTED", authority: "none", citation: "GP-V1 §3 Execution" },
  { machine: "execution", from: "SUBMITTED", to: "CLOSED", authority: "none", citation: "GP-V1 §3 Execution" },
  { machine: "verification", from: "PENDING", to: "ACCEPTED", authority: "sealed-evidence-ref", citation: "GP-V1 §3 invariant 1 + GP1-R1 (opaque sealed-evidence ref)" },
  { machine: "verification", from: "PENDING", to: "REJECTED", authority: "none", citation: "GP-V1 §3 Verification" },
  { machine: "settlement", from: "LOCKED", to: "ELIGIBLE", authority: "accepted-receipt-ref", citation: "GATES GP1 + GP-V1 §3 invariant 3 + GP1-R1 (opaque accepted-receipt ref)" },
  { machine: "settlement", from: "ELIGIBLE", to: "RELEASED", authority: "release-observed-ref", citation: "GP-V1 §3/§7 + GP1-R1 (opaque release-observed ref; NO real escrow/payment side effect)" },
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
 * GP1-R1 (Commander ruling): every legal edge is positively reachable inside
 * GP1 — future-authority edges via typed opaque prerequisite refs. GP1 checks
 * only existence/kind/shape/replay-stability, never semantic validity.
 */
export function prerequisiteKindOf(a: EdgeAuthority): PrerequisiteKind | undefined {
  return PREREQUISITE_KINDS.includes(a as PrerequisiteKind) ? (a as PrerequisiteKind) : undefined;
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
