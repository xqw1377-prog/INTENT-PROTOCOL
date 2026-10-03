/** FRONTEND-R1 / FR-1 gates — verified-chain derivation + the Commander's adversarial counterexamples. */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { deriveExperimentFacts, deriveExperimentState, experimentPaths } from "../server/state.ts";
import { contractFreezeOf, precommitBinding, verificationRulesetOf, verificationRulesetHash, contractFreezeHash, CANONICAL_INSTALL_COMMAND } from "../../../packages/user-evidence-r0/src/schema.ts";
import { filesBindingOf, sha256Of, sha256OfFile } from "../../../packages/user-evidence-r0/src/ledger.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "..", "..");
const REAL_VERIFY_MJS = path.join(repoRoot, "packages/user-evidence-r0/src/portable-replay.mjs");

const w = (file: string, data: string | Buffer): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
};
const wj = (file: string, obj: unknown): void => w(file, JSON.stringify(obj, null, 2) + "\n");

/** A synthetic but CLOSURE-VALID evidence chain — no execution, honest structure. */
function buildChain(d: string): void {
  const p = experimentPaths(d);
  const task = {
    schema_version: "real-task-experiment.v1",
    experiment_id: "ue-x",
    repository_url: "/tmp/synth-repo",
    base_commit_sha: "f".repeat(40),
    payer_identity: "payer:p",
    worker_identity: "worker:w",
    acceptance_suite: "test/regression.test.ts",
    acceptance_suite_sha256: "sha256:" + "a".repeat(64),
    acceptance_full_suite: ["test/green.test.ts"],
    full_suite_baseline_policy: "ALL_GREEN",
    lockfile_path: "package-lock.json",
    lockfile_sha256: "sha256:" + "b".repeat(64),
    allowed_paths: ["src/**"],
    forbidden_paths: ["test/**"],
    max_diff_lines: 40,
    new_dependencies_allowed: false,
    network: "disabled",
    determinism_runs: 3,
    tier1_reward: "10",
    tier2_reward: "0",
    claim_mode: "SINGLE_CLAIMANT",
    commands: {
      regression_command: "node node_modules/vitest/vitest.mjs run test/regression.test.ts",
      baseline_health_command: "node node_modules/vitest/vitest.mjs run test/green.test.ts",
      patched_acceptance_command: "node node_modules/vitest/vitest.mjs run test",
      package_manager: "npm",
      install_command: CANONICAL_INSTALL_COMMAND,
    },
    payer_precommit_text: "I agree.",
    payer_precommit_timestamp: "2026-10-03T00:00:00Z",
  };
  const manifest = {
    schema_version: "freeze-manifest.v2",
    experiment_id: task.experiment_id,
    base_commit_sha: task.base_commit_sha,
    acceptance_suite_sha256: task.acceptance_suite_sha256,
    lockfile_sha256: task.lockfile_sha256,
    verification_ruleset_hash: verificationRulesetHash(verificationRulesetOf(task)),
    contract_freeze_hash: contractFreezeHash(task),
    precommit_binding: precommitBinding(task),
    frozen_at: task.payer_precommit_timestamp,
    eligibility: "ELIGIBLE",
    preflight: { dependency_reconstruction: "CLEAN_ROOM_OK", network_sandbox: "DENIED_VERIFIED", base_regression: "RED", baseline_health: "GREEN", determinism: "3/3" },
  };
  wj(path.join(p.freezeDir, "task.json"), task);
  wj(path.join(p.freezeDir, "ruleset.json"), verificationRulesetOf(task));
  wj(path.join(p.freezeDir, "contract-freeze.json"), contractFreezeOf(task));
  wj(path.join(p.freezeDir, "freeze-manifest.json"), manifest);

  const snapshot = {
    repoPath: task.repository_url, base_commit_sha: task.base_commit_sha,
    payer_identity: task.payer_identity, worker_identity: task.worker_identity,
    tier1_reward: task.tier1_reward, tier2_reward: task.tier2_reward,
    allowed_paths: task.allowed_paths, forbidden_paths: task.forbidden_paths,
    max_diff_lines: task.max_diff_lines, determinism_runs: task.determinism_runs,
    regression_command: task.commands.regression_command,
    baseline_health_command: task.commands.baseline_health_command,
    patched_acceptance_command: task.commands.patched_acceptance_command,
    acceptance_suite: task.acceptance_suite, acceptance_full_suite: task.acceptance_full_suite,
  };
  wj(p.draft, { schema_version: "experiment-draft.v1", ...snapshot });
  wj(p.eligibility, { schema_version: "eligibility.v2", checked_at: "2026-10-03T00:00:00Z", ok: true, draft: snapshot, suiteHash: task.acceptance_suite_sha256, lockHash: task.lockfile_sha256, proven: manifest.preflight, review_id: sha256Of("synthetic-review") });

  const patchText = "diff --git a/src/add.ts b/src/add.ts\n--- a/src/add.ts\n+++ b/src/add.ts\n@@ -1 +1 @@\n-a\n+b";
  w(p.workerPatch, patchText); // NO trailing newline — exact bytes
  const record = {
    schema_version: "real-task-run.v1",
    experiment_id: task.experiment_id,
    worker_identity: task.worker_identity,
    freeze: { verification_ruleset_hash: manifest.verification_ruleset_hash, contract_freeze_hash: manifest.contract_freeze_hash, precommit_binding: manifest.precommit_binding },
    patch_sha256: sha256Of(patchText),
    patch_touched_paths: ["src/add.ts"], patch_added_lines: 1, patch_removed_lines: 1, policy_result: "OK",
    checks: {
      freeze_closure: "VERIFIED", symlink_free_paths: "OK", base_regression_recheck: "RED",
      install_boundary: "LIFECYCLE_SCRIPTS_DISABLED", post_install_bytes: "OK",
      lockfile_unchanged: "OK", suite_unchanged: "OK", dependency_policy: "OK",
      patched_acceptance: "GREEN", baseline_health_patched: "GREEN",
      determinism: "3/3", network_sandbox: "DENIED_VERIFIED",
    },
    runs: [{ stage: "install", command: CANONICAL_INSTALL_COMMAND, code: 0, stdout_sha256: "sha256:" + "a".repeat(64), duration_ms: 1 }],
    verdict: "VALID",
    ran_at: "2026-10-03T01:00:00Z",
  };
  wj(p.runRecord, record);

  // proof pack: the COMPLETE nine-file protocol set, every entry byte-verified
  cpSync(REAL_VERIFY_MJS, path.join(p.proofDir, "verify.mjs"));
  cpSync(path.join(p.freezeDir, "task.json"), path.join(p.proofDir, "task.json"));
  cpSync(path.join(p.freezeDir, "ruleset.json"), path.join(p.proofDir, "ruleset.json"));
  cpSync(path.join(p.freezeDir, "contract-freeze.json"), path.join(p.proofDir, "contract-freeze.json"));
  cpSync(path.join(p.freezeDir, "freeze-manifest.json"), path.join(p.proofDir, "freeze-manifest.json"));
  cpSync(p.runRecord, path.join(p.proofDir, "run-record.json"));
  w(path.join(p.proofDir, "worker.patch"), patchText);
  w(path.join(p.proofDir, "base.bundle"), "synthetic-git-bundle-bytes\n");
  const packFile = (name: string, file = path.join(p.proofDir, name)) => ({ sha256: sha256OfFile(file), bytes: readFileSync(file).length });
  const proofManifest = {
    schema_version: "outcome-proof-manifest.v1",
    experiment_id: task.experiment_id, built_at: "2026-10-03T02:00:00Z", tier1_verdict: "VALID",
    verification_ruleset_hash: manifest.verification_ruleset_hash, contract_freeze_hash: manifest.contract_freeze_hash,
    precommit_binding: manifest.precommit_binding, patch_sha256: record.patch_sha256,
    verifier_sha256: sha256OfFile(path.join(p.proofDir, "verify.mjs")),
    files: {
      "task.json": packFile("task.json"),
      "ruleset.json": packFile("ruleset.json"),
      "contract-freeze.json": packFile("contract-freeze.json"),
      "freeze-manifest.json": packFile("freeze-manifest.json"),
      "worker.patch": packFile("worker.patch"),
      "run-record.json": packFile("run-record.json"),
      "base.bundle": packFile("base.bundle"),
      "verify.mjs": packFile("verify.mjs"),
    },
  };
  wj(path.join(p.proofDir, "proof-manifest.json"), proofManifest);
  wj(p.replayReport, {
    schema_version: "portable-replay-report.v1", replayed_at: "2026-10-03T03:00:00Z",
    proof_manifest_sha256: sha256OfFile(path.join(p.proofDir, "proof-manifest.json")),
    files_binding: filesBindingOf(p.proofDir),
    status: "PASS", same_verdict: true, reproduced: { tier1_verdict: "VALID", reason: null, determinism: "3/3" },
    recorded: { tier1_verdict: "VALID" }, integrity: "OK", freeze_closure: "OK", verdict_binding: "OK",
  });
}

const freshChain = (): string => mkdtempSync(path.join(tmpdir(), "fr1-chain-"));

describe("[FR-1] the verified evidence chain", () => {
  test("happy synthetic chain → EARNED / AWAITING_PAYER", () => {
    const d = freshChain();
    try {
      buildChain(d);
      const s = deriveExperimentState(d);
      expect(s.facts.rules_state).toBe("FROZEN");
      expect(s.freezeVerified).toBe(true);
      expect(s.frozenTermsMatch).toBe(true);
      expect(s.facts.primary_verification).toBe("VALID");
      expect(s.patchBindingMatch).toBe(true);
      expect(s.proofChainMatch).toBe(true);
      expect(s.facts.replay).toBe("PASS");
      expect(s.facts.tier1_entitlement).toBe("EARNED");
      expect(s.phase).toBe("AWAITING_PAYER");
      expect(s.evidenceErrors).toEqual([]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("COUNTEREXAMPLE 1 (broken freeze closure) → NEVER EARNED, phase not AWAITING_PAYER", () => {
    const d = freshChain();
    try {
      buildChain(d);
      const taskFile = path.join(experimentPaths(d).freezeDir, "task.json");
      const orig = readFileSync(taskFile, "utf8");
      const task = JSON.parse(orig);
      task.tier1_reward = "999";
      wj(taskFile, task); // closure now fails AND terms mismatch
      const s = deriveExperimentState(d);
      expect(s.freezeVerified).toBe(false);
      expect(s.facts.rules_state).toBe("DRAFT");
      expect(s.facts.tier1_entitlement).not.toBe("EARNED");
      expect(s.phase).not.toBe("AWAITING_PAYER");
      expect(s.evidenceErrors.join(" ")).toMatch(/unverified|differ/);
      w(taskFile, orig);
      expect(deriveExperimentState(d).facts.tier1_entitlement).toBe("EARNED");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("chain break: record no longer binds the CURRENT patch bytes → primary falls, never EARNED", () => {
    const d = freshChain();
    try {
      buildChain(d);
      const p = experimentPaths(d);
      const orig = readFileSync(p.workerPatch, "utf8");
      w(p.workerPatch, orig + " "); // patch bytes changed after the run
      const s = deriveExperimentState(d);
      expect(s.patchBindingMatch).toBe(false);
      expect(s.facts.primary_verification).toBe("INVALID");
      expect(s.facts.tier1_entitlement).toBe("NOT_EARNED");
      expect(s.evidenceErrors.join(" ")).toContain("current submitted patch");
      w(p.workerPatch, orig);
      expect(deriveExperimentState(d).facts.tier1_entitlement).toBe("EARNED");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("chain break: proof pack decoupled from the current record → replay untrusted", () => {
    const d = freshChain();
    try {
      buildChain(d);
      const p = experimentPaths(d);
      const orig = readFileSync(p.runRecord, "utf8");
      const rec = JSON.parse(orig);
      rec.ran_at = "2026-10-03T09:00:00Z"; // record changed AFTER the pack was built
      wj(p.runRecord, rec);
      const s = deriveExperimentState(d);
      expect(s.proofChainMatch).toBe(false);
      expect(s.facts.replay).toBe("FAIL");
      expect(s.facts.tier1_entitlement).toBe("PENDING"); // primary VALID stands; entitlement unverified
      w(p.runRecord, orig);
      expect(deriveExperimentState(d).facts.tier1_entitlement).toBe("EARNED");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("fresh ≠ trusted: anchored bindings but swapped verifier bytes → replay FAIL", () => {
    const d = freshChain();
    try {
      buildChain(d);
      const p = experimentPaths(d);
      const verifyFile = path.join(p.proofDir, "verify.mjs");
      const orig = readFileSync(verifyFile);
      w(verifyFile, 'console.log("PASS");\n'); // attacker-swapped verifier, fully rehashable
      // attacker also re-hashes manifest + report so freshness alone would pass…
      const manifest = JSON.parse(readFileSync(path.join(p.proofDir, "proof-manifest.json"), "utf8"));
      manifest.files["verify.mjs"] = { sha256: sha256OfFile(verifyFile), bytes: readFileSync(verifyFile).length };
      manifest.verifier_sha256 = manifest.files["verify.mjs"].sha256;
      wj(path.join(p.proofDir, "proof-manifest.json"), manifest);
      const report = JSON.parse(readFileSync(p.replayReport, "utf8"));
      report.proof_manifest_sha256 = sha256OfFile(path.join(p.proofDir, "proof-manifest.json"));
      report.files_binding = filesBindingOf(p.proofDir);
      wj(p.replayReport, report);
      const s = deriveExperimentState(d);
      expect(s.facts.replay).toBe("FAIL");
      expect(s.replayUntrustedReason).toContain("do not match the EXPERIMENT-001 anchor");
      expect(s.facts.tier1_entitlement).not.toBe("EARNED");
      w(verifyFile, orig);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("COUNTEREXAMPLE 2 ({} observation / {} final ledger) → NOT RECORDED / NOT FINALIZED, evidence errors", () => {
    const d = freshChain();
    try {
      buildChain(d);
      const p = experimentPaths(d);
      mkdirSync(p.observationsDir, { recursive: true });
      w(path.join(p.observationsDir, "001.json"), "{}\n");
      w(p.finalLedger, "{}\n");
      const s = deriveExperimentState(d);
      expect(s.facts.payer_response).toBe("NONE");
      expect(s.facts.ledger).toBe("OPEN");
      expect(s.evidenceErrors.join(" ")).toMatch(/observation 001.json invalid/);
      expect(s.evidenceErrors.join(" ")).toMatch(/final ledger invalid/);
      expect(s.phase).toBe("AWAITING_PAYER"); // earned facts stand; recording is an evidence error
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

/** Valid observation + ledger fixtures bound to the synthetic chain (seq 1, accepts, 0 attempts, YES). */
function writeValidObsAndLedger(d: string): void {
  const p = experimentPaths(d);
  mkdirSync(p.observationsDir, { recursive: true });
  const report = JSON.parse(readFileSync(p.replayReport, "utf8"));
  const manifestSha = sha256OfFile(path.join(p.proofDir, "proof-manifest.json"));
  const transcript = "Q1 → YES";
  const obs = {
    schema_version: "real-task-observation.v1", seq: 1, recorded_at: "2026-10-03T00:00:00Z",
    pack_binding: { proof_manifest_sha256: manifestSha, files_binding: report.files_binding },
    replay_check: { status: "PASS", tier1_verdict: "VALID" },
    observations: {
      schema_version: "real-task-ledger-observations.v1", third_party_replay: "SAME",
      payer_accepts_tier1: true, payer_ack_verbatim: "yes", payer_ack_timestamp: "2026-10-03T00:00:00Z",
      posthoc_rule_change_attempts: 0, posthoc_rule_change_details: [], repeat_fund_intent: "YES",
      observation_source: "INTERVIEW", observer_identity: "op", source_record: transcript,
      source_record_sha256: sha256Of(transcript), payer_attestation: "UNSIGNED_RECORDED", recorded_at: "2026-10-03T00:00:00Z",
    },
  };
  wj(path.join(p.observationsDir, "001.json"), obs);
  wj(p.finalLedger, {
    schema_version: "real-task-ledger.v1", experiment_id: "ue-x", finalized_at: "2026-10-03T00:00:00Z",
    finality: { observation_seq: 1, observations_total: 1, final: true },
    technical: { tier1_verdict: "VALID", third_party_replay: "SAME", proof_manifest_sha256: manifestSha },
    user_evidence: { payer_accepts_tier1: true, repeat_fund_intent: "YES", posthoc_rule_change_attempts: 0, posthoc_rule_change_details: [] },
    verdict: "THESIS STRENGTHENED", rendered: "",
  });
}

describe("[FR-1] review round-3 counterexamples (finalized-ledger authenticity)", () => {
  test("REVIEW-3A: FINALIZED with replay evidence DELETED afterwards → un-finalized + named integrity error", () => {
    const d = freshChain();
    try {
      buildChain(d);
      writeValidObsAndLedger(d);
      expect(deriveExperimentState(d).facts.ledger).toBe("FINALIZED");
      const orig = readFileSync(experimentPaths(d).replayReport, "utf8");
      rmSync(experimentPaths(d).replayReport);
      const s = deriveExperimentState(d);
      expect(s.facts.tier1_entitlement).toBe("PENDING");
      expect(s.facts.ledger).toBe("OPEN"); // the finalized claim does not survive broken evidence
      expect(s.phase).not.toBe("FINALIZED");
      expect(s.evidenceErrors.join(" ")).toContain("underlying evidence chain no longer verifies");
      w(experimentPaths(d).replayReport, orig);
      expect(deriveExperimentState(d).facts.ledger).toBe("FINALIZED");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("REVIEW-3B: ledger rule-change attempts tampered to 999 → OPEN + named disagreement", () => {
    const d = freshChain();
    try {
      buildChain(d);
      writeValidObsAndLedger(d);
      const p = experimentPaths(d);
      const ledger = JSON.parse(readFileSync(p.finalLedger, "utf8"));
      ledger.user_evidence.posthoc_rule_change_attempts = 999;
      wj(p.finalLedger, ledger);
      const s = deriveExperimentState(d);
      expect(s.facts.ledger).toBe("OPEN");
      expect(s.evidenceErrors.join(" ")).toContain("rule-change attempts disagree");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("[FR-1] review round-2 counterexamples", () => {
  test("REVIEW-2A: an INCOMPLETE pack (manifest+verify.mjs only) with recomputed digests → never EARNED", () => {
    const d = freshChain();
    try {
      buildChain(d);
      const p = experimentPaths(d);
      // delete seven of the nine files, keep manifest + verify.mjs (the reviewer's shape)
      for (const f of ["task.json", "ruleset.json", "contract-freeze.json", "freeze-manifest.json", "worker.patch", "run-record.json", "base.bundle"]) {
        rmSync(path.join(p.proofDir, f));
      }
      // attacker recomputes the report digests over what remains
      const report = JSON.parse(readFileSync(p.replayReport, "utf8"));
      report.files_binding = filesBindingOf(p.proofDir);
      wj(p.replayReport, report);
      const s = deriveExperimentState(d);
      expect(s.facts.replay).toBe("FAIL");
      expect(s.facts.tier1_entitlement).not.toBe("EARNED");
      expect(s.phase).not.toBe("AWAITING_PAYER");
      expect(s.evidenceErrors.join(" ")).toContain("nine-file");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("REVIEW-2B: verifier DELETED from the pack, digests recomputed → FAIL (missing verifier is a failure, not a skip)", () => {
    const d = freshChain();
    try {
      buildChain(d);
      const p = experimentPaths(d);
      rmSync(path.join(p.proofDir, "verify.mjs"));
      const report = JSON.parse(readFileSync(p.replayReport, "utf8"));
      report.files_binding = filesBindingOf(p.proofDir);
      wj(p.replayReport, report);
      const s = deriveExperimentState(d);
      expect(s.facts.replay).toBe("FAIL");
      expect(s.facts.tier1_entitlement).not.toBe("EARNED");
      expect(s.evidenceErrors.join(" ")).toMatch(/nine-file|verify.mjs bytes/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("REVIEW-2C: well-formed observation/ledger WITHOUT any proof pack → NOT RECORDED / NOT FINALIZED", () => {
    const d = freshChain();
    try {
      const p = experimentPaths(d);
      mkdirSync(p.observationsDir, { recursive: true });
      const transcript = "Q1 → YES";
      const obs = {
        schema_version: "real-task-observation.v1",
        seq: 1,
        recorded_at: "2026-10-03T00:00:00Z",
        pack_binding: { proof_manifest_sha256: "sha256:" + "c".repeat(64), files_binding: "sha256:" + "d".repeat(64) },
        replay_check: { status: "PASS", tier1_verdict: "VALID" },
        observations: {
          schema_version: "real-task-ledger-observations.v1", third_party_replay: "SAME",
          payer_accepts_tier1: true, payer_ack_verbatim: "yes", payer_ack_timestamp: "2026-10-03T00:00:00Z",
          posthoc_rule_change_attempts: 0, posthoc_rule_change_details: [], repeat_fund_intent: "YES",
          observation_source: "INTERVIEW", observer_identity: "op", source_record: transcript,
          source_record_sha256: sha256Of(transcript), payer_attestation: "UNSIGNED_RECORDED", recorded_at: "2026-10-03T00:00:00Z",
        },
      };
      wj(path.join(p.observationsDir, "001.json"), obs);
      wj(p.finalLedger, {
        schema_version: "real-task-ledger.v1", experiment_id: "ue-x", finalized_at: "2026-10-03T00:00:00Z",
        finality: { observation_seq: 1, observations_total: 1, final: true },
        technical: { tier1_verdict: "VALID", third_party_replay: "SAME", proof_manifest_sha256: "sha256:" + "c".repeat(64) },
        user_evidence: { payer_accepts_tier1: true, repeat_fund_intent: "YES", posthoc_rule_change_attempts: 0 },
        verdict: "THESIS STRENGTHENED", rendered: "",
      });
      const s = deriveExperimentState(d);
      expect(s.facts.payer_response).toBe("NONE");
      expect(s.facts.ledger).toBe("OPEN");
      expect(s.facts.tier1_entitlement).toBe("PENDING");
      expect(s.evidenceErrors.join(" ")).toContain("without a valid, chain-bound proof pack");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("REVIEW-2D: ledger disagreeing with the latest valid observation → OPEN", () => {
    const d = freshChain();
    try {
      buildChain(d);
      const p = experimentPaths(d);
      const report = JSON.parse(readFileSync(p.replayReport, "utf8"));
      const manifestSha = sha256OfFile(path.join(p.proofDir, "proof-manifest.json"));
      const transcript = "Q1 → YES";
      const obs = {
        schema_version: "real-task-observation.v1", seq: 1, recorded_at: "2026-10-03T00:00:00Z",
        pack_binding: { proof_manifest_sha256: manifestSha, files_binding: report.files_binding },
        replay_check: { status: "PASS", tier1_verdict: "VALID" },
        observations: {
          schema_version: "real-task-ledger-observations.v1", third_party_replay: "SAME",
          payer_accepts_tier1: true, payer_ack_verbatim: "yes", payer_ack_timestamp: "2026-10-03T00:00:00Z",
          posthoc_rule_change_attempts: 0, posthoc_rule_change_details: [], repeat_fund_intent: "YES",
          observation_source: "INTERVIEW", observer_identity: "op", source_record: transcript,
          source_record_sha256: sha256Of(transcript), payer_attestation: "UNSIGNED_RECORDED", recorded_at: "2026-10-03T00:00:00Z",
        },
      };
      mkdirSync(p.observationsDir, { recursive: true });
      wj(path.join(p.observationsDir, "001.json"), obs);
      wj(p.finalLedger, {
        schema_version: "real-task-ledger.v1", experiment_id: "ue-x", finalized_at: "2026-10-03T00:00:00Z",
        finality: { observation_seq: 1, observations_total: 1, final: true },
        technical: { tier1_verdict: "VALID", third_party_replay: "SAME", proof_manifest_sha256: manifestSha },
        user_evidence: { payer_accepts_tier1: true, repeat_fund_intent: "YES", posthoc_rule_change_attempts: 0 },
        verdict: "THESIS CHALLENGED", rendered: "", // LIES: derived conclusion is STRENGTHENED
      });
      const s = deriveExperimentState(d);
      expect(s.facts.payer_response).toBe("RECORDED");
      expect(s.facts.ledger).toBe("OPEN"); // disagrees with the derived conclusion
      expect(s.evidenceErrors.join(" ")).toContain("verdict THESIS CHALLENGED != derived THESIS STRENGTHENED");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("[FR-1] readiness (D5) and transients", () => {
  test("eligibility ok → READY_TO_FREEZE; failed stays DRAFT; input changes invalidate; snapshot missing never ready", () => {
    const d = freshChain();
    try {
      const p = experimentPaths(d);
      const draft = { payer_identity: "p", worker_identity: "w", tier1_reward: "10", base_commit_sha: "a".repeat(40), acceptance_suite: "t/a.test.ts", acceptance_full_suite: ["t/b.test.ts"] };
      wj(p.eligibility, { ok: false, reason: "base-not-red" });
      expect(deriveExperimentState(d).phase).toBe("DRAFT");
      wj(p.draft, draft);
      wj(p.eligibility, { ok: true, draft, review_id: "sha256:" + "1".repeat(64) });
      expect(deriveExperimentState(d).phase).toBe("READY_TO_FREEZE");
      wj(p.draft, { ...draft, tier1_reward: "99" });
      expect(deriveExperimentState(d).phase).toBe("DRAFT");
      expect(deriveExperimentState(d).readiness.reason).toContain("tier1_reward");
      wj(p.draft, draft);
      expect(deriveExperimentState(d).phase).toBe("READY_TO_FREEZE");
      wj(p.eligibility, { ok: true });
      expect(deriveExperimentState(d).phase).toBe("DRAFT");
      wj(p.eligibility, { ok: true, draft, review_id: "sha256:" + "1".repeat(64) });
      expect(deriveExperimentState(d, { checking: true }).phase).toBe("CHECKING");
      expect(deriveExperimentState(d).phase).toBe("READY_TO_FREEZE");
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
    expect(readFileSync(serverSources[1]!, "utf8")).toContain("tier1VerdictOf"); // derived verdict, never a raw string
  });

  test("no second implementation of backend truth in the orchestrator/web layer", () => {
    for (const file of serverSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file}: no hash computation`).not.toContain("createHash");
      expect(src, `${file}: no canonical serialization`).not.toContain("deepSort");
      expect(src, `${file}: no glob matching`).not.toContain("globToRegExp");
      expect(src, `${file}: no policy parsing`).not.toContain("parseUnifiedPatch");
    }
  });

  test("command regex guessing is gone (P0-6)", () => {
    expect(readFileSync(serverSources[0]!, "utf8")).not.toContain("acceptanceSuiteOf");
  });

  test("frontend red lines: forbidden wording never appears; mandated copy does", () => {
    const ui = readFileSync(path.join(pkgDir, "web/app.js"), "utf8") + readFileSync(path.join(pkgDir, "web/index.html"), "utf8");
    for (const banned of ["Payment complete", "Funds released", "Escrow released", "PAYER-ATTESTED", "Auto release", "Create bounty", "Publish", "Launch task", "Possible reward", "Up to", "Maintainer approval required"]) {
      expect(ui, banned).not.toContain(banned);
    }
    expect(ui).toContain("One experiment is not evidence of product-market fit.");
    expect(ui).toContain("This is a derived protocol result. It is not a maintainer approval.");
    expect(ui).toContain("not used in this experiment");
    expect(ui).toContain("declared, not authenticated");
    // F4 EARNED is the landing view of AWAITING_PAYER; F5 is an explicit step (review fix)
    expect(ui).toMatch(/AWAITING_PAYER[\s\S]{0,400}#f5[\s\S]{0,200}renderVerification/);
  });
});
