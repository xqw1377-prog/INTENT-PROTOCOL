/**
 * GP1 FORMAL REPLAY ADAPTER (Builder D tooling, Issue #12 §D).
 *
 * Thin black-box layer: the ONLY module in the verifier that touches the SUT,
 * and it touches ONLY the SUT's public surface (GPRuntime + its exported
 * types) as captured in the frozen snapshot. Oracle files (model/reference/
 * traces/vectors) are untouched and consumed read-only by the formal suite.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as sut from "../sut-snapshot/gp-runtime-src/runtime.js";
import type { Command as SutCommand, Decision as SutDecision, JournalEntry as SutJournalEntry } from "../sut-snapshot/gp-runtime-src/runtime.js";
import type { Command, Decision, JournalEntry } from "../src/reference.js";
import type { ClaimRecord } from "../src/subject.js";

const capture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../sut-snapshot/capture.json", import.meta.url)), "utf8"),
) as { pinned_sha: string; captured_at: string };

export const SUT_META = { pinned_sha: capture.pinned_sha, captured_at: capture.captured_at };

const toSutCommand = (c: Command): SutCommand => ({
  command_id: c.command_id,
  machine: c.machine,
  entity: c.entity,
  op: c.op,
  to: c.to,
  ...(c.claim ? { claim: c.claim } : {}),
  ...(c.prerequisite ? { prerequisite: c.prerequisite } : {}),
  at: c.at,
});

const fromSutDecision = (d: SutDecision): Decision => ({
  command_id: d.command_id,
  accepted: d.accepted,
  ...(d.reason ? { reason: d.reason } : {}),
  machine: d.machine,
  entity: d.entity,
  from: d.from,
  ...(d.to !== undefined ? { to: d.to } : {}),
});

export interface GPRuntimePort {
  submit(c: Command): Decision;
  stateOf(machine: Parameters<typeof sut.GPRuntime.prototype.stateOf>[0], entity: string): string;
  claimOf(bountyId: string): ClaimRecord | undefined;
  journalSnapshot(): JournalEntry[];
}

export function connect(rt: InstanceType<typeof sut.GPRuntime>): GPRuntimePort {
  return {
    submit: (c) => fromSutDecision(rt.submit(toSutCommand(c))),
    stateOf: (m, e) => rt.stateOf(m, e),
    claimOf: (b) => (rt.claimOf(b) ?? undefined) as ClaimRecord | undefined,
    journalSnapshot: () => rt.journalSnapshot() as unknown as JournalEntry[],
  };
}

export const SutRuntime = sut.GPRuntime;
export type SutRuntimeT = InstanceType<typeof sut.GPRuntime>;
export type { SutJournalEntry };
