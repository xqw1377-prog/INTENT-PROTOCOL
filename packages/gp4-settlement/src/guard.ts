/**
 * GP4-B — kernel-atomic publish primitive.
 *
 * THE ECONOMIC RELEASE GUARD. Uniqueness of (escrow_ref, outcome_receipt_hash)
 * is NOT an application-layer exists→insert check: it is the kernel-atomic
 * `link(2)` syscall. The guard file appears fully-formed or not at all:
 *
 *   1. bytes are written to `<dir>/.tmp-<rand>` with O_EXCL ("wx")
 *   2. the temp file is fsync'd
 *   3. linkSync(tmp, dest) — the kernel fails with EEXIST if ANY process or
 *      thread already created `dest`, no matter how concurrent the attempts
 *   4. only the winner proceeds; every loser reads the winner's bytes
 *
 * This module imports ONLY node builtins (no G1 imports): it is loadable by
 * a bare `node --experimental-strip-types` child process for multi-process
 * race tests.
 */
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import * as path from "node:path";

export type PublishResult =
  | { status: "PUBLISHED" }
  | { status: "EXISTS"; existing: Buffer };

function fsyncDir(dir: string): void {
  // Best-effort directory durability (POSIX). Opening a directory for fsync is
  // not portable to Windows; uniqueness never depends on this.
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* best-effort only */
  }
}

/**
 * Atomically create `dir/<name>` containing exactly `bytes`.
 * - returns PUBLISHED exactly once across all concurrent/racing callers
 * - returns EXISTS (with the winner's bytes) for every other caller
 * The temp file is cleaned up on every path.
 */
export function atomicPublish(dir: string, name: string, bytes: Buffer): PublishResult {
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  const dest = path.join(dir, name);
  writeFileSync(tmp, bytes, { flag: "wx" });
  const fd = openSync(tmp, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(tmp, dest);
  } catch (e) {
    unlinkSync(tmp); // tmp is ours alone; always safe to remove
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return { status: "EXISTS", existing: readFileSync(dest) };
    }
    throw e;
  }
  unlinkSync(tmp);
  fsyncDir(dir);
  return { status: "PUBLISHED" };
}

/**
 * Atomically REPLACE a mutable non-authority file (escrow.json state flips).
 * rename is an atomic replace on POSIX and on Windows (MoveFileEx with
 * REPLACE_EXISTING). Torn state here is always recoverable: the release guard
 * file — not escrow.json — is the release authority, and EscrowLedger.open()
 * re-syncs state from the guard.
 */
export function atomicReplace(file: string, bytes: Buffer): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  writeFileSync(tmp, bytes, { flag: "wx" });
  const fd = openSync(tmp, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  fsyncDir(dir);
}

/**
 * Remove stale temp files left by a crash between write and link/rename.
 * OFFLINE MAINTENANCE ONLY: never call while any publisher may be active —
 * an in-flight temp belongs to its publishing process.
 */
export function sweepTemp(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.startsWith(".tmp-")) {
      try {
        unlinkSync(path.join(dir, e));
      } catch {
        /* already gone */
      }
    }
  }
}
