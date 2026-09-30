/** PH-05 — durable journal integrity machine tests (write format byte-compatible). */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { GPRuntime, fingerprint, type Command } from "../src/runtime.ts";

const cmd = (id: string, machine: "bounty" | "settlement", entity: string, to: string, at = "2026-10-01T00:00:00Z", extra: Partial<Command> = {}): Command =>
  ({ command_id: id, machine, entity, op: "transition", to, at, ...extra });

function goldenWalk(rt: GPRuntime) {
  const claim = { schema_version: "gp-claim.v1", claim_id: "c1a4e7d2-3f3b-4a59-9e02-7b6d5c8f1a23", claimant: "agent:gp-001-demo", bounty_id: "GP-001", task_freeze_hash: "sha256:" + "ab".repeat(32), claimed_at: "2026-10-01T00:00:00Z" } as const;
  rt.submit(cmd("s1", "bounty", "GP-001", "FUNDED"));
  rt.submit(cmd("s2", "bounty", "GP-001", "CLAIMED", "2026-10-01T00:00:01Z", { claim: claim as never }));
  rt.submit(cmd("s3", "bounty", "GP-001", "EXECUTING", "2026-10-01T00:00:02Z"));
  rt.submit(cmd("s4", "bounty", "GP-001", "SUBMITTED", "2026-10-01T00:00:03Z"));
  rt.submit(cmd("s5", "bounty", "GP-001", "VERIFIED", "2026-10-01T00:00:04Z", { prerequisite: { kind: "policy-satisfied-ref", ref: "op:gp3-2of2-20260924a1" } as never }));
  rt.submit(cmd("s6", "bounty", "GP-001", "SETTLED", "2026-10-01T00:00:05Z", { prerequisite: { kind: "release-observed-ref", ref: "op:gp4-release-observed1" } as never }));
  return rt;
}

function journalBytes(dir: string): string { return readFileSync(path.join(dir, "journal.jsonl"), "utf8"); }

describe("[PH-05] durable journal integrity", () => {
  test("[PH-05-1] journal WRITE FORMAT byte-compatible: hardened reload folds the same golden walk to identical bytes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5-a-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      const before = journalBytes(dir);
      const reloaded = GPRuntime.reload(dir);
      expect(reloaded.tornTailDiscarded).toBe(false);
      expect(reloaded.stateOf("bounty", "GP-001")).toBe("SETTLED");
      // a fresh identical walk still produces byte-identical journal (GP5 pack zero drift)
      const dir2 = mkdtempSync(path.join(tmpdir(), "ph5-b-"));
      try {
        goldenWalk(new GPRuntime({ dir: dir2 }));
        expect(journalBytes(dir2)).toBe(before);
      } finally { rmSync(dir2, { recursive: true, force: true }); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05-2] torn FINAL line → discarded with the flag; state folds from the intact prefix", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5-c-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      writeFileSync(path.join(dir, "journal.jsonl"), journalBytes(dir) + '{"seq":7,"at":"2026-10-01T00', "utf8"); // torn tail
      const rt = GPRuntime.reload(dir);
      expect(rt.tornTailDiscarded).toBe(true);
      expect(rt.stateOf("bounty", "GP-001")).toBe("SETTLED");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05-3] torn NON-final line → hard failure", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5-d-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      const lines = journalBytes(dir).split("\n").filter(Boolean);
      lines.splice(2, 0, '{"seq":9,"torn'); // corrupt a middle line
      writeFileSync(path.join(dir, "journal.jsonl"), lines.join("\n") + "\n", "utf8");
      expect(() => GPRuntime.reload(dir)).toThrow(/non-final torn/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05-4] fingerprint tamper → hard failure", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5-e-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      const lines = journalBytes(dir).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
      lines[2]!.payloadFingerprint = JSON.stringify(["bounty", "GP-001", "transition", "FORGED", null, null]);
      writeFileSync(path.join(dir, "journal.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
      expect(() => GPRuntime.reload(dir)).toThrow(/fingerprint mismatch/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05-5] FORGED illegal transition (RUNNING→CLOSED style) → replay refuses to fold", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5-f-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      const lines = journalBytes(dir).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
      // forge an accepted transition that was never legal under the frozen machine
      lines.push({
        seq: 99, at: "2026-10-01T00:09:00Z",
        decision: { command_id: "forge-1", accepted: true, machine: "bounty", entity: "GP-001", from: "SETTLED", to: "CLAIMED" },
        payloadFingerprint: fingerprint({ command_id: "forge-1", machine: "bounty", entity: "GP-001", op: "transition", to: "CLAIMED", at: "2026-10-01T00:09:00Z" }),
      });
      writeFileSync(path.join(dir, "journal.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
      expect(() => GPRuntime.reload(dir)).toThrow(/illegal transition SETTLED→CLAIMED/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05-6] forged accepted transition missing its prerequisite → replay refuses", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5-g-"));
    try {
      const rt = new GPRuntime({ dir });
      rt.submit(cmd("p1", "bounty", "GP-002", "FUNDED"));
      rt.submit(cmd("p2", "bounty", "GP-002", "CLAIMED", "2026-10-01T00:00:01Z", { claim: { schema_version: "gp-claim.v1", claim_id: "c1a4e7d2-3f3b-4a59-9e02-7b6d5c8f1a23", claimant: "a", bounty_id: "GP-002", task_freeze_hash: "sha256:" + "ab".repeat(32), claimed_at: "2026-10-01T00:00:00Z" } as never }));
      rt.submit(cmd("p3", "bounty", "GP-002", "EXECUTING", "2026-10-01T00:00:02Z"));
      rt.submit(cmd("p4", "bounty", "GP-002", "SUBMITTED", "2026-10-01T00:00:03Z"));
      // forge VERIFIED acceptance WITHOUT the policy prerequisite
      const lines = journalBytes(dir).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
      lines.push({
        seq: 5, at: "2026-10-01T00:05:00Z",
        decision: { command_id: "forge-2", accepted: true, machine: "bounty", entity: "GP-002", from: "SUBMITTED", to: "VERIFIED" },
        payloadFingerprint: fingerprint({ command_id: "forge-2", machine: "bounty", entity: "GP-002", op: "transition", to: "VERIFIED", at: "2026-10-01T00:05:00Z" }),
      });
      writeFileSync(path.join(dir, "journal.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
      expect(() => GPRuntime.reload(dir)).toThrow(/journal replay violation at seq 5/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05-7] recorded-from vs replay-state divergence → replay refuses", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5-h-"));
    try {
      const rt = new GPRuntime({ dir });
      rt.submit(cmd("q1", "bounty", "GP-003", "FUNDED"));
      const lines = journalBytes(dir).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
      // forge an accepted transition whose recorded `from` lies about the replay state
      lines.push({
        seq: 2, at: "2026-10-01T00:02:00Z",
        decision: { command_id: "forge-3", accepted: true, machine: "bounty", entity: "GP-003", from: "CLAIMED", to: "EXECUTING" },
        payloadFingerprint: fingerprint({ command_id: "forge-3", machine: "bounty", entity: "GP-003", op: "transition", to: "EXECUTING", at: "2026-10-01T00:02:00Z" }),
      });
      writeFileSync(path.join(dir, "journal.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
      expect(() => GPRuntime.reload(dir)).toThrow(/recorded from=CLAIMED but replay state=FUNDED/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
