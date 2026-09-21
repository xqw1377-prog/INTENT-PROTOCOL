import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { SUT_META, SutRuntime, connect, type GPRuntimePort } from "../src/adapter.js";
import type { Command, Decision } from "../src/reference.js";
import { edgeFor, illegalPairs, legalEdges, MACHINES, prerequisiteKindOf, type MachineName, type PrerequisiteKind, type PrerequisiteRef } from "../src/model.js";
import type { ClaimRecord } from "../src/subject.js";
import { generateAllTraces } from "../src/traces.js";
import { scopeAudit } from "../src/scope.js";

/**
 * GP1 FORMAL BLACK-BOX REPLAY (Builder D, formal target published by Commander).
 *
 * The SUT is the FROZEN SNAPSHOT of packages/gp-runtime at the pinned SHA
 * (sut-snapshot/capture.json). It is driven ONLY through the thin adapter.
 * The oracle (model/reference/traces/vectors) is consumed read-only; this
 * suite adds evidence, it never adapts the oracle to the SUT. Any
 * disagreement is a FINDING, reported as-is.
 */

export const FORMAL_TARGET = "fc87aa9e09f9ecf72b4bf8e005c3c865a6450999";

const claim = (bountyId: string): ClaimRecord => ({
  schema_version: "gp-claim.v1",
  claim_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  bounty_id: bountyId,
  claimant: "agent:gp-agent",
  task_freeze_hash: "sha256:" + "ab".repeat(32),
  claimed_at: "2026-09-21T00:00:00Z",
});

const token = (kind: PrerequisiteKind): PrerequisiteRef => ({ kind, ref: "op:gp1.formal.token-0123" });

const cmd = (over: Partial<Command> & Pick<Command, "command_id" | "machine" | "entity" | "to">): Command => ({
  op: "transition", at: "2026-09-21T00:00:01Z", ...over,
});

const fresh = (): GPRuntimePort => connect(new SutRuntime());

describe("[GP1-F0] formal target pin", () => {
  test("[F0.1] the frozen SUT snapshot is pinned to the Commander-published formal target", () => {
    expect(SUT_META.pinned_sha, "capture.json pinned_sha").toBe(FORMAL_TARGET);
  });
});

describe("[GP1-F1] 384-vector formal replay (oracle expected decisions, black-box SUT)", () => {
  test("[F1.1] every seeded trace decision sequence reproduces through the adapter, field-for-field", () => {
    const traces = generateAllTraces();
    expect(traces).toHaveLength(8);
    let total = 0;
    for (const t of traces) {
      const port = fresh();
      for (let i = 0; i < t.commands.length; i++) {
        const d = port.submit(t.commands[i]!);
        expect(d, `seed ${t.seed} op ${i}`).toEqual(t.expected[i] as Decision);
        total++;
      }
    }
    expect(total).toBe(384);
  });
});

describe("[GP1-F2] state-graph conformance", () => {
  test("[F2.1] all 13 legal edges positively reachable through the adapter", () => {
    const p = fresh();
    const bountyWalk: Array<[string, string, PrerequisiteKind?]> = [
      ["b1", "FUNDED"], ["b2", "CLAIMED"], ["b3", "EXECUTING"], ["b4", "SUBMITTED"],
      ["b5", "VERIFIED", "policy-satisfied-ref"], ["b6", "SETTLED", "release-observed-ref"],
    ];
    for (const [id, to, kind] of bountyWalk) {
      const c = cmd({ command_id: id, machine: "bounty", entity: "GP-001", to, ...(kind ? { prerequisite: token(kind) } : {}) });
      if (to === "CLAIMED") c.claim = claim("GP-001");
      expect(p.submit(c).accepted, `bounty -> ${to}`).toBe(true);
    }
    for (const [id, to] of [["e1", "RUNNING"], ["e2", "SUBMITTED"], ["e3", "CLOSED"]] as const) {
      expect(p.submit(cmd({ command_id: id, machine: "execution", entity: "e", to })).accepted).toBe(true);
    }
    expect(p.submit(cmd({ command_id: "v1", machine: "verification", entity: "v", to: "ACCEPTED", prerequisite: token("sealed-evidence-ref") })).accepted).toBe(true);
    expect(p.submit(cmd({ command_id: "v2", machine: "verification", entity: "v2", to: "REJECTED" })).accepted).toBe(true);
    expect(p.submit(cmd({ command_id: "s1", machine: "settlement", entity: "s", to: "ELIGIBLE", prerequisite: token("accepted-receipt-ref") })).accepted).toBe(true);
    expect(p.submit(cmd({ command_id: "s2", machine: "settlement", entity: "s", to: "RELEASED", prerequisite: token("release-observed-ref") })).accepted).toBe(true);
    expect(legalEdges()).toHaveLength(13);
  });

  test("[F2.2] exhaustive 70 illegal pairs rejected (branch-sibling sources reached via direct-jump walk)", () => {
    let probed = 0;
    for (const [machine, m] of Object.entries(MACHINES) as Array<[MachineName, { states: string[]; terminal: string[] }]>) {
      for (const from of m.states) {
        const p = fresh();
        let i = 0;
        while (p.stateOf(machine, "x") !== from && i < m.states.length) {
          const cur = p.stateOf(machine, "x");
          const direct = edgeFor(machine, cur, from);
          const next = direct ? from : m.states[m.states.indexOf(cur) + 1];
          if (!next) break;
          const edge = edgeFor(machine, cur, next);
          if (!edge) break;
          const kind = prerequisiteKindOf(edge.authority);
          const c = cmd({ command_id: `w${i}`, machine, entity: "x", to: next, ...(kind ? { prerequisite: token(kind) } : {}) });
          if (edge.authority === "claim-record") c.claim = claim("x");
          if (!p.submit(c).accepted) break;
          i++;
        }
        if (p.stateOf(machine, "x") !== from) continue;
        for (const to of m.states) {
          if (edgeFor(machine, from, to)) continue;
          const d = p.submit(cmd({ command_id: `p${probed}`, machine, entity: "x", to }));
          expect(d.accepted, `${machine} ${from}->${to}`).toBe(false);
          expect(d.reason, `${machine} ${from}->${to}`).toBe(m.terminal.includes(from) ? "terminal-source" : "illegal-pair");
          probed++;
        }
      }
    }
    expect(probed, "all 70 illegal pairs probed").toBe(70);
    expect(illegalPairs()).toHaveLength(70);
  });

  test("[F2.3] prerequisite 4-state probes on every future-authority edge: missing / wrong-kind / invalid-shape REJECT, correct ACCEPT", () => {
    type M = "bounty" | "verification" | "settlement";
    const probe = (walk: (p: GPRuntimePort) => void, to: string, kind: PrerequisiteKind, entity: string, machine: M) => {
      const wrong: PrerequisiteKind = kind === "sealed-evidence-ref" ? "policy-satisfied-ref" : "sealed-evidence-ref";
      const run = () => {
        const p = fresh();
        walk(p);
        return p;
      };
      expect(run().submit(cmd({ command_id: "q1", machine, entity, to })).reason).toBe("prerequisite-required");
      expect(run().submit(cmd({ command_id: "q2", machine, entity, to, prerequisite: token(wrong) })).reason).toBe("prerequisite-wrong-kind");
      expect(run().submit(cmd({ command_id: "q3", machine, entity, to, prerequisite: { kind, ref: "BAD-SHAPE" } })).reason).toBe("prerequisite-invalid-shape");
      expect(run().submit(cmd({ command_id: "q4", machine, entity, to, prerequisite: token(kind) })).accepted).toBe(true);
    };
    const walkBounty = (target: string) => (p: GPRuntimePort) => {
      const chain: Array<[string, string, PrerequisiteKind?]> = [
        ["w1", "FUNDED"], ["w2", "CLAIMED"], ["w3", "EXECUTING"], ["w4", "SUBMITTED"], ["w5", "VERIFIED", "policy-satisfied-ref"],
      ];
      for (const [id, to, kind] of chain) {
        if (MACHINES.bounty.states.indexOf(to) > MACHINES.bounty.states.indexOf(target)) break;
        const c = cmd({ command_id: id, machine: "bounty", entity: "GP-001", to, ...(kind ? { prerequisite: token(kind) } : {}) });
        if (to === "CLAIMED") c.claim = claim("GP-001");
        p.submit(c);
      }
    };
    const walkEligible = (p: GPRuntimePort) => {
      p.submit(cmd({ command_id: "we1", machine: "settlement", entity: "s1", to: "ELIGIBLE", prerequisite: token("accepted-receipt-ref") }));
    };
    probe(() => {}, "ACCEPTED", "sealed-evidence-ref", "v1", "verification");
    probe(walkBounty("SUBMITTED"), "VERIFIED", "policy-satisfied-ref", "GP-001", "bounty");
    probe(walkBounty("VERIFIED"), "SETTLED", "release-observed-ref", "GP-001", "bounty");
    probe(() => {}, "ELIGIBLE", "accepted-receipt-ref", "s1", "settlement");
    probe(walkEligible, "RELEASED", "release-observed-ref", "s1", "settlement");
  });
});

describe("[GP1-F3] idempotency, conflict, ClaimRecord", () => {
  test("[F3.1] same command_id+payload: identical decision, single journal event; different payload: conflicting-command, no event", () => {
    const p = fresh();
    const c = cmd({ command_id: "i1", machine: "execution", entity: "e", to: "RUNNING" });
    const d1 = p.submit(c);
    expect(p.submit({ ...c })).toEqual(d1);
    expect(p.journalSnapshot()).toHaveLength(1);
    const len = p.journalSnapshot().length;
    expect(p.submit(cmd({ command_id: "i1", machine: "execution", entity: "e", to: "SUBMITTED" })).reason).toBe("conflicting-command");
    expect(p.journalSnapshot()).toHaveLength(len);
  });

  test("[F3.2] ClaimRecord: required at CLAIMED, shape-invalid never appends, immutable after append", () => {
    const p = fresh();
    p.submit(cmd({ command_id: "c0", machine: "bounty", entity: "GP-001", to: "FUNDED" }));
    expect(p.submit(cmd({ command_id: "c1a", machine: "bounty", entity: "GP-001", to: "CLAIMED" })).reason).toBe("claim-required");
    const bad = { ...claim("GP-001"), claimant: "user:alice@evil" };
    expect(p.submit(cmd({ command_id: "c1b", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: bad })).reason).toBe("invalid-claim-shape");
    expect(p.claimOf("GP-001")).toBeUndefined();
    expect(p.submit(cmd({ command_id: "c1", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: claim("GP-001") })).accepted).toBe(true);
    expect(p.claimOf("GP-001")).toEqual(claim("GP-001"));
    const mutated = { ...claim("GP-001"), claim_id: "99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
    expect(p.submit(cmd({ command_id: "c1", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: mutated })).reason).toBe("conflicting-command");
    expect(p.claimOf("GP-001")).toEqual(claim("GP-001"));
  });
});

describe("[GP1-F4] crash / reload against the real durable runtime (isolated temp dir)", () => {
  test("[F4.1] journal-file crash at every prefix converges; retry after crash-after-commit is a no-op duplicate-free reload", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gp1-formal-"));
    try {
      const rt = new SutRuntime({ dir });
      const p = connect(rt);
      const script: Command[] = [
        cmd({ command_id: "d1", machine: "bounty", entity: "GP-001", to: "FUNDED" }),
        cmd({ command_id: "d2", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: claim("GP-001") }),
        cmd({ command_id: "d3", machine: "execution", entity: "e", to: "RUNNING" }),
        cmd({ command_id: "d4", machine: "settlement", entity: "s", to: "ELIGIBLE", prerequisite: token("accepted-receipt-ref") }),
        cmd({ command_id: "d5", machine: "settlement", entity: "s", to: "RELEASED", prerequisite: token("release-observed-ref") }),
      ];
      for (const c of script) p.submit(c);
      const journalPath = path.join(dir, "journal.jsonl");
      const fullLines = readFileSync(journalPath, "utf8").split("\n").filter((l) => l.trim());
      expect(fullLines).toHaveLength(5);
      // crash after every prefix: truncate the durable file, reload as a NEW process
      for (let k = 0; k <= fullLines.length; k++) {
        writeFileSync(journalPath, fullLines.slice(0, k).join("\n") + (k > 0 ? "\n" : ""), "utf8");
        const recovered = connect(SutRuntime.reload(dir));
        expect(recovered.stateOf("bounty", "GP-001"), `prefix ${k} bounty`).toBe(k >= 2 ? "CLAIMED" : k >= 1 ? "FUNDED" : "CREATED");
        expect(recovered.stateOf("settlement", "s"), `prefix ${k} settlement`).toBe(k >= 5 ? "RELEASED" : k >= 4 ? "ELIGIBLE" : "LOCKED");
        if (k >= 2) expect(recovered.claimOf("GP-001")).toEqual(claim("GP-001"));
        // continue the remainder after recovery — idempotent for committed ids
        for (const c of script) recovered.submit(c);
        expect(recovered.stateOf("settlement", "s"), `prefix ${k} converged after continuation`).toBe("RELEASED");
        expect(recovered.journalSnapshot().filter((e) => e.decision.command_id === "d4")).toHaveLength(1);
      }
      // crash-after-commit retry: same decision, no duplicate event
      writeFileSync(journalPath, fullLines.join("\n") + "\n", "utf8");
      const reloaded = connect(SutRuntime.reload(dir));
      const retry = reloaded.submit(script[2]!);
      expect(retry.accepted).toBe(true);
      expect(reloaded.journalSnapshot().filter((e) => e.decision.command_id === "d3")).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("[GP1-F5] scope audit + wall-clock independence + no-payment side effects", () => {
  const snapDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../sut-snapshot/gp-runtime-src");
  const sources = readdirSync(snapDir).filter((f) => f.endsWith(".ts")).map((f) => ({ name: f, src: readFileSync(path.join(snapDir, f), "utf8") }));
  const capture = JSON.parse(readFileSync(path.join(snapDir, "..", "capture.json"), "utf8"));

  test("[F5.1] scope audit: target diff touches no frozen surface, adds no GP2+ artifact, exports stay clean", () => {
    const exports = sources.flatMap(({ src }) =>
      [...src.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z0-9_]+)/g)].map((m) => `export:${m[1]}`),
    );
    const violations = scopeAudit(capture.changed_paths_vs_parent, sources.map((s) => `packages/gp-runtime/src/${s.name}`), exports);
    expect(violations, "scope audit must be clean").toEqual([]);
    // frozen oracle files untouched by the target
    for (const frozen of ["packages/gp1-verifier/src/model.ts", "packages/gp1-verifier/src/reference.ts", "packages/gp1-verifier/src/traces.ts", "packages/gp1-verifier/vectors/gp1-traces.json"]) {
      expect(capture.changed_paths_vs_parent, `${frozen} untouched by SUT commit`).not.toContain(frozen);
    }
  });

  test("[F5.2] wall-clock independence: SUT sources contain no wall-clock access", () => {
    for (const { name, src } of sources) {
      expect(src.includes("Date.now"), `${name}: Date.now`).toBe(false);
      expect(src.includes("performance.now"), `${name}: performance.now`).toBe(false);
      expect(new RegExp(/new\s+Date\s*\(\s*\)/).test(src), `${name}: new Date()`).toBe(false);
      expect(src.includes("setTimeout"), `${name}: setTimeout`).toBe(false);
      expect(src.includes("setInterval"), `${name}: setInterval`).toBe(false);
    }
  });

  test("[F5.3] no-payment side effects: no network/escrow/payment surface; a full run to RELEASED writes ONLY the journal file", () => {
    for (const { name, src } of sources) {
      expect(/import\s+[^;]*node:(http|https|net|dgram|tls|child_process)/.test(src), `${name}: forbidden node import`).toBe(false);
      expect(/\b(fetch|request|transfer|payout|sendPayment|releaseEscrow)\s*\(/.test(src), `${name}: forbidden call`).toBe(false);
      expect(src.includes("solana") || src.includes("devnet") || src.includes("usdc"), `${name}: chain vocabulary must not appear`).toBe(false);
    }
    const dir = mkdtempSync(path.join(tmpdir(), "gp1-nopay-"));
    try {
      const p = connect(new SutRuntime({ dir }));
      p.submit(cmd({ command_id: "n1", machine: "settlement", entity: "s", to: "ELIGIBLE", prerequisite: token("accepted-receipt-ref") }));
      p.submit(cmd({ command_id: "n2", machine: "settlement", entity: "s", to: "RELEASED", prerequisite: token("release-observed-ref") }));
      expect(p.stateOf("settlement", "s")).toBe("RELEASED");
      expect(readdirSync(dir).sort(), "durable dir contains ONLY the journal").toEqual(["journal.jsonl"]);
      for (const e of p.journalSnapshot()) {
        expect(Object.keys(e).sort(), "journal entries carry only ledger semantics").toBeOneOf([
          ["at", "decision", "payloadFingerprint", "seq"],
          ["at", "decision", "payloadFingerprint", "prerequisite", "seq"],
        ]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
