import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { canonicalize, IntentContractSchema, MilestoneSchema, seal } from "@intent/protocol-schema";

/**
 * GP-ID-R1 V3 (Issue #33 CriterionV1 Exact Freeze Table + V3 review B1-B7).
 * READ-ONLY verification: intent.json and milestone.json are pre-sealed and
 * persisted on disk BEFORE tests run. Tests only read + verify. No writes.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ID_DIR = path.join(repoRoot, "packages/golden-path/identity");
const BASE = "3fbef701165a86d3ad6fd95af695b78ebe74fee7";
const EVID = "packages/golden-path/evidence/9f6610dc-24e9-4e6c-b7c1-67574064d2ae";
const gitShow = (spec: string): string => execFileSync("git", ["show", spec], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitOut = (args: string[]): string => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

const intent = JSON.parse(readFileSync(path.join(ID_DIR, "intent.json"), "utf8"));
const milestone = JSON.parse(readFileSync(path.join(ID_DIR, "milestone.json"), "utf8"));
const provenance = JSON.parse(readFileSync(path.join(ID_DIR, "provenance.json"), "utf8"));
const holdPolicy = JSON.parse(readFileSync(path.join(ID_DIR, "policies/gp-001-settlement-hold-v1.json"), "utf8"));
const bundle = JSON.parse(gitShow(`${BASE}:${EVID}/bundle.json`));

const FROZEN_CRIT_IDS = [
  "crit-01-retry-after-2000ms",
  "crit-02-subsequent-200-returned",
  "crit-03-max-attempts-3",
  "crit-04-non429-no-retry",
  "crit-05-existing-tests-pass",
  "crit-06-build-typecheck-pass",
  "crit-07-allowed-paths-only",
  "crit-08-acceptance-suite-unchanged",
];
const FROZEN_CONSTRAINT_IDS = ["cons-forbidden-paths", "cons-max-attempts-3", "cons-deadline"];

describe("[GP-ID-R1-V3] identity materialization", () => {
  test("[V3.1] B6: intent.json IS pre-sealed with correct content_hash", () => {
    expect(intent.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const resealed = seal(IntentContractSchema as never, intent) as Record<string, any>;
    expect(resealed.content_hash).toBe(intent.content_hash);
  });

  test("[V3.2] B6: milestone.json IS pre-sealed with correct content_hash", () => {
    expect(milestone.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const resealed = seal(MilestoneSchema as never, milestone) as Record<string, any>;
    expect(resealed.content_hash).toBe(milestone.content_hash);
  });

  test("[V3.3] B3: exactly 8 CriterionV1 in Commander's frozen order with frozen IDs", () => {
    expect(intent.success_criteria).toHaveLength(8);
    expect(intent.success_criteria.map((c: any) => c.criterion_id)).toEqual(FROZEN_CRIT_IDS);
  });

  test("[V3.4] B3: criterion bodies match the freeze table EXACTLY (spot: C1 + C7 + C8)", () => {
    const c1 = intent.success_criteria[0];
    expect(c1.assertion).toBe('HTTP 429 + Retry-After: "2" causes a 2000 ms retry delay, then retries.');
    expect(c1.verifier_ref).toBe("verifier:gp3-functional");
    expect(c1.evidence_requirements[0]).toEqual({ kind: "acceptance-suite", min_level: "E1", source: "packages/golden-path/demo/test/acceptance.test.ts", required: true });
    expect(c1.threshold).toEqual({ requested_delay_ms: 2000 });

    const c7 = intent.success_criteria[6];
    expect(c7.verifier_ref).toBe("verifier:gp3-policy");
    expect(c7.evidence_requirements[0]).toEqual({ kind: "patch-diff", min_level: "E2", source: "evidence:agent-patch", required: true });
    expect(c7.threshold.allowed_paths).toEqual(["packages/golden-path/demo/src/**"]);
    expect(c7.threshold.forbidden_paths).toEqual([
      "packages/golden-path/demo/test/**", "packages/golden-path/demo/package.json",
      "packages/golden-path/demo/tsconfig.json", "packages/golden-path/fixtures/**",
    ]);

    const c8 = intent.success_criteria[7];
    expect(c8.evidence_requirements[0]).toEqual({ kind: "suite-identity", min_level: "E2", source: "git-object:packages/golden-path/demo/test/acceptance.test.ts", required: true });
    expect(c8.threshold).toEqual({ sha256: "sha256:2357f37db27841204960d44c3a14b5e4976539a6cb9c3d5a805d21e9663db31c" });
  });

  test("[V3.5] B3: no extra threshold metadata anywhere", () => {
    for (const c of intent.success_criteria) {
      const t = JSON.stringify(c.threshold);
      expect(t).not.toContain("gp0_criterion");
      expect(t).not.toContain("suite_test");
    }
  });

  test("[V3.6] B4: exactly 3 constraints, frozen IDs + kinds, NO max_risk_level", () => {
    expect(intent.constraints).toHaveLength(3);
    expect(intent.constraints.map((c: any) => c.constraint_id)).toEqual(FROZEN_CONSTRAINT_IDS);
    expect(intent.constraints[0].kind).toBe("SCOPE");
    expect(intent.constraints[1].kind).toBe("OTHER");
    expect(intent.constraints[2].kind).toBe("TIME");
    for (const c of intent.constraints) {
      expect(c).not.toHaveProperty("max_risk_level");
    }
  });

  test("[V3.7] B2: goal text, URIs, owner, domain, execution_cap, created_at — Commander's exact values", () => {
    expect(intent.goal.statement).toBe("`retryFetch()` mishandles HTTP 429 `Retry-After` seconds. The Agent must fix the implementation without changing the public API or the frozen acceptance suite.");
    expect(intent.goal.target_state).toBe("All eight frozen GP-001 acceptance criteria are satisfied and the accepted patch changes only frozen allowed implementation paths.");
    expect(intent.goal.domain).toBe("software-delivery");
    expect(intent.owner_subject).toBe("operator:gp-001");
    expect(intent.budget.execution_cap).toBe("0");
    expect(intent.intent_id).toBe("62b2ed5d-d984-4591-8630-98213d2d1d20");
    expect(intent.created_at).toBe("2026-09-22T23:56:59.000Z");
    expect(intent.verification_policy_ref.uri).toBe("urn:sha256:b8933eb4f466c8994cc3f0648b80f72d3f1c2ab50bdcb1eb3907f4100fb9510d");
    expect(intent.settlement_policy_ref.uri).toBe("urn:sha256:78f775b8d711b734648baa08dd91553ad41f69f96296df9bb879f1da665b64fe");
  });

  test("[V3.8] HOLD policy canonical hash matches", () => {
    const canonical = canonicalize(holdPolicy);
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const hash = "sha256:" + crypto.createHash("sha256").update(canonical).digest("hex");
    expect(hash).toBe("sha256:78f775b8d711b734648baa08dd91553ad41f69f96296df9bb879f1da665b64fe");
    expect(intent.settlement_policy_ref.hash).toBe(hash);
  });

  test("[V3.9] milestone binds to intent + PASSED GP2 bundle anchor", () => {
    expect(milestone.intent_hash).toBe(intent.content_hash);
    expect(milestone.milestone_id).toBe(bundle.milestone_id);
    expect(milestone.milestone_revision).toBe(bundle.milestone_revision);
    expect(milestone.verification_policy_hash).toBe(bundle.policy_hash);
    expect(milestone.settlement_policy_hash).toBe(intent.settlement_policy_ref.hash);
    expect(milestone.criterion_ids).toEqual(intent.success_criteria.map((c: any) => c.criterion_id));
  });

  test("[V3.10] UNRESOLVED_FIELDS = [] + POST_GP2_REMEDIATION", () => {
    expect(provenance.UNRESOLVED_FIELDS).toEqual([]);
    expect(provenance.materialization_timing).toBe("POST_GP2_REMEDIATION");
  });

  test("[V3.11] B1: full git diff vs 3fbef70 matches the EXACT allowlist (identity only)", () => {
    const changed = gitOut(["diff", "--name-only", `${BASE}...HEAD`]).split("\n").filter(Boolean);
    const allowlist = [
      "packages/golden-path/identity/intent.json",
      "packages/golden-path/identity/milestone.json",
      "packages/golden-path/identity/provenance.json",
      "packages/golden-path/identity/policies/gp-001-settlement-hold-v1.json",
    ];
    // test files also allowed (start with packages/golden-path/identity/test/)
    for (const p of changed) {
      const ok = allowlist.includes(p) || p.startsWith("packages/golden-path/identity/test/");
      expect(ok, `scope violation: ${p}`).toBe(true);
    }
    // explicit: NO GP2 evidence/report/verifier changes
    for (const p of changed) {
      expect(p.startsWith("packages/golden-path/evidence/"), `no new evidence dirs: ${p}`).toBe(false);
      expect(p.startsWith("packages/gp-execution/report/"), `no GP2 report changes: ${p}`).toBe(false);
      expect(p.startsWith("packages/gp2-verifier/report/"), `no verifier report changes: ${p}`).toBe(false);
    }
  });

  test("[V3.12] B5: test execution leaves the worktree clean (READ-ONLY verification)", () => {
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
    const dirty = (status.stdout || "").split("\n").filter((l) => l.trim().length > 0);
    // this test itself is running; vitest may create .vite cache — filter those
    // B5: tests must not MUTATE already-committed files. New untracked files
    // that are part of this candidate (identity/**) are expected; anything
    // else — especially ` M ` modifications to committed GP2 surfaces — fails.
    const mutations = dirty.filter((l) => l.startsWith(" M ") || l.startsWith("M  "));
    expect(mutations, `no already-committed file may be modified: ${mutations.join("; ")}`).toEqual([]);
  });
});
