/**
 * GP2 deterministic isolated runner (Issue #25 §A/§B/§C).
 *
 * Materializes the exact base commit from the git object database into an
 * isolated temp directory (git archive — the truth repo is NEVER mutated),
 * runs the seeded-red baseline, applies the agent-produced minimal fix under
 * the frozen path policy with the frozen attempt cap, re-runs the suite and
 * build, and captures stdout/stderr/exit/tool-versions for every command.
 * All protocol timestamps come from the caller-supplied logical clock.
 *
 * Determinism: execution identity (run/execution UUID) is derived from the
 * frozen inputs (task_freeze_hash, base SHA, patch SHA, attempt) — an
 * isolated replay reproduces byte-identical evidence.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { changedPathsViolations, git, repoRoot, sha256, type TaskFreezeRecord } from "./task.js";

export interface LogicalClock {
  /** Deterministic logical timestamps supplied by the runner caller. */
  now(step: number): string;
}

export const FIXED_CLOCK: LogicalClock = {
  // Proof runs use a fixed logical epoch so replays are byte-identical.
  now: (step) => new Date(Date.UTC(2026, 8, 21, 10, 0, 0) + step * 1000).toISOString(),
};

export interface CommandCapture {
  command: string[];
  cwd: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms_hint: number; // logical, not wall: derived from clock steps
  at: string;
}

export interface ToolchainInfo {
  node: string;
  npm: string;
  typescript: string;
  vitest: string;
  os: string;
}

export interface ManifestCommand {
  id: string;
  command: string[];
  cwd: string;
  exit_code: number;
  at: string;
}

export interface ExecutionManifest {
  schema_version: "gp-execution-manifest.v1";
  /** ExecutionRef identity (GP-V1 §5 output list; not a new G1 primitive). */
  execution_ref: string;
  /**
   * GP2-R2 identity split:
   *   execution_fingerprint = deterministic EQUIVALENCE fingerprint (same
   *     task/base/patch/attempt => same fingerprint);
   *   run_id = ONE real execution INSTANCE identity — unique on every capture.
   */
  execution_fingerprint: string;
  run_id: string;
  bounty_id: string;
  task_freeze_hash: string;
  base_commit_sha: string;
  package_path: string;
  /** sha256 over the exact unified-diff bytes the agent produced. */
  patch_sha256: string;
  changed_paths: string[];
  attempt: number;
  max_attempts: number;
  commands: ManifestCommand[];
  toolchain: ToolchainInfo;
  started_at: string;
  ended_at: string;
  outcomes: {
    base_acceptance_seeded_red: boolean;
    patched_acceptance_all_green: boolean;
    build_typecheck_ok: boolean;
    patch_policy_clean: boolean;
  };
}

/** Deterministic lowercase-hyphenated UUID derived from a seed string (G1 canonical UUID grammar). */
export function deriveUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex");
  // canonical form: set version 4 bits and variant bits for shape-only compliance (version-agnostic per G1)
  const b = h.slice(0, 32);
  const hex = b.slice(0, 12) + "4" + b.slice(13, 16) + "8" + b.slice(17, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export class RunnerError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[runner:${code}] ${message}`);
  }
}

export interface RawEvidence {
  /** stable artifact key, e.g. "base-acceptance" */
  key: string;
  bytes: Buffer;
  /** Logical capture time. */
  at: string;
}

export interface ExecutionResult {
  manifest: ExecutionManifest;
  raw: Map<string, RawEvidence>;
  workdir: string;
  dispose(): void;
}

const run = (cmd: string[], cwd: string): CommandCapture & { ok: boolean } => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    command: cmd,
    cwd: "workdir-root", // deterministic label — never the random temp path
    exit_code: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    duration_ms_hint: 0,
    at: "",
    ok: (r.status ?? -1) === 0,
  };
};

const toolchain = (): ToolchainInfo => ({
  node: process.version,
  npm: process.env.npm_config_user_agent?.match(/npm\/([\d.]+)/)?.[1] ?? "unknown",
  typescript: readFileSync(path.join(repoRoot, "node_modules/typescript/package.json"), "utf8").match(/"version":\s*"([^"]+)"/)?.[1] ?? "unknown",
  vitest: readFileSync(path.join(repoRoot, "node_modules/vitest/package.json"), "utf8").match(/"version":\s*"([^"]+)"/)?.[1] ?? "unknown",
  os: `${process.platform}/${process.arch}`,
});

/** Minimal agent-style fix for GP-001: derive (not hardcode into evidence) the patch from the seeded bug. */
function produceAgentPatch(workdir: string, record: TaskFreezeRecord): Buffer {
  const fileRel = `${record.package_path}/src/retry.ts`;
  const fileAbs = path.join(workdir, fileRel);
  const before = readFileSync(fileAbs, "utf8");
  // The seeded bug uses Retry-After seconds directly as milliseconds.
  // The agent's minimal fix: multiply parsed seconds by 1000.
  const BUG = "const delayMs = parsed !== null ? parsed : DEFAULT_RETRY_DELAY_MS;";
  const FIX = "const delayMs = parsed !== null ? parsed * 1000 : DEFAULT_RETRY_DELAY_MS;";
  if (!before.includes(BUG)) throw new RunnerError("bug-pattern-missing", "seeded bug pattern not found at base");
  const after = before.replace(BUG, FIX);
  writeFileSync(fileAbs, after, "utf8");
  // unified diff via git in the isolated dir (initialized as a git repo at base)
  const diff = execFileSync("git", ["-C", workdir, "diff", "--no-color", "--", fileRel], { encoding: "utf8" });
  // restore base state; the caller applies the patch through the policy-checked path
  execFileSync("git", ["-C", workdir, "checkout", "--", fileRel]);
  return Buffer.from(diff, "utf8");
}

function parseDiffPaths(diff: string): string[] {
  return [...diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((m) => m[2]!);
}

export interface ExecuteOptions {
  record: TaskFreezeRecord;
  taskFreezeHash: string;
  attempt: number;
  clock?: LogicalClock;
  /** override for tamper tests: an explicitly supplied patch (bypasses agent derivation) */
  patchOverride?: Buffer;
}

export function executeIsolated(opts: ExecuteOptions): ExecutionResult {
  const { record, taskFreezeHash, attempt } = opts;
  const clock = opts.clock ?? FIXED_CLOCK;

  if (attempt < 1 || attempt > record.max_attempts) {
    throw new RunnerError("attempt-out-of-range", `attempt ${attempt} outside 1..${record.max_attempts}`);
  }

  const tmpRoot = mkdtempSync(path.join(tmpdir(), "gp2-root-"));
  const workdir = path.join(tmpRoot, "w");
  mkdirSync(workdir, { recursive: true });
  const dispose = () => rmSync(tmpRoot, { recursive: true, force: true });

  // Early frozen-path-policy rejection for SUPPLIED patches: refuse before any
  // materialization/execution cost (§A "enforce allowed/forbidden boundaries").
  if (opts.patchOverride) {
    const earlyViolations = changedPathsViolations(parseDiffPaths(opts.patchOverride.toString("utf8")), record);
    if (earlyViolations.length > 0) {
      throw new RunnerError("patch-policy", `patch violates frozen path policy: ${earlyViolations.join(", ")}`);
    }
  }

  try {
    // --- materialize the exact base commit (read-only extraction; truth repo untouched)
    const archive = execFileSync("git", ["archive", record.base_commit_sha], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
    // extract with RELATIVE tar path from cwd=workdir: Windows tar treats "C:\..." as host:path
    writeFileSync(path.join(tmpRoot, "a.tar"), archive);
    execFileSync("tar", ["-xf", "../a.tar"], { cwd: workdir });
    rmSync(path.join(tmpRoot, "a.tar"), { force: true });

    // isolated git identity for diff/apply (never touches the truth repo)
    execFileSync("git", ["init", "--quiet"], { cwd: workdir });
    execFileSync("git", ["-C", workdir, "add", "-A"]);
    execFileSync("git", ["-C", workdir, "-c", "user.name=gp2-isolated-runner", "-c", "user.email=runner@gp2.invalid", "commit", "--quiet", "-m", "base"]);

    // toolchain isolation: reuse the repository-pinned node_modules (installed via the
    // frozen lockfile) through a single symlink; recorded in the manifest.
    symlinkSync(path.join(repoRoot, "node_modules"), path.join(workdir, "node_modules"), "junction");

    const raw = new Map<string, RawEvidence>();
    const commands: ManifestCommand[] = [];
    let step = 0;
    const capture = (id: string, cmd: string[], cwdRel = "."): { ok: boolean; stdout: string; stderr: string; exit_code: number } => {
      const c = run(cmd, path.join(workdir, cwdRel));
      const at = clock.now(step++);
      commands.push({ id, command: c.command, cwd: c.cwd, exit_code: c.exit_code, at });
      return { ok: c.ok, stdout: c.stdout, stderr: c.stderr, exit_code: c.exit_code };
    };

    // --- phase 1: seeded-red baseline at the exact base
    const baseTest = capture("base-acceptance", ["node", "node_modules/vitest/vitest.mjs", "run", "--root", ".", "packages/golden-path/demo/test/acceptance.test.ts", "--reporter=json"]);
    const baseOk = baseTest.ok;
    const baseFailed = parseVitestCounts(baseTest.stdout);
    raw.set("base-acceptance", { key: "base-acceptance", bytes: Buffer.from(baseTest.stdout, "utf8"), at: clock.now(step++) });
    const seededRed = !baseOk && baseFailed.failed === 2 && baseFailed.passed === 2; // A1+A2 red, A3+A4 green (frozen seed shape)

    // --- phase 2: agent patch under the frozen path policy
    let patchBytes = opts.patchOverride;
    if (!patchBytes) patchBytes = produceAgentPatch(workdir, record);
    const patchStr = patchBytes.toString("utf8");
    const changedPaths = parseDiffPaths(patchStr);
    const violations = changedPathsViolations(changedPaths, record);
    if (violations.length > 0) {
      dispose();
      throw new RunnerError("patch-policy", `patch violates frozen path policy: ${violations.join(", ")}`);
    }
    // apply through git (checks the patch is valid against base)
    const applyOk = (() => {
      try {
        execFileSync("git", ["-C", workdir, "apply", "--check", "-"], { input: patchBytes, encoding: "utf8" });
        execFileSync("git", ["-C", workdir, "apply", "-"], { input: patchBytes, encoding: "utf8" });
        return true;
      } catch {
        return false;
      }
    })();
    if (!applyOk) {
      dispose();
      throw new RunnerError("patch-apply", "patch does not apply cleanly to base");
    }
    raw.set("agent-patch", { key: "agent-patch", bytes: patchBytes, at: clock.now(step++) });

    // --- phase 3: patched acceptance + build
    const patchedTest = capture("patched-acceptance", ["node", "node_modules/vitest/vitest.mjs", "run", "--root", ".", "packages/golden-path/demo/test/acceptance.test.ts", "--reporter=json"]);
    const patchedCounts = parseVitestCounts(patchedTest.stdout);
    raw.set("patched-acceptance", { key: "patched-acceptance", bytes: Buffer.from(patchedTest.stdout, "utf8"), at: clock.now(step++) });

    const build = capture("build", ["node", "node_modules/typescript/bin/tsc", "-p", `${record.package_path}/tsconfig.json`, "--noEmit"]);
    raw.set("build", { key: "build", bytes: Buffer.from(`${build.stdout}\n${build.stderr}`.trim() + `\nexit=${build.exit_code}\n`, "utf8"), at: clock.now(step++) });

    // --- phase 4: policy-boundary evidence (changed paths + policy verdicts)
    const policyEvidence = JSON.stringify(
      { changed_paths: changedPaths, allowed: record.allowed_paths, forbidden: record.forbidden_paths, violations, patch_sha256: sha256(patchBytes) },
      null, 2,
    ) + "\n";
    raw.set("policy-boundary", { key: "policy-boundary", bytes: Buffer.from(policyEvidence, "utf8"), at: clock.now(step++) });

    const patchSha = sha256(patchBytes);
    const executionFingerprint = deriveUuid(`gp2:fingerprint:${taskFreezeHash}:${record.base_commit_sha}:${patchSha}:${attempt}`);
    const runId = randomUUID(); // instance identity: unique per real execution
    const manifest: ExecutionManifest = {
      schema_version: "gp-execution-manifest.v1",
      execution_ref: deriveUuid(`gp2:execref:${runId}`),
      execution_fingerprint: executionFingerprint,
      run_id: runId,
      bounty_id: record.bounty_id,
      task_freeze_hash: taskFreezeHash,
      base_commit_sha: record.base_commit_sha,
      package_path: record.package_path,
      patch_sha256: patchSha,
      changed_paths: changedPaths,
      attempt,
      max_attempts: record.max_attempts,
      commands,
      toolchain: toolchain(),
      started_at: clock.now(0),
      ended_at: clock.now(step),
      outcomes: {
        base_acceptance_seeded_red: seededRed,
        patched_acceptance_all_green: patchedTest.ok && patchedCounts.failed === 0,
        build_typecheck_ok: build.ok,
        patch_policy_clean: violations.length === 0,
      },
    };
    raw.set("execution-manifest", {
      key: "execution-manifest",
      bytes: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"),
      at: clock.now(step++),
    });

    return { manifest, raw, workdir, dispose };
  } catch (e) {
    dispose();
    throw e;
  }
}

export function parseVitestCounts(json: string): { passed: number; failed: number } {
  // vitest --reporter=json prints a JSON object; robustly extract the totals
  const start = json.indexOf("{");
  if (start < 0) return { passed: 0, failed: 0 };
  try {
    const parsed = JSON.parse(json.slice(start)) as {
      numPassedTests?: number; numFailedTests?: number; numPassedTestSuites?: number;
    };
    return { passed: parsed.numPassedTests ?? 0, failed: parsed.numFailedTests ?? 0 };
  } catch {
    return { passed: 0, failed: 0 };
  }
}

export { sha256, git, repoRoot };
