import { describe, expect, test } from "vitest";

/** REAL RED at base: the seeded regression this experiment freezes (fails until the fix lands). */
describe("frozen regression", () => {
  test("fails at base (the bug exists)", () => {
    expect(1 + 1).toBe(3); // deliberately red
  });
});
