/**
 * FRONTEND-R1 — Local Orchestrator server (spec §26–27).
 *
 * Facilitated Experiment mode: single machine, single operator, no
 * accounts, declared identities. Binds to 127.0.0.1 only.
 *
 * Authority boundary (frozen): this server may ONLY call the frozen
 * UE-0..UE-5 modules and read/write experiment artifacts. It must not
 * reimplement rules, recompute entitlements, or keep a second state
 * database — every state it serves derives from the artifacts on disk.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { freezeExperiment, runPreflight, type FreezeTaskConfig, type FreezeManifest } from "../../../packages/user-evidence-r0/src/freeze.ts";
import { CANONICAL_INSTALL_COMMAND } from "../../../packages/user-evidence-r0/src/schema.ts";
import { deriveExperimentState, experimentPaths } from "./state.ts";

/**
 * The cardinal pre-commit statement shown at the F1 pre-commit moment
 * and frozen VERBATIM as payer_precommit_text (hash-bound into the
 * contract's precommit binding). Spec §7.
 */
export const PRECOMMIT_STATEMENT =
  "If the assigned worker satisfies the Tier-1 conditions shown above and the result is independently replayed, the Tier-1 reward is earned. " +
  "This cannot later be turned into discretionary review because you dislike the implementation.";

export interface ExperimentNotes {
  schema_version: "experiment-notes.v1";
  unfrozen: true;
  disclaimer: string;
  issue_url: string;
  summary: string;
  payer_quote: string;
}

export interface DraftConfig {
  schema_version: "experiment-draft.v1";
  repoPath: string;
  base_commit_sha: string;
  payer_identity: string;
  worker_identity: string;
  tier1_reward: string;
  tier2_reward: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  max_diff_lines: number;
  determinism_runs: number;
  regression_command: string;
  baseline_health_command: string;
  patched_acceptance_command: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

export function createExperimentServer(expDir: string): Server {
  const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
  const transient: { checking: boolean; verifying: boolean } = { checking: false, verifying: false };
  const p = experimentPaths(expDir);
  mkdirSync(expDir, { recursive: true });

  const json = (res: ServerResponse, code: number, body: unknown): void => {
    const text = JSON.stringify(body, null, 2) + "\n";
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(text);
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 4 * 1024 * 1024) reject(new Error("body too large"));
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

  const loadDraft = (): DraftConfig => {
    if (!existsSync(p.draft)) throw new Error("no draft — configure the experiment first");
    return JSON.parse(readFileSync(p.draft, "utf8")) as DraftConfig;
  };

  const draftToFreezeConfig = (draft: DraftConfig): FreezeTaskConfig => ({
    experiment_id: "EXPERIMENT-001",
    repository_url: draft.repoPath,
    base_commit_sha: draft.base_commit_sha,
    payer_identity: draft.payer_identity,
    worker_identity: draft.worker_identity,
    acceptance_suite: acceptanceSuiteOf(draft.regression_command),
    acceptance_full_suite: [acceptanceSuiteOf(draft.baseline_health_command)].filter((x) => x !== ""),
    lockfile_path: "package-lock.json",
    allowed_paths: draft.allowed_paths,
    forbidden_paths: draft.forbidden_paths,
    max_diff_lines: draft.max_diff_lines,
    determinism_runs: draft.determinism_runs,
    tier1_reward: draft.tier1_reward,
    tier2_reward: draft.tier2_reward,
    payer_precommit_text: PRECOMMIT_STATEMENT,
    payer_precommit_timestamp: new Date().toISOString(),
    commands: {
      regression_command: draft.regression_command,
      baseline_health_command: draft.baseline_health_command,
      patched_acceptance_command: draft.patched_acceptance_command,
      package_manager: "npm",
      install_command: CANONICAL_INSTALL_COMMAND, // install authority: never operator-supplied shell
    },
  });

  const server = createServer((req, res) => {
    void handle(req, res).catch((e) => {
      if (!res.headersSent) json(res, 500, { error: String((e as Error).message) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/web/"))) {
      return serveStatic(url.pathname === "/" ? "/web/index.html" : url.pathname, res);
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const view = deriveExperimentState(expDir, transient);
      const payload: Record<string, unknown> = { ...view, precommit_statement: PRECOMMIT_STATEMENT };
      if (existsSync(p.draft)) payload.draft = JSON.parse(readFileSync(p.draft, "utf8"));
      if (existsSync(p.notes)) payload.notes = JSON.parse(readFileSync(p.notes, "utf8"));
      if (existsSync(p.eligibility)) payload.eligibility = JSON.parse(readFileSync(p.eligibility, "utf8"));
      if (existsSync(path.join(p.freezeDir, "freeze-manifest.json"))) {
        const task = JSON.parse(readFileSync(path.join(p.freezeDir, "task.json"), "utf8"));
        const manifest = JSON.parse(readFileSync(path.join(p.freezeDir, "freeze-manifest.json"), "utf8"));
        payload.frozen = {
          payer_identity: task.payer_identity,
          worker_identity: task.worker_identity,
          tier1_reward: task.tier1_reward,
          tier2_reward: task.tier2_reward,
          base_commit_sha: task.base_commit_sha,
          allowed_paths: task.allowed_paths,
          forbidden_paths: task.forbidden_paths,
          max_diff_lines: task.max_diff_lines,
          determinism_runs: task.determinism_runs,
          acceptance_suite: task.acceptance_suite,
          frozen_at: manifest.frozen_at,
          verification_ruleset_hash: manifest.verification_ruleset_hash,
          contract_freeze_hash: manifest.contract_freeze_hash,
          precommit_binding: manifest.precommit_binding,
          preflight: manifest.preflight,
        };
      }
      return json(res, 200, payload);
    }

    if (req.method === "POST" && url.pathname === "/api/prepare") {
      const body = JSON.parse(await readBody(req)) as Partial<DraftConfig> & { notes?: { issue_url?: string; summary?: string; payer_quote?: string } };
      const required = ["repoPath", "base_commit_sha", "payer_identity", "worker_identity", "tier1_reward", "regression_command", "baseline_health_command", "patched_acceptance_command"] as const;
      for (const f of required) {
        if (typeof body[f] !== "string" || (body[f] as string).trim() === "") return json(res, 400, { error: `missing field: ${f}` });
      }
      if (!Array.isArray(body.allowed_paths) || body.allowed_paths.length === 0) return json(res, 400, { error: "allowed_paths required" });
      if (!Array.isArray(body.forbidden_paths) || body.forbidden_paths.length === 0) return json(res, 400, { error: "forbidden_paths required" });
      const draft: DraftConfig = {
        schema_version: "experiment-draft.v1",
        repoPath: body.repoPath!,
        base_commit_sha: body.base_commit_sha!,
        payer_identity: body.payer_identity!,
        worker_identity: body.worker_identity!,
        tier1_reward: body.tier1_reward!,
        tier2_reward: body.tier2_reward ?? "0",
        allowed_paths: body.allowed_paths!.map(String),
        forbidden_paths: body.forbidden_paths!.map(String),
        max_diff_lines: Number.isInteger(body.max_diff_lines) && (body.max_diff_lines as number) > 0 ? (body.max_diff_lines as number) : 40,
        determinism_runs: Number.isInteger(body.determinism_runs) && (body.determinism_runs as number) >= 1 ? (body.determinism_runs as number) : 3,
        regression_command: body.regression_command!,
        baseline_health_command: body.baseline_health_command!,
        patched_acceptance_command: body.patched_acceptance_command!,
      };
      // D1 ruling: unfrozen context sidecar — explicitly NOT part of the contract
      const notes: ExperimentNotes = {
        schema_version: "experiment-notes.v1",
        unfrozen: true,
        disclaimer: "UNFROZEN CONTEXT — helpful background only. It is NOT part of the frozen contract and does not determine whether Tier 1 is earned.",
        issue_url: body.notes?.issue_url ?? "",
        summary: body.notes?.summary ?? "",
        payer_quote: body.notes?.payer_quote ?? "",
      };
      writeAtomic(p.draft, JSON.stringify(draft, null, 2) + "\n");
      writeAtomic(p.notes, JSON.stringify(notes, null, 2) + "\n");
      return json(res, 200, { ok: true, state: deriveExperimentState(expDir, transient) });
    }

    if (req.method === "POST" && url.pathname === "/api/check-eligibility") {
      let draft: DraftConfig;
      try {
        draft = loadDraft();
      } catch (e) {
        return json(res, 400, { error: String((e as Error).message) });
      }
      if (existsSync(path.join(p.freezeDir, "freeze-manifest.json"))) {
        return json(res, 409, { error: "experiment already frozen" });
      }
      transient.checking = true;
      try {
        const cfg = draftToFreezeConfig(draft);
        // Spec §6: eligibility runs BEFORE any payer precommit exists.
        // runPreflight is the frozen UE-1 preflight — materialize, clean-room
        // install, net-sandbox probe, base red, baseline green, determinism.
        const pre = runPreflight(draft.repoPath, cfg);
        const record = {
          schema_version: "eligibility.v1",
          checked_at: new Date().toISOString(),
          ok: true,
          proven: {
            base_regression: pre.preflight.base_regression,
            baseline_health: pre.preflight.baseline_health,
            network_sandbox: pre.preflight.network_sandbox,
            dependency_reconstruction: pre.preflight.dependency_reconstruction,
            determinism: pre.preflight.determinism,
          },
        };
        writeAtomic(p.eligibility, JSON.stringify(record, null, 2) + "\n");
        return json(res, 200, record);
      } catch (e) {
        const record = { schema_version: "eligibility.v1", checked_at: new Date().toISOString(), ok: false, reason: String((e as Error).message) };
        writeAtomic(p.eligibility, JSON.stringify(record, null, 2) + "\n");
        return json(res, 200, record);
      } finally {
        transient.checking = false;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/freeze") {
      const body = JSON.parse(await readBody(req)) as { precommitAcknowledged?: boolean };
      // Spec §7: freeze happens ONLY after the explicit payer action.
      if (body.precommitAcknowledged !== true) {
        return json(res, 400, { error: "payer pre-commit acknowledgement required — the rules cannot be frozen without the payer's explicit action" });
      }
      let draft: DraftConfig;
      try {
        draft = loadDraft();
      } catch (e) {
        return json(res, 400, { error: String((e as Error).message) });
      }
      if (!existsSync(p.eligibility) || (JSON.parse(readFileSync(p.eligibility, "utf8")) as { ok?: boolean }).ok !== true) {
        return json(res, 409, { error: "eligibility must pass before freeze (CHECK ELIGIBILITY → READY TO FREEZE → FREEZE)" });
      }
      const cfg = draftToFreezeConfig(draft); // precommit text = PRECOMMIT_STATEMENT, timestamp = now
      const manifest: FreezeManifest = freezeExperiment(draft.repoPath, cfg, p.freezeDir);
      return json(res, 200, { ok: true, frozen_at: manifest.frozen_at, precommit_binding: manifest.precommit_binding, state: deriveExperimentState(expDir, transient) });
    }

    json(res, 404, { error: "not found" });
  }

  function serveStatic(pathname: string, res: ServerResponse): void {
    const rel = pathname.replace(/^\/web\//, "");
    const file = path.normalize(path.join(webDir, rel));
    if (!file.startsWith(webDir) || !existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  }

  return server;
}

/** Best-effort file path extraction from a frozen command (display only — never used for verification). */
function acceptanceSuiteOf(command: string): string {
  const m = /(\S+\.test\.[cm]?[jt]sx?)\s*$/.exec(command.trim()) ?? /(\S+\.test\.[cm]?[jt]sx?)/.exec(command.trim());
  return m?.[1] ?? "";
}

function writeAtomic(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp-" + process.pid;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  let expDirArg = "";
  let port = 4319;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--exp-dir") expDirArg = args[++i] ?? "";
    else if (args[i] === "--port") port = Number(args[++i] ?? 4319);
  }
  if (!expDirArg) {
    console.error("usage: node --experimental-strip-types apps/experiment-ui/server/index.ts --exp-dir <dir> [--port 4319]");
    console.error("The experiment directory is explicit by design — nothing is ever written to the repo's experiments/ by accident.");
    process.exit(2);
  }
  const server = createExperimentServer(path.resolve(expDirArg));
  server.listen(port, "127.0.0.1", () => {
    console.log(`INTENT experiment-ui (facilitated local experiment) → http://127.0.0.1:${port}`);
    console.log(`experiment dir: ${path.resolve(expDirArg)}`);
  });
}
