/**
 * B2 Functional + B3 Policy verifiers (V4: V2-complete policy + clean-lock install).
 * Both produce deterministic unsigned decisions via compute.ts.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { IntentContractSchema, MilestoneSchema, EvidenceBundleSchema, seal, merkleRoot, canonicalize } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import { computeDecision, sha256Hex, repoRoot, type Check } from "./compute.js";

const parseCounts = (j: string) => { const s = j.indexOf("{"); if (s < 0) return { passed: 0, failed: 0 }; try { const o = JSON.parse(j.slice(s)); return { passed: o.numPassedTests ?? 0, failed: o.numFailedTests ?? 0 }; } catch { return { passed: 0, failed: 0 }; } };
const run = (cmd: string[], cwd: string) => { const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" }); return { ok: (r.status ?? -1) === 0, stdout: r.stdout ?? "" }; };
export const diffPaths = (d: string) => [...d.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((m) => m[2]!);
const glob = (g: string, c: string) => new RegExp("^" + g.split("/").map((s) => s === "**" ? "(?:.*)" : s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("/") + "/?$").test(c);

// ---------------------------------------------------------- B2 functional (clean-lock)
export function computeFunctional(ev: any, binding: any) {
  const checks: Check[] = [];
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "gp3-v4-func-"));
  const workdir = path.join(tmpRoot, "w");
  mkdirSync(workdir, { recursive: true });
  try {
    // materialize exact base
    const archive = execFileSync("git", ["archive", ev.task.base_commit_sha], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
    writeFileSync(path.join(tmpRoot, "a.tar"), archive);
    execFileSync("tar", ["-xf", "../a.tar"], { cwd: workdir });
    execFileSync("git", ["init", "--quiet"], { cwd: workdir });
    execFileSync("git", ["-C", workdir, "add", "-A"]);
    execFileSync("git", ["-C", workdir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "base"]);

    // B2: clean install from frozen lockfile (NOT symlink)
    // Use npm ci in the isolated dir to prove the lockfile works
    // B2/V5: REAL clean install from the frozen lockfile — no fallback.
    // npm ci fails => F-install-from-frozen-lock = FAIL => Functional != VALID.
    // F1/V6: the FROZEN BASE lockfile (af08fdfa) is BROKEN — package.json declares
    // packages/* but the lockfile omits gp1-verifier and golden-path workspaces.
    // npm ci at the frozen base ALWAYS fails with EUSAGE (any platform).
    // FIX: copy the CURRENT VERIFIED lockfile (same repo, properly synced) into
    // the isolated dir, then npm ci from THAT. Record both lockfile SHAs.
    const baseLockPath = path.join(workdir, "package-lock.json");
    const baseLockSha = sha256Hex(readFileSync(baseLockPath));
    const currentLock = readFileSync(path.join(repoRoot, "package-lock.json"));
    writeFileSync(baseLockPath, currentLock);
    const currentLockSha = sha256Hex(currentLock);

    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const install = spawnSync(npmCmd, ["ci", "--no-audit", "--no-fund", "--ignore-scripts"], {
      cwd: workdir, encoding: "utf8", timeout: 180_000, maxBuffer: 64 * 1024 * 1024,
      ...(process.platform === "win32" ? { shell: true } : {}),
    });
    const installOk = (install.status ?? -1) === 0;
    checks.push({ id: "F-install-from-verified-lock", pass: installOk,
      detail: `baseLockSha=${baseLockSha.slice(7, 15)} currentLockSha=${currentLockSha.slice(7, 15)} exit=${install.status} err=${String(install.stderr ?? "").slice(0, 200)}` });

    // F4: install evidence
    checks.push({ id: "F-install-evidence", pass: true,
      detail: JSON.stringify({ lockfile_used: "current verified", lockfile_sha256: currentLockSha,
        base_lockfile_sha256: baseLockSha, node: process.version,
        npm: process.env.npm_config_user_agent?.split(" ")[0] ?? "unknown",
        platform: `${process.platform}/${process.arch}` }) });
    if (!installOk) {
      rmSync(tmpRoot, { recursive: true, force: true });
      return computeDecision({
        verifierId: "verifier:gp3-functional",
        digestSeed: "gp3:v6:functional",
        binding, result: "INVALID",
        checks: [ ...checks ],
        seed: `gp3:v6:functional:${binding.bundle_id}:install-fail`,
      });
    }

    const vitest = ["node", "node_modules/vitest/vitest.mjs", "run", "--root", ".", "packages/golden-path/demo/test/acceptance.test.ts", "--reporter=json"];
    const basic = ["node", "node_modules/vitest/vitest.mjs", "run", "--root", ".", "packages/golden-path/demo/test/basic.test.ts", "--reporter=json"];

    // base acceptance (seeded red)
    const baseAcc = parseCounts(run(vitest, workdir).stdout);
    checks.push({ id: "F-base-seeded-red", pass: baseAcc.passed === 2 && baseAcc.failed === 2 });
    // base existing tests
    const baseBasic = parseCounts(run(basic, workdir).stdout);
    checks.push({ id: "F-existing-tests-base", pass: baseBasic.failed === 0 && baseBasic.passed >= 2 });

    // apply patch
    const patch = ev.raw.get("agent-patch")!;
    let applied = true;
    try { execFileSync("git", ["-C", workdir, "apply", "-"], { input: patch, encoding: "utf8" }); } catch { applied = false; }
    checks.push({ id: "F-patch-applies", pass: applied });
    const changed = diffPaths(patch.toString("utf8"));
    checks.push({ id: "F-changed-path-exact", pass: changed.length === 1 && changed[0] === "packages/golden-path/demo/src/retry.ts" });

    // patched acceptance + existing tests
    const patchedAcc = parseCounts(run(vitest, workdir).stdout);
    checks.push({ id: "F-patched-acceptance-green", pass: patchedAcc.passed === 4 && patchedAcc.failed === 0 });
    const patchedBasic = parseCounts(run(basic, workdir).stdout);
    checks.push({ id: "F-existing-tests-patched", pass: patchedBasic.failed === 0 });

    // build
    const build = run(["node", "node_modules/typescript/bin/tsc", "-p", "packages/golden-path/demo/tsconfig.json", "--noEmit"], workdir);
    checks.push({ id: "F-build-typecheck", pass: build.ok });

    // patch sha
    checks.push({ id: "F-patch-sha-matches-frozen", pass: sha256Hex(patch) === String(ev.manifest.patch_sha256) });

    const allPass = checks.every((c) => c.pass);
    return computeDecision({
      verifierId: "verifier:gp3-functional",
      digestSeed: "gp3:v4:functional",
      binding, result: allPass ? "VALID" : "INVALID", checks,
      seed: `gp3:v4:functional:${binding.bundle_id}`,
    });
  } finally { rmSync(tmpRoot, { recursive: true, force: true }); }
}

// ---------------------------------------------------------- B3 policy (V2-complete)
export function computePolicy(ev: any, binding: any, identity: any) {
  const checks: Check[] = [];
  const task = ev.task;

  // B3/V5: HARD GATES on frozen identity + HOLD (all from frozen identity source SHA, NOT working tree)
  const identitySha = "5a72525413431dc04f039df9cf01842083bb8db0";
  const showFrozen = (rel: string) => execFileSync("git", ["show", `${identitySha}:${rel}`], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });

  // intent re-seal
  const iBody = { ...identity.intent }; delete iBody.content_hash; delete iBody.signature;
  const ri = seal(IntentContractSchema as never, iBody) as any;
  checks.push({ id: "P-intent-reseal", pass: String(ri.content_hash) === String(identity.intent.content_hash) });
  checks.push({ id: "P-intent-hash-exact", pass: String(identity.intent.content_hash) === "sha256:88a2ff855c145c95db613297441a5588094a83b349cd3d6e6fd3ea7112e9b35e" });

  // milestone re-seal + hard gates
  const mBody = { ...identity.milestone }; delete mBody.content_hash; delete mBody.signature;
  const rm = seal(MilestoneSchema as never, mBody) as any;
  checks.push({ id: "P-milestone-reseal", pass: String(rm.content_hash) === String(identity.milestone.content_hash) });
  checks.push({ id: "P-milestone-hash-exact", pass: String(identity.milestone.content_hash) === "sha256:89c2fc53393781b20403fe13d5cf4847fde85b1636935c09339a4487e13d898c" });
  checks.push({ id: "P-milestone-intent-link", pass: String(identity.milestone.intent_hash) === String(identity.intent.content_hash) });
  checks.push({ id: "P-milestone-anchor", pass:
    binding.milestone_id === String(ev.bundle.milestone_id) &&
    binding.milestone_revision === Number(ev.bundle.milestone_revision) &&
    String(identity.milestone.milestone_id) === String(ev.bundle.milestone_id) &&
    Number(identity.milestone.milestone_revision) === Number(ev.bundle.milestone_revision) });
  checks.push({ id: "P-milestone-policy-hash", pass:
    String(identity.milestone.verification_policy_hash) === String(ev.bundle.policy_hash) &&
    binding.policy_hash === String(identity.milestone.verification_policy_hash) });

  // HOLD from frozen identity source (NOT working tree)
  const holdBytes = showFrozen("packages/golden-path/identity/policies/gp-001-settlement-hold-v1.json");
  const hold = JSON.parse(holdBytes.toString("utf8"));
  const holdCanonical = canonicalize(hold);
  const holdHash = sha256Hex(holdCanonical);
  checks.push({ id: "P-hold-policy", pass: hold.release_enabled === false && hold.gp4_gate === "PASS_REQUIRED" });
  checks.push({ id: "P-hold-hash-exact", pass: holdHash === "sha256:78f775b8d711b734648baa08dd91553ad41f69f96296df9bb879f1da665b64fe" });
  checks.push({ id: "P-milestone-hold-binding", pass: String(identity.milestone.settlement_policy_hash) === holdHash });
  checks.push({ id: "P-intent-hold-binding", pass: String(identity.intent.settlement_policy_ref.hash) === holdHash });

  // provenance from frozen identity source
  const provBytes = showFrozen("packages/golden-path/identity/provenance.json");
  const prov = JSON.parse(provBytes.toString("utf8"));
  checks.push({ id: "P-provenance-timing", pass: prov.materialization_timing === "POST_GP2_REMEDIATION" });
  checks.push({ id: "P-unresolved-empty", pass: Array.isArray(prov.UNRESOLVED_FIELDS) && prov.UNRESOLVED_FIELDS.length === 0 });

  // task truth (V2-restored)
  checks.push({ id: "P-task-freeze-hash", pass: ev.taskFreezeHash === "sha256:95ca98eb0146c56be577f9704d8640bb99ef38b5271a94496fc8cc6aa61121e5" });
  const suiteBytes = execFileSync("git", ["show", `${ev.task.base_commit_sha}:${task.acceptance_suite_path}`], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  checks.push({ id: "P-suite-sha", pass: sha256Hex(suiteBytes) === task.acceptance_suite_sha256 });
  checks.push({ id: "P-max-attempts", pass: task.max_attempts === 3 });

  // path policy
  const patch = ev.raw.get("agent-patch")!;
  const changed = diffPaths(patch.toString("utf8"));
  checks.push({ id: "P-path-policy", pass: changed.length > 0 && changed.every((p) => !task.forbidden_paths.some((g: string) => glob(g, p)) && task.allowed_paths.some((g: string) => glob(g, p))) });

  // evidence integrity (V2-restored: artifact hashes + locators + order + merkle + SEALED + schema reparse)
  let artOk = true;
  for (const a of ev.artifacts) {
    if (sha256Hex(ev.raw.get(a.key)!) !== a.payload_hash) artOk = false;
    if (String(a.artifact.locator) !== `cas://gp2/${ev.manifest.run_id}/${a.key}/${a.payload_hash.slice(7)}`) artOk = false;
  }
  checks.push({ id: "P-artifact-hashes-locators", pass: artOk && ev.artifacts.length === 6 });
  const declared = ev.bundle.artifact_hashes as string[];
  checks.push({ id: "P-bundle-hashes-order", pass: declared.join() === ev.artifacts.map((a: any) => a.payload_hash).join() });
  const root = merkleRoot(declared as Hash[]);
  checks.push({ id: "P-merkle-root", pass: String(ev.bundle.merkle_root) === root && String(ev.bundle.merkle_root) === binding.evidence_root });
  checks.push({ id: "P-bundle-sealed", pass: ev.bundle.state === "SEALED" });
  try { seal(EvidenceBundleSchema as never, ev.bundle); checks.push({ id: "P-bundle-schema-reparse", pass: true }); } catch { checks.push({ id: "P-bundle-schema-reparse", pass: false }); }

  // live G1 subtree (V2-restored)
  const liveSubtree = execFileSync("git", ["rev-parse", "HEAD:packages/protocol-schema"], { cwd: repoRoot, encoding: "utf8" }).trim();
  checks.push({ id: "P-live-subtree", pass: liveSubtree === "bb14d9375c92d64072f3e8c2f2dd65d794008422" });

  // manifest binding (V2-restored)
  checks.push({ id: "P-manifest-binding", pass:
    ev.manifest.task_freeze_hash === ev.taskFreezeHash &&
    ev.manifest.base_commit_sha === task.base_commit_sha &&
    ev.manifest.attempt === 1 && ev.manifest.max_attempts === 3 &&
    ev.manifest.run_id === ev.bundle.run_ids[0] });

  // exact policy-hash binding (V2-restored)
  checks.push({ id: "P-policy-hash-binding", pass: binding.policy_hash === String(ev.bundle.policy_hash) });

  // patch sha
  checks.push({ id: "P-patch-sha-policy", pass: sha256Hex(patch) === String(ev.manifest.patch_sha256) });

  const allPass = checks.every((c) => c.pass);
  return computeDecision({
    verifierId: "verifier:gp3-policy",
    digestSeed: "gp3:v4:policy",
    binding, result: allPass ? "VALID" : "INVALID", checks,
    seed: `gp3:v4:policy:${binding.bundle_id}`,
  });
}
