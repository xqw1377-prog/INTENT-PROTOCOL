import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { gitShow, loadCapture, sha256, snapFile, snapJson } from "../../src/indep.js";
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
};

describe("[F7-REC] reproduction evidence recorder", () => {
  test("[R.1] run the real reproduction and record observed facts", () => {
    const replay: ReplayResult = reproduceFrozenTask({
      baseCommit: task.base_commit_sha,
      packagePath: task.package_path,
      maxAttempts: task.max_attempts,
      committedPatch: snapFile("evidence/raw/agent-patch.bin"),
    });
    try {
      const observed = {
        report_kind: "gp2-reproduction-evidence",
        generated_at: new Date().toISOString(),
        target_sha: cap.pinned_sha,
        run_id: report.execution_id,
        method: "independent clean-checkout replay (verifier executor, zero gp-execution imports); committed patch bytes applied verbatim after independent re-derivation",
        observed: {
          base_acceptance: replay.base_counts,
          patched_acceptance: replay.patched_counts,
          build_exit: replay.build_exit,
          derived_patch_sha256: replay.derived_patch_sha256,
          committed_patch_sha256: sha256(snapFile("evidence/raw/agent-patch.bin")),
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
    } finally {
      replay.dispose();
    }
  }, 240_000);
});
