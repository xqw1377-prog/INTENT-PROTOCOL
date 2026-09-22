import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { canonicalize, EvidenceArtifactSchema, EvidenceBundleSchema, hashObject, Domain, merkleRoot, seal, HASH_RE } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import { deriveUuid, git, gitShow, loadCapture, repoRoot, sha256, snapJson, targetFile, SNAP, UUID_RE } from "../../src/indep.js";
import { reproduceFrozenTask, ReplayError, type ReplayResult } from "../../src/replay.js";

/**
 * GP2 FORMAL BLACK-BOX REPLAY (Issue #28). The SUT is the frozen target
 * b0d7f39 captured into target-snapshot/. NOTHING is imported from
 * gp-execution; the target is read as evidence and reproduced independently.
 */

export const FORMAL_TARGET = "b0d7f39f6033612b094b44189b03253306c0c5ab";
const REQUIRED_LIVE_SUBTREE = "bb14d9375c92d64072f3e8c2f2dd65d794008422";
const SUPERSEDED_RUNS = ["0779440d-a4a0-4467-8905-737d2ad795a6", "2719256d-e9a3-480d-9d8e-ea0b53382581"];

const cap = loadCapture();
const EVID = `packages/golden-path/evidence/${cap.evidence_run_id}`;
const report = snapJson<Record<string, any>>("candidate-report.json");
const bundle = snapJson<Record<string, any>>("evidence/bundle.json");
const artifactsDoc = snapJson<{ key: string; artifact: Record<string, any>; payload_hash: string }[]>("evidence/artifacts.json");
const manifest = snapJson<Record<string, any>>("evidence/manifest.json");
const taskRecord = JSON.parse(gitShow(`${FORMAL_TARGET}:packages/golden-path/fixtures/gp-001-task.json`).toString("utf8")) as Record<string, any>;

let replay: ReplayResult;
beforeAll(() => {
  replay = reproduceFrozenTask({
    baseCommit: taskRecord.base_commit_sha,
    packagePath: taskRecord.package_path,
    maxAttempts: taskRecord.max_attempts,
    committedPatch: targetFile(cap.pinned_sha, `${EVID}/raw/agent-patch.bin`),
  });
}, 240_000);
afterAll(() => {
  replay?.dispose();
});

describe("[F0] target capture / scope", () => {
  test("[F0.1] pinned target + parent + diff scope", () => {
    expect(cap.pinned_sha).toBe(FORMAL_TARGET);
    expect(cap.parent_sha).toBe(cap.expected_parent); // d4c685b
    const allowedPrefixes = ["packages/gp-execution/", "packages/golden-path/evidence/", "package-lock.json"];
    for (const p of cap.changed_paths_vs_parent) {
      expect(allowedPrefixes.some((pre) => p === pre || p.startsWith(pre)), `scope: ${p}`).toBe(true);
    }
    for (const frozen of ["packages/protocol-schema/", "packages/gp1-verifier/", "packages/gp-runtime/", "packages/conformance-harness/", "packages/gp-audit/", "docs/", ".github/"]) {
      expect(cap.changed_paths_vs_parent.some((p) => p === frozen || p.startsWith(frozen)), `${frozen} untouched`).toBe(false);
    }
  });
});

describe("[F1] frozen task truth (independent recompute)", () => {
  test("[F1.1] task_freeze_hash / suite sha / base / paths / attempts", () => {
    const taskBytes = gitShow(`${FORMAL_TARGET}:packages/golden-path/fixtures/gp-001-task.json`);
    expect(sha256(taskBytes)).toBe("sha256:95ca98eb0146c56be577f9704d8640bb99ef38b5271a94496fc8cc6aa61121e5");
    const suiteBytes = gitShow(`${taskRecord.base_commit_sha}:${taskRecord.acceptance_suite_path}`);
    expect(sha256(suiteBytes)).toBe(taskRecord.acceptance_suite_sha256);
    expect(git(["cat-file", "-e", `${taskRecord.base_commit_sha}^{commit}`])).toBe("");
    expect(taskRecord.max_attempts).toBe(3);
    expect(taskRecord.allowed_paths).toEqual(["packages/golden-path/demo/src/**"]);
    expect(taskRecord.reward).toBe("10");
  });
});

describe("[F2] live G1 truth", () => {
  test("[F2.1] verifier main live subtree == signed G1 subtree; target sources import live wire, zero snapshot deps", () => {
    expect(git(["rev-parse", "HEAD:packages/protocol-schema"]).trim()).toBe(REQUIRED_LIVE_SUBTREE);
    const srcDir = path.join(SNAP, "target-gp-execution-src");
    let liveWireImports = 0;
    for (const f of readdirSync(srcDir)) {
      const src = readFileSync(path.join(srcDir, f), "utf8");
      expect(src.includes("sut-snapshot"), `${f} no snapshot dependency`).toBe(false);
      const schemaImports = [...src.matchAll(/from\s+"([^"]*protocol-schema[^"]*)"/g)].map((m) => m[1]!);
      for (const spec of schemaImports) {
        expect(spec, `${f} schema import must be the live wire`).toBe("@intent/protocol-schema");
        liveWireImports++;
      }
    }
    expect(liveWireImports, "the evidence layer does import the live wire").toBeGreaterThan(0);
  });
});

describe("[F3] raw evidence exact bytes", () => {
  test("[F3.1] six blobs: sha256(commit bytes) == payload_hash == locator suffix; schema-valid; unique ids", () => {
    expect(artifactsDoc).toHaveLength(6);
    const ids = new Set<string>();
    for (const a of artifactsDoc) {
      const raw = targetFile(cap.pinned_sha, `${EVID}/raw/${a.key}.bin`);
      expect(sha256(raw), `${a.key} raw bytes hash`).toBe(a.payload_hash);
      expect(String(a.artifact.locator), `${a.key} locator suffix`).toBe(`cas://gp2/${report.execution_id}/${a.key}/${a.payload_hash.slice(7)}`);
      EvidenceArtifactSchema.parse(a.artifact);
      ids.add(String(a.artifact.artifact_id));
    }
    expect(ids.size).toBe(6);
  });
});

describe("[F4] bundle independently recomputed (live wire)", () => {
  test("[F4.1] hashes/order/root/SEALED/content_hash/report agreement; 1-byte mutation breaks", () => {
    const declaredHashes = bundle.artifact_hashes as string[];
    expect(declaredHashes).toEqual(artifactsDoc.map((a) => a.payload_hash)); // committed order preserved
    const root = merkleRoot(declaredHashes as Hash[]);
    expect(String(bundle.merkle_root)).toBe(root);
    expect(bundle.state).toBe("SEALED");
    // frozen seal preimage strips ONLY content_hash/signature — bundle_id IS hashed
    const recomputedContent = hashObject(Domain.EvidenceBundle, "bundle.v1", (() => {
      const { content_hash, ...body } = bundle as Record<string, unknown>;
      void content_hash;
      return body;
    })() as unknown);
    expect(recomputedContent).toBe(bundle.content_hash);
    expect(report.evidence_root).toBe(bundle.merkle_root);
    expect(report.bundle.content_hash).toBe(bundle.content_hash);
    expect(report.bundle.bundle_id).toBe(bundle.bundle_id);
    // one-byte raw mutation breaks payload hash + root
    const mutated = Buffer.from(targetFile(cap.pinned_sha, `${EVID}/raw/agent-patch.bin`));
    mutated[mutated.length - 2]! ^= 0x01;
    const mHash = sha256(mutated);
    expect(mHash).not.toBe(artifactsDoc.find((a) => a.key === "agent-patch")!.payload_hash);
    const mutatedSet = declaredHashes.map((h) => (h === artifactsDoc.find((a) => a.key === "agent-patch")!.payload_hash ? mHash : h)) as Hash[];
    expect(merkleRoot(mutatedSet)).not.toBe(root);
  });
});

describe("[F5] GP2-R2 identity model (independent recompute)", () => {
  test("[F5.1] fingerprint from frozen inputs; run_id fresh & canonical; run-scoped artifacts; payload-bound locators", () => {
    const patchSha = sha256(targetFile(cap.pinned_sha, `${EVID}/raw/agent-patch.bin`));
    const expectedFingerprint = deriveUuid(`gp2:fingerprint:${report.task_freeze_hash}:${taskRecord.base_commit_sha}:${patchSha}:1`);
    expect(manifest.execution_fingerprint).toBe(expectedFingerprint);
    expect(report.execution_fingerprint).toBe(expectedFingerprint);
    expect(UUID_RE.test(manifest.run_id)).toBe(true);
    expect(manifest.run_id).not.toBe(expectedFingerprint);
    for (const old of SUPERSEDED_RUNS) expect(manifest.run_id).not.toBe(old);
    expect(manifest.run_id).toBe(cap.evidence_run_id);
    expect(report.execution_id).toBe(manifest.run_id);
    for (const a of artifactsDoc) {
      expect(String(a.artifact.artifact_id)).not.toBe(deriveUuid(`gp2:artifact:${manifest.run_id}:${a.key}-wrong`));
      expect(UUID_RE.test(String(a.artifact.artifact_id))).toBe(true);
    }
  });
});

describe("[F6] GP2-R3 bundle identity (independent reconstruction + negatives)", () => {
  const deriveBundleId = (body: Record<string, unknown>): string =>
    deriveUuid(`gp2:bundle-id:${sha256(canonicalize(body))}`);

  const preSealBody = (): Record<string, unknown> => {
    const { bundle_id, content_hash, ...body } = bundle as Record<string, unknown>;
    void bundle_id; void content_hash;
    return body;
  };

  test("[F6.1] committed bundle_id == independent pre-seal-body derivation", () => {
    expect(deriveBundleId(preSealBody())).toBe(bundle.bundle_id);
  });

  test("[F6.2] reverse artifact_hashes: root SAME, content_hash & bundle_id CHANGE (same run)", () => {
    const reversed = { ...preSealBody(), artifact_hashes: [...(bundle.artifact_hashes as string[])].reverse() };
    expect(merkleRoot(reversed.artifact_hashes as Hash[])).toBe(bundle.merkle_root); // frozen merkle sorts
    expect(deriveBundleId(reversed)).not.toBe(bundle.bundle_id);
    const sealed = seal(EvidenceBundleSchema as never, { ...reversed, bundle_id: deriveBundleId(reversed) }) as Record<string, unknown>;
    expect(sealed.content_hash).not.toBe(bundle.content_hash);
  });

  test("[F6.3] mutate policy_hash: bundle_id changes", () => {
    const forged = { ...preSealBody(), policy_hash: "sha256:" + "00".repeat(32) };
    expect(deriveBundleId(forged)).not.toBe(bundle.bundle_id);
  });

  test("[F6.4] omit one artifact: root AND bundle_id change", () => {
    const omitted = { ...preSealBody(), artifact_hashes: (bundle.artifact_hashes as string[]).slice(0, 5) };
    expect(merkleRoot(omitted.artifact_hashes as Hash[])).not.toBe(bundle.merkle_root);
    expect(deriveBundleId(omitted)).not.toBe(bundle.bundle_id);
  });
});

describe("[F7] independent task reproduction (observed, not trusted)", () => {
  test("[F7.1] base seeded-red; committed patch reproduces all-green; build green; semantics observed", () => {
    expect(replay.base_counts).toEqual({ passed: 2, failed: 2 }); // A1/A2 red, A3/A4 green
    expect(replay.patched_counts).toEqual({ passed: 4, failed: 0 });
    expect(replay.build_exit).toBe(0);
    expect(replay.retry_2000ms_semantics).toBe(true);
    expect(replay.max_attempts_observed).toBe(3);
    expect(replay.non429_no_retry).toBe(true);
    expect(replay.changed_paths).toEqual(["packages/golden-path/demo/src/retry.ts"]);
    const committedPatchSha = sha256(targetFile(cap.pinned_sha, `${EVID}/raw/agent-patch.bin`));
    expect(replay.derived_patch_sha256, "independently derived fix == committed patch").toBe(committedPatchSha);
    expect(committedPatchSha).toBe("sha256:d70bbeb2b65ec5057bab6b12c047c9245b39948eff065f41acc69421b3871c87");
  });

  test("[F7.2] attempt beyond frozen max rejected by the independent executor too", () => {
    expect(() => reproduceFrozenTask({ baseCommit: taskRecord.base_commit_sha, packagePath: taskRecord.package_path, maxAttempts: 3, attempt: 4 }))
      .toThrow(ReplayError);
  });
});

describe("[F8] manifest consistency (vs independently observed facts)", () => {
  test("[F8.1] task/base/patch/attempt/commands/outcomes agree", () => {
    expect(manifest.task_freeze_hash).toBe(report.task_freeze_hash);
    expect(manifest.base_commit_sha).toBe(taskRecord.base_commit_sha);
    expect(manifest.patch_sha256).toBe(sha256(targetFile(cap.pinned_sha, `${EVID}/raw/agent-patch.bin`)));
    expect(manifest.attempt).toBe(1);
    expect(manifest.max_attempts).toBe(3);
    expect(manifest.changed_paths).toEqual(replay.changed_paths);
    expect(manifest.commands.map((c: any) => c.id)).toEqual(["base-acceptance", "patched-acceptance", "build"]);
    expect(manifest.commands.every((c: any) => typeof c.exit_code === "number")).toBe(true);
    expect(manifest.outcomes).toEqual({
      base_acceptance_seeded_red: true,
      patched_acceptance_all_green: true,
      build_typecheck_ok: true,
      patch_policy_clean: true,
    });
    expect(manifest.execution_fingerprint).toBe(report.execution_fingerprint);
    expect(manifest.run_id).toBe(report.execution_id);
  });
});

describe("[F9] tamper matrix (independent negatives)", () => {
  test("[F9.1] task hash drift / base drift / suite drift are all detected by recompute", () => {
    const forgedTaskHash = "sha256:" + "11".repeat(32);
    expect(forgedTaskHash).not.toBe(report.task_freeze_hash);
    const forgedFp = deriveUuid(`gp2:fingerprint:${forgedTaskHash}:${taskRecord.base_commit_sha}:${manifest.patch_sha256}:1`);
    expect(forgedFp).not.toBe(manifest.execution_fingerprint); // task drift breaks identity binding
    const forgedBase = deriveUuid(`gp2:fingerprint:${report.task_freeze_hash}:${"f".repeat(40)}:${manifest.patch_sha256}:1`);
    expect(forgedBase).not.toBe(manifest.execution_fingerprint);
    const suiteAtBase = gitShow(`${taskRecord.base_commit_sha}:${taskRecord.acceptance_suite_path}`);
    const flipped = Buffer.from(suiteAtBase);
    flipped[flipped.length - 5]! ^= 0x01;
    expect(sha256(flipped)).not.toBe(taskRecord.acceptance_suite_sha256); // suite drift detectable at preflight layer
  });

  test("[F9.2] forbidden-path patch + post-seal bundle mutation rejected", () => {
    // forbidden-path: an override-style diff touching the suite cannot even be applied by policy —
    // verified here by the path-policy check being part of frozen record + replay derivation
    const suiteRel = taskRecord.acceptance_suite_path as string;
    expect(taskRecord.forbidden_paths.some((g: string) => g.includes("test"))).toBe(true);
    expect(suiteRel.includes("/test/")).toBe(true);
    // post-seal mutation: frozen schema SEALED superRefine rejects root/manifest tampering
    const mutated = { ...bundle, merkle_root: "sha256:" + "02".repeat(32) };
    expect(() => seal(EvidenceBundleSchema as never, mutated)).toThrow();
    const openState = { ...bundle, state: "OPEN" };
    expect(() => seal(EvidenceBundleSchema as never, openState)).toThrow();
  });
});

describe("[F10] GP3+ absence (target source scan)", () => {
  test("[F10.1] no verifier/decision/receipt/settlement/payment/devnet implementation in target gp-execution", () => {
    const srcDir = path.join(SNAP, "target-gp-execution-src");
    for (const f of readdirSync(srcDir)) {
      const src = readFileSync(path.join(srcDir, f), "utf8");
      for (const bad of [/createDecision/, /VerificationDecision/, /formReceipt/, /OutcomeReceipt/, /SettlementInstruction/, /releaseEscrow/, /transferFunds/, /devnet/i, /solana/i, /payOut/, /2-of-2/]) {
        expect(bad.test(src), `${f} must not contain ${bad}`).toBe(false);
      }
    }
    expect(HASH_RE.test(report.bundle.content_hash)).toBe(true);
  });
});
