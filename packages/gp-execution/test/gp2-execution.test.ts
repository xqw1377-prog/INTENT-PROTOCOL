import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { changedPathsViolations, loadTaskRecord, pathGlobMatches, preflight, PreflightError, sha256 } from "../src/task.js";
import { executeIsolated, parseVitestCounts, RunnerError, type ExecutionResult } from "../src/runner.js";
import { buildSealedBundle, packageArtifacts, verifySealedBundle, type PackagedArtifact, type SealedBundle } from "../src/evidence.js";
import { EvidenceBundleSchema, merkleRoot, seal } from "../../conformance-harness/sut-snapshot/protocol-schema-src/index.js";
import type { Hash } from "../../conformance-harness/sut-snapshot/protocol-schema-src/index.js";

/**
 * GP2 EXECUTION + EVIDENCE — implementation self-tests against Issue #25 §A–G.
 * One real isolated execution is shared by the positive checks; tamper
 * negatives operate on copies/overrides and never touch the truth repo.
 */

const PINNED_TASK_HASH_PREFIX = "sha256:95ca98eb";
const PINNED_SUITE_HASH_PREFIX = "sha256:2357f37d";

let pf: ReturnType<typeof preflight>;
let exec: ExecutionResult;
let artifacts: PackagedArtifact[];
let bundle: SealedBundle;

beforeAll(() => {
  pf = preflight();
  exec = executeIsolated({ record: pf.record, taskFreezeHash: pf.task_freeze_hash, attempt: 1 });
  artifacts = packageArtifacts(exec.manifest, exec.raw);
  bundle = buildSealedBundle(exec.manifest, artifacts, pf.task_freeze_hash, pf.record.verification_policy);
}, 180_000);

afterAll(() => {
  exec?.dispose();
});

describe("[GP2-T1] task preflight", () => {
  test("[T1.1] exact-byte hashes match the Commander-pinned frozen values", () => {
    expect(pf.task_freeze_hash.startsWith(PINNED_TASK_HASH_PREFIX)).toBe(true);
    expect(pf.recomputed_suite_sha256.startsWith(PINNED_SUITE_HASH_PREFIX)).toBe(true);
    expect(pf.record.base_commit_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(pf.record.max_attempts).toBe(3);
    expect(pf.record.reward).toBe("10");
    expect(pf.record.asset).toEqual({ network: "solana-devnet", asset: "USDC-test", decimals: 6 });
  });

  test("[T1.2] suite byte drift at the record level => preflight invalid (negative F6)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gp2-drift-"));
    try {
      const mutated = { ...pf.record, acceptance_suite_sha256: "sha256:" + "00".repeat(32) };
      const p = path.join(dir, "task.json");
      writeFileSync(p, JSON.stringify(mutated, null, 2) + "\n");
      expect(() => preflight({ recordPath: p })).toThrow(PreflightError);
      expect(() => preflight({ recordPath: p })).toThrow(/suite-drift/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("[GP2-T2] execution outcomes (real isolated run)", () => {
  test("[T2.1] SEEDED RED at base: exactly A1+A2 fail, A3+A4 pass", () => {
    const baseOut = exec.raw.get("base-acceptance")!.bytes.toString("utf8");
    const counts = parseVitestCounts(baseOut);
    expect(exec.manifest.outcomes.base_acceptance_seeded_red).toBe(true);
    expect(counts).toEqual({ passed: 2, failed: 2 });
  });

  test("[T2.2] agent patch is minimal and inside allowed paths", () => {
    expect(exec.manifest.changed_paths).toEqual(["packages/golden-path/demo/src/retry.ts"]);
    expect(changedPathsViolations(exec.manifest.changed_paths, pf.record)).toEqual([]);
    expect(exec.manifest.outcomes.patch_policy_clean).toBe(true);
    const diff = exec.raw.get("agent-patch")!.bytes.toString("utf8");
    expect(diff).toContain("parsed * 1000");
    expect(diff).not.toContain("test/");
  });

  test("[T2.3] patched acceptance ALL GREEN (A1-A4) and exact 2000 ms semantics proven by the frozen suite", () => {
    const patched = parseVitestCounts(exec.raw.get("patched-acceptance")!.bytes.toString("utf8"));
    expect(patched).toEqual({ passed: 4, failed: 0 });
    expect(exec.manifest.outcomes.patched_acceptance_all_green).toBe(true);
  });

  test("[T2.4] build/typecheck green", () => {
    expect(exec.manifest.outcomes.build_typecheck_ok).toBe(true);
    expect(exec.raw.get("build")!.bytes.toString("utf8")).toContain("exit=0");
  });

  test("[T2.5] manifest carries the full frozen ExecutionRef field set", () => {
    const m = exec.manifest;
    expect(m.schema_version).toBe("gp-execution-manifest.v1");
    expect(m.task_freeze_hash).toBe(pf.task_freeze_hash);
    expect(m.base_commit_sha).toBe(pf.record.base_commit_sha);
    expect(m.attempt).toBe(1);
    expect(m.max_attempts).toBe(3);
    expect(m.commands.map((c) => c.id)).toEqual(["base-acceptance", "patched-acceptance", "build"]);
    expect(m.toolchain.node).toMatch(/^v/);
    expect(m.changed_paths.length).toBeGreaterThan(0);
    expect(m.started_at).toMatch(/\.\d{3}Z$/);
  });
});

describe("[GP2-T3] evidence artifacts (frozen EvidenceArtifactV1)", () => {
  test("[T3.1] six artifact kinds, every payload hash recomputes from ACTUAL bytes, schema-valid", () => {
    expect(artifacts.map((a) => a.key).sort()).toEqual([
      "agent-patch", "base-acceptance", "build", "execution-manifest", "patched-acceptance", "policy-boundary",
    ]);
    for (const a of artifacts) {
      expect(a.payloadHash).toBe(sha256(a.rawBytes));
      expect(a.artifact.locator).toMatch(/^cas:\/\/gp2\/[0-9a-f-]+\/[a-z-]+$/);
    }
  });
});

describe("[GP2-T4] SEALED bundle (frozen EvidenceBundleV1)", () => {
  test("[T4.1] bundle seals, merkle root recomputes, seal is idempotent, binding verifies", () => {
    expect(bundle.bundle.state).toBe("SEALED");
    const root = merkleRoot(artifacts.map((a) => a.payloadHash) as Hash[]);
    expect(bundle.merkle_root).toBe(root);
    const again = seal(EvidenceBundleSchema as never, bundle.bundle) as Record<string, unknown>;
    expect(again.content_hash).toBe(bundle.content_hash);
    expect(() => verifySealedBundle({
      bundle: bundle.bundle, manifest: exec.manifest,
      taskFreezeHash: pf.task_freeze_hash, verificationPolicy: pf.record.verification_policy,
      artifactPayloadHashes: artifacts.map((a) => a.payloadHash),
    })).not.toThrow();
  });

  test("[T4.2] deterministic manifest + full isolated replay reproduces identical facts (F10 + determinism)", () => {
    const replay = executeIsolated({ record: pf.record, taskFreezeHash: pf.task_freeze_hash, attempt: 1 });
    try {
      expect(replay.manifest).toEqual(exec.manifest);
      expect(replay.manifest.outcomes).toEqual(exec.manifest.outcomes);
      expect(replay.manifest.patch_sha256).toBe(exec.manifest.patch_sha256);
      // deterministic artifact keys must hash identically across replays;
      // wall-clock-bearing logs (base/patched acceptance JSON durations, build
      // output) are legitimately volatile — presence is asserted, not bytes.
      const replayArts = packageArtifacts(replay.manifest, replay.raw);
      expect(replayArts.map((a) => a.key).sort()).toEqual(artifacts.map((a) => a.key).sort());
      const DETERMINISTIC_KEYS = ["agent-patch", "policy-boundary", "execution-manifest"];
      for (const key of DETERMINISTIC_KEYS) {
        const a = replayArts.find((x) => x.key === key)!;
        const b = artifacts.find((x) => x.key === key)!;
        expect(a.payloadHash, `replay-stable artifact: ${key}`).toBe(b.payloadHash);
      }
    } finally {
      replay.dispose();
    }
  }, 180_000);
});

describe("[GP2-T5] tamper / replay negatives (F1–F9)", () => {
  const hashOf = (a: PackagedArtifact[]) => a.map((x) => x.payloadHash) as Hash[];

  test("[N1] one-byte raw evidence mutation => artifact hash AND root mismatch", () => {
    const mutated = Buffer.from(artifacts.find((a) => a.key === "agent-patch")!.rawBytes);
    mutated[mutated.length - 2]! ^= 0x01;
    const mutatedHash = sha256(mutated);
    expect(mutatedHash).not.toBe(artifacts.find((a) => a.key === "agent-patch")!.payloadHash);
    const hashes = hashOf(artifacts).map((h) => (h === artifacts.find((a) => a.key === "agent-patch")!.payloadHash ? mutatedHash : h)) as Hash[];
    expect(merkleRoot(hashes)).not.toBe(bundle.merkle_root);
  });

  test("[N2] artifact reorder => bundle content_hash changes (canonical rejection) while the frozen sorted-merkle root is order-invariant", () => {
    const reordered = [...artifacts].reverse();
    const rebundle = buildSealedBundle(exec.manifest, reordered, pf.task_freeze_hash, pf.record.verification_policy);
    expect(rebundle.content_hash, "the artifact ARRAY is covered by content_hash => reorder is detectable").not.toBe(bundle.content_hash);
    expect(rebundle.merkle_root, "frozen merkle sorts leaves: root alone is order-invariant BY DESIGN").toBe(bundle.merkle_root);
  });

  test("[N3] omitted artifact => root mismatch", () => {
    const omitted = artifacts.filter((a) => a.key !== "build");
    expect(merkleRoot(hashOf(omitted))).not.toBe(bundle.merkle_root);
  });

  test("[N4] changed task_freeze_hash => run invalid (milestone + policy binding break)", () => {
    const forged = "sha256:" + "ee".repeat(32);
    expect(() => verifySealedBundle({
      bundle: bundle.bundle, manifest: exec.manifest,
      taskFreezeHash: forged, verificationPolicy: pf.record.verification_policy,
      artifactPayloadHashes: artifacts.map((a) => a.payloadHash),
    })).toThrow(/milestone binding mismatch/);
  });

  test("[N5] changed base SHA => run invalid (run binding break)", () => {
    const forgedManifest = { ...exec.manifest, base_commit_sha: "f".repeat(40), run_id: exec.manifest.run_id.replace(/^./, "e") };
    expect(() => verifySealedBundle({
      bundle: bundle.bundle, manifest: forgedManifest,
      taskFreezeHash: pf.task_freeze_hash, verificationPolicy: pf.record.verification_policy,
      artifactPayloadHashes: artifacts.map((a) => a.payloadHash),
    })).toThrow(/run binding mismatch/);
  });

  test("[N6] acceptance suite drift => preflight invalid (covered in T1.2)", () => {
    expect(typeof PreflightError).toBe("function");
  });

  test("[N7] forbidden-path patch => rejected BEFORE bundle SEALED", () => {
    const forbiddenDiff = [
      "diff --git a/packages/golden-path/demo/test/basic.test.ts b/packages/golden-path/demo/test/basic.test.ts",
      "--- a/packages/golden-path/demo/test/basic.test.ts",
      "+++ b/packages/golden-path/demo/test/basic.test.ts",
      "@@ -1,3 +1,4 @@",
      "+// tamper",
    ].join("\n");
    expect(() => executeIsolated({
      record: pf.record, taskFreezeHash: pf.task_freeze_hash, attempt: 1, patchOverride: Buffer.from(forbiddenDiff),
    })).toThrow(RunnerError);
    expect(() => executeIsolated({
      record: pf.record, taskFreezeHash: pf.task_freeze_hash, attempt: 1, patchOverride: Buffer.from(forbiddenDiff),
    })).toThrow(/patch-policy/);
  }, 60_000);

  test("[N8] attempt beyond max_attempts => reject", () => {
    expect(() => executeIsolated({ record: pf.record, taskFreezeHash: pf.task_freeze_hash, attempt: 4 }))
      .toThrow(/attempt-out-of-range/);
  });

  test("[N9] bundle mutation after SEALED => frozen schema rejects (SEALED merkle superRefine)", () => {
    const mutated = { ...bundle.bundle, merkle_root: "sha256:" + "01".repeat(32) };
    expect(() => seal(EvidenceBundleSchema as never, mutated)).toThrow();
    const mutatedState = { ...bundle.bundle, state: "OPEN" };
    expect(() => verifySealedBundle({
      bundle: mutatedState, manifest: exec.manifest,
      taskFreezeHash: pf.task_freeze_hash, verificationPolicy: pf.record.verification_policy,
      artifactPayloadHashes: artifacts.map((a) => a.payloadHash),
    })).toThrow();
  });
});

describe("[GP2-T6] scope hygiene", () => {
  test("[T6.1] no GP3+ capability vocabulary in gp-execution sources (self-scan)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const scan = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? scan(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : [],
      );
    for (const f of scan(path.resolve(here, "../src"))) {
      const src = readFileSync(f, "utf8");
      for (const bad of [/createDecision/, /VerificationDecision/, /formReceipt/, /OutcomeReceipt/, /SettlementInstruction/, /releaseEscrow/, /transferFunds/, /devnet/i, /solana/i, /payOut/]) {
        expect(bad.test(src), `${f} must not contain ${bad}`).toBe(false);
      }
    }
  });
});
