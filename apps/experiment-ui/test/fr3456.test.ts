/** FRONTEND-R1 (HOLD-6) acceptance contract — the 10 machine-evidenced gates over the REAL machinery. */
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createExperimentServer } from "../server/index.ts";
import { deriveExperimentState } from "../server/state.ts";
import { TRUST_ANCHOR } from "../server/trust-anchor.ts";
import { sha256OfFile } from "../../../packages/user-evidence-r0/src/ledger.ts";
import { fixableConfig, fixPatch, makeFixableRepo, wrongFixPatch } from "../../../packages/user-evidence-r0/test/helpers.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let repo = { dir: "", sha: "" };
let expA = ""; // happy path → EARNED → payer response → FINALIZED
let expB = ""; // INVALID terminal path
let srvA: Server | null = null;
let srvB: Server | null = null;
let baseA = "";
let baseB = "";

async function startServer(expDir: string): Promise<{ server: Server; base: string }> {
  const server = createExperimentServer(expDir);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("no port");
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

async function call(base: string, method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + p, body ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { method });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const preparePayload = (over: Record<string, unknown> = {}) => {
  const c = fixableConfig(repo.dir, repo.sha);
  return {
    repoPath: repo.dir,
    base_commit_sha: repo.sha,
    payer_identity: "payer:alice-maintainer",
    worker_identity: "worker:bob-external",
    tier1_reward: "10",
    tier2_reward: "0",
    allowed_paths: c.allowed_paths,
    forbidden_paths: c.forbidden_paths,
    max_diff_lines: 40,
    determinism_runs: 2,
    regression_command: c.commands.regression_command,
    baseline_health_command: c.commands.baseline_health_command,
    patched_acceptance_command: c.commands.patched_acceptance_command,
    notes: { issue_url: "#412 — Fix parser crash", summary: "Parser crashes on nested input.", payer_quote: "" },
    ...over,
  };
};

beforeAll(async () => {
  repo = makeFixableRepo();
  expA = mkdtempSync(path.join(tmpdir(), "fr3456-a-"));
  expB = mkdtempSync(path.join(tmpdir(), "fr3456-b-"));
  ({ server: srvA, base: baseA } = await startServer(expA));
  ({ server: srvB, base: baseB } = await startServer(expB));
}, 1_200_000);

afterAll(() => {
  srvA?.close();
  srvB?.close();
  rmSync(expA, { recursive: true, force: true });
  rmSync(expB, { recursive: true, force: true });
  rmSync(repo.dir, { recursive: true, force: true });
});

describe("[HOLD-6 acceptance] Experiment A — full happy path", () => {
  test("1a. prepare publishes nothing; failed eligibility stays DRAFT", { timeout: 1_200_000 }, async () => {
    const c = fixableConfig(repo.dir, repo.sha);
    // regression rule that is GREEN on base → NOT ELIGIBLE (base-not-red), with a real suite path
    const bad = await call(baseA, "POST", "/api/prepare", preparePayload({ regression_command: c.commands.baseline_health_command }));
    expect(bad.status).toBe(200);
    const check = await call(baseA, "POST", "/api/check-eligibility");
    expect(check.json.ok).toBe(false);
    expect(check.json.reason).toMatch(/base-not-red/);
    const s = await call(baseA, "GET", "/api/state");
    expect(s.json.phase).toBe("DRAFT");
    expect(s.json.hasEligibility).toBe(true);
    expect(s.json.readiness.ready).toBe(false); // acceptance 1: failed prepare publishes nothing
  });

  test("1b/2. input change invalidates readiness; missing payer/worker blocks prepare; SINGLE_CLAIMANT visible", { timeout: 1_200_000 }, async () => {
    await call(baseA, "POST", "/api/prepare", preparePayload()); // correct config
    await call(baseA, "POST", "/api/check-eligibility");
    let s = await call(baseA, "GET", "/api/state");
    expect(s.json.phase).toBe("READY_TO_FREEZE");
    // any change to reviewed inputs → readiness invalidated (acceptance 1)
    await call(baseA, "POST", "/api/prepare", preparePayload({ tier1_reward: "99" }));
    s = await call(baseA, "GET", "/api/state");
    expect(s.json.phase).toBe("DRAFT");
    expect(s.json.readiness.reason).toContain("tier1_reward");
    expect((await call(baseA, "POST", "/api/freeze", { precommitAcknowledged: true })).status).toBe(409); // cannot silently freeze different reviewed terms
    // restore the reviewed config; missing worker identity blocks preparation (acceptance 2)
    expect((await call(baseA, "POST", "/api/prepare", preparePayload({ worker_identity: " " }))).status).toBe(400);
    await call(baseA, "POST", "/api/prepare", preparePayload());
    await call(baseA, "POST", "/api/check-eligibility");
    s = await call(baseA, "GET", "/api/state");
    expect(s.json.phase).toBe("READY_TO_FREEZE");
    expect(s.json.frozen ?? s.json.eligibility.draft).toBeTruthy();
  });

  test("1c. freeze ONLY on explicit reviewed agreement; published terms match the snapshot; frozen pack verified", { timeout: 1_200_000 }, async () => {
    expect((await call(baseA, "POST", "/api/freeze", {})).status).toBe(400); // no acknowledgement → refuse
    const r = await call(baseA, "POST", "/api/freeze", { precommitAcknowledged: true });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    const s = await call(baseA, "GET", "/api/state");
    expect(s.json.phase).toBe("FROZEN");
    expect(s.json.freezeVerified).toBe(true); // D7: closure re-verified, not mere presence
    expect(s.json.frozenTermsMatch).toBe(true);
    expect(s.json.frozen.claim_mode).toBe("SINGLE_CLAIMANT"); // acceptance 2
    expect(s.json.frozen.tier2_reward).toBe("0"); // acceptance 6: tier-2 zero renders unused
    expect(s.json.frozen.worker_identity).toBe("worker:bob-external");
    // F2 download: byte-verbatim frozen task
    const dl = await fetch(baseA + "/api/freeze-file/task.json");
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe(readFileSync(path.join(expA, "freeze", "task.json"), "utf8"));
  });

  test("8a. submission is write-once; the submitted bytes are immutable for this run", async () => {
    const patch = fixPatch(repo.dir);
    const r = await call(baseA, "POST", "/api/submit", { patch });
    expect(r.status).toBe(200);
    expect(r.json.bytes).toBeGreaterThan(0);
    const again = await call(baseA, "POST", "/api/submit", { patch: patch + "\n" });
    expect(again.status).toBe(409);
    expect(again.json.error).toContain("cannot be replaced");
    expect(readFileSync(path.join(expA, "worker.patch"), "utf8")).toBe(patch.endsWith("\n") ? patch : patch + "\n");
  });

  test("3a. UE-2 VALID alone NEVER renders EARNED (replay pending)", { timeout: 1_200_000 }, async () => {
    const r = await call(baseA, "POST", "/api/verify");
    expect(r.status).toBe(200);
    expect(r.json.verdict).toBe("VALID");
    const s = await call(baseA, "GET", "/api/state");
    expect(s.json.facts.primary_verification).toBe("VALID");
    expect(s.json.facts.replay).toBe("PENDING");
    expect(s.json.facts.tier1_entitlement).toBe("PENDING"); // acceptance 3
    expect(s.json.phase).toBe("SUBMITTED"); // no optimistic EARNED / AWAITING_PAYER frame
    // verification is once-per-run
    expect((await call(baseA, "POST", "/api/verify")).status).toBe(409);
  });

  test("3b. bound-matched replay PASS → EARNED; stale pack bytes → replay untrusted, never EARNED", { timeout: 1_200_000 }, async () => {
    const r = await call(baseA, "POST", "/api/replay");
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    let s = await call(baseA, "GET", "/api/state");
    expect(s.json.facts.replay).toBe("PASS");
    expect(s.json.replayFresh).toBe(true);
    expect(s.json.facts.tier1_entitlement).toBe("EARNED"); // acceptance 4 (derivation)
    expect(s.json.phase).toBe("AWAITING_PAYER");
    const packPatch = path.join(expA, "proof", "worker.patch");
    const orig = readFileSync(packPatch);
    writeFileSync(packPatch, orig + "\n");
    s = await call(baseA, "GET", "/api/state");
    expect(s.json.facts.replay).toBe("FAIL");
    expect(s.json.facts.tier1_entitlement).toBe("PENDING");
    expect(s.json.phase).toBe("SUBMITTED");
    writeFileSync(packPatch, orig); // restore for the payer-response path
    s = await call(baseA, "GET", "/api/state");
    expect(s.json.facts.tier1_entitlement).toBe("EARNED");
  });

  test("9a. Answer-later records nothing and blocks finalize; rejection is preserved verbatim; a payer No preserves the machine result", { timeout: 1_200_000 }, async () => {
    // acceptance 9: unresolved follow-up blocks finalize (nothing recorded yet)
    const early = await call(baseA, "POST", "/api/finalize", {});
    expect(early.status).toBe(409);
    expect(early.json.error).toContain("Answer later blocks finalize");
    // acceptance 7 + verbatim: rejection with the payer's own words
    const no = await call(baseA, "POST", "/api/observe", {
      payer_accepts: false,
      payer_ack_verbatim: "",
      no_reason: "The tests pass but I wanted a different implementation style.",
      rule_change_attempts: 1,
      rule_change_details: ["I wanted a code-review step added after seeing the patch"],
      repeat_fund: "YES",
      observation_source: "INTERVIEW",
      observer_identity: "operator",
    });
    expect(no.status).toBe(200);
    const obs1 = JSON.parse(readFileSync(path.join(expA, "observations", "001.json"), "utf8"));
    expect(obs1.observations.payer_accepts_tier1).toBe(false);
    expect(obs1.observations.source_record).toContain("I wanted a different implementation style");
    expect(obs1.observations.source_record).toContain("code-review step");
    expect(obs1.observations.payer_attestation).toBe("UNSIGNED_RECORDED");
    expect(obs1.observations.source_record_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    // acceptance 4: the payer's No preserves the machine result
    const s = await call(baseA, "GET", "/api/state");
    expect(s.json.facts.tier1_entitlement).toBe("EARNED");
    expect(s.json.facts.primary_verification).toBe("VALID");
    expect(s.json.latestObservation.payer_accepts_tier1).toBe(false);
    // acceptance 9: explicit operator closure of an unresolved follow-up (NOT_ASKED, provenance recorded)
    const close = await call(baseA, "POST", "/api/close-followup", {
      hesitation_verbatim: "Payer: ask me again next week.",
      close_reason: "Experiment session ended before the payer decided on repeat funding.",
    });
    expect(close.status).toBe(200);
    const obs2 = JSON.parse(readFileSync(path.join(expA, "observations", "002.json"), "utf8"));
    expect(obs2.observations.repeat_fund_intent).toBe("NOT_ASKED");
    expect(obs2.observations.source_record).toContain("NOT an explicit No");
    // revision before final: payer accepts (latest observation wins)
    const yes = await call(baseA, "POST", "/api/observe", {
      payer_accepts: true,
      payer_ack_verbatim: "Yes. Under the frozen rules, this worker earned Tier 1.",
      rule_change_attempts: 0,
      rule_change_details: [],
      repeat_fund: "YES",
      observation_source: "INTERVIEW",
      observer_identity: "operator",
    });
    expect(yes.status).toBe(200);
    // acceptance 7: acceptance without verbatim is refused
    expect((await call(baseA, "POST", "/api/observe", { payer_accepts: true, payer_ack_verbatim: " ", repeat_fund: "YES" })).status).toBe(400);
  });

  test("9b. final ledger created ONCE from the LATEST observation; badges retained; restart derives the same state", { timeout: 1_200_000 }, async () => {
    const r = await call(baseA, "POST", "/api/finalize", {});
    expect(r.status).toBe(200);
    expect(r.json.verdict).toBe("THESIS STRENGTHENED"); // latest observation: accepts ∧ 0 attempts ∧ YES
    // the "One experiment is not evidence of product-market fit." line is a UI-layer
    // obligation (frozen UE-5 rendered belongs to the ledger, not the UI copy) — asserted in fr1 source tests
    let s = await call(baseA, "GET", "/api/state");
    expect(s.json.phase).toBe("FINALIZED");
    // acceptance 5: badges survive to FINALIZED
    expect(s.json.facts.rules_state).toBe("FROZEN");
    expect(s.json.facts.primary_verification).toBe("VALID");
    expect(s.json.facts.replay).toBe("PASS");
    expect(s.json.facts.tier1_entitlement).toBe("EARNED");
    expect(s.json.facts.payer_response).toBe("RECORDED");
    expect(s.json.finalLedger.verdict).toBe("THESIS STRENGTHENED");
    expect(s.json.finalLedger.user_evidence.attestation_class).toBe("OBSERVED / UNSIGNED"); // acceptance 7
    expect((await call(baseA, "POST", "/api/finalize", {})).status).toBe(409); // once, forever
    // acceptance 5: restart (fresh server, same dir) derives the SAME state; no process inference
    srvA!.close();
    const restarted = await startServer(expA);
    try {
      const s2 = await call(restarted.base, "GET", "/api/state");
      expect(s2.json.phase).toBe("FINALIZED");
      expect(s2.json.facts).toEqual(s.json.facts);
      expect(s2.json.transient).toEqual({ checking: false, verifying: false });
    } finally {
      restarted.server.close();
    }
  });
});

describe("[HOLD-6 acceptance] Experiment B — INVALID is terminal", () => {
  test("8b. wrong-but-applicable patch → INVALID terminal; no retry, no replacement, no replay, no payer path", { timeout: 1_800_000 }, async () => {
    await call(baseB, "POST", "/api/prepare", preparePayload({ worker_identity: "worker:carol-external" }));
    await call(baseB, "POST", "/api/check-eligibility");
    const fr = await call(baseB, "POST", "/api/freeze", { precommitAcknowledged: true });
    expect(fr.status).toBe(200);
    const sub = await call(baseB, "POST", "/api/submit", { patch: wrongFixPatch(repo.dir) }); // applies cleanly, does NOT fix the bug
    expect(sub.status).toBe(200);
    const vr = await call(baseB, "POST", "/api/verify");
    expect(vr.status).toBe(200);
    expect(vr.json.verdict).toBe("INVALID");
    expect(vr.json.invalid_reason).toBe("patched-acceptance-red");
    let s = await call(baseB, "GET", "/api/state");
    expect(s.json.facts.primary_verification).toBe("INVALID");
    expect(s.json.facts.tier1_entitlement).toBe("NOT_EARNED");
    expect(s.json.phase).toBe("SUBMITTED"); // outcome panel; no AWAITING_PAYER path UE-5 would reject
    // no retry, no replacement, no replay, no payer response (acceptance 8)
    expect((await call(baseB, "POST", "/api/verify")).status).toBe(409);
    expect((await call(baseB, "POST", "/api/submit", { patch: fixPatch(repo.dir) })).status).toBe(409);
    expect((await call(baseB, "POST", "/api/replay")).status).toBe(409);
    expect((await call(baseB, "POST", "/api/observe", { payer_accepts: true, payer_ack_verbatim: "x", repeat_fund: "YES" })).status).toBe(409);
    expect((await call(baseB, "POST", "/api/finalize", {})).status).toBe(409);
    expect(s.json.facts.payer_response).toBe("NONE");
  });
});

describe("[HOLD-6 acceptance] 10. trust anchor and frozen modules unchanged", () => {
  test("the orchestrator's anchor constants equal the EXPERIMENT-001 governance record and the actual release bytes", () => {
    const doc = readFileSync(path.join(repoRoot, "docs/experiments/EXPERIMENT-001.md"), "utf8");
    expect(doc).toContain(`= ${TRUST_ANCHOR.main_sha}`);
    expect(doc).toContain(`= ${TRUST_ANCHOR.implementation_audit_sha}`);
    expect(doc).toContain(TRUST_ANCHOR.verifier_release_sha256);
    expect(doc).toContain(TRUST_ANCHOR.portable_replay_sha256);
    // the repo's actual release file IS the anchored release
    expect(sha256OfFile(path.join(repoRoot, "packages/user-evidence-r0/VERIFIER-RELEASE.json"))).toBe(TRUST_ANCHOR.verifier_release_sha256);
  });
});
