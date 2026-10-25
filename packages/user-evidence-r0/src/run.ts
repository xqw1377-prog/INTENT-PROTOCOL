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
 *   4. clean-room execution (SECURITY-R1): materialize the EXACT frozen base,
 *      reconstruct deps in the PHASE A install container (no patch yet),
 *      re-prove base-red, apply the patch on the host as data (PHASE B),
 *      then require patched green (N-run determinism) and an unbroken
 *      baseline in the PHASE C execution container — network none, /work
 *      read-only, negatively probed. Docker unavailable → run refused;
 *   5. every execution is recorded (command, exit code, stdout hash, ms);
 *      verdict VALID iff every check holds — there is no other path to VALID.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { inNetSandbox, materializeBase, verifyNetSandbox, FreezeError } from "./freeze.ts";
import { assertIsolationAvailable, installIsolated, IsolationError, makeRunDir } from "./isolation.ts";
import { CANONICAL_INSTALL_COMMAND } from "./schema.ts";
import { verifyFreezePackDir } from "./pack.ts";
import { dependencySectionsUnchanged, evaluatePatchPolicy, isCanonicalRepoRelativePath, isDependencyManifestPath, parseUnifiedPatch } from "./policy.ts";

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
    symlink_free_paths: "OK";
    base_regression_recheck: "RED";
    install_boundary: "LIFECYCLE_SCRIPTS_DISABLED";
    post_install_bytes: "OK";
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

/** Execute one frozen command in the execution container and append it to the run ledger. */
function execRecorded(runs: ExecutedRun[], stageDir: string, stageName: string, cmd: string): { code: number; stdout: string } {
  const t0 = Date.now();
  const r = inNetSandbox(cmd, stageDir);
  runs.push({ stage: stageName, command: cmd, code: r.code, stdout_sha256: sha256Text(r.stdout), duration_ms: Date.now() - t0 });
  return r;
}

/** PHASE B: the patch is data — host git applies it; no project code executes. */
function gitApplyRecorded(runs: ExecutedRun[], stageDir: string, stageName: string, patchAbs: string, check: boolean): number {
  const t0 = Date.now();
  const args = check ? ["apply", "--check", patchAbs] : ["apply", patchAbs];
  let code = 0;
  let stdout = "";
  try {
    stdout = execFileSync("git", ["-C", stageDir, ...args], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    code = (e as { status?: number }).status ?? 1;
  }
  runs.push({ stage: stageName, command: `git ${args.slice(0, -1).join(" ")} ${JSON.stringify(patchAbs)}`, code, stdout_sha256: sha256Text(stdout), duration_ms: Date.now() - t0 });
  return code;
}

/**
 * UE2-R-PATH (CUT-2R): no component of any touched path may be a symlink in
 * the materialized base tree — a patch writing through a symlinked directory
 * modifies files OUTSIDE the hashed tree. Runs after base materialization
 * and BEFORE any command (zero executions on violation).
 */
function assertPathsSymlinkFree(stage: string, touchedPaths: readonly string[]): boolean {
  for (const p of touchedPaths) {
    let cur = stage;
    for (const seg of p.split("/")) {
      cur = path.join(cur, seg);
      const st = lstatSync(cur, { throwIfNoEntry: false });
      if (st?.isSymbolicLink()) return false;
    }
  }
  return true;
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

  // 3./4. clean-room execution — an unavailable isolation runtime is an
  // operator/environment failure: refuse, write no record, execute nothing
  try {
    assertIsolationAvailable();
  } catch (e) {
    if (e instanceof IsolationError) throw new RunError(`isolation-${e.reason}`, e.message);
    throw e;
  }
  const runs: ExecutedRun[] = [];
  const stage = makeRunDir("ue2-run-");
  const invalid = (reason: string): InvalidRunRecordV1 => {
    const rec: InvalidRunRecordV1 = { ...base, checks: {}, runs, verdict: "INVALID", invalid_reason: reason, ran_at: input.ranAt };
    if (outPath) writeRecordAtomic(rec, outPath);
    return rec;
  };

  try {
    materializeBase(input.repoDir, task.base_commit_sha, stage);
    execFileSync("git", ["init", "--quiet"], { cwd: stage }); // git apply needs a repo root

    // UE2-R-PATH: no touched path may traverse a symlink of the base tree —
    // checked BEFORE any command executes (zero executions on violation)
    if (!assertPathsSymlinkFree(stage, parsed.touchedPaths)) {
      return invalid("symlink-in-path");
    }

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

    // UE2-R-INSTALL / CUT-2R1 + SECURITY-R1 S2: install is a dependency-
    // materialization operation with ZERO shell authority — the canonical
    // argv runs in the PHASE A install container (clean env whitelist,
    // lifecycle scripts disabled by flag + env, only this run dir mounted)
    // BEFORE any worker byte is applied. The bootstrap is NOT trusted:
    // every frozen byte the verdict depends on is re-hashed after it.
    rmSync(path.join(stage, "node_modules"), { recursive: true, force: true });
    const t0 = Date.now();
    const install = installIsolated(stage);
    runs.push({ stage: "install", command: CANONICAL_INSTALL_COMMAND, code: install.code, stdout_sha256: sha256Text(install.stdout), duration_ms: Date.now() - t0 });
    if (install.code !== 0) return invalid("install-failed");
    if (sha256File(suitePath) !== task.acceptance_suite_sha256) return invalid("post-install-suite-drift");
    if (sha256File(lockPath) !== task.lockfile_sha256) return invalid("post-install-lockfile-drift");

    try {
      verifyNetSandbox(stage, task.lockfile_path);
    } catch (e) {
      throw new RunError("network-sandbox", String((e as FreezeError).message));
    }

    const baseRed = execRecorded(runs, stage, "base-regression-recheck", task.commands.regression_command);
    if (baseRed.code === 0) return invalid("base-not-red-at-run");

    const patchAbs = path.resolve(input.patchPath);
    if (gitApplyRecorded(runs, stage, "patch-apply-check", patchAbs, true) !== 0) return invalid("patch-not-applicable");
    if (gitApplyRecorded(runs, stage, "patch-apply", patchAbs, false) !== 0) return invalid("patch-apply-failed");

    if (sha256File(lockPath) !== task.lockfile_sha256) return invalid("lockfile-drift");
    if (sha256File(suitePath) !== task.acceptance_suite_sha256) return invalid("suite-drift");
    for (const p of manifests) {
      const after = existsSync(path.join(stage, p)) ? readFileSync(path.join(stage, p), "utf8") : null;
      if (!dependencySectionsUnchanged(beforeManifests.get(p) ?? null, after)) return invalid(`dependency-change:${p}`);
    }

    const acc = execRecorded(runs, stage, "patched-acceptance", task.commands.patched_acceptance_command);
    if (acc.code !== 0) return invalid("patched-acceptance-red");
    const health = execRecorded(runs, stage, "baseline-health-patched", task.commands.baseline_health_command);
    if (health.code !== 0) return invalid("baseline-broken");

    let greens = 0;
    for (let i = 0; i < task.determinism_runs; i++) {
      const r = execRecorded(runs, stage, `determinism-${i + 1}`, task.commands.patched_acceptance_command);
      if (r.code === 0) greens++;
    }
    if (greens !== task.determinism_runs) return invalid("determinism-unstable");

    const rec: ValidRunRecordV1 = {
      ...base,
      policy_result: "OK",
      checks: {
        freeze_closure: "VERIFIED",
        symlink_free_paths: "OK",
        base_regression_recheck: "RED",
        install_boundary: "LIFECYCLE_SCRIPTS_DISABLED",
        post_install_bytes: "OK",
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
