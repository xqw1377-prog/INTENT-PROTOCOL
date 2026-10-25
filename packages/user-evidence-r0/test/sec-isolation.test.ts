/**
 * SECURITY-R1 / S1+S2 gates — untrusted worker code runs isolated.
 *
 * The end-to-end gate submits a CORRECT fix whose module, when the frozen
 * tests import it, attacks the host: network, host $HOME write, host secret
 * reads (outside the run dir, and next to it under ~/.intent-sandbox), and
 * a runtime rewrite of the frozen acceptance suite. Any attack that
 * succeeds throws → the run cannot be VALID. So VALID proves every attack
 * was denied while /tmp stayed writable and the normal commands passed.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freezeExperiment } from "../src/freeze.ts";
import { dockerArgv, execIsolated, makeRunDir, RUNTIME_IMAGE, SANDBOX_HOME, SANDBOX_RUNS, verifyIsolation } from "../src/isolation.ts";
import { runWorkerPatch, type ValidRunRecordV1 } from "../src/run.ts";
import { buildProofPack } from "../src/proof.ts";
import { replayPack } from "../src/portable-replay.mjs";
import { fixableConfig, makeFixableRepo, makePatch } from "./helpers.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = randomUUID();
const hostHomeProbe = path.join(homedir(), `.intent-sec-probe-${id}`);
const outsideSecretDir = mkdtempSync(path.join(tmpdir(), "sec-secret-"));
const outsideSecret = path.join(outsideSecretDir, "credentials");
const adjacentSecret = path.join(SANDBOX_HOME, `sec-adjacent-secret-${id}`);
const SECRET = `TOPSECRET-${id}`;

let repo = { dir: "", sha: "" };
let tmp = "";
let proofDir = "";

beforeAll(() => {
  writeFileSync(outsideSecret, SECRET);
  makeRunDir("sec-warm-"); // ensures SANDBOX_HOME exists for the adjacent fixture
  writeFileSync(adjacentSecret, SECRET);
  repo = makeFixableRepo();
  tmp = mkdtempSync(path.join(tmpdir(), "sec-iso-"));
  proofDir = path.join(tmp, "proof");
}, 600_000);

afterAll(() => {
  for (const p of [hostHomeProbe, adjacentSecret]) rmSync(p, { force: true });
  for (const d of [outsideSecretDir, tmp, repo.dir]) rmSync(d, { recursive: true, force: true });
});

const HOSTILE_FIX = (): string =>
  [
    'import * as fs from "node:fs";',
    'import * as net from "node:net";',
    "const fail = (what: string): never => { throw new Error(`SECURITY BREACH: ${what}`); };",
    "const attempt = (fn: () => unknown): boolean => { try { fn(); return true; } catch { return false; } };",
    `if (attempt(() => fs.writeFileSync(${JSON.stringify(hostHomeProbe)}, "pwned"))) fail("host home write");`,
    `if (attempt(() => fs.readFileSync(${JSON.stringify(outsideSecret)}, "utf8"))) fail("host secret read");`,
    `if (attempt(() => fs.readFileSync(${JSON.stringify(adjacentSecret)}, "utf8"))) fail("adjacent sandbox secret read");`,
    'if (attempt(() => fs.writeFileSync("/work/test/regression.test.ts", "// rewritten at runtime\\n"))) fail("frozen suite rewrite");',
    'if (attempt(() => fs.writeFileSync("test/regression.test.ts", "// rewritten at runtime\\n"))) fail("frozen suite rewrite (relative)");',
    'if (!attempt(() => fs.writeFileSync("/tmp/worker-scratch", "ok"))) fail("/tmp must stay writable");',
    "const connected = await new Promise<boolean>((resolve) => {",
    '  const s = net.connect({ host: "1.1.1.1", port: 53, timeout: 3000 });',
    '  s.on("connect", () => { s.destroy(); resolve(true); });',
    '  s.on("error", () => resolve(false));',
    '  s.on("timeout", () => { s.destroy(); resolve(false); });',
    "});",
    'if (connected) fail("network connect");',
    "export const add = (a: number, b: number): number => a + b;",
    "",
  ].join("\n");

describe("[SEC-1..4C] untrusted worker code — end to end through the real runner", () => {
  test("[SEC-E2E] a hostile but correct fix is VALID only because every attack was denied", () => {
    const freezeDir = path.join(tmp, "freeze");
    freezeExperiment(repo.dir, fixableConfig(repo.dir, repo.sha), freezeDir);
    const patchPath = path.join(tmp, "hostile.patch");
    writeFileSync(patchPath, makePatch(repo.dir, (wr) => wr("src/add.ts", HOSTILE_FIX())));
    const recordPath = path.join(tmp, "hostile-run.json");
    const rec = runWorkerPatch({ repoDir: repo.dir, freezePackDir: freezeDir, patchPath, ranAt: "2026-10-25T00:00:00.000Z" }, recordPath);
    expect(rec.verdict, rec.verdict === "INVALID" ? rec.invalid_reason : "").toBe("VALID"); // SEC-4C: normal commands PASS
    expect((rec as ValidRunRecordV1).checks.network_sandbox).toBe("DENIED_VERIFIED");
    // independent host-side confirmation of SEC-2
    expect(existsSync(hostHomeProbe)).toBe(false);
    expect(readFileSync(outsideSecret, "utf8")).toBe(SECRET);

    // the third-party path: the anchored verifier re-executes the same hostile pack under the same contract
    buildProofPack({ freezePackDir: freezeDir, runRecordPath: recordPath, patchPath, repoDir: repo.dir, outDir: proofDir, builtAt: "2026-10-25T00:01:00.000Z" });
    const report = replayPack(proofDir, { replayedAt: "2026-10-25T00:02:00.000Z" });
    expect(report.status, String(report.fail_reason)).toBe("PASS");
    expect(report.reproduced?.tier1_verdict).toBe("VALID");
    expect(existsSync(hostHomeProbe)).toBe(false);
  }, 1_200_000);

  test("[SEC-NOFALLBACK] Docker unavailable → the runner refuses (no record) and the verifier REFUSES replay", () => {
    const freezeDir = path.join(tmp, "freeze");
    const patchPath = path.join(tmp, "hostile.patch");
    const recordPath = path.join(tmp, "refused-run.json");
    const emptyBin = mkdtempSync(path.join(tmpdir(), "sec-nobin-"));
    const savedPath = process.env.PATH;
    try {
      process.env.PATH = emptyBin;
      expect(() => runWorkerPatch({ repoDir: repo.dir, freezePackDir: freezeDir, patchPath, ranAt: "2026-10-25T00:03:00.000Z" }, recordPath)).toThrow(/RUN-REFUSED \(isolation-docker-unavailable\)/);
      const report = replayPack(proofDir, { replayedAt: "2026-10-25T00:04:00.000Z" });
      expect(report.status).toBe("FAIL");
      expect(report.fail_reason).toBe("replay-refused:isolation-docker-unavailable");
    } finally {
      process.env.PATH = savedPath;
      rmSync(emptyBin, { recursive: true, force: true });
    }
    expect(existsSync(recordPath)).toBe(false);
  });
});

describe("[SEC] execution container — direct probes", () => {
  let run = "";
  beforeAll(() => {
    run = makeRunDir("sec-probe-");
    writeFileSync(path.join(run, "frozen.txt"), "frozen");
  });
  afterAll(() => rmSync(run, { recursive: true, force: true }));

  test("[SEC-1] network connect → DENIED", () => {
    const r = execIsolated(`node -e "require('net').connect({host:'1.1.1.1',port:53,timeout:3000}).on('connect',()=>process.exit(7)).on('error',()=>process.exit(0)).on('timeout',()=>process.exit(0))"`, run, 60_000);
    expect(r.code).toBe(0);
  });

  test("[SEC-2] write to the real host home path → DENIED (path absent in the container)", () => {
    const r = execIsolated(`mkdir -p ${JSON.stringify(path.dirname(hostHomeProbe))} 2>/dev/null; echo x > ${JSON.stringify(hostHomeProbe)}`, run, 60_000);
    expect(r.code).not.toBe(0);
    expect(existsSync(hostHomeProbe)).toBe(false);
  });

  test("[SEC-3] host secret fixtures outside the run dir → UNREADABLE", () => {
    for (const s of [outsideSecret, adjacentSecret]) {
      const r = execIsolated(`cat ${JSON.stringify(s)}`, run, 60_000);
      expect(r.code, s).not.toBe(0);
      expect(r.stdout).not.toContain(SECRET);
    }
  });

  test("[SEC-4] write /work during execution → DENIED; frozen bytes unchanged", () => {
    expect(execIsolated("echo tampered > /work/frozen.txt", run, 60_000).code).not.toBe(0);
    expect(execIsolated("touch /work/new-file", run, 60_000).code).not.toBe(0);
    expect(readFileSync(path.join(run, "frozen.txt"), "utf8")).toBe("frozen");
    expect(existsSync(path.join(run, "new-file"))).toBe(false);
  });

  test("[SEC-4B] write /tmp → ALLOWED; [SEC-4C] reading the tree works", () => {
    const r = execIsolated("echo scratch > /tmp/s && cat /tmp/s && cat /work/frozen.txt", run, 60_000);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("scratch\nfrozen");
  });

  test("[SEC-PROBE] the pre-execution isolation probe passes on a correct container", () => {
    expect(() => verifyIsolation(run, "frozen.txt")).not.toThrow();
  });
});

describe("[SEC] docker invocation contract", () => {
  const run = path.join(SANDBOX_RUNS, "contract-only");

  test("[SEC-ARGV] exec: network none, /work ro, pinned image, --pull=never, no host env, no $HOME/socket mount", () => {
    const a = dockerArgv("exec", run, ["sh", "-lc", "x"], "n");
    const joined = a.join(" ");
    for (const flag of ["--pull=never", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges", "--network none", "--pids-limit", "--memory", "--cpus"]) {
      expect(joined, flag).toContain(flag);
    }
    expect(a).toContain(`${run}:/work:ro`);
    expect(a.filter((x, i) => a[i - 1] === "-v")).toEqual([`${run}:/work:ro`]);
    expect(a[a.indexOf(RUNTIME_IMAGE) + 1]).toBe("sh");
    expect(RUNTIME_IMAGE).toMatch(/^node:[0-9.]+-bookworm@sha256:[0-9a-f]{64}$/);
    expect(joined).not.toContain("docker.sock");
    expect(a.filter((x, i) => a[i - 1] === "-e").every((kv) => /^(HOME=\/tmp|CI=1|NPM_CONFIG_[A-Z_]+=.*)$/.test(kv))).toBe(true);
  });

  test("[SEC-ARGV] install: /work rw + npm cache only; network not disabled; never the host home", () => {
    const a = dockerArgv("install", run, ["npm", "ci", "--ignore-scripts"], "n");
    const mounts = a.filter((x, i) => a[i - 1] === "-v");
    expect(mounts).toEqual([`${run}:/work:rw`, `${path.join(SANDBOX_HOME, "npm-cache")}:/npm-cache:rw`]);
    expect(a).not.toContain("--network");
    expect(a.slice(a.indexOf(RUNTIME_IMAGE) + 1)).toEqual(["npm", "ci", "--ignore-scripts"]);
  });

  test("[SEC-MOUNT] a directory outside ~/.intent-sandbox/runs is never mounted", () => {
    expect(() => dockerArgv("exec", tmpdir(), ["true"], "n")).toThrow(/mount-outside-runs/);
    expect(() => dockerArgv("exec", homedir(), ["true"], "n")).toThrow(/mount-outside-runs/);
    expect(() => dockerArgv("exec", SANDBOX_RUNS + "-evil/x", ["true"], "n")).toThrow(/mount-outside-runs/);
  });

  test("[SEC-PARITY] the anchored portable verifier implements the same container contract independently", () => {
    const verifier = readFileSync(path.join(pkgDir, "src/portable-replay.mjs"), "utf8");
    expect(verifier).toContain(`const RUNTIME_IMAGE = "${RUNTIME_IMAGE}"`);
    for (const s of ['"--pull=never"', '"--read-only"', '"--cap-drop", "ALL"', '"--security-opt", "no-new-privileges"', '"--network", "none"', '":/work:ro"', '"sh", "-lc"']) {
      expect(verifier, s).toContain(s);
    }
    expect(verifier).not.toContain("sandbox-exec");
    expect(verifier).not.toContain("unshare");
    const release = JSON.parse(readFileSync(path.join(pkgDir, "VERIFIER-RELEASE.json"), "utf8"));
    expect(release.runtime_image).toBe(RUNTIME_IMAGE);
  });
});
