/**
 * GP1 runtime state machines (Builder: Zcode, branch zcode/golden-path-implementation).
 *
 * Transcribed from the FROZEN contract docs/GOLDEN-PATH-V1.md @ a1d9749 §3 and
 * the GP1-R1 ruling (typed opaque prerequisite refs). Deliberately does NOT
 * import packages/gp1-verifier/** — the verifier oracle is an independent
 * black-box implementation of the same contract; cross-imports would defeat
 * the replay gate.
 */

export type MachineName = "bounty" | "execution" | "verification" | "settlement";

export type PrerequisiteKind =
  | "sealed-evidence-ref"
  | "policy-satisfied-ref"
  | "accepted-receipt-ref"
  | "release-observed-ref";

export type EdgeAuthority =
  | "none"
  | "claim-record"
  | PrerequisiteKind;

export interface PrerequisiteRef {
  kind: PrerequisiteKind;
  ref: string;
}

export interface Edge {
  machine: MachineName;
  from: string;
  to: string;
  authority: EdgeAuthority;
}

/** §3 state graphs (order is normative). */
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
    terminal: ["ACCEPTED", "REJECTED"],
  },
  settlement: {
    states: ["LOCKED", "ELIGIBLE", "RELEASED"],
    terminal: ["RELEASED"],
  },
};

export const INITIAL_STATE: Record<MachineName, string> = {
  bounty: "CREATED",
  execution: "CREATED",
  verification: "PENDING",
  settlement: "LOCKED",
};

export const EDGES: Edge[] = [
  { machine: "bounty", from: "CREATED", to: "FUNDED", authority: "none" },
  { machine: "bounty", from: "FUNDED", to: "CLAIMED", authority: "claim-record" },
  { machine: "bounty", from: "CLAIMED", to: "EXECUTING", authority: "none" },
  { machine: "bounty", from: "EXECUTING", to: "SUBMITTED", authority: "none" },
  { machine: "bounty", from: "SUBMITTED", to: "VERIFIED", authority: "policy-satisfied-ref" },
  { machine: "bounty", from: "VERIFIED", to: "SETTLED", authority: "release-observed-ref" },
  { machine: "execution", from: "CREATED", to: "RUNNING", authority: "none" },
  { machine: "execution", from: "RUNNING", to: "SUBMITTED", authority: "none" },
  { machine: "execution", from: "SUBMITTED", to: "CLOSED", authority: "none" },
  { machine: "verification", from: "PENDING", to: "ACCEPTED", authority: "sealed-evidence-ref" },
  { machine: "verification", from: "PENDING", to: "REJECTED", authority: "none" },
  { machine: "settlement", from: "LOCKED", to: "ELIGIBLE", authority: "accepted-receipt-ref" },
  { machine: "settlement", from: "ELIGIBLE", to: "RELEASED", authority: "release-observed-ref" },
];

export const PREREQ_KINDS: readonly string[] = [
  "sealed-evidence-ref", "policy-satisfied-ref", "accepted-receipt-ref", "release-observed-ref",
];

/** Opaque token grammar (GP1-R1): kind + shape checked, semantics never interpreted. */
export const PREREQUISITE_REF_RE = /^op:[a-z0-9._-]{8,128}$/;
// PH-05R3: the remaining replay-rule constants are EXPORTED so the
// RULESET_DESCRIPTOR and the validators share ONE source of truth.
export const SUBJECT_REF_RE = /^(user|org|agent|verifier|arbitrator|service|operator):[A-Za-z0-9._-]{1,128}$/;
export const CLAIM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const TASK_FREEZE_HASH_RE = /^sha256:[0-9a-f]{64}$/;
export const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function edgeFor(machine: MachineName, from: string, to: string): Edge | undefined {
  return EDGES.find((e) => e.machine === machine && e.from === from && e.to === to);
}

export function isTerminal(machine: MachineName, state: string): boolean {
  return MACHINES[machine].terminal.includes(state);
}

export function prerequisiteKindOf(a: EdgeAuthority): PrerequisiteKind | undefined {
  return PREREQ_KINDS.includes(a) ? (a as PrerequisiteKind) : undefined;
}

export function prerequisiteShapeViolations(p: unknown): string[] {
  const o = p as Partial<PrerequisiteRef> | null | undefined;
  if (!o || typeof o !== "object") return ["not-an-object"];
  const v: string[] = [];
  if (!PREREQ_KINDS.includes(o.kind as string)) v.push("kind");
  if (typeof o.ref !== "string" || !PREREQUISITE_REF_RE.test(o.ref)) v.push("ref");
  return v;
}

/** ClaimRecord (GP0 §3 Claim binding). */
export interface ClaimRecord {
  schema_version: "gp-claim.v1";
  claim_id: string;
  bounty_id: string;
  claimant: string;
  task_freeze_hash: string;
  claimed_at: string;
}

const UUID_RE = CLAIM_ID_RE; // single source (PH-05R3): alias, not a second copy

export function claimRecordShapeViolations(c: Partial<ClaimRecord>): string[] {
  const v: string[] = [];
  if (c.schema_version !== "gp-claim.v1") v.push("schema_version");
  if (typeof c.claim_id !== "string" || !UUID_RE.test(c.claim_id)) v.push("claim_id");
  if (typeof c.bounty_id !== "string" || c.bounty_id.length === 0) v.push("bounty_id");
  if (typeof c.claimant !== "string" || !SUBJECT_REF_RE.test(c.claimant)) v.push("claimant");
  if (typeof c.task_freeze_hash !== "string" || !TASK_FREEZE_HASH_RE.test(c.task_freeze_hash)) v.push("task_freeze_hash");
  if (typeof c.claimed_at !== "string" || !RFC3339_UTC_RE.test(c.claimed_at)) v.push("claimed_at");
  return v;
}
