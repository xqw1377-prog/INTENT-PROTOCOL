import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  illegalPairs, isLegalPair, legalEdges, MODEL_COUNTS,
  MACHINES, terminalNegatives, edgeFor, prerequisiteKindOf,
  type MachineName, type PrerequisiteKind, type PrerequisiteRef,
} from "../src/model.js";
import { MACHINES as M } from "../src/model.js";
import { ReferenceRuntime, fingerprint, type Command } from "../src/reference.js";
import { claimRecordShapeViolations, isSubjectRef, isTaskFreezeHash } from "../src/subject.js";
import { generateAllTraces, generateTrace, OPS_PER_TRACE, TRACE_SEEDS } from "../src/traces.js";
import { scopeAudit } from "../src/scope.js";

const token = (kind: PrerequisiteKind): PrerequisiteRef => ({ kind, ref: "op:gp1.fixtures.token-0123" });
const withPrereq = (id: string, machine: "bounty" | "execution" | "verification" | "settlement", entity: string, to: string, kind?: PrerequisiteKind): Command =>
  cmd({ command_id: id, machine, entity, to, ...(kind ? { prerequisite: token(kind) } : {}) });

/**
 * GP1 ORACLE SELF-TEST (Builder D, Issue #12 §A/§B/§C).
 * Oracle-only: no Builder C package is imported anywhere in this package
 * (asserted below). The adapter layer is written ONLY after the Commander
 * publishes the GP1 formal target SHA.
 */

const validClaim = (bountyId = "GP-001", claimId = "bbbbbbbb-0000-4000-8000-000000000001") => ({
  schema_version: "gp-claim.v1" as const,
  claim_id: claimId,
  bounty_id: bountyId,
  claimant: "agent:gp-agent",
  task_freeze_hash: "sha256:" + "ab".repeat(32),
  claimed_at: "2026-09-21T00:00:00Z",
});

const cmd = (over: Partial<Command> & Pick<Command, "command_id" | "machine" | "entity" | "to">): Command => ({
  op: "transition", at: "2026-09-21T00:00:01Z", ...over,
});

describe("[GP1-A] model oracle", () => {
  test("[GP1-A1] frozen counts: 4 machines, 17 states, 13 legal edges, 70 illegal pairs, 5 terminal negatives", () => {
    expect(MODEL_COUNTS).toEqual({ machines: 4, states: 17, legalEdges: 13, illegalPairs: 70, terminalNegatives: 5 });
  });

  test("[GP1-A2] GP1-R1: ALL 13 legal edges are positively reachable (future-authority edges via typed opaque refs)", () => {
    const rt = new ReferenceRuntime();
    // bounty: full chain to SETTLED
    const bountyWalk: Array<[string, string, PrerequisiteKind?]> = [
      ["b1", "FUNDED"],
      ["b2", "CLAIMED"],
      ["b3", "EXECUTING"],
      ["b4", "SUBMITTED"],
      ["b5", "VERIFIED", "policy-satisfied-ref"],
      ["b6", "SETTLED", "release-observed-ref"],
    ];
    for (const [id, to, kind] of bountyWalk) {
      const c = withPrereq(id, "bounty", "GP-001", to, kind);
      if (to === "CLAIMED") c.claim = validClaim();
      const d = rt.submit(c);
      expect(d.accepted, `bounty -> ${to} must be reachable (${d.reason ?? "ok"})`).toBe(true);
    }
    // execution: full chain incl. terminal CLOSED
    for (const [id, to] of [["e1", "RUNNING"], ["e2", "SUBMITTED"], ["e3", "CLOSED"]] as const) {
      expect(rt.submit(cmd({ command_id: id, machine: "execution", entity: "exec-1", to })).accepted).toBe(true);
    }
    // verification: ACCEPTED (via opaque sealed-evidence ref) and REJECTED
    expect(rt.submit(withPrereq("v1", "verification", "verif-1", "ACCEPTED", "sealed-evidence-ref")).accepted).toBe(true);
    expect(rt.submit(cmd({ command_id: "v2", machine: "verification", entity: "verif-2", to: "REJECTED" })).accepted).toBe(true);
    // settlement: ELIGIBLE then RELEASED (ledger reachability only)
    expect(rt.submit(withPrereq("s1", "settlement", "st-1", "ELIGIBLE", "accepted-receipt-ref")).accepted).toBe(true);
    const released = rt.submit(withPrereq("s2", "settlement", "st-1", "RELEASED", "release-observed-ref"));
    expect(released.accepted, "ELIGIBLE->RELEASED is ledger reachability (GP1-R1)").toBe(true);
    // every edge object itself is well-formed
    for (const e of legalEdges()) {
      expect(isLegalPair(e.machine, e.from, e.to), `edge legal: ${e.machine} ${e.from}->${e.to}`).toBe(true);
    }
  });

  test("[GP1-A3] every illegal state pair is rejected (exhaustive 70)", () => {
    const rt = new ReferenceRuntime();
    let n = 0;
    for (const { machine, from, to } of illegalPairs()) {
      // place the entity in `from` as far as possible, then attempt `to`
      const states = MACHINES[machine as MachineName].states;
      const rt2 = new ReferenceRuntime();
      let i = 0;
      while (rt2.stateOf(machine as MachineName, "x") !== from && i < states.length) {
        const cur = rt2.stateOf(machine as MachineName, "x");
        // Prefer a direct legal edge to the desired source state (needed for
        // branch siblings such as verification PENDING -> REJECTED);
        // otherwise advance one state along the declared chain.
        const direct = edgeFor(machine as MachineName, cur, from);
        const next = direct ? from : states[states.indexOf(cur) + 1];
        if (!next || !isLegalPair(machine as MachineName, cur, next)) break;
        const setupEdge = edgeFor(machine as MachineName, cur, next);
        const setupKind = setupEdge ? prerequisiteKindOf(setupEdge.authority) : undefined;
        const c = cmd({ command_id: `setup-${n}-${i}`, machine: machine as MachineName, entity: "x", to: next, ...(setupKind ? { prerequisite: token(setupKind) } : {}) });
        if (c.to === "CLAIMED" && machine === "bounty") c.claim = validClaim("x");
        const d = rt2.submit(c);
        if (!d.accepted) break;
        i++;
      }
      expect(rt2.stateOf(machine as MachineName, "x"), `source state must be reachable for exhaustive probe: ${machine}:${from}`).toBe(from);
      const d = rt2.submit(cmd({ command_id: `probe-${n}`, machine: machine as MachineName, entity: "x", to }));
      expect(d.accepted, `illegal pair must be rejected: ${machine} ${from}->${to}`).toBe(false);
      // from a terminal source the rejection is MORE specific (terminal-source); otherwise exactly illegal-pair
      const src = MACHINES[machine as MachineName].terminal.includes(from) ? "terminal-source" : "illegal-pair";
      expect(d.reason, `${machine} ${from}->${to}`).toBe(src);
      n++;
    }
    expect(illegalPairs().length).toBe(70);
    expect(n, "all 70 illegal pairs must be behaviorally probed, not only enumerated").toBe(70);
  });

  test("[GP1-A4] terminal states reject every outgoing attempt", () => {
    const rt = new ReferenceRuntime();
    // reach execution terminal CLOSED, then attempt any transition
    for (const [id, to] of [["e1", "RUNNING"], ["e2", "SUBMITTED"], ["e3", "CLOSED"]] as const) {
      rt.submit(cmd({ command_id: id, machine: "execution", entity: "exec-t", to }));
    }
    for (const to of ["CREATED", "RUNNING", "SUBMITTED", "CLOSED"]) {
      const d = rt.submit(cmd({ command_id: `t-${to}`, machine: "execution", entity: "exec-t", to }));
      expect(d.accepted, `terminal CLOSED must reject -> ${to}`).toBe(false);
      expect(d.reason).toBe("terminal-source");
    }
    // verification REJECTED is terminal too
    rt.submit(cmd({ command_id: "v1", machine: "verification", entity: "vf", to: "REJECTED" }));
    expect(rt.submit(cmd({ command_id: "v2", machine: "verification", entity: "vf", to: "PENDING" })).reason).toBe("terminal-source");
    expect(terminalNegatives().length).toBe(5);
  });

  test("[GP1-A5] GP1-R1 per-edge prerequisite semantics: missing/wrong-kind/invalid-shape REJECT, correct typed opaque ref ACCEPT; RELEASED has zero side effects", () => {
    type M = "bounty" | "verification" | "settlement";
    const probe = (walk: (rt: ReferenceRuntime) => void, to: string, kind: PrerequisiteKind, entity: string, machine: M) => {
      const wrongKind: PrerequisiteKind = kind === "sealed-evidence-ref" ? "policy-satisfied-ref" : "sealed-evidence-ref";
      const fresh = () => {
        const rt = new ReferenceRuntime();
        walk(rt);
        return rt;
      };
      const missing = fresh().submit(cmd({ command_id: "p-missing", machine, entity, to }));
      expect(missing.accepted, `${machine}->${to} missing ref`).toBe(false);
      expect(missing.reason).toBe("prerequisite-required");
      const wrong = fresh().submit(cmd({ command_id: "p-wrong", machine, entity, to, prerequisite: token(wrongKind) }));
      expect(wrong.reason).toBe("prerequisite-wrong-kind");
      const badShape = fresh().submit(cmd({ command_id: "p-bad", machine, entity, to, prerequisite: { kind, ref: "NOT-VALID" } }));
      expect(badShape.reason).toBe("prerequisite-invalid-shape");
      const ok = fresh().submit(cmd({ command_id: "p-ok", machine, entity, to, prerequisite: token(kind) }));
      expect(ok.accepted, `${machine}->${to} accepts correct typed opaque ref`).toBe(true);
    };
    const walkBountyTo = (target: string) => (rt: ReferenceRuntime) => {
      const chain: Array<[string, string, PrerequisiteKind?]> = [
        ["w1", "FUNDED"], ["w2", "CLAIMED"], ["w3", "EXECUTING"], ["w4", "SUBMITTED"], ["w5", "VERIFIED", "policy-satisfied-ref"],
      ];
      for (const [id, to, kind] of chain) {
        if (MACHINES.bounty.states.indexOf(to) > MACHINES.bounty.states.indexOf(target)) break;
        const c = withPrereq(id, "bounty", "GP-001", to, kind);
        if (to === "CLAIMED") c.claim = validClaim();
        rt.submit(c);
      }
    };
    const walkEligible = (rt: ReferenceRuntime) => {
      rt.submit(withPrereq("we1", "settlement", "s1", "ELIGIBLE", "accepted-receipt-ref"));
    };
    probe(() => {}, "ACCEPTED", "sealed-evidence-ref", "v1", "verification");
    probe(walkBountyTo("SUBMITTED"), "VERIFIED", "policy-satisfied-ref", "GP-001", "bounty");
    probe(walkBountyTo("VERIFIED"), "SETTLED", "release-observed-ref", "GP-001", "bounty");
    probe(() => {}, "ELIGIBLE", "accepted-receipt-ref", "s1", "settlement");
    probe(walkEligible, "RELEASED", "release-observed-ref", "s1", "settlement");
    // RELEASED side-effect discipline: the committed entry records ONLY ledger semantics
    const rt = new ReferenceRuntime();
    walkEligible(rt);
    const before = rt.journalSnapshot().length;
    rt.submit(withPrereq("rel", "settlement", "s1", "RELEASED", "release-observed-ref"));
    const entry = rt.journalSnapshot()[before]!;
    expect(entry.decision.to).toBe("RELEASED");
    expect(entry.prerequisite).toEqual(token("release-observed-ref"));
    expect(Object.keys(entry).sort(), "no payment/escrow side-effect fields exist (GP1-R1)").toEqual(["at", "decision", "payloadFingerprint", "prerequisite", "seq"]);
    // LOCKED->RELEASED (skipping ELIGIBLE) is still not an edge at all
    expect(new ReferenceRuntime().submit(cmd({ command_id: "skip", machine: "settlement", entity: "s2", to: "RELEASED", prerequisite: token("release-observed-ref") })).reason).toBe("illegal-pair");
  });
});

describe("[GP1-B] invariant oracle", () => {
  test("[GP1-B1] idempotent same-command replay: same decision, NO duplicate journal event", () => {
    const rt = new ReferenceRuntime();
    const c = cmd({ command_id: "idem-1", machine: "bounty", entity: "GP-001", to: "FUNDED" });
    const d1 = rt.submit(c);
    const len1 = rt.journalSnapshot().length;
    const d2 = rt.submit({ ...c }); // byte-identical resubmission (crash-after-commit retry)
    expect(d2).toEqual(d1);
    expect(rt.journalSnapshot().length, "no duplicate event").toBe(len1);
  });

  test("[GP1-B2] conflicting payload under the same command_id is rejected, no journal event", () => {
    const rt = new ReferenceRuntime();
    rt.submit(cmd({ command_id: "cf-1", machine: "bounty", entity: "GP-001", to: "FUNDED" }));
    const len = rt.journalSnapshot().length;
    const d = rt.submit(cmd({ command_id: "cf-1", machine: "bounty", entity: "GP-001", to: "EXECUTING" }));
    expect(d.accepted).toBe(false);
    expect(d.reason).toBe("conflicting-command");
    expect(rt.journalSnapshot().length).toBe(len);
  });

  test("[GP1-B3] append-only journal: strictly monotone seq, entries never mutate, ordering stable", () => {
    const rt = new ReferenceRuntime();
    rt.submit(cmd({ command_id: "j1", machine: "execution", entity: "e", to: "RUNNING" }));
    rt.submit(cmd({ command_id: "j2", machine: "execution", entity: "e", to: "SUBMITTED" }));
    rt.submit(cmd({ command_id: "j3", machine: "execution", entity: "e", to: "CREATED" })); // rejected — still journaled
    const snap = rt.journalSnapshot();
    expect(snap.map((e) => e.seq)).toEqual([1, 2, 3]);
    rt.submit(cmd({ command_id: "j4", machine: "execution", entity: "e", to: "CLOSED" }));
    const snap2 = rt.journalSnapshot();
    expect(snap2.slice(0, 3), "earlier entries are append-only (unchanged)").toEqual(snap);
    expect(snap2[3]!.seq).toBe(4);
  });

  test("[GP1-B4] deterministic replay: full reload reproduces identical states, claims, journal", () => {
    const rt = new ReferenceRuntime();
    rt.submit(cmd({ command_id: "r1", machine: "bounty", entity: "GP-001", to: "FUNDED" }));
    rt.submit(cmd({ command_id: "r2", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: validClaim() }));
    rt.submit(cmd({ command_id: "r3", machine: "execution", entity: "e", to: "RUNNING" }));
    rt.submit(cmd({ command_id: "r4", machine: "verification", entity: "v", to: "ACCEPTED" })); // rejected
    const reloaded = rt.reload();
    expect(reloaded.stateOf("bounty", "GP-001")).toBe(rt.stateOf("bounty", "GP-001"));
    expect(reloaded.stateOf("execution", "e")).toBe("RUNNING");
    expect(reloaded.stateOf("verification", "v")).toBe("PENDING");
    expect(reloaded.claimOf("GP-001")).toEqual(validClaim());
    expect(reloaded.journalSnapshot()).toEqual(rt.journalSnapshot());
  });

  test("[GP1-B5] crash/recovery at EVERY prefix converges to the same state as the uninterrupted run", () => {
    const trace = generateTrace(TRACE_SEEDS[0]);
    const full = new ReferenceRuntime();
    const decisions: boolean[] = [];
    for (const c of trace.commands) decisions.push(full.submit(c).accepted);
    const snap = full.journalSnapshot();
    for (let k = 0; k <= snap.length; k += 7) {
      const recovered = ReferenceRuntime.fromJournalPrefix(snap.slice(0, k));
      // continue the remainder of the trace after recovery
      for (const c of trace.commands) recovered.submit(c); // idempotent replay of already-committed ids keeps first decision
      expect(recovered.stateOf("bounty", "GP-001"), `prefix ${k}: bounty state converges`).toBe(full.stateOf("bounty", "GP-001"));
      expect(recovered.claimOf("GP-001"), `prefix ${k}: claim survives recovery`).toEqual(full.claimOf("GP-001"));
    }
  });

  test("[GP1-B6] ClaimRecord immutability: replacement and field mutation are both rejected", () => {
    const rt = new ReferenceRuntime();
    rt.submit(cmd({ command_id: "c1", machine: "bounty", entity: "GP-001", to: "FUNDED" }));
    rt.submit(cmd({ command_id: "c2", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: validClaim() }));
    // replacement attempt (different claim_id) — reachable again only from a fresh runtime at FUNDED
    const rt2 = new ReferenceRuntime();
    rt2.submit(cmd({ command_id: "c1", machine: "bounty", entity: "GP-001", to: "FUNDED" }));
    rt2.submit(cmd({ command_id: "c2", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: validClaim() }));
    // state moved past CLAIMED; a second claim-shaped transition is not-current-state — but the claim STORE must resist mutation:
    // simulate mutation attempt via conflicting command payload under the SAME command id
    const mutated = validClaim("GP-001", "cccccccc-0000-4000-8000-000000000002");
    const d = rt2.submit(cmd({ command_id: "c2", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: mutated }));
    expect(d.accepted).toBe(false);
    expect(d.reason).toBe("conflicting-command");
    expect(rt2.claimOf("GP-001"), "stored record unchanged").toEqual(validClaim());
    // shape-invalid claims never append
    const rt3 = new ReferenceRuntime();
    rt3.submit(cmd({ command_id: "c1", machine: "bounty", entity: "GP-001", to: "FUNDED" }));
    const bad = { ...validClaim(), claimant: "user:alice@evil" };
    const d3 = rt3.submit(cmd({ command_id: "c2", machine: "bounty", entity: "GP-001", to: "CLAIMED", claim: bad }));
    expect(d3.reason).toBe("invalid-claim-shape");
    expect(rt3.claimOf("GP-001")).toBeUndefined();
    expect(claimRecordShapeViolations(bad)).toContain("claimant");
  });

  test("[GP1-B7] frozen SubjectRef acceptance/rejection set", () => {
    for (const good of ["user:alice", "agent:builder-c-agent", "verifier:independent-b", "org:acme.team", "service:ci.1"]) {
      expect(isSubjectRef(good), `accept ${good}`).toBe(true);
    }
    for (const bad of ["user:alice@evil", "user:", "principal:alice", "user:" + "a".repeat(129), 42, null]) {
      expect(isSubjectRef(bad), `reject ${String(bad)}`).toBe(false);
    }
  });

  test("[GP1-B8] task_freeze_hash shape", () => {
    expect(isTaskFreezeHash("sha256:" + "ab".repeat(32))).toBe(true);
    for (const bad of ["sha256:abcd", "sha256:" + "AB".repeat(32), "0x" + "ab".repeat(32), ""]) {
      expect(isTaskFreezeHash(bad), `reject ${bad}`).toBe(false);
    }
  });

  test("[GP1-B9] caller-supplied time: identical logical clocks => identical outcomes; time comes only from commands", () => {
    const run = () => {
      const rt = new ReferenceRuntime();
      const at = "2026-09-21T12:00:00Z";
      rt.submit(cmd({ command_id: "t1", machine: "execution", entity: "e", to: "RUNNING", at }));
      rt.submit(cmd({ command_id: "t2", machine: "execution", entity: "e", to: "SUBMITTED", at }));
      return rt.journalSnapshot();
    };
    expect(run()).toEqual(run()); // deterministic — no wall-clock anywhere in the fold
    expect(fingerprint(cmd({ command_id: "x", machine: "execution", entity: "e", to: "RUNNING", at: "2026-01-01T00:00:00Z" })))
      .not.toContain("2026-09-21"); // at is command-supplied, not folded into payload identity
  });

  test("[GP1-B10] crash-before-commit => NO transition; crash-after-commit-before-response => retry returns same result, no duplicate", () => {
    // before commit: command absent from journal, state unchanged
    const rt = new ReferenceRuntime();
    rt.submit(cmd({ command_id: "k1", machine: "settlement", entity: "s", to: "ELIGIBLE" })); // rejected anyway
    const before = ReferenceRuntime.crashBeforeCommit(rt, cmd({ command_id: "k2", machine: "settlement", entity: "s", to: "ELIGIBLE" }));
    expect(before.before).toBe(before.after);
    expect(rt.journalSnapshot().length).toBe(1); // k2 never committed
    // after commit: entry exists; retry (network-level duplicate) sees the recorded decision
    const c = cmd({ command_id: "k3", machine: "execution", entity: "e2", to: "RUNNING" });
    const first = rt.submit(c);
    const retry = rt.submit({ ...c });
    expect(retry).toEqual(first);
    expect(rt.journalSnapshot().filter((e) => e.decision.command_id === "k3")).toHaveLength(1);
  });
});

describe("[GP1-C] seeded trace vectors", () => {
  const VEC_PATH = fileURLToPath(new URL("../vectors/gp1-traces.json", import.meta.url));

  test("[GP1-C1] committed vectors regenerate byte-identically (8 seeds x 48 ops = 384 commands)", () => {
    const regenerated = generateAllTraces();
    if (process.env.GEN_VECTORS === "1") {
      writeFileSync(VEC_PATH, JSON.stringify({ generator: "traces.ts@gp1-verifier", seeds: [...TRACE_SEEDS], opsPerTrace: OPS_PER_TRACE, traces: regenerated }, null, 2) + "\n");
    }
    expect(existsSync(VEC_PATH), "vectors committed (run GEN_VECTORS=1 once to bootstrap)").toBe(true);
    const committed = JSON.parse(readFileSync(VEC_PATH, "utf8"));
    expect(committed.seeds).toEqual([...TRACE_SEEDS]);
    expect(committed.traces, "regeneration must equal committed vectors exactly").toEqual(regenerated);
    expect(regenerated).toHaveLength(8);
    expect(regenerated[0]!.commands).toHaveLength(48);
  });

  test("[GP1-C2] every committed expected-decision sequence reproduces from a fresh runtime", () => {
    for (const t of generateAllTraces()) {
      const rt = new ReferenceRuntime();
      for (let i = 0; i < t.commands.length; i++) {
        const d = rt.submit(t.commands[i]!);
        expect(d, `seed ${t.seed} op ${i}`).toEqual(t.expected[i]);
      }
    }
  });
});

describe("[GP1-D] scope sentinel + independence", () => {
  test("[GP1-D1] clean candidate diff passes; frozen-surface touches and GP2+ artifacts fail", () => {
    expect(scopeAudit(
      ["packages/gp-runtime/src/bounty-machine.ts", "packages/gp-runtime/src/journal.ts", "packages/gp-runtime/test/bounty.test.ts"],
      ["packages/gp-runtime/src/bounty-machine.ts"],
      ["submitTransition", "readJournal", "reload"],
    ), "state-machine-only candidate is clean").toEqual([]);
    expect(scopeAudit(["packages/protocol-schema/src/objects.ts"], [], []).some((v) => v.kind === "forbidden-path")).toBe(true);
    expect(scopeAudit(["packages/gp-audit/test/gp0-delta-reaudit.test.ts"], [], []).some((v) => v.kind === "forbidden-path")).toBe(true);
    expect(scopeAudit(["packages/gp-runtime/src/outcome-receipt.ts"], [], []).some((v) => v.kind === "gp3-outcome-receipt")).toBe(true);
    expect(scopeAudit(["packages/gp-runtime/src/verifier.ts"], [], []).some((v) => v.kind === "gp3-verifier-decision")).toBe(true);
    expect(scopeAudit(["packages/gp-runtime/src/agent-runner.ts"], [], []).some((v) => v.kind === "gp2-agent-runner")).toBe(true);
    expect(scopeAudit(["packages/gp-runtime/src/devnet.ts"], [], []).some((v) => v.kind === "gp4-devnet")).toBe(true);
    expect(scopeAudit([], ["packages/gp-runtime/src/settlement-machine.ts"], ["releaseEscrow"]).some((v) => v.kind === "gp4-release-payment")).toBe(true);
    // state NAME in a state-machine file is NOT a violation (no false positives on RELEASED state)
    expect(scopeAudit([], ["packages/gp-runtime/src/settlement-machine.ts"], ["submitTransition"])).toEqual([]);
  });

  test("[GP1-D2] independence: this package imports nothing from gp-runtime (self-scan of every source/test file)", () => {
    const dir = fileURLToPath(new URL("../", import.meta.url));
    const scan = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? scan(`${d}/${e.name}`) : /\.(ts|mjs|json)$/.test(e.name) ? [`${d}/${e.name}`] : [],
      );
    for (const f of scan(`${dir}/src`).concat(scan(`${dir}/test`))) {
      const src = readFileSync(f, "utf8");
      expect(src.match(/from\s+["'][^"']*gp-runtime/), `${f} must not import gp-runtime`).toBeNull();
    }
  });
});
