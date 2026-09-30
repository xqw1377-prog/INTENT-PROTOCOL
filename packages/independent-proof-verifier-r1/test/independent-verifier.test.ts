/** PRODUCTION-HARDENING-R0 / PH-03 — independent verifier machine tests. */
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileP = promisify(execFile);
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgDir, "../..");
const FROZEN_PACK = path.join(repoRoot, "packages/gp5-proof-pack/pack");

async function run(dir: string): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await execFileP("node", [path.join(pkgDir, "verify.mjs"), dir], { timeout: 120_000 });
    return { code: 0, stdout };
  } catch (e) {
    const err = e as { code?: number; stdout?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "" };
  }
}

describe("[PH-03] independent proof verifier (zero SUT imports)", () => {
  test("[PH-03-1] verifies the FROZEN GP5 pack independently: exit 0, all checks pass", { timeout: 180_000 }, async () => {
    const v = await run(FROZEN_PACK);
    expect(v.code).toBe(0);
    expect(v.stdout).toContain("GP5 PROOF PACK INDEPENDENTLY VERIFIED");
    expect(v.stdout).toMatch(/\d+\/\d+ checks passed/);
  });

  test("[PH-03-2] ZERO imports from protocol-schema / frozen-lib / SUT code", () => {
    const src = readFileSync(path.join(pkgDir, "verify.mjs"), "utf8");
    const code = src.replace(/^[\s]*[\*].*$/gm, "").replace(/^[\s]*\/\/.*$/gm, ""); // strip comments/docstrings
    expect(code).not.toMatch(/from\s+"@intent\//);
    expect(code).not.toMatch(/frozen-lib/);
    expect(code).not.toMatch(/protocol-schema/);
    expect(code).not.toMatch(/\.\.\/\.\.\/(gp|conformance)/);
    expect(code).not.toMatch(/require\(["']@intent\//);
  });

  test("[PH-03-3] tamper negative: receipt content_hash forged (manifest recomputed) → semantic FAIL", { timeout: 180_000 }, async () => {
    const copy = mkdtempSync(path.join(tmpdir(), "ph3-tamper-"));
    cpSync(FROZEN_PACK, copy, { recursive: true });
    const f = path.join(copy, "receipt.json");
    const r = JSON.parse(readFileSync(f, "utf8"));
    r.content_hash = "sha256:" + "ab".repeat(32);
    writeFileSync(f, JSON.stringify(r, null, 2) + "\n");
    // attacker recomputes the manifest so checksums match — semantics must catch it
    const { createHash } = await import("node:crypto");
    const mfile = path.join(copy, "pack-manifest.json");
    const m = JSON.parse(readFileSync(mfile, "utf8"));
    for (const e of m.files) e.sha256 = "sha256:" + createHash("sha256").update(readFileSync(path.join(copy, e.file))).digest("hex");
    writeFileSync(mfile, JSON.stringify(m, null, 2) + "\n");
    const v = await run(copy);
    expect(v.code).not.toBe(0);
    expect(v.stdout).toContain("FAIL");
  });

  test("[PH-03-4] tamper negative: release record swapped → settlement/exactly-once FAIL", { timeout: 180_000 }, async () => {
    const copy = mkdtempSync(path.join(tmpdir(), "ph3-tamper2-"));
    cpSync(FROZEN_PACK, copy, { recursive: true });
    const f = path.join(copy, "settlement/release.json");
    const r = JSON.parse(readFileSync(f, "utf8"));
    r.outcome_receipt_hash = "sha256:" + "cd".repeat(32);
    writeFileSync(f, JSON.stringify(r, null, 2) + "\n");
    const v = await run(copy);
    expect(v.code).not.toBe(0);
  });
});
