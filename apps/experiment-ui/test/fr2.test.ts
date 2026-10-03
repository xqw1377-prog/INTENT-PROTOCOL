/** FRONTEND-R1 / FR-2 gates — F1 Prepare / Eligibility / Freeze over the REAL frozen machinery (E2E). */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Server } from "node:http";
import { createExperimentServer, PRECOMMIT_STATEMENT } from "../server/index.ts";
import { deriveExperimentState } from "../server/state.ts";
import { fixableConfig, makeFixableRepo } from "../../../packages/user-evidence-r0/test/helpers.ts";

let repo = { dir: "", sha: "" };
let exp = "";
let server: Server | null = null;
let base = "";

beforeAll(async () => {
  repo = makeFixableRepo();
  exp = mkdtempSync(path.join(tmpdir(), "fr2-exp-"));
  server = createExperimentServer(exp);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server!.address();
  if (addr && typeof addr === "object") base = `http://127.0.0.1:${addr.port}`;
}, 1_200_000);

afterAll(() => {
  server?.close();
  rmSync(exp, { recursive: true, force: true });
  rmSync(repo.dir, { recursive: true, force: true });
});

async function call(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + p, body ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { method });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const cfg = () => fixableConfig(repo.dir, repo.sha);

describe("[FR-2] F1 — Prepare / Check eligibility / Payer review / Freeze", () => {
  test("[FR2-PREPARE] configuration persists; unfrozen context is visibly labeled in the sidecar", async () => {
    const c = cfg();
    const r = await call("POST", "/api/prepare", {
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
      acceptance_suite: c.acceptance_suite,
      acceptance_full_suite: c.acceptance_full_suite,
      notes: { issue_url: "#412 — Fix parser crash", summary: "Parser crashes on nested input.", payer_quote: "" },
    });
    expect(r.status).toBe(200);
    const notes = JSON.parse(readFileSync(path.join(exp, "experiment-notes.json"), "utf8"));
    expect(notes.unfrozen).toBe(true);
    expect(notes.disclaimer).toContain("NOT part of the frozen contract");
    // payer + assigned worker visible in state payload
    const s = await call("GET", "/api/state");
    expect(s.json.draft.payer_identity).toBe("payer:alice-maintainer");
    expect(s.json.draft.worker_identity).toBe("worker:bob-external");
    expect(s.json.phase).toBe("DRAFT");
  });

  test("[FR2-ELIGIBILITY-BEFORE-PRECOMMIT] preflight runs with NO precommit yet; proven facts recorded", { timeout: 1_200_000 }, async () => {
    const r = await call("POST", "/api/check-eligibility");
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.proven).toMatchObject({ base_regression: "RED", baseline_health: "GREEN", network_sandbox: "DENIED_VERIFIED", dependency_reconstruction: "CLEAN_ROOM_OK" });
    // no freeze pack exists yet — nothing hash-bound, no precommit anywhere on disk
    expect(existsSync(path.join(exp, "freeze"))).toBe(false);
    const s = await call("GET", "/api/state");
    expect(s.json.phase).toBe("READY_TO_FREEZE");
    expect(s.json.facts.rules_state).toBe("DRAFT");
  });

  test("[FR2-FREEZE-GATE] freeze REFUSES without the explicit payer acknowledgement", async () => {
    const r = await call("POST", "/api/freeze", { reviewId: "x", reviewedTerms: {} });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("payer pre-commit acknowledgement required");
    expect(existsSync(path.join(exp, "freeze"))).toBe(false);
  });

  test("[FR2-FREEZE] explicit payer action bound to the reviewed snapshot → REAL freeze; precommit verbatim; phase FROZEN", { timeout: 1_200_000 }, async () => {
    const st = (await call("GET", "/api/state")).json;
    // P0-4: a consent without the snapshot identity is refused
    const noReview = await call("POST", "/api/freeze", { precommitAcknowledged: true });
    expect(noReview.status).toBe(409);
    expect(noReview.json.error).toContain("review expired");
    const r = await call("POST", "/api/freeze", { precommitAcknowledged: true, reviewId: st.eligibility.review_id, reviewedTerms: st.eligibility.draft });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    const task = JSON.parse(readFileSync(path.join(exp, "freeze", "task.json"), "utf8"));
    expect(task.payer_precommit_text).toBe(PRECOMMIT_STATEMENT); // the pre-commit moment IS the frozen text
    expect(task.commands.install_command).toBe("npm ci --ignore-scripts"); // install authority: never operator-supplied
    expect(task.claim_mode).toBe("SINGLE_CLAIMANT");
    const manifest = JSON.parse(readFileSync(path.join(exp, "freeze", "freeze-manifest.json"), "utf8"));
    expect(manifest.eligibility).toBe("ELIGIBLE");
    const s = await call("GET", "/api/state");
    expect(s.json.phase).toBe("FROZEN");
    expect(s.json.facts.rules_state).toBe("FROZEN");
    expect(s.json.frozen.payer_identity).toBe("payer:alice-maintainer");
    expect(s.json.frozen.contract_freeze_hash).toBe(manifest.contract_freeze_hash);
  });

  test("[FR2-NO-DOUBLE-FREEZE] a second freeze is refused; state derivation stays FROZEN from disk", { timeout: 1_200_000 }, async () => {
    const r = await call("POST", "/api/freeze", { precommitAcknowledged: true, reviewId: "stale", reviewedTerms: {} });
    expect(r.status).toBe(409); // duplicate freeze requests are disabled
    expect(r.json.error).toContain("already frozen");
    expect(deriveExperimentState(exp).phase).toBe("FROZEN");
    const r2 = await call("POST", "/api/check-eligibility");
    expect(r2.status).toBe(409); // no re-checking after freeze
  });
});
