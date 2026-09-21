import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { EDGES, MACHINES, type MachineName, type PrerequisiteKind, type PrerequisiteRef } from "../src/machines.js";
import { GPRuntime, type Command } from "../src/runtime.js";

/**
 * GP1 runtime self-tests — written from GATES GP1 PASS bullets + GP-V1 §3.
 * The independent replay gate (frozen packages/gp1-verifier oracle + adapter)
 * re-verifies all of this black-box at candidate time; these tests are the
 * implementation's own first-line evidence.
 */

const claim = (bountyId = "GP-001") => ({
  schema_version: "gp-claim.v1" as const,
  claim_id: "11111111-2222-4333-8444-555555555555",
  bounty_id: bountyId,
  claimant: "agent:gp-agent",
  task_freeze_hash: "sha256:" + "ab".repeat(32),
  claimed_at: "2026-09-21T00:00:00Z",
});

const token = (kind: PrerequisiteKind): PrerequisiteRef => ({ kind, ref: "op:gp1.runtime.token-0123" });

const cmd = (over: Partial<Command> & Pick<Command, "command_id" | "machine" | "entity" | "to">): Command => ({
  op: "transition", at: "2026-09-21T00:00:01Z", ...over,
});

describe("[RT-1] state machines", () => {
  test("[RT-1.1] all 13 legal edges positively reachable (GP1-R1 opaque refs on future-authority edges)", () => {
    const rt = new GPRuntime();
    const walk: Array<[string, string, PrerequisiteKind?]> = [
      ["b1", "FUNDED"], ["b2", "CLAIMED"], ["b3", "EXECUTING"], ["b4", "SUBMITTED"],
      ["b5", "VERIFIED", "policy-satisfied-ref"], ["b6", "SETTLED", "release-observed-ref"],
    ];
    for (const [id, to, kind] of walk) {
      const c = cmd({ command_id: id, machine: "bounty", entity: "GP-001", to, ...(kind ? { prerequisite: token(kind) } : {}) });
      if (to === "CLAIMED") c.claim = claim();
      expect(rt.submit(c).accepted, `bounty -> ${to}`).toBe(true);
    }
    for (const [id, to] of [["e1", "RUNNING"], ["e2", "SUBMITTED"], ["e3", "CLOSED"]] as const) {
      expect(rt.submit(cmd({ command_id: id, machine: "execution", entity: "e", to })).accepted).toBe(true);
    }
    expect(rt.submit(cmd({ command_id: "v1", machine: "verification", entity: "v", to: "ACCEPTED", prerequisite: token("sealed-evidence-ref") })).accepted).toBe(true);
    expect(rt.submit(cmd({ command_id: "v2", machine: "verification", entity: "v2", to: "REJECTED" })).accepted).toBe(true);
    expect(rt.submit(cmd({ command_id: "s1", machine: "settlement", entity: "s", to: "ELIGIBLE", prerequisite: token("accepted-receipt-ref") })).accepted).toBe(true);
    expect(rt.submit(cmd({ command_id: "s2", machine: "settlement", entity: "s", to: "RELEASED", prerequisite: token("release-observed-ref") })).accepted).toBe(true);
  });

  test("[RT-1.2] exhaustive illegal state pairs rejected (70) + terminals reject everything", () => {
    let illegal = 0;
    for (const [machine, m] of Object.entries(MACHINES) as Array<[MachineName, { states: string[]; terminal: string[] }]>) {
      for (const from of m.states) {
        // walk a private entity to `from`
        const rt = new GPRuntime();
        let i = 0;
        while (rt.stateOf(machine, "x") !== from && i < m.states.length) {
          const cur = rt.stateOf(machine, "x");
          // jump directly to the target when a legal edge exists (branch siblings
          // like verification REJECTED are not the "next" state in chain order);
          // otherwise advance one step along the chain
          const direct = EDGES.some((e) => e.machine === machine && e.from === cur && e.to === from);
          const next = direct ? from : m.states[m.states.indexOf(cur) + 1];
          if (!next) break;
          const edge = EDGES.find((e) => e.machine === machine && e.from === cur && e.to === next);
          if (!edge) break;
          const c = cmd({ command_id: `w${i}`, machine, entity: "x", to: next });
          if (edge.authority === "claim-record") c.claim = claim("x");
          const needed = ["sealed-evidence-ref", "policy-satisfied-ref", "accepted-receipt-ref", "release-observed-ref"].includes(edge.authority)
            ? (edge.authority as PrerequisiteKind) : undefined;
          if (needed) c.prerequisite = token(needed);
          if (!rt.submit(c).accepted) break;
          i++;
        }
        if (rt.stateOf(machine, "x") !== from) continue;
        for (const to of m.states) {
          if (EDGES.some((e) => e.machine === machine && e.from === from && e.to === to)) continue;
          const d = rt.submit(cmd({ command_id: `p${illegal}`, machine, entity: "x", to }));
          expect(d.accepted, `${machine} ${from}->${to} must be rejected`).toBe(false);
          expect(m.terminal.includes(from) ? d.reason : "illegal-pair").toBe(m.terminal.includes(from) ? "terminal-source" : "illegal-pair");
          illegal++;
        }
      }
    }
    expect(illegal).toBe(70);
  });
});

describe("[RT-2] prerequisites (GP1-R1)", () => {
  test("[RT-2.1] tri-state: missing / wrong-kind / bad-shape REJECT; correct typed ref ACCEPT and is journaled", () => {
    const fresh = () => new GPRuntime();
    const m: PrerequisiteKind = "sealed-evidence-ref";
    expect(fresh().submit(cmd({ command_id: "a", machine: "verification", entity: "v", to: "ACCEPTED" })).reason).toBe("prerequisite-required");
    expect(fresh().submit(cmd({ command_id: "a", machine: "verification", entity: "v", to: "ACCEPTED", prerequisite: { kind: "policy-satisfied-ref", ref: "op:x.kind-wrong-0123" } })).reason).toBe("prerequisite-wrong-kind");
    expect(fresh().submit(cmd({ command_id: "a", machine: "verification", entity: "v", to: "ACCEPTED", prerequisite: { kind: m, ref: "BAD" } })).reason).toBe("prerequisite-invalid-shape");
    const rt = fresh();
    const d = rt.submit(cmd({ command_id: "a", machine: "verification", entity: "v", to: "ACCEPTED", prerequisite: token(m) }));
    expect(d.accepted).toBe(true);
    expect(rt.journalSnapshot()[0]!.prerequisite).toEqual(token(m));
    // LOCKED->RELEASED skipping ELIGIBLE stays illegal even with a correct ref
    expect(new GPRuntime().submit(cmd({ command_id: "skip", machine: "settlement", entity: "s", to: "RELEASED", prerequisite: token("release-observed-ref") })).reason).toBe("illegal-pair");
  });
});

describe("[RT-3] idempotency / conflict / journal", () => {
  test("[RT-3.1] same command_id + same payload: same decision, single journal event; different payload: conflicting-command, no event", () => {
    const rt = new GPRuntime();
    const c = cmd({ command_id: "i1", machine: "execution", entity: "e", to: "RUNNING" });
    const d1 = rt.submit(c);
    expect(rt.submit({ ...c })).toEqual(d1);
    expect(rt.journalSnapshot()).toHaveLength(1);
    const len = rt.journalSnapshot().length;
    const cf = rt.submit(cmd({ command_id: "i1", machine: "execution", entity: "e", to: "SUBMITTED" }));
    expect(cf.reason).toBe("conflicting-command");
    expect(rt.journalSnapshot()).toHaveLength(len);
  });

  test("[RT-3.2] append-only: seq strictly monotonic, earlier entries immutable across later ops", () => {
    const rt = new GPRuntime();
    rt.submit(cmd({ command_id: "j1", machine: "execution", entity: "e", to: "RUNNING" }));
    rt.submit(cmd({ command_id: "j2", machine: "execution", entity: "e", to: "SUBMITTED" }));
    const snap = rt.journalSnapshot();
    rt.submit(cmd({ command_id: "j3", machine: "execution", entity: "e", to: "CREATED" })); // rejected, still journaled
    const snap2 = rt.journalSnapshot();
    expect(snap2.slice(0, 2)).toEqual(snap);
    expect(snap2.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe("[RT-4] ClaimRecord", () => {
  test("[RT-4.1] append at CLAIMED; shape-invalid never appended; immutability on later attempts", () => {
    const rt = new GPRuntime();
    rt.submit(cmd({ command_id: "c0", machine: "bounty", entity: "GP-001", to: "FUNDED" }));
    expect(rt.submit(cmd({ command_id: "c1a", machine: "bounty", entity: "GP-001", to: "CLAIMED" })).reason).toBe("claim-required");
    const bad = { ...claim(), claimant: "user:alice@evil" };
    expect(rt.submit(cmd({ command_id: "c1b", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: bad })).reason).toBe("invalid-claim-shape");
    expect(rt.claimOf("GP-001")).toBeUndefined();
    expect(rt.submit(cmd({ command_id: "c1", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: claim() })).accepted).toBe(true);
    expect(rt.claimOf("GP-001")).toEqual(claim());
    // same command_id replay with mutated claim -> conflict + record unchanged
    const mutated = { ...claim(), claim_id: "99999999-2222-4333-8444-555555555555" };
    expect(rt.submit(cmd({ command_id: "c1", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: mutated })).reason).toBe("conflicting-command");
    expect(rt.claimOf("GP-001")).toEqual(claim());
  });
});

describe("[RT-5] persistence, crash & reload (isolated temp dir)", () => {
  test("[RT-5.1] durable journal; reload from a fresh instance reproduces state/claims/journal; every prefix converges", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gp1-rt-"));
    try {
      const rt = new GPRuntime({ dir });
      rt.submit(cmd({ command_id: "d1", machine: "bounty", entity: "GP-001", to: "FUNDED" }));
      rt.submit(cmd({ command_id: "d2", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: claim() }));
      rt.submit(cmd({ command_id: "d3", machine: "execution", entity: "e", to: "RUNNING" }));
      rt.submit(cmd({ command_id: "d4", machine: "settlement", entity: "s", to: "ELIGIBLE", prerequisite: token("accepted-receipt-ref") }));
      // simulate a crash: a NEW process reloads from disk
      const reloaded = GPRuntime.reload(dir);
      expect(reloaded.stateOf("bounty", "GP-001")).toBe("CLAIMED");
      expect(reloaded.claimOf("GP-001")).toEqual(claim());
      expect(reloaded.stateOf("settlement", "s")).toBe("ELIGIBLE");
      expect(reloaded.journalSnapshot()).toEqual(rt.journalSnapshot());
      // crash at every prefix: truncate the journal file and reload
      const full = rt.journalSnapshot();
      for (let k = 0; k <= full.length; k++) {
        const partial = GPRuntime.fold(full.slice(0, k));
        expect(partial.stateOf("bounty", "GP-001"), `prefix ${k}`).toBe(k >= 2 ? "CLAIMED" : k >= 1 ? "FUNDED" : "CREATED");
      }
      // retry after crash-after-commit: same command => same decision, no duplicate
      const retry = reloaded.submit(cmd({ command_id: "d3", machine: "execution", entity: "e", to: "RUNNING" }));
      expect(retry.accepted).toBe(true);
      expect(reloaded.journalSnapshot().filter((e) => e.decision.command_id === "d3")).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("[RT-5.2] no wall-clock and no verifier-package imports anywhere in gp-runtime sources", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scan = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? scan(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : [],
      );
    for (const f of scan(path.resolve(here, "../src"))) {
      const src = readFileSync(f, "utf8");
      expect(src.includes("Date.now"), `${f} must not read a wall clock`).toBe(false);
      expect(src.match(/from\s+["'][^"']*gp1-verifier/), `${f} must not import the verifier oracle`).toBeNull();
    }
  });
});
