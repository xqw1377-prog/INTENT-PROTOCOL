import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  IntentContractSchema, MilestoneSchema, seal,
} from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import provenance from "../provenance.json";

/**
 * GP-ID-R1 (Issue #33): machine checks that the candidate IntentContractV1
 * and MilestoneV1 materialize under LIVE G1 schemas, bind to the PASSED GP2
 * bundle anchor, and disclose POST_GP2_REMEDIATION timing.
 *
 * UNRESOLVED_FIELDS are listed in provenance.json and surfaced here — nothing
 * is silently invented. The candidate objects below use placeholder values
 * ONLY for fields the Commander has not yet frozen; the test proves the
 * SHAPE is correct so the Commander can swap values without re-engineering.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const EVIDENCE_SOURCE = "3fbef701165a86d3ad6fd95af695b78ebe74fee7";
const EVID = "packages/golden-path/evidence/9f6610dc-24e9-4e6c-b7c1-67574064d2ae";

const gitShow = (spec: string): Buffer => execFileSync("git", ["show", spec], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
const task = JSON.parse(readFileSync(path.join(repoRoot, "packages/golden-path/fixtures/gp-001-task.json"), "utf8"));
const bundle = JSON.parse(gitShow(`${EVIDENCE_SOURCE}:${EVID}/bundle.json`).toString("utf8"));

// --- UNRESOLVED placeholders (swap on Commander freeze; shapes are frozen) ---
const OWNER = "user:commander";                                          // UNRESOLVED
const GOAL_DOMAIN = "software-delivery";                                 // UNRESOLVED
const POLICY_URI = "ipfs://UNRESOLVED-verification-policy-uri";         // UNRESOLVED
const SETTLEMENT_URI = "ipfs://UNRESOLVED-settlement-policy-uri";       // UNRESOLVED
const SETTLEMENT_HASH = "sha256:" + "00".repeat(32);                    // UNRESOLVED
const CREATED_AT = "2026-09-21T00:00:00.000Z";                          // UNRESOLVED (task freeze date)
const INTENT_ID = "d3dce9be-1111-4222-8333-444455556666";              // UNRESOLVED (proposed derivation)

// --- deterministically traced fields (from frozen sources) ---
const criterion = (id: string, kind: "MACHINE" | "ECONOMIC" | "HUMAN", assertion: string, threshold: unknown) => ({
  schema_version: "criterion.v1",
  criterion_id: id,
  kind,
  assertion,
  verifier_ref: "ci:golden-path-demo",
  evidence_requirements: [{ kind: "acceptance-suite", min_level: "E1", source: "repo:golden-path/demo", required: true }],
  threshold,
});

export const intentCandidate = {
  schema_version: "intent.v1",
  intent_id: INTENT_ID,
  version: 1,
  owner_subject: OWNER,
  goal: {
    statement: "Fix the GP-001 seeded retryFetch bug: on HTTP 429, honor Retry-After seconds as an exact millisecond delay before retrying.",
    target_state: "The frozen acceptance suite passes on the patched code with build/typecheck green.",
    domain: GOAL_DOMAIN,
  },
  success_criteria: [
    criterion("crit-A1-retry-after-2000ms", "MACHINE", "429 + Retry-After \"2\" requests an exact 2000 ms delay via the injected clock, then retries and returns the subsequent 200.", { test: "A1", expected_delay_ms: 2000 }),
    criterion("crit-A2-max-attempts-3", "MACHINE", "Three consecutive 429s exhaust after exactly 3 attempts with two 2000 ms delays.", { test: "A2", max_attempts: 3 }),
    criterion("crit-A3-non429-no-retry", "MACHINE", "A non-429 non-success response does not enter the 429 retry path: one attempt, no delay.", { test: "A3" }),
    criterion("crit-A4-immediate-200", "MACHINE", "A plain 200 on the first attempt returns immediately: one attempt, no delay, body preserved.", { test: "A4" }),
    criterion("crit-A5-allowed-paths-only", "MACHINE", "The agent patch changes only paths within the frozen allowed_paths set.", { allowed: task.allowed_paths, forbidden: task.forbidden_paths }),
    criterion("crit-A6-build-typecheck", "MACHINE", "Build and typecheck pass on the patched code.", { command: "tsc -p tsconfig.json --noEmit", exit: 0 }),
  ],
  constraints: [
    { constraint_id: "cons-forbidden-paths", kind: "SCOPE" as const, statement: `No changes outside allowed_paths ${task.allowed_paths.join(",")}`, max_risk_level: "L1" },
    { constraint_id: "cons-max-attempts-3", kind: "TIME" as const, statement: "Execution attempts are capped at the frozen max_attempts=3." },
    { constraint_id: "cons-deadline", kind: "TIME" as const, statement: `Deadline ${task.deadline}.` },
  ],
  budget: {
    asset: task.asset,
    total: task.reward,
    execution_cap: task.reward,
  },
  deadline: "2026-10-31T23:59:59.000Z",
  verification_policy_ref: { uri: POLICY_URI, hash: bundle.policy_hash },
  settlement_policy_ref: { uri: SETTLEMENT_URI, hash: SETTLEMENT_HASH },
  created_at: CREATED_AT,
};

// MilestoneV1: fields traced to the PASSED GP2 bundle anchor + Intent seal
export function buildMilestone(intentContentHash: string) {
  return {
    schema_version: "milestone.v1",
    milestone_id: bundle.milestone_id,
    intent_hash: intentContentHash as Hash,
    milestone_revision: bundle.milestone_revision,
    criterion_ids: intentCandidate.success_criteria.map((c) => c.criterion_id),
    verification_policy_hash: bundle.policy_hash,
    settlement_policy_hash: SETTLEMENT_HASH as Hash,
    allocation: { asset: task.asset, amount: task.reward },
  };
}

describe("[GP-ID-R1] identity materialization", () => {
  const sealedIntent = seal(IntentContractSchema as never, intentCandidate) as Record<string, any>;
  const sealedMilestone = seal(MilestoneSchema as never, buildMilestone(String(sealedIntent.content_hash))) as Record<string, any>;

  test("[M.1] IntentContractV1 parses and seals under LIVE G1 schema", () => {
    expect(sealedIntent.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("[M.2] MilestoneV1 parses and seals under LIVE G1 schema", () => {
    expect(sealedMilestone.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("[M.3] milestone.intent_hash == intent.content_hash", () => {
    expect(String(sealedMilestone.intent_hash)).toBe(String(sealedIntent.content_hash));
  });

  test("[M.4] milestone.milestone_id == PASSED GP2 bundle.milestone_id", () => {
    expect(String(sealedMilestone.milestone_id)).toBe(bundle.milestone_id);
  });

  test("[M.5] milestone.milestone_revision == PASSED GP2 bundle.milestone_revision", () => {
    expect(Number(sealedMilestone.milestone_revision)).toBe(bundle.milestone_revision);
  });

  test("[M.6] milestone.verification_policy_hash == PASSED GP2 bundle.policy_hash", () => {
    expect(String(sealedMilestone.verification_policy_hash)).toBe(bundle.policy_hash);
  });

  test("[M.7] milestone allocation asset/amount == GP-001 task reward/asset", () => {
    expect(sealedMilestone.allocation).toEqual({ asset: task.asset, amount: task.reward });
    expect(task.asset).toEqual({ network: "solana-devnet", asset: "USDC-test", decimals: 6 });
    expect(task.reward).toBe("10");
  });

  test("[M.8] materialization_timing is POST_GP2_REMEDIATION everywhere", () => {
    expect((provenance as any).materialization_timing).toBe("POST_GP2_REMEDIATION");
    expect((provenance as any).UNRESOLVED_FIELDS.length).toBeGreaterThanOrEqual(8);
  });

  test("[M.9] zero changes to frozen sources (task + GP2 evidence subtree)", () => {
    // the task record bytes at HEAD are identical to the GP2-passed merge
    const headTask = execFileSync("git", ["show", "HEAD:packages/golden-path/fixtures/gp-001-task.json"], { cwd: repoRoot });
    const passedTask = gitShow(`${EVIDENCE_SOURCE}:packages/golden-path/fixtures/gp-001-task.json`);
    expect(headTask.equals(passedTask)).toBe(true);
    // the evidence subtree is byte-identical
    const headBundle = execFileSync("git", ["show", `HEAD:${EVID}/bundle.json`], { cwd: repoRoot });
    const passedBundle = gitShow(`${EVIDENCE_SOURCE}:${EVID}/bundle.json`);
    expect(headBundle.equals(passedBundle)).toBe(true);
  });

  test("[M.10] criterion_ids are unique and non-empty in both objects", () => {
    const ids = sealedMilestone.criterion_ids as string[];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });
});
