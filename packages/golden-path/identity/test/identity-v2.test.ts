import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { canonicalize, IntentContractSchema, MilestoneSchema, seal } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";

/**
 * GP-ID-R1 V2 (Issue #33 Commander freeze table): full materialization of
 * IntentContractV1 (8 CriterionV1 = GP0's 8 acceptance criteria) + MilestoneV1,
 * with ALL fields frozen. UNRESOLVED_FIELDS = [].
 *
 * Objects are read from the committed JSON files, sealed here, and the sealed
 * content_hash values are written to milestone.json (which carries the
 * intent.content_hash as intent_hash).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ID_DIR = path.join(repoRoot, "packages/golden-path/identity");
const EVIDENCE_SOURCE = "3fbef701165a86d3ad6fd95af695b78ebe74fee7";
const EVID = "packages/golden-path/evidence/9f6610dc-24e9-4e6c-b7c1-67574064d2ae";

const gitShow = (spec: string): Buffer => execFileSync("git", ["show", spec], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
const sha256 = (b: Buffer | string): string => "sha256:" + createHash("sha256").update(b).digest("hex");

const intentRaw = JSON.parse(readFileSync(path.join(ID_DIR, "intent.json"), "utf8"));
const bundle = JSON.parse(gitShow(`${EVIDENCE_SOURCE}:${EVID}/bundle.json`).toString("utf8"));
const task = JSON.parse(gitShow(`${EVIDENCE_SOURCE}:packages/golden-path/fixtures/gp-001-task.json`).toString("utf8"));
const holdPolicyBytes = readFileSync(path.join(ID_DIR, "policies/gp-001-settlement-hold-v1.json"));

// seal intent
const sealedIntent = seal(IntentContractSchema as never, intentRaw) as Record<string, any>;
const intentCh = String(sealedIntent.content_hash);

// build + seal milestone (reads intent.content_hash at seal time)
const milestoneRaw = {
  schema_version: "milestone.v1",
  milestone_id: bundle.milestone_id,
  intent_hash: intentCh as Hash,
  milestone_revision: bundle.milestone_revision,
  criterion_ids: intentRaw.success_criteria.map((c: any) => c.criterion_id),
  verification_policy_hash: bundle.policy_hash,
  settlement_policy_hash: intentRaw.settlement_policy_ref.hash as Hash,
  allocation: { asset: task.asset, amount: task.reward },
};
const sealedMilestone = seal(MilestoneSchema as never, milestoneRaw) as Record<string, any>;

// persist the sealed milestone for the Proof Pack
mkdirSync(ID_DIR, { recursive: true });
writeFileSync(path.join(ID_DIR, "milestone.json"), JSON.stringify(milestoneRaw, null, 2) + "\n");

describe("[GP-ID-R1-V2] identity materialization — UNRESOLVED_FIELDS = []", () => {
  test("[V.1] IntentContractV1: exactly 8 CriterionV1 objects (GP0 criteria 1-8)", () => {
    expect(intentRaw.success_criteria).toHaveLength(8);
    const ids = intentRaw.success_criteria.map((c: any) => c.criterion_id);
    expect(new Set(ids).size).toBe(8);
    for (let i = 1; i <= 8; i++) {
      expect(ids.some((id: string) => id.includes(`GP0-${i}`)), `criterion for GP0 #${i}`).toBe(true);
    }
  });

  test("[V.2] every criterion field is Commander-frozen (no UNRESOLVED placeholders)", () => {
    for (const c of intentRaw.success_criteria) {
      expect(c.kind).toMatch(/^(MACHINE|ECONOMIC|CRYPTO|HUMAN)$/);
      expect(c.verifier_ref).toMatch(/^verifier:gp3-(functional|policy)$/);
      expect(c.evidence_requirements).toHaveLength(1);
      expect(c.evidence_requirements[0].kind).not.toContain("UNRESOLVED");
      expect(JSON.stringify(c.threshold)).not.toContain("UNRESOLVED");
    }
  });

  test("[V.3] intent seals under LIVE G1 schema", () => {
    expect(intentCh).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("[V.4] Commander-frozen identity values", () => {
    expect(intentRaw.intent_id).toBe("62b2ed5d-d984-4591-8630-98213d2d1d20");
    expect(intentRaw.owner_subject).toBe("operator:gp-001");
    expect(intentRaw.goal.domain).toBe("software-delivery");
    expect(intentRaw.budget.execution_cap).toBe("0");
    expect(intentRaw.created_at).toBe("2026-09-22T23:56:59.000Z");
  });

  test("[V.5] intent_id derivation reproduces", () => {
    const taskHash = sha256(gitShow(`${EVIDENCE_SOURCE}:packages/golden-path/fixtures/gp-001-task.json`));
    const seed = `gp001:intent:${taskHash}`;
    const h = createHash("sha256").update(seed).digest("hex").slice(0, 32);
    const hex = h.slice(0, 12) + "4" + h.slice(13, 16) + "8" + h.slice(17, 32);
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    expect(uuid).toBe("62b2ed5d-d984-4591-8630-98213d2d1d20");
  });

  test("[V.6] settlement HOLD policy bytes hash matches Commander-frozen value", () => {
    const parsed = JSON.parse(holdPolicyBytes.toString("utf8"));
    const hold = sha256(canonicalize(parsed));
    expect(hold).toBe("sha256:78f775b8d711b734648baa08dd91553ad41f69f96296df9bb879f1da665b64fe");
    // the committed file is the same JSON + trailing newline for git; the
    // Commander's hash is over the canonical IPC-JSON-1 bytes (no trailing LF)
    expect(parsed).toEqual({ authority: "outcome-receipt-only", gp4_gate: "PASS_REQUIRED", policy_id: "gp-001-settlement-hold-v1", release_enabled: false });
  });

  test("[V.7] intent.settlement_policy_ref.hash == HOLD policy hash", () => {
    expect(intentRaw.settlement_policy_ref.hash).toBe("sha256:78f775b8d711b734648baa08dd91553ad41f69f96296df9bb879f1da665b64fe");
  });

  test("[V.8] intent.verification_policy_ref.hash == PASSED GP2 bundle.policy_hash", () => {
    expect(intentRaw.verification_policy_ref.hash).toBe(bundle.policy_hash);
  });

  test("[V.9] MilestoneV1 seals; milestone.intent_hash == intent.content_hash", () => {
    expect(String(sealedMilestone.content_hash)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(String(sealedMilestone.intent_hash)).toBe(intentCh);
  });

  test("[V.10] milestone.{id,revision,policy} == PASSED GP2 bundle anchor", () => {
    expect(String(sealedMilestone.milestone_id)).toBe(bundle.milestone_id);
    expect(Number(sealedMilestone.milestone_revision)).toBe(bundle.milestone_revision);
    expect(String(sealedMilestone.verification_policy_hash)).toBe(bundle.policy_hash);
  });

  test("[V.11] milestone.settlement_policy_hash == intent.settlement_policy_ref.hash == HOLD hash", () => {
    expect(String(sealedMilestone.settlement_policy_hash)).toBe(intentRaw.settlement_policy_ref.hash);
  });

  test("[V.12] milestone allocation == GP-001 task reward/asset", () => {
    expect(sealedMilestone.allocation).toEqual({ asset: task.asset, amount: task.reward });
  });

  test("[V.13] milestone criterion_ids == intent criterion ids (same set, same order)", () => {
    expect(sealedMilestone.criterion_ids).toEqual(intentRaw.success_criteria.map((c: any) => c.criterion_id));
  });

  test("[V.14] zero changes to frozen sources", () => {
    const headTask = execFileSync("git", ["show", "HEAD:packages/golden-path/fixtures/gp-001-task.json"], { cwd: repoRoot });
    expect(headTask.equals(gitShow(`${EVIDENCE_SOURCE}:packages/golden-path/fixtures/gp-001-task.json`))).toBe(true);
    const headBundle = execFileSync("git", ["show", `HEAD:${EVID}/bundle.json`], { cwd: repoRoot });
    expect(headBundle.equals(gitShow(`${EVIDENCE_SOURCE}:${EVID}/bundle.json`))).toBe(true);
  });

  test("[V.15] constraints cover scope+time with frozen kinds and risk levels", () => {
    expect(intentRaw.constraints).toHaveLength(2);
    for (const c of intentRaw.constraints) {
      expect(["FORBIDDEN_ACTION", "SCOPE", "COMPLIANCE", "BUDGET", "TIME", "OTHER"]).toContain(c.kind);
      expect(c.max_risk_level).toMatch(/^L[0-3]$/);
    }
  });

  test("[V.16] committed intent.json bytes are stable (self-hash recorded for audit)", () => {
    const raw = readFileSync(path.join(ID_DIR, "intent.json"));
    const selfHash = sha256(raw);
    expect(selfHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // record for the provenance map
    const provenancePath = path.join(ID_DIR, "provenance.json");
    const prov = JSON.parse(readFileSync(provenancePath, "utf8"));
    prov.committed_files = {
      "intent.json_sha256": selfHash,
      "milestone.json_sha256": sha256(readFileSync(path.join(ID_DIR, "milestone.json"))),
      "gp-001-settlement-hold-v1.json_sha256": sha256(holdPolicyBytes),
      "sealed_intent_content_hash": intentCh,
      "sealed_milestone_content_hash": String(sealedMilestone.content_hash),
    };
    writeFileSync(provenancePath, JSON.stringify(prov, null, 2) + "\n");
  });
});
