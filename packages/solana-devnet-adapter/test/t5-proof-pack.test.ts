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
    expect(v.stdout).toMatch(/\d+\/\d+ checks passed/);
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

  test("[T5-08c] COORDINATED tamper: attacker edits fields AND recomputes the manifest — semantic checks still fail", { timeout: 300_000 }, async () => {
    const { createHash } = await import("node:crypto");
    const recomputeManifest = (dir: string) => {
      const mfile = path.join(dir, "pack-manifest.json");
      const m = JSON.parse(readFileSync(mfile, "utf8")) as { files: Array<{ file: string; sha256: string }> };
      for (const f of m.files) {
        f.sha256 = "sha256:" + createHash("sha256").update(readFileSync(path.join(dir, f.file))).digest("hex");
      }
      writeFileSync(mfile, JSON.stringify(m, null, 2) + "\n");
    };
    const coordinated = async (label: string, mutate: (dir: string) => void) => {
      const copy = freshPackCopy();
      mutate(copy);
      recomputeManifest(copy); // the attacker fixes the checksums — the SEMANTIC chain must still catch it
      const v = await runVerifier(copy);
      expect(v.code, `${label}: coordinated tamper must FAIL semantically`).not.toBe(0);
      expect(v.stdout, `${label}: failure must be named`).toContain("FAIL");
    };

    // 1. receipt content_hash lied (body does not hash to it any more — or a different hash claimed)
    await coordinated("receipt.content_hash forged", (dir) => {
      const f = path.join(dir, "receipt.json");
      const r = JSON.parse(readFileSync(f, "utf8"));
      r.content_hash = "sha256:" + "ab".repeat(32);
      writeFileSync(f, JSON.stringify(r, null, 2) + "\n");
    });
    // 2. raw ChainRelease amount changed AND semantic field kept in sync
    await coordinated("raw ChainRelease amount + semantic sync", (dir) => {
      const f = path.join(dir, "release-pda.json");
      const j = JSON.parse(readFileSync(f, "utf8"));
      const raw = Buffer.from(j.chain_release.raw_account_data_hex, "hex");
      raw.writeBigUInt64LE(20_000_000n, 129); // pretend 20 USDC-test
      j.chain_release.raw_account_data_hex = raw.toString("hex");
      j.chain_release.amount_base_units = "20000000"; // attacker keeps semantics in sync
      writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    });
    // 3. claimant swapped everywhere the attacker can reach (claim.json + binding_summary)
    await coordinated("claimant swapped + binding_summary sync", (dir) => {
      const cf = path.join(dir, "claim.json");
      const c = JSON.parse(readFileSync(cf, "utf8"));
      c.claimant = "agent:impostor";
      writeFileSync(cf, JSON.stringify(c, null, 2) + "\n");
      const mf = path.join(dir, "pack-manifest.json");
      const m = JSON.parse(readFileSync(mf, "utf8"));
      m.binding_summary.claimant = "agent:impostor";
      writeFileSync(mf, JSON.stringify(m, null, 2) + "\n");
    });
    // 4. tx token deltas inflated
    await coordinated("tx token deltas inflated", (dir) => {
      const f = path.join(dir, "tx.json");
      const j = JSON.parse(readFileSync(f, "utf8"));
      j.token_balance_changes.claimant_ata.post = "30000000";
      writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    });
    // 6. Operator moved OUT of the required signer prefix (role-layout forgery)
    await coordinated("operator moved outside signer prefix", (dir) => {
      const f = path.join(dir, "tx.json");
      const j = JSON.parse(readFileSync(f, "utf8"));
      const keys = j.raw_message_structured.accountKeys;
      const opIdx = keys.indexOf("673H3SuS1o8cWEGFFpd4ua7roZppZWhKvAGBGgtsvTjN");
      keys.splice(opIdx, 1); // remove Operator from position 1...
      keys.splice(5, 0, "673H3SuS1o8cWEGFFpd4ua7roZppZWhKvAGBGgtsvTjN"); // ...re-add later as a plain (unsigned) account
      writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    });
    // 7. required-signature count inflated so Treasury+other key are "signers"
    await coordinated("signer prefix mis-sized", (dir) => {
      const f = path.join(dir, "tx.json");
      const j = JSON.parse(readFileSync(f, "utf8"));
      j.raw_message_structured.header.numRequiredSignatures = 1; // Treasury-only world
      writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    });

    // 5. authorization root narrative pointed at a different hash
    await coordinated("authorization root redirected", (dir) => {
      const f = path.join(dir, "authorization.json");
      const j = JSON.parse(readFileSync(f, "utf8"));
      j.authorization_root.content_hash = "sha256:" + "cd".repeat(32);
      writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    });
  });

  test("[T5-S] the committed verifier is byte-identical to the source of truth", () => {
    const src = readFileSync(path.join(pkgDir, "scripts/t5-verify.mjs"));
    const packed = readFileSync(path.join(PACK, "verify.mjs"));
    expect(packed.equals(src), "pack/verify.mjs must equal scripts/t5-verify.mjs").toBe(true);
  });
});
