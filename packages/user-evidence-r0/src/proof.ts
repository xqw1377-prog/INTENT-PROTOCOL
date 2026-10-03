/**
 * USER-EVIDENCE-R0 / UE-3 (CUT-3) — Portable Outcome Proof builder.
 *
 * The proof pack is the ENTIRE portable Tier-1 evidence: frozen contract
 * (4 freeze artifacts, byte-verbatim), the worker patch, the run record,
 * the frozen base BYTES (git bundle at the exact commit), and a standalone
 * verifier (verify.mjs). Any technically capable third party replays the
 * pack with only node+git+npm — no access to the original service, repo,
 * or runners. Generation-atomic publish (UE-1 R6A discipline): staging
 * sibling, fsync, full self-check, rename; outDir must not pre-exist.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { contractFreezeHash, contractFreezeOf, precommitBinding, verificationRulesetHash, verificationRulesetOf } from "./schema.ts";
import { verifyFreezePackDir } from "./pack.ts";
import type { RunRecordV1, ValidRunRecordV1 } from "./run.ts";

export class ProofError extends Error {
  constructor(readonly reason: string, message: string) {
    super(`PROOF-REFUSED (${reason}): ${message}`);
  }
}

export interface ProofFileEntry {
  sha256: string;
  bytes: number;
}

export interface ProofManifestV1 {
  schema_version: "outcome-proof-manifest.v1";
  experiment_id: string;
  built_at: string;
  tier1_verdict: "VALID";
  verification_ruleset_hash: string;
  contract_freeze_hash: string;
  precommit_binding: string;
  patch_sha256: string;
  files: Record<string, ProofFileEntry>;
}

const sha256File = (p: string): string => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex");

/**
 * The Tier-1 verdict is a DERIVED value, never an assertion: VALID iff the
 * record says VALID AND every check field is exactly its required constant
 * AND determinism is a full n/n with n >= 1. Flipping any single check
 * flips the verdict — there is no free variable.
 */
export function tier1VerdictOf(record: RunRecordV1): "VALID" | "INVALID" {
  if (record.verdict !== "VALID" || record.checks === undefined || record.checks === null) return "INVALID";
  const expected = {
    freeze_closure: "VERIFIED",
    base_regression_recheck: "RED",
    lockfile_unchanged: "OK",
    suite_unchanged: "OK",
    dependency_policy: "OK",
    patched_acceptance: "GREEN",
    baseline_health_patched: "GREEN",
    network_sandbox: "DENIED_VERIFIED",
  } as const;
  for (const [k, v] of Object.entries(expected)) {
    if ((record.checks as Record<string, unknown>)[k] !== v) return "INVALID";
  }
  const m = /^(\d+)\/(\d+)$/.exec(String((record.checks as Record<string, unknown>).determinism ?? ""));
  if (!m || m[1] !== m[2] || Number(m[1]) < 1) return "INVALID";
  if (!Array.isArray(record.runs) || record.runs.length === 0) return "INVALID";
  for (const r of record.runs) {
    if (typeof r?.command !== "string" || typeof r.code !== "number" || !/^sha256:[0-9a-f]{64}$/.test(String(r.stdout_sha256))) return "INVALID";
  }
  return "VALID";
}

export interface BuildProofInput {
  freezePackDir: string;
  runRecordPath: string;
  patchPath: string;
  /** the git object database that holds the frozen base commit */
  repoDir: string;
  outDir: string;
  builtAt: string;
}

export const PROOF_PACK_FILES = [
  "task.json",
  "ruleset.json",
  "contract-freeze.json",
  "freeze-manifest.json",
  "worker.patch",
  "run-record.json",
  "base.bundle",
  "verify.mjs",
] as const;

/** Create the base git bundle (local clone → pinned ref → bundle), self-checked. */
function createVerifiedBundle(repoDir: string, baseSha: string, bundlePath: string): void {
  const work = mkdtempSync(path.join(tmpdir(), "ue3-bundle-"));
  try {
    execFileSync("git", ["clone", "--quiet", repoDir, work], { maxBuffer: 256 * 1024 * 1024 });
    execFileSync("git", ["-C", work, "update-ref", "refs/heads/ue-base", baseSha]);
    execFileSync("git", ["-C", work, "bundle", "create", bundlePath, "refs/heads/ue-base"], { maxBuffer: 256 * 1024 * 1024 });
    execFileSync("git", ["-C", work, "bundle", "verify", bundlePath], { maxBuffer: 256 * 1024 * 1024 });
    // self-check: the bundle ALONE materializes the exact frozen base
    const check = mkdtempSync(path.join(tmpdir(), "ue3-bcheck-"));
    try {
      execFileSync("git", ["clone", "--quiet", "--branch", "ue-base", bundlePath, check], { maxBuffer: 256 * 1024 * 1024 });
      const got = execFileSync("git", ["-C", check, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      if (got !== baseSha) throw new ProofError("bundle-sha", `bundle HEAD ${got} != frozen base ${baseSha}`);
    } finally {
      rmSync(check, { recursive: true, force: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function buildProofPack(input: BuildProofInput): ProofManifestV1 {
  const pack = verifyFreezePackDir(input.freezePackDir);
  const task = pack.task;

  let record: RunRecordV1;
  try {
    record = JSON.parse(readFileSync(input.runRecordPath, "utf8")) as RunRecordV1;
  } catch (e) {
    throw new ProofError("run-record-unparsable", String((e as Error).message));
  }
  if (tier1VerdictOf(record) !== "VALID") {
    throw new ProofError("run-not-valid", `tier1 verdict is ${tier1VerdictOf(record)} — only a VALID run may enter a Tier-1 proof pack`);
  }
  const valid = record as ValidRunRecordV1;
  if (valid.experiment_id !== task.experiment_id) throw new ProofError("record-id", "run record experiment_id does not match the freeze");
  if (valid.worker_identity !== task.worker_identity) throw new ProofError("record-worker", "run record worker_identity does not match the freeze");
  if (
    valid.freeze.verification_ruleset_hash !== pack.manifest.verification_ruleset_hash ||
    valid.freeze.contract_freeze_hash !== pack.manifest.contract_freeze_hash ||
    valid.freeze.precommit_binding !== pack.manifest.precommit_binding
  ) {
    throw new ProofError("record-not-bound", "run record is not bound to THIS freeze pack");
  }

  const patchBytes = readFileSync(input.patchPath);
  const patchSha = "sha256:" + createHash("sha256").update(patchBytes).digest("hex");
  if (patchSha !== valid.patch_sha256) throw new ProofError("patch-mismatch", "patch bytes do not hash to run-record.patch_sha256");

  if (existsSync(input.outDir)) throw new ProofError("outdir-exists", `${input.outDir} already exists — refuse to overwrite or mix generations`);
  const parent = path.dirname(path.resolve(input.outDir));
  execFileSync("mkdir", ["-p", parent]);
  const staging = mkdtempSync(path.join(parent, ".ue3-gen-"));
  let manifest: ProofManifestV1;
  try {
    for (const f of ["task.json", "ruleset.json", "contract-freeze.json", "freeze-manifest.json"] as const) {
      copyFileSync(path.join(input.freezePackDir, f), path.join(staging, f));
    }
    writeFileSync(path.join(staging, "worker.patch"), patchBytes);
    copyFileSync(path.resolve(input.runRecordPath), path.join(staging, "run-record.json"));
    createVerifiedBundle(path.resolve(input.repoDir), task.base_commit_sha, path.join(staging, "base.bundle"));
    writeFileSync(path.join(staging, "verify.mjs"), readFileSync(new URL("./portable-replay.mjs", import.meta.url)));

    const m: ProofManifestV1 = {
      schema_version: "outcome-proof-manifest.v1",
      experiment_id: task.experiment_id,
      built_at: input.builtAt,
      tier1_verdict: "VALID",
      verification_ruleset_hash: verificationRulesetHash(verificationRulesetOf(task)),
      contract_freeze_hash: contractFreezeHash(task),
      precommit_binding: precommitBinding(task),
      patch_sha256: patchSha,
      files: {},
    };
    manifest = m;
    for (const f of PROOF_PACK_FILES) {
      const p = path.join(staging, f);
      manifest.files[f] = { sha256: sha256File(p), bytes: statBytes(p) };
    }
    writeFileSync(path.join(staging, "proof-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

    for (const f of readdirSync(staging)) {
      const fd = openSync(path.join(staging, f), "r");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    // self-check the staged generation before the atomic rename
    const stagedFiles = readdirSync(staging).sort();
    const expectedFiles = [...PROOF_PACK_FILES, "proof-manifest.json"].sort();
    if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
      throw new ProofError("generation-selfcheck", `staged file set != expected: ${stagedFiles.join(",")}`);
    }
    for (const [f, entry] of Object.entries(manifest.files)) {
      if (sha256File(path.join(staging, f)) !== entry.sha256 || statBytes(path.join(staging, f)) !== entry.bytes) {
        throw new ProofError("generation-selfcheck", `staged ${f} does not match the manifest entry`);
      }
    }
    renameSync(staging, input.outDir);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
  return manifest;
}

function statBytes(p: string): number {
  return readFileSync(p).length;
}

if (process.argv[1]?.endsWith("proof.ts") && process.argv[2] === "experiment" && process.argv[3] === "proof") {
  const [, , , , repoArg, packArg, patchArg, recordArg, builtAtArg, outArg] = process.argv;
  if (!repoArg || !packArg || !patchArg || !recordArg || !builtAtArg || !outArg) {
    console.error("usage: node --experimental-strip-types src/proof.ts experiment proof <repo> <freeze-pack-dir> <patch> <run-record.json> <built-at-ISO> <out-dir>");
    process.exit(2);
  }
  try {
    const m = buildProofPack({
      repoDir: path.resolve(repoArg),
      freezePackDir: path.resolve(packArg),
      patchPath: path.resolve(patchArg),
      runRecordPath: path.resolve(recordArg),
      builtAt: builtAtArg,
      outDir: path.resolve(outArg),
    });
    console.log("PROOF PACK — published:", JSON.stringify(m, null, 2));
  } catch (e) {
    console.error(String((e as Error).message));
    process.exit(1);
  }
}
