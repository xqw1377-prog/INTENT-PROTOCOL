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
    // macOS runner the whole suite takes ~10min and vitest's worker→main
    // RPC (onTaskUpdate, default 60s) can expire at end-of-run under load,
    // turning a 60/60-green run red with unhandled
    // "[vitest-worker]: Timeout calling onTaskUpdate" (2026-10-22 run on
    // 270317b: 60 files / 665 tests passed, exit 1). Raising the RPC
    // ceiling changes no assertion, no skip, no test timeout.
    rpcTimeout: 300_000,
  },
});
