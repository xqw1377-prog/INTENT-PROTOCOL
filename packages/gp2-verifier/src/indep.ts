/**
 * GP2 verifier independent primitives (Issue #28 hard independence boundary):
 * nothing here imports gp-execution; hashes/identity conventions are
 * reimplemented from the Commander rulings (GP2-R2/R3) and the frozen G1 wire.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SNAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../target-snapshot");

export const git = (args: string[]): string => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
export const gitBuf = (args: string[]): Buffer => execFileSync("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });

export const sha256 = (bytes: Buffer | string): string => "sha256:" + createHash("sha256").update(bytes).digest("hex");

/** Deterministic UUID convention (published GP2 identity convention): sha256 seed -> canonical v4-shape. */
export function deriveUuid(seed: string): string {
  const b = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const hex = b.slice(0, 12) + "4" + b.slice(13, 16) + "8" + b.slice(17, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface Capture {
  mode: string;
  pinned_sha: string;
  parent_sha: string;
  expected_parent: string;
  changed_paths_vs_parent: string[];
  evidence_run_id: string;
  files: Array<{ file: string; sha256: string; bytes: number }>;
}

export function loadCapture(): Capture {
  return JSON.parse(readFileSync(path.join(SNAP, "capture.json"), "utf8")) as Capture;
}

/**
 * BYTE-EXACT evidence access (V3 hardening): captured evidence blobs MUST be
 * read from the git OBJECT DATABASE at the pinned target SHA. Working-tree
 * copies can be smudged by checkout EOL conversion (observed: LF blob checked
 * out as CRLF on Windows), which breaks git-apply and could silently alter
 * hashed bytes. The snapshot directory remains a human-readable convenience
 * copy only.
 */
export function targetFile(pinnedSha: string, rel: string): Buffer {
  return gitBuf(["show", `${pinnedSha}:${rel}`]);
}
export const snapFile = (rel: string): Buffer => readFileSync(path.join(SNAP, rel));
export const snapJson = <T>(rel: string): T => JSON.parse(snapFile(rel).toString("utf8")) as T;

/** Frozen task record path + base-commit content access (object database, not worktree). */
export const TASK_RECORD_PATH = "packages/golden-path/fixtures/gp-001-task.json";
export const gitShow = (spec: string): Buffer => gitBuf(["show", spec]);
