/**
 * SECURITY-R1 / S1+S2 — container isolation for everything that executes
 * repository code (docs/AMENDMENTS.md AMENDMENT-2).
 *
 *   PHASE A  install    : network allowed, /work RW, no worker patch yet
 *   PHASE B  patch apply: host git, the patch is data — no project code runs
 *   PHASE C  execution  : network none, /work READ-ONLY, only /tmp writable
 *
 * Both container phases: read-only root fs, tmpfs /tmp, all capabilities
 * dropped, no-new-privileges, bounded pids/memory/cpu, host uid, a clean
 * environment whitelist (host env never enters a container), and ONLY the
 * run directory is mounted — never $HOME, the host repo, keys, or the
 * Docker socket. Docker is invoked by direct argv; a frozen command string
 * is only ever the argument of `sh -lc` INSIDE the container.
 *
 * No fallback: Docker unavailable or the pinned image absent → refuse.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { CANONICAL_INSTALL_COMMAND } from "./schema.ts";

/** Pinned execution base (multi-arch index digest). Changing it requires an amendment. */
export const RUNTIME_IMAGE = "node:22.23.4-bookworm@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384";

/** Bind sources must live here: Colima shares $HOME with its VM, not /var/folders. */
export const SANDBOX_HOME = path.join(homedir(), ".intent-sandbox");
export const SANDBOX_RUNS = path.join(SANDBOX_HOME, "runs");

export const INSTALL_ARGV: readonly string[] = CANONICAL_INSTALL_COMMAND.split(" ");

const CONTAINER_ENV = [
  "HOME=/tmp",
  "CI=1",
  "NPM_CONFIG_USERCONFIG=/dev/null",
  "NPM_CONFIG_CACHE=/tmp/npm-cache",
  "NPM_CONFIG_IGNORE_SCRIPTS=true",
  "NPM_CONFIG_UPDATE_NOTIFIER=false",
  "NPM_CONFIG_FUND=false",
  "NPM_CONFIG_AUDIT=false",
] as const;

export class IsolationError extends Error {
  constructor(readonly reason: string, message: string) {
    super(`ISOLATION (${reason}): ${message}`);
  }
}

export interface IsolatedResult {
  code: number;
  stdout: string;
}

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** A fresh 0700 run directory under ~/.intent-sandbox/runs — the only thing a container ever sees. */
export function makeRunDir(prefix: string): string {
  ensurePrivateDir(SANDBOX_HOME);
  ensurePrivateDir(SANDBOX_RUNS);
  const dir = mkdtempSync(path.join(SANDBOX_RUNS, prefix));
  chmodSync(dir, 0o700);
  return dir;
}

function assertInsideRuns(workDir: string): string {
  const abs = path.resolve(workDir);
  if (!abs.startsWith(SANDBOX_RUNS + path.sep)) {
    throw new IsolationError("mount-outside-runs", `${abs} is not a run directory under ${SANDBOX_RUNS}`);
  }
  return abs;
}

/** Docker reachable and the pinned image present locally (runs use --pull=never). */
export function assertIsolationAvailable(): void {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new IsolationError("docker-unavailable", `Docker is required for isolated execution: ${String((e as Error).message).slice(0, 200)}`);
  }
  try {
    execFileSync("docker", ["image", "inspect", "--format", "{{.Id}}", RUNTIME_IMAGE], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new IsolationError("image-missing", `pinned runtime image not present locally — run: docker pull ${RUNTIME_IMAGE}`);
  }
}

function hostUser(): string {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) throw new IsolationError("unsupported-host", "host uid/gid unavailable");
  return `${uid}:${gid}`;
}

function baseArgv(name: string): string[] {
  return [
    "run", "--rm", "--pull=never", "--name", name,
    "--read-only",
    "--tmpfs", "/tmp:rw,exec,nosuid,size=1g",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "1024",
    "--memory", "4g",
    "--cpus", "2",
    "--user", hostUser(),
    ...CONTAINER_ENV.flatMap((kv) => ["-e", kv]),
    "-w", "/work",
  ];
}

/** Full docker argv for one phase. Exported so the verifier-parity gate can compare contracts. */
export function dockerArgv(phase: "install" | "exec", workDir: string, command: readonly string[], name: string): string[] {
  const work = assertInsideRuns(workDir);
  if (phase === "install") {
    return [...baseArgv(name), "-v", `${work}:/work:rw`, RUNTIME_IMAGE, ...command];
  }
  return [...baseArgv(name), "--network", "none", "-v", `${work}:/work:ro`, RUNTIME_IMAGE, ...command];
}

function runDocker(argv: string[], name: string, timeoutMs: number): IsolatedResult {
  try {
    const out = execFileSync("docker", argv, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout: out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; signal?: string | null };
    if (err.signal) {
      try {
        execFileSync("docker", ["rm", "-f", name], { stdio: "ignore", timeout: 60_000 });
      } catch {
        // already gone
      }
    }
    return { code: err.status ?? 1, stdout: err.stdout ?? "" };
  }
}

const containerName = (phase: string): string => `intent-${phase}-${randomUUID().slice(0, 12)}`;

/** PHASE A — dependency build from the frozen lockfile; no worker patch exists yet. */
export function installIsolated(workDir: string, timeoutMs = 15 * 60_000): IsolatedResult {
  const name = containerName("install");
  return runDocker(dockerArgv("install", workDir, INSTALL_ARGV, name), name, timeoutMs);
}

/** PHASE C — run a frozen command against a READ-ONLY tree with no network. */
export function execIsolated(cmd: string, workDir: string, timeoutMs = 10 * 60_000): IsolatedResult {
  const name = containerName("exec");
  return runDocker(dockerArgv("exec", workDir, ["sh", "-lc", cmd], name), name, timeoutMs);
}

const PROBE_FILE = ".intent-isolation-probe";
const PROBE_SCRIPT = String.raw`
const fs = require("node:fs"), net = require("node:net"), crypto = require("node:crypto");
const [hostHome, probeRel, probeFile] = process.argv.slice(1);
const out = {};
try { fs.writeFileSync("/work/" + probeFile, "x"); out.work_write = "ALLOWED"; } catch { out.work_write = "DENIED"; }
try { fs.writeFileSync("/tmp/" + probeFile, "x"); out.tmp_write = "ALLOWED"; } catch { out.tmp_write = "DENIED"; }
out.host_home_visible = fs.existsSync(hostHome);
try { out.probe_sha256 = "sha256:" + crypto.createHash("sha256").update(fs.readFileSync("/work/" + probeRel)).digest("hex"); } catch { out.probe_sha256 = null; }
const s = net.connect({ host: "1.1.1.1", port: 53, timeout: 3000 });
const done = (v) => { out.network = v; s.destroy(); process.stdout.write(JSON.stringify(out)); process.exit(0); };
s.on("connect", () => done("OPEN"));
s.on("error", () => done("DENIED"));
s.on("timeout", () => done("DENIED"));
`;

/**
 * Negative-probed isolation contract, checked before any frozen command:
 * network DENIED, /work write DENIED, /tmp write ALLOWED, host $HOME absent,
 * and the mounted tree is the REAL run dir (a silently empty bind fails).
 */
export function verifyIsolation(workDir: string, probeRel: string): void {
  const name = containerName("probe");
  const argv = dockerArgv("exec", workDir, ["node", "-e", PROBE_SCRIPT, homedir(), probeRel, PROBE_FILE], name);
  const probe = runDocker(argv, name, 60_000);
  let facts: { work_write?: string; tmp_write?: string; host_home_visible?: boolean; probe_sha256?: string | null; network?: string };
  try {
    facts = JSON.parse(probe.stdout);
  } catch {
    throw new IsolationError("probe-failed", `isolation probe produced no report (exit ${probe.code})`);
  }
  const expectedSha = "sha256:" + createHash("sha256").update(readFileSync(path.join(workDir, probeRel))).digest("hex");
  if (facts.network !== "DENIED") throw new IsolationError("network-open", "TCP connect to 1.1.1.1:53 SUCCEEDED inside the execution container");
  if (facts.work_write !== "DENIED" || existsSync(path.join(workDir, PROBE_FILE))) throw new IsolationError("work-writable", "/work is writable during execution");
  if (facts.tmp_write !== "ALLOWED") throw new IsolationError("tmp-unwritable", "/tmp is not writable inside the execution container");
  if (facts.host_home_visible !== false) throw new IsolationError("host-home-visible", "the host home directory is visible inside the container");
  if (facts.probe_sha256 !== expectedSha) throw new IsolationError("mount-mismatch", `the mounted /work is not the run directory (${probeRel} ${facts.probe_sha256} != ${expectedSha})`);
}
