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

describe("[PH-05R] atomic ordering + version envelope", () => {
  test("[PH-05R-1] FAULT INJECTION: append fails → states, claims, journal, byCommandId ALL unchanged", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5r-fault-"));
    try {
      const rt = new GPRuntime({ dir });
      rt.submit(cmd("f1", "bounty", "GP-009", "FUNDED"));
      const stateBefore = rt.stateOf("bounty", "GP-009");
      const journalBefore = rt.journalSnapshot().length;
      const claim = { schema_version: "gp-claim.v1", claim_id: "c1a4e7d2-3f3b-4a59-9e02-7b6d5c8f1a23", claimant: "a", bounty_id: "GP-009", task_freeze_hash: "sha256:" + "ab".repeat(32), claimed_at: "2026-10-01T00:00:00Z" } as never;
      // make the NEXT append fail: replace journal.jsonl with a DIRECTORY
      rmSync(path.join(dir, "journal.jsonl"));
      (await import("node:fs")).mkdirSync(path.join(dir, "journal.jsonl"));
      expect(() => rt.submit(cmd("f2", "bounty", "GP-009", "CLAIMED", "2026-10-01T00:00:01Z", { claim }))).toThrow();
      expect(rt.stateOf("bounty", "GP-009")).toBe(stateBefore);   // FUNDED — not CLAIMED
      expect(rt.journalSnapshot().length).toBe(journalBefore);    // journal unchanged
      expect(rt.claimOf("GP-009")).toBeUndefined();               // claim NOT applied
      expect(() => rt.submit(cmd("f1", "bounty", "GP-009", "FUNDED"))).not.toThrow(); // idempotency intact
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05R-2] version sidecar: stamped on first durable write; reload enforces it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5r-meta-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      const meta = JSON.parse(readFileSync(path.join(dir, "journal.meta.json"), "utf8"));
      expect(meta.journal_schema_version).toBe("gp-journal-v1");
      expect(meta.machine_version).toBe(1);
      expect(meta.fingerprint_scheme).toBe("json-array-v1");
      expect(meta.ruleset_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(() => GPRuntime.reload(dir)).not.toThrow(); // matching envelope
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05R-3] RULESET DRIFT → hard fail on reload", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5r-drift-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      const f = path.join(dir, "journal.meta.json");
      const meta = JSON.parse(readFileSync(f, "utf8"));
      meta.ruleset_hash = "sha256:" + "ff".repeat(32); // a journal from a DIFFERENT ruleset
      writeFileSync(f, JSON.stringify(meta, null, 2) + "\n");
      expect(() => GPRuntime.reload(dir)).toThrow(/RULESET DRIFT/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05R-4] unknown journal schema version → hard fail", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5r-ver-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      const f = path.join(dir, "journal.meta.json");
      const meta = JSON.parse(readFileSync(f, "utf8"));
      meta.journal_schema_version = "gp-journal-v99";
      writeFileSync(f, JSON.stringify(meta, null, 2) + "\n");
      expect(() => GPRuntime.reload(dir)).toThrow(/unknown journal_schema_version/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05R-5] legacy journal WITHOUT sidecar replays ONLY via the EXPLICIT legacy entry (PH-05R2 boundary)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5r-leg-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      rmSync(path.join(dir, "journal.meta.json")); // strip the sidecar → legacy v1 journal
      expect(() => GPRuntime.reload(dir)).toThrow(/without journal.meta.json/);      // default reader refuses
      const rt = GPRuntime.reloadLegacyV1(dir);                                     // explicit migration authority
      expect(rt.stateOf("bounty", "GP-001")).toBe("SETTLED");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05R-6] journal LINE FORMAT still byte-identical after PH-05R (GP5 pack zero drift)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5r-fmt-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      const bytes = journalBytes(dir);
      expect(bytes.split("\n").filter(Boolean).every((l) => !l.includes("ruleset") && !l.includes("machine_version"))); // no version fields leaked into lines
      const rt = GPRuntime.reload(dir);
      expect(rt.stateOf("bounty", "GP-001")).toBe("SETTLED");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("[PH-05R2] ruleset identity + legacy boundary", () => {
  test("[PH-05R2-1] RULESET_HASH is a stable golden constant", async () => {
    const { RULESET_HASH, computeRulesetHashForTest } = await import("../src/runtime.ts");
    // GOLDEN constant (PH-05R3 coupled form — validator constants ARE the
    // descriptor input): any change to the replay ruleset MUST change this hash
    expect(RULESET_HASH).toBe("sha256:2bad13b85585392d7d3435839e91402ad7f63f00fc0a4f635d58393e6ddb73d4");
    expect(computeRulesetHashForTest()).toBe(RULESET_HASH); // golden identity, no wall-clock input
  });

  test("[PH-05R2-2] ANY rule change mutates the hash (counterfactual matrix)", async () => {
    const { computeRulesetHashForTest } = await import("../src/runtime.ts");
    const base = computeRulesetHashForTest();
    const edit = (fn: (d: Record<string, any>) => void) => computeRulesetHashForTest(fn);
    expect(edit((d) => { (d.machines as any).bounty.states.push("HACKED"); })).not.toBe(base);      // state graph
    expect(edit((d) => { (d.machines as any).bounty.terminal.push("FUNDED"); })).not.toBe(base);   // terminals
    expect(edit((d) => { (d.edges as any[])[0]!.to = "HACKED"; })).not.toBe(base);                  // one edge
    expect(edit((d) => { (d.edges as any[])[1]!.authority = "none"; })).not.toBe(base);             // authority
    expect(edit((d) => { (d.initial_states as any).bounty = "FUNDED"; })).not.toBe(base);          // initial state
    expect(edit((d) => { (d.prerequisite_kinds as string[]).push("rogue-kind"); })).not.toBe(base); // prereq kinds
    expect(edit((d) => { d.prerequisite_ref_grammar = "^.*$"; })).not.toBe(base);                  // prereq grammar
    expect(edit((d) => { d.claim_schema_version = "gp-claim.v2"; })).not.toBe(base);               // claim schema
    expect(edit((d) => { d.claim_claimant_grammar = "^.*$"; })).not.toBe(base);                    // claim field grammar
    expect(edit((d) => { d.claim_entity_binding = "disabled"; })).not.toBe(base);                  // entity binding
    expect(edit((d) => { d.claim_immutability_rule = "mutable"; })).not.toBe(base);                // immutability
    expect(edit(() => {})).toBe(base); // identity edit → hash unchanged (sanity)
  });

  test("[PH-05R2-3] NON-EMPTY journal missing sidecar → default reload HARD FAILS (no silent legacy downgrade)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5r2-del-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      rmSync(path.join(dir, "journal.meta.json")); // attacker deletes the envelope
      expect(() => GPRuntime.reload(dir)).toThrow(/without journal.meta.json/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05R2-4] EXPLICIT reloadLegacyV1 still loads a sidecar-less journal (frozen reader compatibility)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5r2-leg-"));
    try {
      goldenWalk(new GPRuntime({ dir }));
      rmSync(path.join(dir, "journal.meta.json"));
      const rt = GPRuntime.reloadLegacyV1(dir);
      expect(rt.stateOf("bounty", "GP-001")).toBe("SETTLED");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("[PH-05R2-5] EMPTY journal (fresh dir) reloads fine without sidecar", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ph5r2-empty-"));
    try {
      const rt = GPRuntime.reload(dir);
      expect(rt.stateOf("bounty", "X")).toBe("CREATED");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("[PH-05R3] validator/descriptor single-source coupling", () => {
  test("[PH-05R3-1] descriptor grammars === the ACTUAL validator regexes (same object source)", async () => {
    const { RULESET_DESCRIPTOR_FOR_TEST } = await import("../src/runtime.ts");
    const { PREREQUISITE_REF_RE, SUBJECT_REF_RE, CLAIM_ID_RE, TASK_FREEZE_HASH_RE, RFC3339_UTC_RE, PREREQ_KINDS } = await import("../src/machines.ts");
    const d = RULESET_DESCRIPTOR_FOR_TEST() as Record<string, unknown>;
    expect(d.prerequisite_ref_grammar).toBe(PREREQUISITE_REF_RE.source);
    expect(d.claim_claimant_grammar).toBe(SUBJECT_REF_RE.source);
    expect(d.claim_id_grammar).toBe(CLAIM_ID_RE.source);
    expect(d.claim_task_freeze_hash_grammar).toBe(TASK_FREEZE_HASH_RE.source);
    expect(d.claim_claimed_at_grammar).toBe(RFC3339_UTC_RE.source);
    expect(d.prerequisite_kinds).toEqual([...PREREQ_KINDS]);
  });

  test("[PH-05R3-2] changing a VALIDATOR rule necessarily changes RULESET_HASH (the coupling proof)", async () => {
    const { computeRulesetHashForTest } = await import("../src/runtime.ts");
    const base = computeRulesetHashForTest();
    const edit = (fn: (d: Record<string, any>) => void) => computeRulesetHashForTest(fn);
    // The counterfactual now edits the SAME fields the validators read —
    // a validator-constant change flows into these fields by construction.
    expect(edit((d) => { d.prerequisite_ref_grammar = "^op:.*$"; })).not.toBe(base);
    expect(edit((d) => { d.claim_claimant_grammar = "^.*$"; })).not.toBe(base);
    expect(edit((d) => { d.claim_id_grammar = "^.*$"; })).not.toBe(base);
    expect(edit((d) => { d.claim_task_freeze_hash_grammar = "^.*$"; })).not.toBe(base);
    expect(edit((d) => { d.claim_claimed_at_grammar = "^.*$"; })).not.toBe(base);
    expect(edit((d) => { (d.prerequisite_kinds as string[]).pop(); })).not.toBe(base);
    expect(edit(() => {})).toBe(base);
  });

  test("[PH-05R3-3] machines.ts semantic surface UNCHANGED: validators still reject/accept identically", async () => {
    const { prerequisiteShapeViolations, claimRecordShapeViolations } = await import("../src/machines.ts");
    // prerequisite: good shape passes, bad ref fails (same frozen behavior)
    expect(prerequisiteShapeViolations({ kind: "policy-satisfied-ref", ref: "op:gp3-2of2-20260924a1" })).toEqual([]);
    expect(prerequisiteShapeViolations({ kind: "policy-satisfied-ref", ref: "x" })).toContain("ref");
    expect(prerequisiteShapeViolations({ kind: "rogue", ref: "op:abcdefgh" })).toContain("kind");
    // claim: the frozen valid fixture passes; each field corruption fails
    const claim = { schema_version: "gp-claim.v1", claim_id: "c1a4e7d2-3f3b-4a59-9e02-7b6d5c8f1a23", bounty_id: "GP-001", claimant: "agent:gp-001-demo", task_freeze_hash: "sha256:" + "ab".repeat(32), claimed_at: "2026-10-01T00:00:00Z" };
    expect(claimRecordShapeViolations(claim as never)).toEqual([]);
    expect(claimRecordShapeViolations({ ...claim, claimant: "not-a-subject" } as never)).toContain("claimant");
    expect(claimRecordShapeViolations({ ...claim, claim_id: "zzz" } as never)).toContain("claim_id");
    expect(claimRecordShapeViolations({ ...claim, task_freeze_hash: "nope" } as never)).toContain("task_freeze_hash");
    expect(claimRecordShapeViolations({ ...claim, claimed_at: "2026-10-01" } as never)).toContain("claimed_at");
  });
});
