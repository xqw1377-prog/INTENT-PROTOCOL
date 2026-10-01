import { describe, expect, test } from "vitest";

/** Green at base — used to prove the freezer rejects non-red suites as INELIGIBLE. */
describe("always green", () => {
  test("trivially true", () => {
    expect(1 + 1).toBe(2);
  });
});
