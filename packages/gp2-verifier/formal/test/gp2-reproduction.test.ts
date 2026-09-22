import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { gitShow, loadCapture, sha256, snapJson, targetFile } from "../../src/indep.js";
import { reproduceFrozenTask, type ReplayResult } from "../../src/replay.js";

/**
 * P4 REPRODUCTION EVIDENCE — records the REAL F7 observations into
 * report/gp2-reproduction.json. No hardcoded conclusions: every field is
 * written from the live replay object; the only assertions are structural
 * (the file must reflect an actually-executed replay).
 */
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cap = loadCapture();
const report = snapJson<{ execution_id: string }>("candidate-report.json");
const task = JSON.parse(gitShow(`${cap.pinned_sha}:packages/golden-path/fixtures/gp-001-task.json`).toString("utf8")) as {
  base_commit_sha: string; package_path: string; max_attempts: number;
  acceptance_suite_path: string; acceptance_suite_sha256: string;
};

describe("[F7-REC] reproduction evidence recorder", () => {
  test("[R.1] run the real reproduction and record observed facts", () => {
    const replay: ReplayResult = reproduceFrozenTask({
      baseCommit: task.base_commit_sha,
      packagePath: task.package_path,
      maxAttempts: task.max_attempts,
      committedPatch: targetFile(cap.pinned_sha, `packages/golden-path/evidence/${cap.evidence_run_id}/raw/agent-patch.bin`),
    });
    try {
      const taskBytes = gitShow(`${cap.pinned_sha}:packages/golden-path/fixtures/gp-001-task.json`);
      const suiteBytes = gitShow(`${task.base_commit_sha}:${task.acceptance_suite_path}`);
      const observed = {
        report_kind: "gp2-reproduction-evidence",
        generated_at: new Date().toISOString(),
        target_sha: cap.pinned_sha,
        run_id: report.execution_id,
        method: "independent clean-checkout replay (verifier executor, zero gp-execution imports); committed patch bytes applied verbatim after independent re-derivation",
        frozen_truth: {
          base_commit_sha: task.base_commit_sha,
          task_freeze_hash: sha256(taskBytes),
          acceptance_suite_sha256: sha256(suiteBytes),
          frozen_acceptance_suite_sha256: task.acceptance_suite_sha256,
        },
        observed: {
          base_acceptance: replay.base_counts,
          patched_acceptance: replay.patched_counts,
          build_exit: replay.build_exit,
          derived_patch_sha256: replay.derived_patch_sha256,
          committed_patch_sha256: sha256(targetFile(cap.pinned_sha, `packages/golden-path/evidence/${cap.evidence_run_id}/raw/agent-patch.bin`)),
          changed_paths: replay.changed_paths,
          retry_after_2000ms_semantics_observed: replay.retry_2000ms_semantics,
          max_attempts_observed: replay.max_attempts_observed,
          non429_no_retry_observed: replay.non429_no_retry,
        },
        note: "observed values only — conclusions are drawn by the formal checks in gp2-formal-replay.test.ts, not by this file",
      };
      mkdirSync(path.join(pkgDir, "report"), { recursive: true });
      writeFileSync(path.join(pkgDir, "report/gp2-reproduction.json"), JSON.stringify(observed, null, 2) + "\n");
      expect(observed.observed.patched_acceptance).toBeDefined();
      expect(observed.observed.build_exit).toBeDefined();
      expect(observed.frozen_truth.task_freeze_hash).toBe("sha256:95ca98eb0146c56be577f9704d8640bb99ef38b5271a94496fc8cc6aa61121e5");
      expect(observed.frozen_truth.acceptance_suite_sha256).toBe(observed.frozen_truth.frozen_acceptance_suite_sha256);
    } finally {
      replay.dispose();
    }
  }, 240_000);
});
