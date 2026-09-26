import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "workers/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    passWithNoTests: true,
    // Test files run SEQUENTIALLY: several gates spawn real child-process
    // storms (gp3-formal npm-ci replays, gp4 multi-process races, gp5 proof
    // pack verifiers). Parallel files saturate the host and starve the race
    // tests non-deterministically. Order is also load-bearing for the
    // identity worktree-clean checks (they run before the gp2 report
    // regenerating suites, per the alphabetical file order).
    fileParallelism: false,
  },
});
