import { describe, expect, test } from "vitest";
import { retryFetch } from "../src/retry.js";

/** Existing package tests (green at the task base; independent of the frozen acceptance suite). */
describe("[GP-001 demo] existing behavior", () => {
  test("B1. success passthrough without options noise", async () => {
    const result = await retryFetch("https://demo.example/ok", {
      fetch: async () => ({ status: 200, body: "fine" }),
      clock: { sleep: async () => {} },
    });
    expect(result).toMatchObject({ status: 200, body: "fine", attempts: 1, exhausted: false });
  });

  test("B2. caller can raise maxAttempts within policy bounds", async () => {
    let n = 0;
    const result = await retryFetch("https://demo.example/flaky", {
      fetch: async () => (++n === 1 ? { status: 429, headers: { "retry-after": "1" } } : { status: 200, body: "recovered" }),
      clock: { sleep: async () => {} },
    });
    expect(result.status).toBe(200);
    expect(result.attempts).toBe(2);
  });
});
