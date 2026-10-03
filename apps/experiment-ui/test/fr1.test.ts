/** FRONTEND-R1 / FR-1 gates — status derivation + no duplicated backend truth. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { deriveExperimentFacts, deriveExperimentState, experimentPaths } from "../server/state.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let tmp = "";
const expDir = (): string => {
  tmp = mkdtempSync(path.join(tmpdir(), "fr1-"));
  return tmp;
};

describe("[FR-1] phase derives from artifacts (no second state database)", () => {
  test("empty experiment dir → DRAFT, all facts pending/open", () => {
    const d = expDir();
    try {
      const s = deriveExperimentState(d);
      expect(s.phase).toBe("DRAFT");
      expect(s.facts).toEqual({
        rules_state: "DRAFT",
        submission_state: "NONE",
        primary_verification: "PENDING",
        replay: "PENDING",
        tier1_entitlement: "PENDING",
        payer_response: "NONE",
        ledger: "OPEN",
      });
      expect(s.transient).toEqual({ checking: false, verifying: false });
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("eligibility ok → READY_TO_FREEZE; failed eligibility stays DRAFT; input changes invalidate readiness (D5); transients are explicit and never persisted", () => {
    const d = expDir();
    try {
      const p = experimentPaths(d);
      const draft = { payer_identity: "p", worker_identity: "w", tier1_reward: "10", base_commit_sha: "a".repeat(40) };
      // failed eligibility → DRAFT
      writeFileSync(p.eligibility, JSON.stringify({ ok: false, reason: "base-not-red" }) + "\n");
      expect(deriveExperimentState(d).phase).toBe("DRAFT");
      // ok + reviewed snapshot matching the current draft → READY_TO_FREEZE
      writeFileSync(p.draft, JSON.stringify(draft) + "\n");
      writeFileSync(p.eligibility, JSON.stringify({ ok: true, draft }) + "\n");
      expect(deriveExperimentState(d).phase).toBe("READY_TO_FREEZE");
      // ANY change to reviewed inputs invalidates readiness (D5)
      writeFileSync(p.draft, JSON.stringify({ ...draft, tier1_reward: "99" }) + "\n");
      expect(deriveExperimentState(d).phase).toBe("DRAFT");
      expect(deriveExperimentState(d).readiness.reason).toContain("tier1_reward");
      writeFileSync(p.draft, JSON.stringify(draft) + "\n"); // restored → matches the reviewed snapshot again
      expect(deriveExperimentState(d).phase).toBe("READY_TO_FREEZE");
      // snapshot missing → never ready (restart safety: readiness is never reconstructed from memory)
      writeFileSync(p.eligibility, JSON.stringify({ ok: true }) + "\n");
      expect(deriveExperimentState(d).phase).toBe("DRAFT");
      // transients are explicit and never persist
      writeFileSync(p.eligibility, JSON.stringify({ ok: true, draft }) + "\n");
      expect(deriveExperimentState(d, { checking: true }).phase).toBe("CHECKING");
      expect(deriveExperimentState(d).phase).toBe("READY_TO_FREEZE");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("full lifecycle facts derive independently and never merge", () => {
    const d = expDir();
    try {
      const p = experimentPaths(d);
      mkdirSync(path.join(p.freezeDir));
      // a minimal but HONEST freeze manifest (state derives binding from it)
      writeFileSync(path.join(p.freezeDir, "freeze-manifest.json"), JSON.stringify({ contract_freeze_hash: "sha256:" + "c".repeat(64), verification_ruleset_hash: "sha256:" + "r".repeat(64) }) + "\n");
      expect(deriveExperimentFacts(d).rules_state).toBe("FROZEN");
      expect(deriveExperimentState(d).phase).toBe("FROZEN");

      writeFileSync(p.workerPatch, "diff --git\n");
      expect(deriveExperimentFacts(d).submission_state).toBe("SUBMITTED");
      expect(deriveExperimentState(d).phase).toBe("SUBMITTED");

      // D7: a bare verdict string is NOT sufficient — the record must derive
      // VALID (tier1VerdictOf) AND bind to THIS freeze
      writeFileSync(p.runRecord, JSON.stringify({ verdict: "VALID" }) + "\n");
      expect(deriveExperimentFacts(d).primary_verification).toBe("INVALID"); // raw string rejected

      const goodChecks = {
        freeze_closure: "VERIFIED", symlink_free_paths: "OK", base_regression_recheck: "RED",
        install_boundary: "LIFECYCLE_SCRIPTS_DISABLED", post_install_bytes: "OK",
        lockfile_unchanged: "OK", suite_unchanged: "OK", dependency_policy: "OK",
        patched_acceptance: "GREEN", baseline_health_patched: "GREEN",
        determinism: "3/3", network_sandbox: "DENIED_VERIFIED",
      };
      const goodRuns = [{ command: "x", code: 0, stdout_sha256: "sha256:" + "a".repeat(64) }];
      const validRecord = { verdict: "VALID", checks: goodChecks, runs: goodRuns, freeze: { contract_freeze_hash: "sha256:" + "c".repeat(64), verification_ruleset_hash: "sha256:" + "r".repeat(64), precommit_binding: "sha256:" + "p".repeat(64) } };
      writeFileSync(p.runRecord, JSON.stringify(validRecord) + "\n");
      expect(deriveExperimentFacts(d).primary_verification).toBe("VALID");
      expect(deriveExperimentFacts(d).tier1_entitlement).toBe("PENDING"); // VALID alone must NOT earn (D6)

      // replay without a proof pack is never PASS (stale/untrusted)
      mkdirSync(p.proofDir);
      writeFileSync(p.replayReport, JSON.stringify({ schema_version: "portable-replay-report.v1", status: "PASS", same_verdict: true, reproduced: { tier1_verdict: "VALID" } }) + "\n");
      expect(deriveExperimentFacts(d).replay).toBe("FAIL"); // no fresh binding → untrusted, never EARNED
      expect(deriveExperimentFacts(d).tier1_entitlement).toBe("PENDING");

      writeFileSync(p.runRecord, JSON.stringify({ verdict: "INVALID", invalid_reason: "patched-acceptance-red" }) + "\n");
      expect(deriveExperimentFacts(d).tier1_entitlement).toBe("NOT_EARNED"); // INVALID is terminal for the run
      expect(deriveExperimentState(d).phase).toBe("SUBMITTED"); // facts carry the outcome; no invented retry phase

      mkdirSync(p.observationsDir);
      writeFileSync(path.join(p.observationsDir, "001.json"), "{}\n");
      expect(deriveExperimentFacts(d).payer_response).toBe("RECORDED");

      writeFileSync(p.finalLedger, "{}\n");
      expect(deriveExperimentFacts(d).ledger).toBe("FINALIZED");
      expect(deriveExperimentState(d).phase).toBe("FINALIZED");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("[FR-1] no duplicated backend truth (source discipline)", () => {
  const serverSources = ["server/index.ts", "server/state.ts", "web/app.js"].map((f) => path.join(pkgDir, f));

  test("the server CALLS the frozen modules — imports them, does not reimplement them", () => {
    const src = readFileSync(serverSources[0]!, "utf8");
    expect(src).toContain("packages/user-evidence-r0/src/freeze.ts");
    expect(src).toContain("runPreflight");
    expect(src).toContain("freezeExperiment");
    expect(src).toContain("CANONICAL_INSTALL_COMMAND");
  });

  test("no second implementation of backend truth anywhere in the orchestrator/web layer", () => {
    for (const file of serverSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file}: no hash computation`).not.toContain("createHash");
      expect(src, `${file}: no canonical serialization`).not.toContain("deepSort");
      expect(src, `${file}: no glob matching`).not.toContain("globToRegExp");
      expect(src, `${file}: no policy parsing`).not.toContain("parseUnifiedPatch");
      expect(src, `${file}: no verdict recompute`).not.toMatch(/sha256\s*\(/);
    }
  });

  test("frontend red lines: forbidden wording never appears; mandated copy does", () => {
    const ui = readFileSync(path.join(pkgDir, "web/app.js"), "utf8") + readFileSync(path.join(pkgDir, "web/index.html"), "utf8");
    for (const banned of ["Payment complete", "Funds released", "Escrow released", "PAYER-ATTESTED", "Auto release", "Create bounty", "Publish", "Launch task", "Possible reward", "Up to", "Maintainer approval required"]) {
      expect(ui, banned).not.toContain(banned);
    }
    // mandated copy (spec §23 / HOLD-6): the finalize screen must carry the PMF disclaimer
    expect(ui).toContain("One experiment is not evidence of product-market fit.");
    expect(ui).toContain("This is a derived protocol result. It is not a maintainer approval.");
    expect(ui).toContain("not used in this experiment"); // Tier-2 zero renders unused (acceptance 6)
    expect(ui).toContain("declared, not authenticated");
  });
});
