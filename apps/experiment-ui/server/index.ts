/**
 * FRONTEND-R1 (HOLD-6 contract) — Local Orchestrator server.
 *
 * Facilitated local experiment: single machine, single operator, loopback
 * only, declared identities, no accounts, no authentication. This server
 * CALLS the frozen UE-0..UE-5 modules and reads/writes experiment
 * artifacts; it never reimplements rules, hashes, verifiers, or
 * entitlements. Operational sidecars (draft/notes/eligibility/
 * replay-report) live OUTSIDE the exact frozen/proof generations.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { freezeExperiment, runPreflight, type FreezeTaskConfig, type FreezeManifest } from "../../../packages/user-evidence-r0/src/freeze.ts";
import { CANONICAL_INSTALL_COMMAND } from "../../../packages/user-evidence-r0/src/schema.ts";
import { runWorkerPatch, type RunRecordV1 } from "../../../packages/user-evidence-r0/src/run.ts";
import { buildProofPack, tier1VerdictOf } from "../../../packages/user-evidence-r0/src/proof.ts";
import { recordObservation, finalizeLedger, sha256OfFile, sha256Of, type LedgerObservationsV1 } from "../../../packages/user-evidence-r0/src/ledger.ts";
import { deriveExperimentState, experimentPaths } from "./state.ts";
import { TRUST_ANCHOR } from "./trust-anchor.ts";

/**
 * P0-3 (review fix): the trusted verifier is NEVER executed from the module
 * cache. At replay time the on-disk bytes are hashed against the anchor,
 * copied to a protected temp location, the COPY is re-hashed (what was
 * checked is what executes), and the copy runs in a SEPARATE process.
 * Swapping the module between boot and request cannot make the server run
 * un-checked code.
 */
const PORTABLE_REPLAY_PATH = fileURLToPath(new URL("../../../packages/user-evidence-r0/src/portable-replay.mjs", import.meta.url));

function runTrustedReplay(packDir: string): Record<string, unknown> {
  const diskSha = sha256OfFile(PORTABLE_REPLAY_PATH);
  if (diskSha !== TRUST_ANCHOR.portable_replay_sha256) {
    throw new Error(`the verifier bytes on disk hash to ${diskSha}, not the EXPERIMENT-001 anchor — execution refused`);
  }
  const work = mkdtempSync(path.join(tmpdir(), "ue-trusted-replay-"));
  try {
    const copy = path.join(work, "verify.mjs"); // named verify.mjs → the CLI entry
    writeFileSync(copy, readFileSync(PORTABLE_REPLAY_PATH), { mode: 0o400 });
    chmodSync(copy, 0o400);
    const copySha = sha256OfFile(copy);
    if (copySha !== TRUST_ANCHOR.portable_replay_sha256) {
      throw new Error(`protected copy hashes to ${copySha} — refusing to execute anything un-checked`);
    }
    const reportPath = path.join(work, "replay-report.json");
    let code = 0;
    try {
      execFileSync(process.execPath, [copy, "--pack", packDir, "--report", reportPath], { encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      code = (e as { status?: number }).status ?? 1; // exit 1 = verified FAIL — the report still exists
    }
    if (!existsSync(reportPath)) throw new Error(`trusted verifier produced no report (exit ${code})`);
    return JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The cardinal pre-commit statement shown at the F1 pre-commit moment and
 * frozen VERBATIM as payer_precommit_text (hash-bound into the contract).
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
  /** P0-6: explicit protocol inputs — never guessed from commands */
  acceptance_suite: string;
  acceptance_full_suite: string[];
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".patch": "text/plain; charset=utf-8",
  ".bundle": "application/octet-stream",
  ".mjs": "text/javascript; charset=utf-8",
};

const FREEZE_FILES = ["task.json", "ruleset.json", "contract-freeze.json", "freeze-manifest.json"] as const;
const PROOF_FILES = ["task.json", "ruleset.json", "contract-freeze.json", "freeze-manifest.json", "worker.patch", "run-record.json", "base.bundle", "verify.mjs", "proof-manifest.json"] as const;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function createExperimentServer(expDir: string): Server {
  const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
  const transient: { checking: boolean; verifying: boolean; publishing: boolean } = { checking: false, verifying: false, publishing: false };
  const p = experimentPaths(expDir);
  mkdirSync(expDir, { recursive: true });

  const json = (res: ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body, null, 2) + "\n");
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 16 * 1024 * 1024) reject(new Error("body too large"));
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

  const readJson = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const loadDraft = (): Record<string, unknown> => {
    if (!existsSync(p.draft)) throw new Error("no draft — configure the experiment first");
    return readJson(p.draft);
  };

  /** Build the freeze config FROM THE REVIEWED SNAPSHOT (D5), never from mutable current input. */
  const snapshotToFreezeConfig = (snapshot: Record<string, unknown>): FreezeTaskConfig => ({
    experiment_id: "EXPERIMENT-001",
    repository_url: String(snapshot.repoPath),
    base_commit_sha: String(snapshot.base_commit_sha),
    payer_identity: String(snapshot.payer_identity),
    worker_identity: String(snapshot.worker_identity),
    acceptance_suite: String(snapshot.acceptance_suite),
    acceptance_full_suite: (snapshot.acceptance_full_suite as string[]) ?? [],
    lockfile_path: "package-lock.json",
    allowed_paths: snapshot.allowed_paths as string[],
    forbidden_paths: snapshot.forbidden_paths as string[],
    max_diff_lines: snapshot.max_diff_lines as number,
    determinism_runs: snapshot.determinism_runs as number,
    tier1_reward: String(snapshot.tier1_reward),
    tier2_reward: String(snapshot.tier2_reward ?? "0"),
    payer_precommit_text: PRECOMMIT_STATEMENT,
    payer_precommit_timestamp: new Date().toISOString(),
    commands: {
      regression_command: String(snapshot.regression_command),
      baseline_health_command: String(snapshot.baseline_health_command),
      patched_acceptance_command: String(snapshot.patched_acceptance_command),
      package_manager: "npm",
      install_command: CANONICAL_INSTALL_COMMAND,
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

    if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, statePayload());

    if (req.method === "POST" && url.pathname === "/api/prepare") {
      const body = JSON.parse(await readBody(req)) as Partial<DraftConfig> & { notes?: { issue_url?: string; summary?: string; payer_quote?: string } };
      // D4: both real participants must be selected before preparation
      const required = ["repoPath", "base_commit_sha", "payer_identity", "worker_identity", "tier1_reward", "regression_command", "baseline_health_command", "patched_acceptance_command"] as const;
      for (const f of required) {
        if (typeof body[f] !== "string" || (body[f] as string).trim() === "") return json(res, 400, { error: `missing field: ${f} (payer and assigned worker must both be selected before preparation)` });
      }
      if (!Array.isArray(body.allowed_paths) || body.allowed_paths.length === 0) return json(res, 400, { error: "allowed_paths required" });
      if (!Array.isArray(body.forbidden_paths) || body.forbidden_paths.length === 0) return json(res, 400, { error: "forbidden_paths required" });
      if (typeof body.acceptance_suite !== "string" || !body.acceptance_suite.trim()) return json(res, 400, { error: "acceptance_suite required (explicit protocol input — never guessed from commands)" });
      if (!Array.isArray(body.acceptance_full_suite) || body.acceptance_full_suite.length === 0) return json(res, 400, { error: "acceptance_full_suite required (explicit list)" });
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
        acceptance_suite: body.acceptance_suite,
        acceptance_full_suite: body.acceptance_full_suite.map(String),
      };
      const notes: ExperimentNotes = {
        schema_version: "experiment-notes.v1",
        unfrozen: true,
        disclaimer: "UNFROZEN CONTEXT — helpful background only. It is NOT part of the frozen contract and does not determine whether Tier 1 is earned.",
        issue_url: body.notes?.issue_url ?? "",
        summary: body.notes?.summary ?? "",
        payer_quote: body.notes?.payer_quote ?? "",
      };
      writeAtomic(p.draft, JSON.stringify(draft, null, 2) + "\n"); // any change here invalidates readiness (derived)
      writeAtomic(p.notes, JSON.stringify(notes, null, 2) + "\n");
      return json(res, 200, { ok: true, state: statePayload() });
    }

    if (req.method === "POST" && url.pathname === "/api/check-eligibility") {
      if (existsSync(path.join(p.freezeDir, "freeze-manifest.json"))) return json(res, 409, { error: "experiment already frozen" });
      let draft: Record<string, unknown>;
      try {
        draft = loadDraft();
      } catch (e) {
        return json(res, 400, { error: String((e as Error).message) });
      }
      transient.checking = true;
      try {
        const cfg = snapshotToFreezeConfig(draft);
        // D5: preflight WITHOUT publishing — no precommit exists at this stage
        const pre = runPreflight(String(draft.repoPath), cfg);
        const record = {
          schema_version: "eligibility.v2",
          checked_at: new Date().toISOString(),
          ok: true,
          draft, // the reviewed input snapshot (server-side, persisted)
          suiteHash: pre.suiteHash,
          lockHash: pre.lockHash,
          proven: pre.preflight,
        };
        // P0-4: the snapshot identity the payer's consent must bind to
        record.review_id = sha256Of(JSON.stringify(record));
        writeAtomic(p.eligibility, JSON.stringify(record, null, 2) + "\n");
        return json(res, 200, { ok: true, proven: pre.preflight, review_id: record.review_id });
      } catch (e) {
        const record = { schema_version: "eligibility.v2", checked_at: new Date().toISOString(), ok: false, reason: String((e as Error).message) };
        writeAtomic(p.eligibility, JSON.stringify(record, null, 2) + "\n");
        return json(res, 200, record);
      } finally {
        transient.checking = false;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/freeze") {
      const body = JSON.parse(await readBody(req)) as { precommitAcknowledged?: boolean; reviewId?: string; reviewedTerms?: Record<string, unknown> };
      if (body.precommitAcknowledged !== true) {
        return json(res, 400, { error: "payer pre-commit acknowledgement required — the rules cannot be frozen without the payer's explicit action" });
      }
      if (transient.publishing) return json(res, 409, { error: "freeze already in progress" }); // disable duplicate freeze requests
      const st = deriveExperimentState(expDir, transient);
      if (!st.readiness.ready) return json(res, 409, { error: `not ready to freeze — ${st.readiness.reason}` });
      if (st.facts.rules_state === "FROZEN") return json(res, 409, { error: "experiment already frozen" });
      // P0-4: the consent must bind the EXACT snapshot the payer read. A stale
      // review (draft changed and re-checked elsewhere) is refused — re-read, re-review.
      const eligibility = readJson(p.eligibility);
      if (typeof body.reviewId !== "string" || body.reviewId !== eligibility.review_id) {
        return json(res, 409, { error: "review expired — the reviewed snapshot changed after this review; read the terms again before freezing" });
      }
      if (!body.reviewedTerms || JSON.stringify(body.reviewedTerms) !== JSON.stringify(eligibility.draft)) {
        return json(res, 409, { error: "reviewed terms do not match the current reviewed snapshot — re-read the complete terms before freezing" });
      }
      transient.publishing = true;
      try {
        const cfg = snapshotToFreezeConfig(eligibility.draft as Record<string, unknown>); // reviewed snapshot, not mutable input
        const manifest: FreezeManifest = freezeExperiment(String((eligibility.draft as Record<string, unknown>).repoPath), cfg, p.freezeDir);
        // D5: compare published identities/terms against the reviewed snapshot; mismatch blocks the UI frozen claim
        const after = deriveExperimentState(expDir, transient);
        if (after.frozenTermsMatch === false) {
          return json(res, 500, { error: "PUBLISHED TERMS DIFFER FROM REVIEWED TERMS — operator inspection required; the UI frozen claim is blocked", manifest_frozen_at: manifest.frozen_at });
        }
        return json(res, 200, { ok: true, frozen_at: manifest.frozen_at, precommit_binding: manifest.precommit_binding, state: statePayload() });
      } finally {
        transient.publishing = false;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/submit") {
      const body = JSON.parse(await readBody(req)) as { patch?: string };
      if (typeof body.patch !== "string" || body.patch.trim() === "") return json(res, 400, { error: "a unified diff is required (paste or choose a .patch file)" });
      if (st_(expDir).facts.rules_state !== "FROZEN") return json(res, 409, { error: "submit is available only for a frozen task" });
      if (existsSync(p.workerPatch)) return json(res, 409, { error: "a patch is already submitted for this run — submission is immutable and cannot be replaced (operator action required for a new attempt)" });
      // EXACT bytes — "this exact patch" means no normalization, not even a trailing newline
      writeAtomic(p.workerPatch, body.patch);
      return json(res, 200, { ok: true, bytes: readFileSync(p.workerPatch).length, state: statePayload() });
    }

    if (req.method === "POST" && url.pathname === "/api/verify") {
      if (!existsSync(p.workerPatch)) return json(res, 409, { error: "no submitted patch" });
      if (existsSync(p.runRecord)) return json(res, 409, { error: "verification already ran for this run — INVALID is terminal and VALID needs no re-run; a new attempt requires operator action" });
      transient.verifying = true;
      try {
        const frozen = readJson(path.join(p.freezeDir, "task.json"));
        const record = runWorkerPatch(
          { repoDir: String(frozen.repository_url), freezePackDir: p.freezeDir, patchPath: p.workerPatch, ranAt: new Date().toISOString() },
          p.runRecord,
        ) as RunRecordV1;
        return json(res, 200, { ok: true, verdict: record.verdict, invalid_reason: record.verdict === "INVALID" ? record.invalid_reason : undefined, state: statePayload() });
      } finally {
        transient.verifying = false;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/replay") {
      if (!existsSync(p.runRecord)) return json(res, 409, { error: "primary verification has not run" });
      if (existsSync(p.replayReport)) return json(res, 409, { error: "replay evidence already exists for this run — no auto-retry; operator action required" });
      const derived = tier1VerdictOf(readJson(p.runRecord) as never);
      if (derived !== "VALID") return json(res, 409, { error: `replay is available only for a derived-VALID run (got ${derived})` });
      // P0-5: the anchored release file must be the repository's actual release
      const releasePath = path.join(repoRoot, "packages/user-evidence-r0/VERIFIER-RELEASE.json");
      if (!existsSync(releasePath)) return json(res, 500, { error: "VERIFIER-RELEASE.json not found — the trusted verifier cannot be established" });
      const releaseSha = sha256OfFile(releasePath);
      if (releaseSha !== TRUST_ANCHOR.verifier_release_sha256) {
        return json(res, 500, { error: `VERIFIER-RELEASE.json hash ${releaseSha} does not match the EXPERIMENT-001 anchor — trusted verifier NOT established` });
      }
      transient.verifying = true;
      try {
        const frozen = readJson(path.join(p.freezeDir, "task.json"));
        if (!existsSync(p.proofDir)) {
          buildProofPack({ freezePackDir: p.freezeDir, runRecordPath: p.runRecord, patchPath: p.workerPatch, repoDir: String(frozen.repository_url), outDir: p.proofDir, builtAt: new Date().toISOString() });
        }
        // P0-3: check the disk bytes, copy them protected, execute THE COPY in a
        // separate process — never the boot-time module cache
        const report = runTrustedReplay(p.proofDir);
        writeAtomic(p.replayReport, JSON.stringify(report, null, 2) + "\n"); // sidecar — NEVER inside the 9-file pack
        return json(res, 200, { ok: report.status === "PASS", report, state: statePayload() });
      } finally {
        transient.verifying = false;
      }
    }

    if (req.method === "POST" && url.pathname === "/api/observe") {
      const body = JSON.parse(await readBody(req)) as {
        payer_accepts?: boolean; payer_ack_verbatim?: string;
        rule_change_attempts?: number; rule_change_details?: string[];
        repeat_fund?: "YES" | "NO"; // "ANSWER_LATER" never reaches the ledger (client keeps it unresolved)
        observation_source?: string; observer_identity?: string;
      };
      if (!existsSync(p.replayReport)) return json(res, 409, { error: "payer response is recorded only on the verified VALID evidence path" });
      const st = deriveExperimentState(expDir, transient);
      if (st.facts.tier1_entitlement !== "EARNED") return json(res, 409, { error: "payer response requires EARNED (derived VALID ∧ fresh-bound replay PASS)" });
      if (typeof body.payer_accepts !== "boolean") return json(res, 400, { error: "Q1 answer required" });
      if (body.payer_accepts && !(body.payer_ack_verbatim ?? "").trim()) return json(res, 400, { error: "acceptance requires the payer's own words (verbatim capture is mandatory)" });
      if (!body.payer_accepts && !(body.payer_ack_verbatim ?? "").trim() && !((body as { no_reason?: string }).no_reason ?? "").trim()) {
        return json(res, 400, { error: "a rejection requires the payer's own words (Tell us why) — preserved verbatim" });
      }
      if (body.repeat_fund !== "YES" && body.repeat_fund !== "NO") return json(res, 400, { error: "repeat-fund question must be answered YES or NO before recording; 'Answer later' stays unresolved and records nothing" });
      const now = new Date().toISOString();
      const transcript = [
        "FACILITATED EXPERIMENT — observed input, declared identities, not authenticated.",
        `Q1 According to the rules you agreed to before work began, has this worker earned the Tier-1 reward? → ${body.payer_accepts ? "YES" : "NO"}`,
        body.payer_ack_verbatim?.trim() ? `Payer's own words: ${body.payer_ack_verbatim.trim()}` : "",
        (body as { no_reason?: string }).no_reason?.trim() ? `Reason for No: ${(body as { no_reason?: string }).no_reason.trim()}` : "",
        `Q2 After seeing the result, did you attempt to change any Tier-1 rule? → ${body.rule_change_attempts ?? 0} attempt(s)`,
        ...(body.rule_change_details ?? []).map((d, i) => `  detail ${i + 1}: ${d}`),
        `Q3 Would you fund another task using this structure? → ${body.repeat_fund}`,
      ].filter(Boolean).join("\n");
      const observations: LedgerObservationsV1 = {
        schema_version: "real-task-ledger-observations.v1",
        third_party_replay: "SAME",
        payer_accepts_tier1: body.payer_accepts,
        payer_ack_verbatim: body.payer_ack_verbatim ?? "",
        payer_ack_timestamp: now,
        posthoc_rule_change_attempts: Number.isInteger(body.rule_change_attempts) ? body.rule_change_attempts! : 0,
        posthoc_rule_change_details: body.rule_change_details ?? [],
        repeat_fund_intent: body.repeat_fund,
        observation_source: (["INTERVIEW", "GITHUB_COMMENT", "EMAIL", "SIGNED_STATEMENT", "OTHER"].includes(body.observation_source ?? "") ? body.observation_source : "INTERVIEW") as LedgerObservationsV1["observation_source"],
        observer_identity: (body.observer_identity ?? "operator").trim() || "operator",
        source_record: transcript,
        source_record_sha256: sha256Of(transcript),
        payer_attestation: "UNSIGNED_RECORDED",
        recorded_at: now,
      };
      const file = recordObservation(p.proofDir, observations, expDir, { replayReport: JSON.parse(readFileSync(p.replayReport, "utf8")) });
      return json(res, 200, { ok: true, seq: file.seq, state: statePayload() });
    }

    if (req.method === "POST" && url.pathname === "/api/close-followup") {
      // P0-3: closes an unresolved Q3 WITHOUT requiring a prior observation —
      // the FIRST answer being "Answer later" is the real path this serves.
      // The operator supplies the full Q1/Q2 answers plus the hesitation
      // verbatim and the close reason; the ledger records NOT_ASKED with
      // provenance, never fabricating a YES/NO first.
      const body = JSON.parse(await readBody(req)) as {
        payer_accepts?: boolean; payer_ack_verbatim?: string; no_reason?: string;
        rule_change_attempts?: number; rule_change_details?: string[];
        hesitation_verbatim?: string; close_reason?: string;
        observation_source?: string; observer_identity?: string;
      };
      if (!existsSync(p.replayReport)) return json(res, 409, { error: "no verified evidence path" });
      const st = deriveExperimentState(expDir, transient);
      if (st.facts.tier1_entitlement !== "EARNED") return json(res, 409, { error: "closure is available only on the EARNED evidence path" });
      if (typeof body.payer_accepts !== "boolean") return json(res, 400, { error: "Q1 answer required (part of the closure record)" });
      if (body.payer_accepts && !(body.payer_ack_verbatim ?? "").trim()) return json(res, 400, { error: "acceptance requires the payer's own words" });
      if (!body.payer_accepts && !(body.payer_ack_verbatim ?? "").trim() && !(body.no_reason ?? "").trim()) return json(res, 400, { error: "a rejection requires the payer's own words" });
      if (!(body.hesitation_verbatim ?? "").trim() || !(body.close_reason ?? "").trim()) {
        return json(res, 400, { error: "explicit operator closure requires the hesitation verbatim AND the reason the experiment closed without an answer" });
      }
      const now = new Date().toISOString();
      const transcript = [
        "OPERATOR CLOSURE of an unresolved follow-up (D9) — the question was shown; the payer chose 'Answer later' on FIRST answer.",
        `Q1 According to the rules you agreed to before work began, has this worker earned the Tier-1 reward? → ${body.payer_accepts ? "YES" : "NO"}`,
        body.payer_ack_verbatim?.trim() ? `Payer's own words: ${body.payer_ack_verbatim.trim()}` : "",
        body.no_reason?.trim() ? `Reason for No: ${body.no_reason.trim()}` : "",
        `Q2 After seeing the result, did you attempt to change any Tier-1 rule? → ${body.rule_change_attempts ?? 0} attempt(s)`,
        ...(body.rule_change_details ?? []).map((d, i) => `  detail ${i + 1}: ${d}`),
        "Q3 Would you fund another task using this structure? → ANSWER LATER (unresolved at close).",
        `Hesitation verbatim: ${body.hesitation_verbatim.trim()}`,
        `Reason the experiment closed without an answer: ${body.close_reason.trim()}`,
        "NOT_ASKED here means: unresolved at close by explicit operator decision — it is NOT an explicit No and NOT evidence the question was never shown.",
      ].filter(Boolean).join("\n");
      const observations: LedgerObservationsV1 = {
        schema_version: "real-task-ledger-observations.v1",
        third_party_replay: "SAME",
        payer_accepts_tier1: body.payer_accepts,
        payer_ack_verbatim: body.payer_ack_verbatim ?? "",
        payer_ack_timestamp: now,
        posthoc_rule_change_attempts: Number.isInteger(body.rule_change_attempts) ? body.rule_change_attempts! : 0,
        posthoc_rule_change_details: body.rule_change_details ?? [],
        repeat_fund_intent: "NOT_ASKED",
        observation_source: (["INTERVIEW", "GITHUB_COMMENT", "EMAIL", "SIGNED_STATEMENT", "OTHER"].includes(body.observation_source ?? "") ? body.observation_source : "INTERVIEW") as LedgerObservationsV1["observation_source"],
        observer_identity: (body.observer_identity ?? "operator").trim() || "operator",
        source_record: transcript,
        source_record_sha256: sha256Of(transcript),
        payer_attestation: "UNSIGNED_RECORDED",
        recorded_at: now,
      };
      const file = recordObservation(p.proofDir, observations, expDir, { replayReport: JSON.parse(readFileSync(p.replayReport, "utf8")) });
      return json(res, 200, { ok: true, seq: file.seq, state: statePayload() });
    }

    if (req.method === "POST" && url.pathname === "/api/finalize") {
      if (existsSync(p.finalLedger)) return json(res, 409, { error: "the final experiment ledger can only be created once" });
      const latest = latestObservation(expDir);
      if (!latest) return json(res, 409, { error: "no payer response recorded — Answer later blocks finalize until answered or explicitly closed by the operator" });
      try {
        const ledger = finalizeLedger(p.proofDir, expDir, { replayReport: JSON.parse(readFileSync(p.replayReport, "utf8")) });
        return json(res, 200, { ok: true, verdict: ledger.verdict, rendered: ledger.rendered, state: statePayload() });
      } catch (e) {
        return json(res, 409, { error: String((e as Error).message) });
      }
    }

    const freezeFile = req.method === "GET" && url.pathname.match(/^\/api\/freeze-file\/([a-z.-]+)$/);
    if (freezeFile) {
      const name = freezeFile[1];
      if (!(FREEZE_FILES as readonly string[]).includes(name)) return json(res, 404, { error: "not found" });
      return serveBytes(path.join(p.freezeDir, name), name, res);
    }
    const proofFile = req.method === "GET" && url.pathname.match(/^\/api\/proof-file\/([a-z.-]+)$/);
    if (proofFile) {
      const name = proofFile[1];
      if (!(PROOF_FILES as readonly string[]).includes(name)) return json(res, 404, { error: "not found" });
      return serveBytes(path.join(p.proofDir, name), name, res);
    }

    json(res, 404, { error: "not found" });
  }

  function st_(dir: string) {
    return deriveExperimentState(dir, transient);
  }

  function latestObservation(dir: string): { observations: LedgerObservationsV1 } | null {
    if (!existsSync(p.observationsDir)) return null;
    const seqs = readdirSyncSafe(p.observationsDir)
      .filter((f) => /^\d{3}\.json$/.test(f))
      .sort();
    if (!seqs.length) return null;
    return JSON.parse(readFileSync(path.join(p.observationsDir, seqs[seqs.length - 1]!), "utf8")) as { observations: LedgerObservationsV1 };
  }

  function statePayload(): Record<string, unknown> {
    const view = deriveExperimentState(expDir, transient);
    const payload: Record<string, unknown> = {
      ...view,
      precommit_statement: PRECOMMIT_STATEMENT,
      operating_mode: "Facilitated local experiment — declared identities, not authenticated; browser clicks are observed input, never proof of identity.",
    };
    if (existsSync(p.draft)) payload.draft = readJson(p.draft);
    if (existsSync(p.notes)) payload.notes = readJson(p.notes);
    if (existsSync(p.eligibility)) payload.eligibility = readJson(p.eligibility);
    if (existsSync(path.join(p.freezeDir, "freeze-manifest.json"))) {
      try {
        const task = readJson(path.join(p.freezeDir, "task.json"));
        const manifest = readJson(path.join(p.freezeDir, "freeze-manifest.json"));
        payload.frozen = {
          payer_identity: task.payer_identity,
          worker_identity: task.worker_identity,
          tier1_reward: task.tier1_reward,
          tier2_reward: task.tier2_reward,
          base_commit_sha: task.base_commit_sha,
          repository_url: task.repository_url,
          allowed_paths: task.allowed_paths,
          forbidden_paths: task.forbidden_paths,
          max_diff_lines: task.max_diff_lines,
          determinism_runs: task.determinism_runs,
          acceptance_suite: task.acceptance_suite,
          commands: task.commands,
          claim_mode: task.claim_mode,
          frozen_at: manifest.frozen_at,
          verification_ruleset_hash: manifest.verification_ruleset_hash,
          contract_freeze_hash: manifest.contract_freeze_hash,
          precommit_binding: manifest.precommit_binding,
          preflight: manifest.preflight,
        };
      } catch {
        payload.frozenError = "freeze generation unreadable — evidence error, not a frozen task";
      }
    }
    if (existsSync(p.workerPatch)) payload.submitted = { bytes: readFileSync(p.workerPatch).length, immutable: true };
    if (existsSync(p.runRecord)) {
      const record = readJson(p.runRecord);
      payload.runRecord = {
        verdict: record.verdict,
        derived: tier1VerdictOf(record as never),
        invalid_reason: record.invalid_reason ?? null,
        checks: record.checks ?? null,
        policy_result: record.policy_result ?? null,
        determinism: (record.checks as Record<string, unknown> | undefined)?.determinism ?? null,
      };
    }
    if (existsSync(p.replayReport)) payload.replayReport = readJson(p.replayReport);
    if (existsSync(path.join(p.proofDir, "proof-manifest.json"))) {
      payload.proof = { present: true, files: PROOF_FILES };
    }
    if (existsSync(p.observationsDir)) {
      const seqs = readdirSyncSafe(p.observationsDir).filter((f) => /^\d{3}\.json$/.test(f)).sort();
      payload.observations = { count: seqs.length, latest_seq: seqs[seqs.length - 1] ?? null };
      if (seqs.length) {
        const latest = JSON.parse(readFileSync(path.join(p.observationsDir, seqs[seqs.length - 1]!), "utf8"));
        payload.latestObservation = {
          payer_accepts_tier1: latest.observations.payer_accepts_tier1,
          posthoc_rule_change_attempts: latest.observations.posthoc_rule_change_attempts,
          repeat_fund_intent: latest.observations.repeat_fund_intent,
          recorded_at: latest.observations.recorded_at,
          payer_attestation: latest.observations.payer_attestation,
        };
      }
    }
    if (existsSync(p.finalLedger)) {
      // Review round-3: the UI consumes ONLY the verified ledger view — a
      // tampered/stale ledger is exposed as unverified + named evidence
      // errors, never as finalLedger the page could render as FINALIZED.
      if (view.facts.ledger === "FINALIZED") {
        payload.finalLedger = readJson(p.finalLedger);
      } else {
        payload.finalLedgerUnverified = true;
      }
    }
    return payload;
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

  function serveBytes(file: string, name: string, res: ServerResponse): void {
    if (!existsSync(file)) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": MIME[path.extname(name)] ?? "application/octet-stream", "content-disposition": `attachment; filename="${name}"` });
    res.end(readFileSync(file));
  }

  return server;
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
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
  const srv = createExperimentServer(path.resolve(expDirArg));
  srv.listen(port, "127.0.0.1", () => {
    console.log(`INTENT experiment-ui (facilitated local experiment) → http://127.0.0.1:${port}`);
    console.log(`experiment dir: ${path.resolve(expDirArg)}`);
  });
}
