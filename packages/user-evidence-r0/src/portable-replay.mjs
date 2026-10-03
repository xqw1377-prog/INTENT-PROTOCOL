#!/usr/bin/env node
/**
 * USER-EVIDENCE-R0 / UE-4 (CUT-3) — portable third-party verifier.
 *
 * STANDALONE BY CONTRACT: plain JavaScript, Node built-ins only, and it
 * deliberately does NOT import the implementation it verifies (src/*.ts).
 * Every identity formula, policy rule, and execution step is re-implemented
 * here independently — verifier independence over code sharing. A third
 * party unpacks a proof pack and runs, with only node + git + npm on PATH:
 *
 *   node verify.mjs [--pack <dir>] [--report <out.json>]
 *
 * The verifier re-checks, from the pack ALONE:
 *   1. file integrity — every file is listed in proof-manifest.json and
 *      hashes to it; no unlisted files;
 *   2. freeze closure — ruleset.json / contract-freeze.json re-derive from
 *      task.json; every freeze-manifest hash re-derives; hard-coded
 *      contracts (network disabled, no new dependencies, single claimant)
 *      hold on the pack bytes;
 *   3. verdict binding — the manifest's tier1_verdict is re-derived from
 *      run-record.json (the verdict is a function, not an assertion);
 *   4. reality — the frozen base is cloned from base.bundle at the exact
 *      frozen commit, dependencies reconstructed from the frozen lockfile,
 *      and the FULL pipeline re-executed in a network-denied sandbox:
 *      policy wall, base red, patch apply, patched green, baseline green,
 *      N-run determinism. The reproduced outcome must EQUAL the recorded
 *      one (an attacker who rewrites the record AND re-hashes the manifest
 *      still fails here — the bytes have to actually work).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const PROOF_MANIFEST = "proof-manifest.json";
const EXPECTED_FILES = [
  "base.bundle",
  "contract-freeze.json",
  "freeze-manifest.json",
  "proof-manifest.json",
  "run-record.json",
  "ruleset.json",
  "task.json",
  "verify.mjs",
  "worker.patch",
];
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundledDependencies",
  "overrides",
  "resolutions",
];

/* ── canonical hashing (independent re-implementation of the schema formulas) ── */

function deepSorted(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(deepSorted);
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = deepSorted(value[k]);
  return out;
}
const canonical = (v) => JSON.stringify(deepSorted(v));
const shaObj = (v) => "sha256:" + createHash("sha256").update(canonical(v)).digest("hex");
const shaBytes = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
const shaFile = (p) => shaBytes(readFileSync(p));
const sameJson = (a, b) => canonical(a) === canonical(b);

function rulesetOfTask(task) {
  return {
    schema_version: "real-task-verification-ruleset.v1",
    base_commit_sha: task.base_commit_sha,
    acceptance_suite_sha256: task.acceptance_suite_sha256,
    lockfile_path: task.lockfile_path,
    lockfile_sha256: task.lockfile_sha256,
    commands: task.commands,
    allowed_paths: task.allowed_paths,
    forbidden_paths: task.forbidden_paths,
    max_diff_lines: task.max_diff_lines,
    new_dependencies_allowed: false,
    network: "disabled",
    determinism_runs: task.determinism_runs,
  };
}
function contractOfTask(task) {
  return {
    schema_version: "real-task-contract-freeze.v1",
    payer_identity: task.payer_identity,
    worker_identity: task.worker_identity,
    tier1_reward: task.tier1_reward,
    tier2_reward: task.tier2_reward,
    claim_mode: "SINGLE_CLAIMANT",
    auto_release: "ABSENT",
    tier2_execution: "ABSENT",
    verification_ruleset_hash: shaObj(rulesetOfTask(task)),
  };
}
function precommitBindingOf(task) {
  return (
    "sha256:" +
    createHash("sha256")
      .update(Buffer.from(shaObj(contractOfTask(task)).slice(7), "hex"))
      .update(Buffer.from(task.payer_precommit_text, "utf8"))
      .update(Buffer.from(task.payer_precommit_timestamp, "utf8"))
      .digest("hex")
  );
}

/* ── patch policy (independent re-implementation of the UE-2 rules) ── */

function splitGitPaths(s) {
  const out = [];
  let i = 0;
  while (i < s.length && out.length < 2) {
    while (i < s.length && s[i] === " ") i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      const j = s.indexOf('"', i + 1);
      if (j === -1) {
        out.push(s.slice(i));
        break;
      }
      out.push(s.slice(i, j + 1));
      i = j + 1;
    } else {
      let j = s.indexOf(" ", i);
      if (j === -1) j = s.length;
      out.push(s.slice(i, j));
      i = j;
    }
  }
  return out;
}
function unquote(p) {
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    try {
      return JSON.parse(p);
    } catch {
      return p.slice(1, -1);
    }
  }
  return p;
}
function stripSide(p) {
  const t = unquote(String(p).trim());
  if (t === "/dev/null" || t === "") return "";
  if (t.startsWith("a/") || t.startsWith("b/")) return t.slice(2);
  return t;
}
function parsePatch(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  const touched = new Set();
  let added = 0;
  let removed = 0;
  let binary = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("GIT binary patch")) binary = true;
    if (line.startsWith("diff --git ")) {
      for (const side of splitGitPaths(line.slice("diff --git ".length))) {
        const p = stripSide(side);
        if (p) touched.add(p);
      }
    } else if (line.startsWith("rename from ")) {
      const p = unquote(line.slice("rename from ".length).trim());
      if (p) touched.add(p);
    } else if (line.startsWith("rename to ")) {
      const p = unquote(line.slice("rename to ".length).trim());
      if (p) touched.add(p);
    } else if (line.startsWith("+++ ")) {
      const p = stripSide(line.slice(4));
      if (p) touched.add(p);
    } else if (line.startsWith("--- ")) {
      const p = stripSide(line.slice(4));
      if (p) touched.add(p);
    }
    if (/^\+(?!\+\+\+)/.test(line)) added++;
    else if (/^-(?!---)/.test(line)) removed++;
  }
  return { touchedPaths: [...touched].sort(), addedLines: added, removedLines: removed, binary };
}
function globRe(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += "[\\s\\S]*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + "$");
}
function evaluatePolicy(patch, task) {
  if (patch.binary) return "binary-patch";
  if (patch.touchedPaths.length === 0) return "empty-patch";
  for (const p of patch.touchedPaths) {
    if (task.forbidden_paths.some((g) => globRe(g).test(p))) return "forbidden-path:" + p;
    if (!task.allowed_paths.some((g) => globRe(g).test(p))) return "out-of-scope:" + p;
  }
  const total = patch.addedLines + patch.removedLines;
  if (total > task.max_diff_lines) return "diff-over-bound:" + total + ">" + task.max_diff_lines;
  return null; // policy-clean
}
function depSectionsOf(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out = {};
  for (const s of DEP_SECTIONS) out[s] = parsed[s] ?? {};
  return out;
}
function depsUnchanged(before, after) {
  if (before === null) {
    if (after === null) return true;
    const a = depSectionsOf(after);
    if (!a) return false;
    return Object.values(a).every((v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
  }
  if (after === null) return false;
  const b = depSectionsOf(before);
  const a = depSectionsOf(after);
  if (!b || !a) return false;
  return canonical(b) === canonical(a);
}

/* ── execution (network-denied sandbox; independent of src/freeze.ts) ── */

function sh(cmd, cwd, timeoutMs = 10 * 60_000) {
  try {
    const out = execFileSync("sh", ["-c", cmd], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout: out };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "" };
  }
}
function inNetSandbox(cmd, cwd, timeoutMs = 10 * 60_000) {
  const wrapped =
    process.platform === "darwin"
      ? "sandbox-exec -p '(version 1)(allow default)(deny network*)' sh -c " + JSON.stringify(cmd)
      : "unshare -n sh -c " + JSON.stringify(cmd);
  return sh(wrapped, cwd, timeoutMs);
}
function verifyNetSandbox(cwd) {
  const probe =
    "node -e \"const net=require('node:net');const s=net.connect({host:'1.1.1.1',port:53,timeout:3000});s.on('error',()=>process.exit(0));s.on('connect',()=>{s.destroy();process.exit(1)});setTimeout(()=>process.exit(0),4000)\"";
  if (inNetSandbox(probe, cwd, 30_000).code !== 0) throw new Error("network-sandbox-ineffective");
  if (inNetSandbox("node -e \"process.exit(0)\"", cwd, 30_000).code !== 0) throw new Error("network-sandbox-too-strict");
}

/** Re-execute the whole pipeline from the pack alone; returns the reproduced outcome. */
function reexecute(packDir, task) {
  const work = mkdtempSync(path.join(tmpdir(), "ue4-replay-"));
  try {
    const clone = sh(`git clone --quiet --branch ue-base ${JSON.stringify(path.resolve(packDir, "base.bundle"))} ${JSON.stringify(work + "/repo")}`, tmpdir());
    if (clone.code !== 0) return { tier1_verdict: "INVALID", reason: "bundle-unclonable" };
    const repo = path.join(work, "repo");
    const head = sh("git rev-parse HEAD", repo);
    if (head.code !== 0 || head.stdout.trim() !== task.base_commit_sha) return { tier1_verdict: "INVALID", reason: "bundle-base-mismatch" };

    const suitePath = path.join(repo, task.acceptance_suite);
    const lockPath = path.join(repo, task.lockfile_path);
    if (!existsSync(suitePath) || shaFile(suitePath) !== task.acceptance_suite_sha256) return { tier1_verdict: "INVALID", reason: "suite-bytes-drift" };
    if (!existsSync(lockPath) || shaFile(lockPath) !== task.lockfile_sha256) return { tier1_verdict: "INVALID", reason: "lockfile-bytes-drift" };

    const patchAbs = path.resolve(packDir, "worker.patch");
    const parsed = parsePatch(readFileSync(patchAbs));
    const policyReason = evaluatePolicy(parsed, task);
    if (policyReason) return { tier1_verdict: "INVALID", reason: policyReason, executed: false };

    const manifests = parsed.touchedPaths.filter((p) => p === "package.json" || p.endsWith("/package.json"));
    const before = new Map(manifests.map((p) => [p, existsSync(path.join(repo, p)) ? readFileSync(path.join(repo, p), "utf8") : null]));

    rmSync(path.join(repo, "node_modules"), { recursive: true, force: true });
    const install = sh(task.commands.install_command, repo, 15 * 60_000);
    if (install.code !== 0) return { tier1_verdict: "INVALID", reason: "install-failed" };
    try {
      verifyNetSandbox(repo);
    } catch (e) {
      return { tier1_verdict: "INVALID", reason: "net-sandbox:" + e.message };
    }
    if (inNetSandbox(task.commands.regression_command, repo).code === 0) return { tier1_verdict: "INVALID", reason: "base-not-red-at-run" };
    if (inNetSandbox("git apply --check " + JSON.stringify(patchAbs), repo).code !== 0) return { tier1_verdict: "INVALID", reason: "patch-not-applicable" };
    if (inNetSandbox("git apply " + JSON.stringify(patchAbs), repo).code !== 0) return { tier1_verdict: "INVALID", reason: "patch-apply-failed" };
    if (shaFile(lockPath) !== task.lockfile_sha256) return { tier1_verdict: "INVALID", reason: "lockfile-drift" };
    if (shaFile(suitePath) !== task.acceptance_suite_sha256) return { tier1_verdict: "INVALID", reason: "suite-drift" };
    for (const p of manifests) {
      const after = existsSync(path.join(repo, p)) ? readFileSync(path.join(repo, p), "utf8") : null;
      if (!depsUnchanged(before.get(p) ?? null, after)) return { tier1_verdict: "INVALID", reason: "dependency-change:" + p };
    }
    if (inNetSandbox(task.commands.patched_acceptance_command, repo).code !== 0) return { tier1_verdict: "INVALID", reason: "patched-acceptance-red" };
    if (inNetSandbox(task.commands.baseline_health_command, repo).code !== 0) return { tier1_verdict: "INVALID", reason: "baseline-broken" };
    let greens = 0;
    for (let i = 0; i < task.determinism_runs; i++) {
      if (inNetSandbox(task.commands.patched_acceptance_command, repo).code === 0) greens++;
    }
    if (greens !== task.determinism_runs) return { tier1_verdict: "INVALID", reason: "determinism-unstable" };
    return { tier1_verdict: "VALID", determinism: greens + "/" + task.determinism_runs, executed: true };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The verdict is a function of the record, never an assertion. */
function tier1VerdictOfRecord(record) {
  if (!record || record.verdict !== "VALID" || !record.checks) return "INVALID";
  const expected = {
    freeze_closure: "VERIFIED",
    base_regression_recheck: "RED",
    lockfile_unchanged: "OK",
    suite_unchanged: "OK",
    dependency_policy: "OK",
    patched_acceptance: "GREEN",
    baseline_health_patched: "GREEN",
    network_sandbox: "DENIED_VERIFIED",
  };
  for (const k of Object.keys(expected)) if (record.checks[k] !== expected[k]) return "INVALID";
  const m = /^(\d+)\/(\d+)$/.exec(String(record.checks.determinism ?? ""));
  if (!m || m[1] !== m[2] || Number(m[1]) < 1) return "INVALID";
  if (!Array.isArray(record.runs) || record.runs.length === 0) return "INVALID";
  for (const r of record.runs) {
    if (!r || typeof r.command !== "string" || typeof r.code !== "number" || !HASH_RE.test(String(r.stdout_sha256))) return "INVALID";
  }
  return "VALID";
}

/* ── the replay: integrity → closure → binding → reality ── */

export function replayPack(packDir, opts = {}) {
  const fail = (stage, reason) => ({
    schema_version: "portable-replay-report.v1",
    replayed_at: opts.replayedAt ?? new Date().toISOString(),
    pack_dir: path.resolve(packDir),
    proof_manifest_sha256: existsSync(path.join(packDir, PROOF_MANIFEST)) ? shaFile(path.join(packDir, PROOF_MANIFEST)) : null,
    files_binding: null,
    integrity: stage === "integrity" ? reason : "OK",
    freeze_closure: stage === "freeze" ? reason : stage === "integrity" ? "SKIPPED" : "OK",
    verdict_binding: stage === "binding" ? reason : stage === "integrity" || stage === "freeze" ? "SKIPPED" : "OK",
    reproduced: null,
    recorded: null,
    same_verdict: false,
    status: "FAIL",
    fail_reason: reason,
  });

  // 1. file integrity: exact file set, every hash and byte count
  const manifestPath = path.join(packDir, PROOF_MANIFEST);
  if (!existsSync(manifestPath)) return fail("integrity", "missing-proof-manifest");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return fail("integrity", "proof-manifest-unparsable");
  }
  if (manifest.schema_version !== "outcome-proof-manifest.v1") return fail("integrity", "proof-manifest-schema");
  const onDisk = readdirSync(packDir).sort();
  if (JSON.stringify(onDisk) !== JSON.stringify([...EXPECTED_FILES].sort())) return fail("integrity", "file-set:" + onDisk.join(","));
  const filesBindingObj = {};
  for (const [f, entry] of Object.entries(manifest.files ?? {})) {
    const p = path.join(packDir, f);
    if (!existsSync(p)) return fail("integrity", "missing:" + f);
    const diskSha = shaFile(p);
    if (diskSha !== entry.sha256) return fail("integrity", "hash:" + f);
    if (readFileSync(p).length !== entry.bytes) return fail("integrity", "bytes:" + f);
    filesBindingObj[f] = diskSha;
  }
  // binds a replay report to EVERY pack byte, not just the manifest file
  // (sorted keys — the ledger recomputes this digest independently)
  const sortedBinding = {};
  for (const k of Object.keys(filesBindingObj).sort()) sortedBinding[k] = filesBindingObj[k];
  const filesBinding = "sha256:" + createHash("sha256").update(JSON.stringify(sortedBinding)).digest("hex");

  // 2. freeze closure, re-derived from the pack bytes
  let task;
  try {
    task = JSON.parse(readFileSync(path.join(packDir, "task.json"), "utf8"));
  } catch {
    return fail("freeze", "task-unparsable");
  }
  if (task.schema_version !== "real-task-experiment.v1") return fail("freeze", "task-schema");
  const reqStrings = [
    "experiment_id", "repository_url", "base_commit_sha", "payer_identity", "worker_identity",
    "acceptance_suite", "lockfile_path", "payer_precommit_text",
    "payer_precommit_timestamp", "tier1_reward", "tier2_reward",
  ];
  for (const f of reqStrings) if (typeof task[f] !== "string" || task[f].trim() === "") return fail("freeze", "task-incomplete:" + f);
  for (const f of ["acceptance_full_suite", "allowed_paths", "forbidden_paths"]) {
    if (!Array.isArray(task[f]) || task[f].length === 0 || !task[f].every((x) => typeof x === "string" && x.trim() !== "")) {
      return fail("freeze", "task-incomplete:" + f);
    }
  }
  if (task.full_suite_baseline_policy !== "ALL_GREEN") return fail("freeze", "task-incomplete:full_suite_baseline_policy");
  if (!/^[0-9a-f]{40}$/.test(task.base_commit_sha)) return fail("freeze", "task-incomplete:base_commit_sha");
  if (!HASH_RE.test(task.acceptance_suite_sha256 ?? "")) return fail("freeze", "task-incomplete:acceptance_suite_sha256");
  if (!HASH_RE.test(task.lockfile_sha256 ?? "")) return fail("freeze", "task-incomplete:lockfile_sha256");
  if (task.new_dependencies_allowed !== false) return fail("freeze", "task-new-dependencies");
  if (task.network !== "disabled") return fail("freeze", "task-network");
  if (task.claim_mode !== "SINGLE_CLAIMANT") return fail("freeze", "task-claim-mode");
  if (!Number.isInteger(task.max_diff_lines) || task.max_diff_lines <= 0) return fail("freeze", "task-max-diff");
  if (!Number.isInteger(task.determinism_runs) || task.determinism_runs < 1) return fail("freeze", "task-determinism-runs");
  if (!Array.isArray(task.allowed_paths) || task.allowed_paths.length === 0) return fail("freeze", "task-allowed-paths");
  if (!Array.isArray(task.forbidden_paths) || task.forbidden_paths.length === 0) return fail("freeze", "task-forbidden-paths");
  const cmds = task.commands ?? {};
  for (const f of ["regression_command", "baseline_health_command", "patched_acceptance_command", "install_command"]) {
    if (typeof cmds[f] !== "string" || cmds[f].trim() === "") return fail("freeze", "task-command:" + f);
  }
  let rulesetFile;
  let contractFile;
  let freezeManifest;
  try {
    rulesetFile = JSON.parse(readFileSync(path.join(packDir, "ruleset.json"), "utf8"));
    contractFile = JSON.parse(readFileSync(path.join(packDir, "contract-freeze.json"), "utf8"));
    freezeManifest = JSON.parse(readFileSync(path.join(packDir, "freeze-manifest.json"), "utf8"));
  } catch {
    return fail("freeze", "freeze-artifacts-unparsable");
  }
  if (!sameJson(rulesetFile, rulesetOfTask(task))) return fail("freeze", "ruleset-not-derived");
  if (!sameJson(contractFile, contractOfTask(task))) return fail("freeze", "contract-not-derived");
  if (freezeManifest.eligibility !== "ELIGIBLE") return fail("freeze", "not-eligible");
  if (freezeManifest.verification_ruleset_hash !== shaObj(rulesetOfTask(task))) return fail("freeze", "ruleset-hash");
  if (freezeManifest.contract_freeze_hash !== shaObj(contractOfTask(task))) return fail("freeze", "contract-hash");
  if (freezeManifest.precommit_binding !== precommitBindingOf(task)) return fail("freeze", "precommit-binding");
  if (manifest.verification_ruleset_hash !== shaObj(rulesetOfTask(task))) return fail("freeze", "manifest-ruleset-hash");
  if (manifest.contract_freeze_hash !== shaObj(contractOfTask(task))) return fail("freeze", "manifest-contract-hash");
  if (manifest.precommit_binding !== precommitBindingOf(task)) return fail("freeze", "manifest-precommit-binding");
  if (manifest.experiment_id !== task.experiment_id) return fail("freeze", "manifest-experiment-id");

  // 3. verdict binding: the recorded verdict must re-derive from the record
  let record;
  try {
    record = JSON.parse(readFileSync(path.join(packDir, "run-record.json"), "utf8"));
  } catch {
    return fail("binding", "run-record-unparsable");
  }
  const recordedVerdict = tier1VerdictOfRecord(record);
  if (manifest.tier1_verdict !== recordedVerdict) return fail("binding", "manifest-verdict-not-derived");
  if (record.freeze) {
    if (record.freeze.verification_ruleset_hash !== freezeManifest.verification_ruleset_hash) return fail("binding", "record-not-bound:ruleset");
    if (record.freeze.contract_freeze_hash !== freezeManifest.contract_freeze_hash) return fail("binding", "record-not-bound:contract");
    if (record.freeze.precommit_binding !== freezeManifest.precommit_binding) return fail("binding", "record-not-bound:precommit");
  }
  const patchSha = shaFile(path.join(packDir, "worker.patch"));
  if (manifest.patch_sha256 !== patchSha) return fail("binding", "manifest-patch-hash");
  if (record.patch_sha256 !== patchSha) return fail("binding", "record-patch-hash");
  if (record.policy_result !== "OK" && recordedVerdict !== "INVALID") return fail("binding", "policy-result-inconsistent");
  if (record.policy_result === "OK" && record.invalid_reason) return fail("binding", "invalid-reason-inconsistent");

  // 4. reality: re-execute from the pack alone and require the SAME verdict
  const reproduced = reexecute(packDir, task);
  const recordedSide = { tier1_verdict: recordedVerdict, reason: record.invalid_reason ?? null, checks: record.checks ?? null };
  const same = reproduced.tier1_verdict === recordedVerdict && (recordedVerdict === "VALID" || reproduced.reason === record.invalid_reason);
  if (recordedVerdict === "VALID" && reproduced.tier1_verdict === "VALID" && reproduced.determinism !== record.checks.determinism) {
    return {
      ...baseReport("OK", "OK", "OK", reproduced, recordedSide, false),
      status: "FAIL",
      fail_reason: "determinism-mismatch:" + reproduced.determinism + "!=" + record.checks.determinism,
    };
  }
  if (!same) {
    return {
      ...baseReport("OK", "OK", "OK", reproduced, recordedSide, false),
      status: "FAIL",
      fail_reason: "verdict-mismatch:reproduced=" + reproduced.tier1_verdict + (reproduced.reason ? ":" + reproduced.reason : "") + ",recorded=" + recordedVerdict,
    };
  }
  return baseReport("OK", "OK", "OK", reproduced, recordedSide, true);

  function baseReport(integrity, freezeClosure, binding, reproduced_, recorded_, same_) {
    return {
      schema_version: "portable-replay-report.v1",
      replayed_at: opts.replayedAt ?? new Date().toISOString(),
      pack_dir: path.resolve(packDir),
      proof_manifest_sha256: shaFile(manifestPath),
      files_binding: filesBinding,
      integrity,
      freeze_closure: freezeClosure,
      verdict_binding: binding,
      reproduced: { tier1_verdict: reproduced_.tier1_verdict, reason: reproduced_.reason ?? null, determinism: reproduced_.determinism ?? null },
      recorded: recorded_,
      same_verdict: same_,
      status: same_ ? "PASS" : "FAIL",
      fail_reason: same_ ? undefined : "verdict-mismatch",
    };
  }
}

/* ── CLI ── */

function isMain() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const a = path.resolve(argv1);
  return a === path.resolve(new URL(import.meta.url).pathname) || a.endsWith("verify.mjs") || a.endsWith("portable-replay.mjs");
}

if (isMain()) {
  const args = process.argv.slice(2);
  let packDir = null;
  let reportPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pack") packDir = args[++i];
    else if (args[i] === "--report") reportPath = args[++i];
    else {
      console.error("usage: node verify.mjs [--pack <dir>] [--report <out.json>]");
      process.exit(2);
    }
  }
  packDir = packDir ?? process.cwd();
  const report = replayPack(packDir);
  const text = JSON.stringify(report, null, 2) + "\n";
  if (reportPath) {
    const fs = await import("node:fs");
    fs.writeFileSync(reportPath, text);
  }
  process.stdout.write(text);
  console.log("REPLAY_STATUS=" + report.status);
  console.log("TIER1_VERDICT=" + (report.reproduced ? report.reproduced.tier1_verdict : "UNREPRODUCIBLE"));
  process.exit(report.status === "PASS" ? 0 : 1);
}
