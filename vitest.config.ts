import { defineConfig } from "vitest/config";

// TEST-HYGIENE-R1 / SUITE-CONTRACT-R1 (Commander MAIN-CLOSURE-R1)
//
// This is the REPOSITORY HEALTH suite: it must be GREEN on a clean checkout.
// The GP-001 task acceptance suite (acceptance.test.ts) is deliberately
// EXCLUDED: its A1/A2 are the SEEDED-RED task fixture (the demo base ships
// the Retry-After bug the GP-001 agent must fix), so "expected fail 2" is a
// task property, not repository health. The GP2 flows run that suite inside
// their ISOLATED frozen-base workdirs (the frozen base has no such exclude),
// asserting BASE = A1/A2 FAIL and PATCHED = all green.
export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "workers/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    exclude: ["**/demo/test/acceptance.test.ts"],
    passWithNoTests: true,
    // TEST-HYGIENE-R1 master gate: `git status --porcelain` must be IDENTICAL
    // before and after the whole suite (on a clean checkout: empty == empty).
    // Tests may only write to OS temp dirs; materializing official evidence
    // is reserved to explicit builder commands (env-gated builder tests are
    // exempt because they ARE those commands).
    globalSetup: ["./scripts/test-hygiene-gate.mts"],
    // Test files run SEQUENTIALLY: several gates spawn real child-process
    // storms (gp3-formal npm-ci replays, gp4 multi-process races, gp5 proof
    // pack verifiers). Parallel files saturate the host and starve the race
    // tests non-deterministically.
    fileParallelism: false,
    // CI-runner infra timeout, NOT a test property: on a ~3x-slower hosted
    // macOS runner the whole suite takes ~7-10min and vitest's worker→main
    // RPC (onTaskUpdate, default 60s) can stall past any fixed ceiling at
    // end-of-run under CPU throttling — turning 60/60-green runs red with
    // unhandled "[vitest-worker]: Timeout calling onTaskUpdate" (seen
    // 2026-10-22: runs on 270317b and 4c92137, both 665/665 passed, exit 1).
    // 600s = a full-suite-length stall budget; the 60min job timeout still
    // bounds a truly wedged run. No assertion, skip, or test timeout changes.
    rpcTimeout: 600_000,
  },
});
