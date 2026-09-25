/**
 * B2 FUNCTIONAL VERIFIER — full clean-environment reproduction.
 * B3 POLICY VERIFIER — frozen identity binding + evidence integrity.
 * Both produce Ed25519-signed VerificationDecisionV1 objects.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { IntentContractSchema, MilestoneSchema, seal } from "@intent/protocol-schema";
import { buildSignedDecision, type CheckResult } from "./context.js";
import { sha256Hex } from "./r9.js";

const parseCounts = (json: string): { passed: number; failed: number } => {
  const start = json.indexOf("{");
  if (start < 0) return { passed: 0, failed: 0 };
  try { const j = JSON.parse(json.slice(start)); return { passed: j.numPassedTests ?? 0, failed: j.numFailedTests ?? 0 }; } catch { return { passed: 0, failed: 0 }; }
};
const run = (cmd: string[], cwd: string) => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: (r.status ?? -1) === 0, stdout: r.stdout ?? "" };
};
export const diffPaths = (d: string) => [...d.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((m) => m[2]!);
const glob = (g: string, c: string) => new RegExp("^" + g.split("/").map((s) => s === "**" ? "(?:.*)" : s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("/") + "/?$").test(c);

// ---------------------------------------------------------- B2 functional
export function runFunctionalVerifier(ev: any, binding: any) {
  const checks: CheckResult[] = [];
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "gp3-v3-func-"));
  const workdir = path.join(tmpRoot, "w");
  mkdirSync(workdir, { recursive: true });
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const archive = execFileSync("git", ["archive", ev.task.base_commit_sha], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(path.join(tmpRoot, "a.tar"), archive);
    execFileSync("tar", ["-xf", "../a.tar"], { cwd: workdir });
    execFileSync("git", ["init", "--quiet"], { cwd: workdir });
    execFileSync("git", ["-C", workdir, "add", "-A"]);
    execFileSync("git", ["-C", workdir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "base"]);
    symlinkSync(path.join(repoRoot, "node_modules"), path.join(workdir, "node_modules"), "junction");

    // B2: acceptance suite at base (seeded red)
    const base = run(["node", "node_modules/vitest/vitest.mjs", "run", "--root", ".", "packages/golden-path/demo/test/acceptance.test.ts", "--reporter=json"], workdir);
    const bc = parseCounts(base.stdout);
    checks.push({ id: "F-base-seeded-red", pass: bc.passed === 2 && bc.failed === 2, detail: JSON.stringify(bc) });

    // B2: existing tests (basic.test.ts) at base — MUST also run
    const basic = run(["node", "node_modules/vitest/vitest.mjs", "run", "--root", ".", "packages/golden-path/demo/test/basic.test.ts", "--reporter=json"], workdir);
    const basicC = parseCounts(basic.stdout);
    checks.push({ id: "F-existing-tests-base", pass: basicC.failed === 0 && basicC.passed >= 2, detail: JSON.stringify(basicC) });

    // apply committed patch
    const patch = ev.raw.get("agent-patch")!;
    let applied = true;
    try { execFileSync("git", ["-C", workdir, "apply", "-"], { input: patch, encoding: "utf8" }); } catch { applied = false; }
    checks.push({ id: "F-patch-applies", pass: applied });

    const changed = diffPaths(patch.toString("utf8"));
    checks.push({ id: "F-changed-path-exact", pass: changed.length === 1 && changed[0] === "packages/golden-path/demo/src/retry.ts" });

    // B2: patched acceptance suite (all green)
    const patched = run(["node", "node_modules/vitest/vitest.mjs", "run", "--root", ".", "packages/golden-path/demo/test/acceptance.test.ts", "--reporter=json"], workdir);
    const pc = parseCounts(patched.stdout);
    checks.push({ id: "F-patched-acceptance-green", pass: pc.passed === 4 && pc.failed === 0, detail: JSON.stringify(pc) });

    // B2: patched existing tests still pass
    const patchedBasic = run(["node", "node_modules/vitest/vitest.mjs", "run", "--root", ".", "packages/golden-path/demo/test/basic.test.ts", "--reporter=json"], workdir);
    const pbc = parseCounts(patchedBasic.stdout);
    checks.push({ id: "F-existing-tests-patched", pass: pbc.failed === 0, detail: JSON.stringify(pbc) });

    // B2: build/typecheck
    const build = run(["node", "node_modules/typescript/bin/tsc", "-p", "packages/golden-path/demo/tsconfig.json", "--noEmit"], workdir);
    checks.push({ id: "F-build-typecheck", pass: build.ok });

    // patch sha matches frozen manifest
    checks.push({ id: "F-patch-sha-matches-frozen", pass: sha256Hex(patch) === String(ev.manifest.patch_sha256) });

    const allPass = checks.every((c) => c.pass);
    return buildSignedDecision({
      verifierId: "verifier:gp3-functional",
      verifierDigestSeed: "gp3:v3:functional:clean-env-reproduction",
      binding, result: allPass ? "VALID" : "INVALID",
      reasonCodes: allPass ? ["ALL_FUNCTIONAL_CHECKS_PASSED"] : checks.filter((c) => !c.pass).map((c) => `FAILED_${c.id}`),
      checks, decisionIdSeed: `gp3:v3:functional:${binding.bundle_id}`,
    });
  } finally { rmSync(tmpRoot, { recursive: true, force: true }); }
}

// ---------------------------------------------------------- B3 policy
export function runPolicyVerifier(ev: any, binding: any, identity: any) {
  const checks: CheckResult[] = [];
  const task = ev.task;

  // B3: re-seal frozen Intent — hash must match
  const intentBody = { ...identity.intent }; delete intentBody.content_hash; delete intentBody.signature;
  const resealedIntent = seal(IntentContractSchema as never, intentBody) as any;
  checks.push({ id: "P-intent-reseal", pass: String(resealedIntent.content_hash) === identity.intentContentHash });

  // B3: re-seal frozen Milestone — hash must match
  const msBody = { ...identity.milestone }; delete msBody.content_hash; delete msBody.signature;
  const resealedMs = seal(MilestoneSchema as never, msBody) as any;
  checks.push({ id: "P-milestone-reseal", pass: String(resealedMs.content_hash) === identity.milestoneContentHash });

  // B3: intent_hash binding
  checks.push({ id: "P-intent-hash-binding", pass: binding.intent_hash === identity.intentContentHash && binding.intent_hash === "sha256:88a2ff855c145c95db613297441a5588094a83b349cd3d6e6fd3ea7112e9b35e" });

  // B3: milestone anchor alignment with GP2 bundle
  checks.push({ id: "P-milestone-anchor", pass: binding.milestone_id === String(ev.bundle.milestone_id) && binding.milestone_revision === Number(ev.bundle.milestone_revision) });

  // B3: HOLD settlement policy still release_enabled=false
  const repoRootP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const hold = JSON.parse(readFileSync(path.join(repoRootP, "packages/golden-path/identity/policies/gp-001-settlement-hold-v1.json"), "utf8"));
  checks.push({ id: "P-hold-policy", pass: hold.release_enabled === false && hold.gp4_gate === "PASS_REQUIRED" });

  // task truth
  checks.push({ id: "P-task-freeze-hash", pass: ev.taskFreezeHash === "sha256:95ca98eb0146c56be577f9704d8640bb99ef38b5271a94496fc8cc6aa61121e5" });
  checks.push({ id: "P-max-attempts", pass: task.max_attempts === 3 });

  // path policy
  const patch = ev.raw.get("agent-patch")!;
  const changed = diffPaths(patch.toString("utf8"));
  checks.push({ id: "P-path-policy", pass: changed.length > 0 && changed.every((p) => !task.forbidden_paths.some((g: string) => glob(g, p)) && task.allowed_paths.some((g: string) => glob(g, p))) });

  // evidence integrity
  let artOk = true;
  for (const a of ev.artifacts) {
    if (sha256Hex(ev.raw.get(a.key)!) !== a.payload_hash) artOk = false;
    if (String(a.artifact.locator) !== `cas://gp2/${ev.manifest.run_id}/${a.key}/${a.payload_hash.slice(7)}`) artOk = false;
  }
  checks.push({ id: "P-artifact-integrity", pass: artOk && ev.artifacts.length === 6 });
  checks.push({ id: "P-patch-sha-policy", pass: sha256Hex(patch) === String(ev.manifest.patch_sha256) });

  const allPass = checks.every((c) => c.pass);
  return buildSignedDecision({
    verifierId: "verifier:gp3-policy",
    verifierDigestSeed: "gp3:v3:policy:identity-binding",
    binding, result: allPass ? "VALID" : "INVALID",
    reasonCodes: allPass ? ["ALL_POLICY_CHECKS_PASSED"] : checks.filter((c) => !c.pass).map((c) => `FAILED_${c.id}`),
    checks, decisionIdSeed: `gp3:v3:policy:${binding.bundle_id}`,
  });
}
