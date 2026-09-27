import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "workers/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      // The GP-001 acceptance suite is the BASE-STATE (seeded-bug) fixture of the
      // GP2 task. In the repository working tree it is RED BY CONSTRUCTION: the
      // shipped retry.ts contains the seeded bug deliberately, so A1/A2 must fail
      // (recorded in the frozen GP2 evidence as base_acceptance_seeded_red, with
      // the agent-patch artifact carrying the actual fix). It is executed where
      // it is meaningful — inside the GP2 isolated runner, first against an
      // archived base checkout and then against the patched tree. Running it
      // against the live base tree can only ever reproduce that seeded red, so it
      // is excluded from the root developer/CI suite. The suite bytes and the
      // frozen acceptance_suite_sha256 are untouched.
      "packages/golden-path/demo/test/acceptance.test.ts",
    ],
    passWithNoTests: true,
    // Test files run SEQUENTIALLY: several gates spawn real child-process
    // storms (gp3-formal npm-ci replays, gp4 multi-process races, gp5 proof
    // pack verifiers). Parallel files saturate the host and starve the race
    // tests non-deterministically.
    fileParallelism: false,
  },
});
