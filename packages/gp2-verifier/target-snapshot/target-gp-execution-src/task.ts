/**
 * GP2 task preflight (Issue #25 §Frozen task input).
 *
 * Loads packages/golden-path/fixtures/gp-001-task.json, recomputes the
 * exact-byte task_freeze_hash and the acceptance-suite sha256 FROM THE BASE
 * COMMIT (git object database — never the live worktree), and verifies every
 * frozen fact before any execution. Any drift => NOT_READY, no execution.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface TaskFreezeRecord {
  schema_version: string;
  bounty_id: string;
  repository_url: string;
  package_path: string;
  base_commit_sha: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  acceptance_suite_path: string;
  acceptance_suite_sha256: string;
  max_attempts: number;
  deadline: string;
  escrow_ref: string;
  asset: { network: string; asset: string; decimals: number };
  reward: string;
  verification_policy: string;
}

export const TASK_RECORD_PATH = "packages/golden-path/fixtures/gp-001-task.json";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const git = (args: string[], cwd = repoRoot): string => execFileSync("git", args, { cwd, encoding: "utf8" });
const sha256 = (bytes: Buffer | string): string => "sha256:" + createHash("sha256").update(bytes).digest("hex");

export class PreflightError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[preflight:${code}] ${message}`);
  }
}

export interface PreflightResult {
  record: TaskFreezeRecord;
  /** sha256 over the exact committed UTF-8 bytes of the task record file. */
  task_freeze_hash: string;
  /** sha256 over the exact base-commit bytes of the acceptance suite. */
  recomputed_suite_sha256: string;
  base_commit_exists: true;
}

export function loadTaskRecord(recordPath: string = TASK_RECORD_PATH): { record: TaskFreezeRecord; fileBytes: Buffer } {
  const fileBytes = readFileSync(path.resolve(repoRoot, recordPath));
  const record = JSON.parse(fileBytes.toString("utf8")) as TaskFreezeRecord;
  return { record, fileBytes };
}

/** Commander-pinned LIVE wire subtree (main@d4c685b == G1-signed c1a85cb subtree). */
export const REQUIRED_LIVE_SCHEMA_SUBTREE = "bb14d9375c92d64072f3e8c2f2dd65d794008422";

export function assertLiveSchemaSubtree(expected: string = REQUIRED_LIVE_SCHEMA_SUBTREE): void {
  const actual = git(["rev-parse", "HEAD:packages/protocol-schema"]).trim();
  if (actual !== expected) {
    throw new PreflightError("live-schema-subtree", `live protocol-schema subtree ${actual} != required ${expected}`);
  }
}

export function preflight(opts: { recordPath?: string } = {}): PreflightResult {
  // HARD GATE (Commander V2 order): evidence generation refuses to start unless
  // the live imported wire IS the verified subtree.
  assertLiveSchemaSubtree();
  const { record, fileBytes } = loadTaskRecord(opts.recordPath);

  // 1. exact-byte task_freeze_hash
  if (record.schema_version !== "gp-task-freeze.v1") throw new PreflightError("schema", `unexpected schema_version ${record.schema_version}`);
  const taskHash = sha256(fileBytes);

  // 4. base commit exists + object-database content resolvable
  let baseOk = false;
  try {
    baseOk = git(["cat-file", "-e", `${record.base_commit_sha}^{commit}`]) === "";
  } catch { /* fallthrough */ }
  if (!baseOk) throw new PreflightError("base-missing", `base commit ${record.base_commit_sha} not found`);

  // 2. acceptance suite sha256 from the BASE COMMIT bytes
  let suiteBytes: Buffer;
  try {
    suiteBytes = execFileSync("git", ["show", `${record.base_commit_sha}:${record.acceptance_suite_path}`], { cwd: repoRoot });
  } catch {
    throw new PreflightError("suite-missing", `suite path ${record.acceptance_suite_path} not resolvable at base`);
  }
  const suiteHash = sha256(suiteBytes);

  // 3. both match the frozen record
  if (suiteHash !== record.acceptance_suite_sha256) {
    throw new PreflightError("suite-drift", `suite sha256 at base ${suiteHash} != frozen ${record.acceptance_suite_sha256}`);
  }

  // 4b. package path resolves at base
  try {
    execFileSync("git", ["show", `${record.base_commit_sha}:${record.package_path}/package.json`], { cwd: repoRoot });
  } catch {
    throw new PreflightError("package-missing", `package path ${record.package_path} not resolvable at base`);
  }

  // 5. path sets parse and are non-empty; allowed must not overlap forbidden
  if (record.allowed_paths.length === 0 || record.forbidden_paths.length === 0) throw new PreflightError("paths-empty", "allowed/forbidden path sets must be non-empty");
  for (const a of record.allowed_paths) {
    if (record.forbidden_paths.some((f) => pathGlobMatches(f, a))) {
      throw new PreflightError("paths-conflict", `allowed path ${a} overlaps forbidden set`);
    }
  }

  return {
    record,
    task_freeze_hash: taskHash,
    recomputed_suite_sha256: suiteHash,
    base_commit_exists: true,
  };
}

/** Minimal glob: ** matches any segments, * within a segment. */
export function pathGlobMatches(glob: string, candidate: string): boolean {
  const re = new RegExp(
    "^" + glob.split("/").map((seg) =>
      seg === "**" ? "(?:.*)" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
    ).join("/") + "/?$",
  );
  return re.test(candidate);
}

/** Verify a patch's changed-file list against the frozen path policy. */
export function changedPathsViolations(changedPaths: string[], record: TaskFreezeRecord): string[] {
  const v: string[] = [];
  for (const p of changedPaths) {
    if (record.forbidden_paths.some((g) => pathGlobMatches(g, p))) v.push(`forbidden:${p}`);
    if (!record.allowed_paths.some((g) => pathGlobMatches(g, p))) v.push(`outside-allowed:${p}`);
  }
  return v;
}

export { sha256, git, repoRoot };
