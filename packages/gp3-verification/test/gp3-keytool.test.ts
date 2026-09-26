/**
 * T2 hardening tests — provision-keys.mjs two-step key tool.
 *
 * Proves the Commander's six amendment rules, entirely inside TEMP keys-dirs
 * (plus one read-only proof against the real committed V3 registry):
 *
 *   K-1  version is a required parameter (no hardcoded default)
 *   K-2  generate NEVER touches verifier-registry.json (candidate only)
 *   K-3  candidate is schema-shaped and carries the requested version ids
 *   K-4  promote refuses to overwrite an existing registry without --force
 *   K-5  promote refuses when the pinned current-sha256 / version mismatches
 *   K-6  promote succeeds ONLY with --force + matching expectation (atomic)
 *   K-7  DEFAULT EXECUTION CANNOT DESTROY THE COMMITTED V3 ROOT:
 *        a byte-copy of the real registry survives generate, promote-no-force,
 *        and promote-wrong-expect untouched
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "util";
import { describe, expect, test } from "vitest";

const execFileP = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/provision-keys.mjs", import.meta.url));
const realRegistry = fileURLToPath(new URL("../keys/verifier-registry.json", import.meta.url));

interface RunResult { code: number; stdout: string; stderr: string }

function run(args: string[]): Promise<RunResult> {
  return execFileP(process.execPath, [script, ...args], { timeout: 30_000 })
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((e: { code?: number; stdout?: string; stderr?: string }) => ({
      code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "",
    }));
}

/** temp keys-dir seeded with a byte-copy of the committed V3 registry. */
function v3Sandbox(): { dir: string; registry: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "gp3-keytool-"));
  const registry = path.join(dir, "verifier-registry.json");
  cpSync(realRegistry, registry);
  return { dir, registry };
}

const sha256 = (p: string) => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex");

describe("[T2] provision-keys hardening", () => {
  test("[K-1] version is required — no hardcoded default", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gp3-keytool-noversion-"));
    const r = await run(["generate", "--keys-dir", dir]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--version");
  });

  test("[K-2] generate NEVER touches verifier-registry.json", async () => {
    const { dir, registry } = v3Sandbox();
    const before = readFileSync(registry);
    const r = await run(["generate", "--version", "v4", "--keys-dir", dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("registry untouched");
    expect(readFileSync(registry).equals(before)).toBe(true); // byte-preserved
    expect(existsSync(path.join(dir, "verifier-registry.candidate.json"))).toBe(true);
  });

  test("[K-3] candidate is schema-shaped with the requested version ids; private keys only under private/", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gp3-keytool-shape-"));
    const r = await run(["generate", "--version", "v4", "--keys-dir", dir]);
    expect(r.code).toBe(0);
    const candidate = JSON.parse(readFileSync(path.join(dir, "verifier-registry.candidate.json"), "utf8"));
    expect(candidate.schema_version).toBe("gp3-verifier-keys.v1");
    expect(candidate.keys).toHaveLength(2);
    for (const k of candidate.keys) {
      expect(k.key_id).toMatch(/-ed25519-v4$/); // requested version, never a stale hardcoded one
      expect(k.algorithm).toBe("ed25519");
      expect(k.public_key_pem).toContain("BEGIN PUBLIC KEY");
    }
    const priv = readdirSync(path.join(dir, "private"));
    expect(priv.every((f) => f.endsWith("-v4.pem"))).toBe(true);
    expect(priv).toHaveLength(2);
  });

  test("[K-4] promote refuses to overwrite an existing registry without --force", async () => {
    const { dir, registry } = v3Sandbox();
    await run(["generate", "--version", "v4", "--keys-dir", dir]);
    const before = readFileSync(registry);
    const r = await run(["promote", "--keys-dir", dir, "--expect-current-version", "v3"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("refusing to overwrite");
    expect(readFileSync(registry).equals(before)).toBe(true);
  });

  test("[K-5] promote refuses on sha256/version expectation mismatch", async () => {
    const { dir, registry } = v3Sandbox();
    await run(["generate", "--version", "v4", "--keys-dir", dir]);
    const before = readFileSync(registry);
    const wrongHash = await run(["promote", "--keys-dir", dir, "--force", "--expect-current-sha256", "sha256:" + "00".repeat(32)]);
    expect(wrongHash.code).toBe(3);
    expect(wrongHash.stderr).toContain("!= expected");
    const wrongVersion = await run(["promote", "--keys-dir", dir, "--force", "--expect-current-version", "v9"]);
    expect(wrongVersion.code).toBe(3);
    expect(wrongVersion.stderr).toContain("!= expected v9");
    expect(readFileSync(registry).equals(before)).toBe(true); // still byte-preserved
  });

  test("[K-6] promote succeeds ONLY with --force + matching expectation (atomic replace)", async () => {
    const { dir, registry } = v3Sandbox();
    await run(["generate", "--version", "v4", "--keys-dir", dir]);
    const r = await run(["promote", "--keys-dir", dir, "--force",
      "--expect-current-sha256", sha256(registry), "--expect-current-version", "v3"]);
    expect(r.code).toBe(0);
    const promoted = JSON.parse(readFileSync(registry, "utf8"));
    expect(promoted.keys.every((k: { key_id: string }) => k.key_id.endsWith("-v4"))).toBe(true);
    expect(existsSync(registry + ".tmp-promote")).toBe(false); // atomic — no residue
  });

  test("[K-7] DEFAULT EXECUTION CANNOT DESTROY THE COMMITTED V3 ROOT", async () => {
    // the REAL committed registry, byte-for-byte, after every non-forced path
    const { dir, registry } = v3Sandbox();
    const before = readFileSync(registry);
    // (a) plain generate
    await run(["generate", "--version", "v5", "--keys-dir", dir]);
    // (b) promote without force
    await run(["promote", "--keys-dir", dir, "--expect-current-version", "v3"]);
    // (c) promote with force but WRONG pinned hash
    await run(["promote", "--keys-dir", dir, "--force", "--expect-current-sha256", "sha256:" + "ff".repeat(32)]);
    expect(readFileSync(registry).equals(before)).toBe(true);
    // (d) and the real one in-repo is the frozen V3 root, untouched by this suite
    const real = JSON.parse(readFileSync(realRegistry, "utf8"));
    expect(real.keys.every((k: { key_id: string }) => k.key_id.endsWith("-ed25519-v3"))).toBe(true);
    // (e) static: the script's generate path contains no registry write
    const src = readFileSync(script, "utf8");
    const generateBody = src.split('if (mode === "promote")')[0]!;
    expect(generateBody).not.toContain('verifier-registry.json", '); // no direct registry write in generate
  });
});
