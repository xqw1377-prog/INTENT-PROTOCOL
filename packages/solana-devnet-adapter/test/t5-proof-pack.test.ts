/**
 * TESTNET-R1 / T5 machine tests — Testnet Proof Pack: third-party offline
 * verification + tamper negatives. The verifier (t5-proof-pack/verify.mjs)
 * is SELF-CONTAINED (node builtins only, no repo imports, no network); these
 * tests run it as a third party would, then attack every critical file.
 */
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileP = promisify(execFile);
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACK = path.join(pkgDir, "t5-proof-pack");

async function runVerifier(dir: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileP("node", ["verify.mjs"], { cwd: dir, timeout: 60_000 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/** Flip one byte in the middle of a JSON value in place. */
function flipMiddleByte(file: string): void {
  const bytes = readFileSync(file);
  const i = Math.max(1, Math.floor(bytes.length / 2));
  const flipped = Buffer.from(bytes);
  flipped[i] = flipped[i]! === 0x30 ? 0x31 : 0x30;
  writeFileSync(file, flipped);
}

function freshPackCopy(): string {
  const copy = mkdtempSync(path.join(tmpdir(), "t5-tamper-"));
  cpSync(PACK, copy, { recursive: true });
  return copy;
}

describe("[TESTNET-R1/T5] cross-layer evidence / testnet proof pack", () => {
  test("[T5-07] third-party offline verification passes on the committed pack", { timeout: 120_000 }, async () => {
    for (const f of ["pack-manifest.json", "tx.json", "release-pda.json", "receipt.json", "claim.json", "authorization.json", "world-now.json", "verify.mjs"]) {
      expect(existsSync(path.join(PACK, f)), `pack file: ${f}`).toBe(true);
    }
    const v = await runVerifier(PACK);
    expect(v.code, `verifier stderr: ${v.stderr.slice(0, 400)}`).toBe(0);
    expect(v.stdout).toContain("39/39 checks passed");
    expect(v.stdout).toContain("TESTNET PROOF PACK VERIFIED");
    // the verifier must be network-free and repo-free by construction: it
    // imports only node builtins
    expect(readFileSync(path.join(PACK, "verify.mjs"), "utf8")).not.toMatch(/from "\.\.\//);
  });

  test("[T5-08] tamper negatives: ANY critical file flipped → verifier fails", { timeout: 240_000 }, async () => {
    const criticals = ["tx.json", "release-pda.json", "receipt.json", "claim.json", "authorization.json", "world-now.json"];
    for (const rel of criticals) {
      const copy = freshPackCopy();
      flipMiddleByte(path.join(copy, rel));
      const v = await runVerifier(copy);
      expect(v.code, `${rel}: flipped pack must FAIL verification`).not.toBe(0);
      expect(v.stdout, `${rel}: failure must be named`).toContain("FAIL");
    }
    // removing a file entirely must also fail
    {
      const copy = freshPackCopy();
      writeFileSync(path.join(copy, "release-pda.json"), "{}\n");
      const v = await runVerifier(copy);
      expect(v.code).not.toBe(0);
    }
    // mutating the manifest's recorded hash must fail the manifest integrity
    {
      const copy = freshPackCopy();
      const mfile = path.join(copy, "pack-manifest.json");
      const m = JSON.parse(readFileSync(mfile, "utf8"));
      m.files[0].sha256 = "sha256:" + "0".repeat(64);
      writeFileSync(mfile, JSON.stringify(m, null, 2) + "\n");
      const v = await runVerifier(copy);
      expect(v.code).not.toBe(0);
    }
  });

  test("[T5-S] the committed verifier is byte-identical to the source of truth", () => {
    const src = readFileSync(path.join(pkgDir, "scripts/t5-verify.mjs"));
    const packed = readFileSync(path.join(PACK, "verify.mjs"));
    expect(packed.equals(src), "pack/verify.mjs must equal scripts/t5-verify.mjs").toBe(true);
  });
});
