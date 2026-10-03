/**
 * USER-EVIDENCE-R0 / UE-2 (CUT-2) — Real Task Runner.
 *
 * Order of authority (frozen in the UE-2 contract):
 *   1. intake: the freeze pack must re-verify from disk, or the run refuses
 *      (operator error — no record, nothing executed);
 *   2. policy wall BEFORE execution: forbidden path / out-of-scope path /
 *      diff bound / binary patch → INVALID record with ZERO commands run;
 *   3. dependency wall at apply time: dependency sections of any touched
 *      package.json must be byte-identical before/after → INVALID;
 *   4. clean-room execution: materialize the EXACT frozen base, reconstruct
 *      deps from the frozen lockfile, re-prove base-red, apply the patch,
 *      require patched green (N-run determinism) and an unbroken baseline,
 *      all inside the network-denied sandbox (negatively probed);
 *   5. every execution is recorded (command, exit code, stdout hash, ms);
 *      verdict VALID iff every check holds — there is no other path to VALID.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { inNetSandbox, materializeBase, verifyNetSandbox, FreezeError } from "./freeze.ts";
import { verifyFreezePackDir } from "./pack.ts";
import { dependencySectionsUnchanged, evaluatePatchPolicy, isDependencyManifestPath, parseUnifiedPatch } from "./policy.ts";

export interface ExecutedRun {
  stage: string;
  command: string;
  code: number;
  stdout_sha256: string;
  duration_ms: number;
}

export interface RunRecordBaseV1 {
  schema_version: "real-task-run.v1";
  experiment_id: string;
  worker_identity: string;
  freeze: {
    verification_ruleset_hash: string;
    contract_freeze_hash: string;
    precommit_binding: string;
  };
  patch_sha256: string;
  patch_touched_paths: string[];
  patch_added_lines: number;
  patch_removed_lines: number;
  /** "OK" or the first policy violation (single source, pre-execution) */
  policy_result: string;
}

export interface ValidRunRecordV1 extends RunRecordBaseV1 {
  policy_result: "OK";
  checks: {
    freeze_closure: "VERIFIED";
    base_regression_recheck: "RED";
    lockfile_unchanged: "OK";
    suite_unchanged: "OK";
    dependency_policy: "OK";
    patched_acceptance: "GREEN";
    baseline_health_patched: "GREEN";
    determinism: `${number}/${number}`;
    network_sandbox: "DENIED_VERIFIED";
  };
  runs: ExecutedRun[];
  verdict: "VALID";
  ran_at: string;
}

export interface InvalidRunRecordV1 extends RunRecordBaseV1 {
  checks: Record<string, never>;
  runs: ExecutedRun[]; // empty for pre-execution disqualification
  verdict: "INVALID";
  invalid_reason: string;
  ran_at: string;
}

export type RunRecordV1 = ValidRunRecordV1 | InvalidRunRecordV1;

export class RunError extends Error {
  constructor(readonly reason: string, message: string) {
    super(`RUN-REFUSED (${reason}): ${message}`);
  }
}

export interface RunInput {
  repoDir: string;
  freezePackDir: string;
  patchPath: string;
  ranAt: string;
}

const sha256File = (p: string): string => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex");
const sha256Text = (s: string): string => "sha256:" + createHash("sha256").update(s).digest("hex");

/** Execute one command (sandboxed by default) and append it to the run ledger. */
function execRecorded(runs: ExecutedRun[], stageDir: string, stageName: string, cmd: string, sandbox: boolean): { code: number; stdout: string } {
  const t0 = Date.now();
  let r: { code: number; stdout: string };
  if (sandbox) {
    r = inNetSandbox(cmd, stageDir);
  } else {
    try {
      const out = execFileSync("sh", ["-c", cmd], { cwd: stageDir, encoding: "utf8", timeout: 15 * 60_000, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      r = { code: 0, stdout: out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      r = { code: err.status ?? 1, stdout: err.stdout ?? "" };
    }
  }
  runs.push({ stage: stageName, command: cmd, code: r.code, stdout_sha256: sha256Text(r.stdout), duration_ms: Date.now() - t0 });
  return r;
}

/** Write the record atomically (temp sibling + rename); refuse to overwrite. */
function writeRecordAtomic(rec: RunRecordV1, outPath: string): void {
  if (existsSync(outPath)) throw new RunError("out-exists", `${outPath} already exists — a run record is never overwritten`);
  const tmp = outPath + ".tmp-" + process.pid;
  try {
    writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n");
    renameSync(tmp, outPath);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function runWorkerPatch(input: RunInput, outPath?: string): RunRecordV1 {
  const pack = verifyFreezePackDir(input.freezePackDir);
  const task = pack.task;

  const patchBytes = readFileSync(input.patchPath);
  const patchSha = "sha256:" + createHash("sha256").update(patchBytes).digest("hex");
  const parsed = parseUnifiedPatch(patchBytes);
  const policy = evaluatePatchPolicy(parsed, {
    allowed_paths: task.allowed_paths,
    forbidden_paths: task.forbidden_paths,
    max_diff_lines: task.max_diff_lines,
  });

  const base: RunRecordBaseV1 = {
    schema_version: "real-task-run.v1",
    experiment_id: task.experiment_id,
    worker_identity: task.worker_identity,
    freeze: {
      verification_ruleset_hash: pack.manifest.verification_ruleset_hash,
      contract_freeze_hash: pack.manifest.contract_freeze_hash,
      precommit_binding: pack.manifest.precommit_binding,
    },
    patch_sha256: patchSha,
    patch_touched_paths: parsed.touchedPaths,
    patch_added_lines: parsed.addedLines,
    patch_removed_lines: parsed.removedLines,
    policy_result: policy.ok ? "OK" : (policy.reason as string),
  };

  // 2. the policy wall: pre-execution disqualification, ZERO commands run
  if (!policy.ok) {
    const rec: InvalidRunRecordV1 = {
      ...base,
      checks: {},
      runs: [],
      verdict: "INVALID",
      invalid_reason: policy.reason as string,
      ran_at: input.ranAt,
    };
    if (outPath) writeRecordAtomic(rec, outPath);
    return rec;
  }

  // 3./4. clean-room execution
  const runs: ExecutedRun[] = [];
  const stage = mkdtempSync(path.join(tmpdir(), "ue2-run-"));
  const invalid = (reason: string): InvalidRunRecordV1 => {
    const rec: InvalidRunRecordV1 = { ...base, checks: {}, runs, verdict: "INVALID", invalid_reason: reason, ran_at: input.ranAt };
    if (outPath) writeRecordAtomic(rec, outPath);
    return rec;
  };

  try {
    materializeBase(input.repoDir, task.base_commit_sha, stage);
    execFileSync("git", ["init", "--quiet"], { cwd: stage }); // git apply needs a repo root

    // byte re-checks against the materialized base (the pack binds bytes, not trust)
    const suitePath = path.join(stage, task.acceptance_suite);
    if (!existsSync(suitePath)) return invalid("suite-missing-at-base");
    if (sha256File(suitePath) !== task.acceptance_suite_sha256) return invalid("suite-bytes-drift");
    const lockPath = path.join(stage, task.lockfile_path);
    if (!existsSync(lockPath)) return invalid("lockfile-missing-at-base");
    if (sha256File(lockPath) !== task.lockfile_sha256) return invalid("lockfile-bytes-drift");

    // dependency wall evidence: dependency manifests BEFORE the patch
    const manifests = parsed.touchedPaths.filter(isDependencyManifestPath);
    const beforeManifests = new Map<string, string | null>(
      manifests.map((p) => [p, existsSync(path.join(stage, p)) ? readFileSync(path.join(stage, p), "utf8") : null]),
    );

    // clean-room dependency reconstruction (UE-1 parity, recorded)
    rmSync(path.join(stage, "node_modules"), { recursive: true, force: true });
    execRecorded(runs, stage, "install", task.commands.install_command, /* sandbox */ false);

    try {
      verifyNetSandbox(stage);
    } catch (e) {
      throw new RunError("network-sandbox", String((e as FreezeError).message));
    }

    const baseRed = execRecorded(runs, stage, "base-regression-recheck", task.commands.regression_command, true);
    if (baseRed.code === 0) return invalid("base-not-red-at-run");

    const patchArg = JSON.stringify(path.resolve(input.patchPath));
    const chk = execRecorded(runs, stage, "patch-apply-check", `git apply --check ${patchArg}`, true);
    if (chk.code !== 0) return invalid("patch-not-applicable");
    const ap = execRecorded(runs, stage, "patch-apply", `git apply ${patchArg}`, true);
    if (ap.code !== 0) return invalid("patch-apply-failed");

    if (sha256File(lockPath) !== task.lockfile_sha256) return invalid("lockfile-drift");
    if (sha256File(suitePath) !== task.acceptance_suite_sha256) return invalid("suite-drift");
    for (const p of manifests) {
      const after = existsSync(path.join(stage, p)) ? readFileSync(path.join(stage, p), "utf8") : null;
      if (!dependencySectionsUnchanged(beforeManifests.get(p) ?? null, after)) return invalid(`dependency-change:${p}`);
    }

    const acc = execRecorded(runs, stage, "patched-acceptance", task.commands.patched_acceptance_command, true);
    if (acc.code !== 0) return invalid("patched-acceptance-red");
    const health = execRecorded(runs, stage, "baseline-health-patched", task.commands.baseline_health_command, true);
    if (health.code !== 0) return invalid("baseline-broken");

    let greens = 0;
    for (let i = 0; i < task.determinism_runs; i++) {
      const r = execRecorded(runs, stage, `determinism-${i + 1}`, task.commands.patched_acceptance_command, true);
      if (r.code === 0) greens++;
    }
    if (greens !== task.determinism_runs) return invalid("determinism-unstable");

    const rec: ValidRunRecordV1 = {
      ...base,
      policy_result: "OK",
      checks: {
        freeze_closure: "VERIFIED",
        base_regression_recheck: "RED",
        lockfile_unchanged: "OK",
        suite_unchanged: "OK",
        dependency_policy: "OK",
        patched_acceptance: "GREEN",
        baseline_health_patched: "GREEN",
        determinism: `${task.determinism_runs}/${task.determinism_runs}` as `${number}/${number}`,
        network_sandbox: "DENIED_VERIFIED",
      },
      runs,
      verdict: "VALID",
      ran_at: input.ranAt,
    };
    if (outPath) writeRecordAtomic(rec, outPath);
    return rec;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("run.ts") && process.argv[2] === "experiment" && process.argv[3] === "run") {
  const [, , , , repoArg, packArg, patchArg, ranAtArg, outArg] = process.argv;
  if (!repoArg || !packArg || !patchArg || !ranAtArg) {
    console.error("usage: node --experimental-strip-types src/run.ts experiment run <repo> <freeze-pack-dir> <patch> <ran-at-ISO> [out-record.json]");
    process.exit(2);
  }
  try {
    const rec = runWorkerPatch(
      { repoDir: path.resolve(repoArg), freezePackDir: path.resolve(packArg), patchPath: path.resolve(patchArg), ranAt: ranAtArg },
      outArg ? path.resolve(outArg) : undefined,
    );
    console.log(`TIER1_VERDICT=${rec.verdict}${rec.verdict === "INVALID" ? ` (${rec.invalid_reason})` : ""}`);
    if (outArg) console.log("run record:", path.resolve(outArg));
  } catch (e) {
    console.error(String((e as Error).message));
    process.exit(1);
  }
}
