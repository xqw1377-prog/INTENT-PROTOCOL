/**
 * GP3 verifiers (Issue #32 §4/§5). Both consume the FROZEN GP2 evidence and
 * independently derive their VerificationDecisionV1. Neither trusts GP2
 * candidate-report booleans: functional RE-OBSERVES by reproduction, policy
 * RECOMPUTES from raw bytes + frozen contracts.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { EvidenceBundleSchema, merkleRoot, seal } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import { buildDecision, type BindingContext, type CheckResult, type FrozenEvidence, gitBuf, repoRoot, REQUIRED_LIVE_SUBTREE } from "./context.js";
import { sha256Hex } from "./r9.js";

const parseCounts = (json: string): { passed: number; failed: number } => {
  const start = json.indexOf("{");
  if (start < 0) return { passed: 0, failed: 0 };
  try {
    const j = JSON.parse(json.slice(start)) as { numPassedTests?: number; numFailedTests?: number };
    return { passed: j.numPassedTests ?? 0, failed: j.numFailedTests ?? 0 };
  } catch {
    return { passed: 0, failed: 0 };
  }
};

const run = (cmd: string[], cwd: string): { ok: boolean; stdout: string } => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: (r.status ?? -1) === 0, stdout: r.stdout ?? "" };
};

/** Changed paths inside a unified diff. */
export const diffPaths = (diff: string): string[] =>
  [...diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((m) => m[2]!);

const globMatch = (glob: string, candidate: string): boolean => {
  const re = new RegExp("^" + glob.split("/").map((seg) =>
    seg === "**" ? "(?:.*)" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
  ).join("/") + "/?$");
  return re.test(candidate);
};

// ---------------------------------------------------------------- functional

export interface FunctionalResult {
  decision: Record<string, any>;
  content_hash: string;
  checks: CheckResult[];
}

/**
 * Functional verifier: reproduces the GP-001 technical outcome from the frozen
 * base commit + committed patch bytes in a clean isolated checkout. Returns a
 * sealed decision.v1 (result VALID only if every functional check passes).
 */
export function runFunctionalVerifier(ev: FrozenEvidence, binding: BindingContext): FunctionalResult {
  const task = ev.task;
  const patch = ev.raw.get("agent-patch")!;
  const patchSha = sha256Hex(patch);
  const checks: CheckResult[] = [];
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "gp3-func-"));
  const workdir = path.join(tmpRoot, "w");
  mkdirSync(workdir, { recursive: true });
  try {
    const archive = execFileSync("git", ["archive", task.base_commit_sha], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(path.join(tmpRoot, "a.tar"), archive);
    execFileSync("tar", ["-xf", "../a.tar"], { cwd: workdir });
    rmSync(path.join(tmpRoot, "a.tar"), { force: true });
    execFileSync("git", ["init", "--quiet"], { cwd: workdir });
    execFileSync("git", ["-C", workdir, "add", "-A"]);
    execFileSync("git", ["-C", workdir, "-c", "user.name=gp3-functional", "-c", "user.email=functional@gp3.invalid", "commit", "--quiet", "-m", "base"]);
    symlinkSync(path.join(repoRoot, "node_modules"), path.join(workdir, "node_modules"), "junction");

    const vitest = ["node", "node_modules/vitest/vitest.mjs", "run", "--root", ".", "packages/golden-path/demo/test/acceptance.test.ts", "--reporter=json"];

    const base = run(vitest, workdir);
    const baseCounts = parseCounts(base.stdout);
    checks.push({ id: "F-base-seeded-red", pass: baseCounts.passed === 2 && baseCounts.failed === 2, detail: JSON.stringify(baseCounts) });

    // patch bytes apply cleanly to the exact base
    let applied = true;
    try {
      execFileSync("git", ["-C", workdir, "apply", "-"], { input: patch, encoding: "utf8" });
    } catch {
      applied = false;
    }
    checks.push({ id: "F-patch-applies", pass: applied });

    const changed = diffPaths(patch.toString("utf8"));
    checks.push({ id: "F-changed-path-exact", pass: changed.length === 1 && changed[0] === "packages/golden-path/demo/src/retry.ts", detail: changed.join(",") });

    const patched = run(vitest, workdir);
    const patchedCounts = parseCounts(patched.stdout);
    checks.push({ id: "F-patched-acceptance-green", pass: patchedCounts.passed === 4 && patchedCounts.failed === 0, detail: JSON.stringify(patchedCounts) });

    // Retry-After 2000ms + max_attempts + non-429 semantics observed in the suite run
    const names = [...patched.stdout.matchAll(/"fullName":\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
    const a1 = names.some((n) => n.includes("A1") && n.includes("2000 ms") && patchedCounts.failed === 0);
    const a2 = names.some((n) => n.includes("A2") && n.includes("max_attempts = 3") && patchedCounts.failed === 0);
    const a3 = names.some((n) => n.includes("A3") && n.includes("does NOT enter") && patchedCounts.failed === 0);
    checks.push({ id: "F-retry-2000ms", pass: a1 });
    checks.push({ id: "F-max-attempts-3", pass: a2 });
    checks.push({ id: "F-non429-unchanged", pass: a3 });

    const build = run(["node", "node_modules/typescript/bin/tsc", "-p", `${task.package_path}/tsconfig.json`, "--noEmit"], workdir);
    checks.push({ id: "F-build-typecheck", pass: build.ok });

    // committed patch identity matches the frozen manifest
    checks.push({ id: "F-patch-sha-matches-frozen", pass: patchSha === String(ev.manifest.patch_sha256) });

    const allPass = checks.every((c) => c.pass);
    const built = buildDecision({
      verifierId: "verifier:gp3-functional",
      verifierDigestSeed: "gp3:functional:reproduction-from-frozen-base",
      binding,
      result: allPass ? "VALID" : "INVALID",
      reasonCodes: allPass ? ["ALL_FUNCTIONAL_CHECKS_PASSED"] : checks.filter((c) => !c.pass).map((c) => `FAILED_${c.id}`),
      checks,
      decisionIdSeed: `gp3:decision:functional:${binding.bundle_id}:${patchSha}`,
    });
    return { ...built, checks };
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// -------------------------------------------------------------------- policy

export interface PolicyResult {
  decision: Record<string, any>;
  content_hash: string;
  checks: CheckResult[];
}

/**
 * Policy/provenance verifier: recomputes task truth, path policy, evidence
 * integrity, identity invariants and the R9 binding inputs from raw bytes.
 */
export function runPolicyVerifier(ev: FrozenEvidence, binding: BindingContext): PolicyResult {
  const checks: CheckResult[] = [];
  const task = ev.task;

  // task truth (independent recompute of the frozen facts)
  const taskBytes = gitBuf(["show", `HEAD:packages/golden-path/fixtures/gp-001-task.json`]);
  const taskHash = sha256Hex(taskBytes);
  checks.push({ id: "P-task-freeze-hash", pass: taskHash === ev.taskFreezeHash && taskHash === "sha256:95ca98eb0146c56be577f9704d8640bb99ef38b5271a94496fc8cc6aa61121e5" });
  const suiteBytes = gitBuf(["show", `${task.base_commit_sha}:${task.acceptance_suite_path}`]);
  checks.push({ id: "P-suite-sha", pass: sha256Hex(suiteBytes) === task.acceptance_suite_sha256 });
  checks.push({ id: "P-max-attempts", pass: task.max_attempts === 3 });

  // path policy over the committed patch bytes
  const patch = ev.raw.get("agent-patch")!;
  const changed = diffPaths(patch.toString("utf8"));
  const policyOk = changed.length > 0 && changed.every(
    (p) => !task.forbidden_paths.some((g: string) => globMatch(g, p)) && task.allowed_paths.some((g: string) => globMatch(g, p)),
  );
  checks.push({ id: "P-path-policy", pass: policyOk, detail: changed.join(",") });

  // evidence integrity: six payload hashes recompute; locators bind run+key+hash
  let artifactsOk = true;
  for (const a of ev.artifacts) {
    const raw = ev.raw.get(a.key)!;
    if (sha256Hex(raw) !== a.payload_hash) artifactsOk = false;
    const expected = `cas://gp2/${ev.manifest.run_id}/${a.key}/${a.payload_hash.slice(7)}`;
    if (String(a.artifact.locator) !== expected) artifactsOk = false;
  }
  checks.push({ id: "P-artifact-hashes-locators", pass: artifactsOk && ev.artifacts.length === 6 });

  // bundle: SEALED, merkle recomputes over committed order, content_hash recomputes
  const declared = ev.bundle.artifact_hashes as string[];
  checks.push({ id: "P-bundle-hashes-order", pass: declared.join() === ev.artifacts.map((a) => a.payload_hash).join() });
  const root = merkleRoot(declared as Hash[]);
  checks.push({ id: "P-merkle-root", pass: String(ev.bundle.merkle_root) === root && String(ev.bundle.merkle_root) === binding.evidence_root });
  checks.push({ id: "P-bundle-sealed", pass: ev.bundle.state === "SEALED" });
  try {
    seal(EvidenceBundleSchema as never, ev.bundle);
    checks.push({ id: "P-bundle-schema-reparse", pass: true });
  } catch {
    checks.push({ id: "P-bundle-schema-reparse", pass: false });
  }

  // live G1 identity
  checks.push({ id: "P-live-subtree", pass: ev.liveSubtree === REQUIRED_LIVE_SUBTREE });

  // GP2 identity invariants (fingerprint + run scoping vs manifest)
  checks.push({ id: "P-manifest-binding", pass:
    ev.manifest.task_freeze_hash === taskHash &&
    ev.manifest.base_commit_sha === task.base_commit_sha &&
    ev.manifest.attempt === 1 && ev.manifest.max_attempts === 3 &&
    ev.manifest.run_id === ev.bundle.run_ids[0] });

  // R9 binding inputs point at THIS frozen bundle/task
  checks.push({ id: "P-binding-inputs", pass:
    binding.intent_hash === taskHash &&
    binding.milestone_id === String(ev.bundle.milestone_id) &&
    binding.milestone_revision === Number(ev.bundle.milestone_revision) &&
    binding.bundle_id === String(ev.bundle.bundle_id) &&
    binding.evidence_root === String(ev.bundle.merkle_root) &&
    binding.policy_hash === String(ev.bundle.policy_hash) });

  const allPass = checks.every((c) => c.pass);
  const built = buildDecision({
    verifierId: "verifier:gp3-policy",
    verifierDigestSeed: "gp3:policy:provenance-recompute",
    binding,
    result: allPass ? "VALID" : "INVALID",
    reasonCodes: allPass ? ["ALL_POLICY_CHECKS_PASSED"] : checks.filter((c) => !c.pass).map((c) => `FAILED_${c.id}`),
    checks,
    decisionIdSeed: `gp3:decision:policy:${binding.bundle_id}:${createHash("sha256").update(declared.join()).digest("hex").slice(0, 16)}`,
  });
  return { ...built, checks };
}
