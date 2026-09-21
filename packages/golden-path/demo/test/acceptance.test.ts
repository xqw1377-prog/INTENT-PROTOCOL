import { describe, expect, test } from "vitest";
import { retryFetch, type FetchLike } from "../src/retry.js";

/**
 * GP-001 FROZEN ACCEPTANCE SUITE — IMMUTABLE from the task base commit.
 * (acceptance_suite_path / acceptance_suite_sha256 in gp-001-task.json;
 *  this file is inside forbidden_paths for the agent.)
 *
 * Deterministic by construction: injected fetch + injected recording clock;
 * no wall clock, no network. Fails against the SEEDED bug (base) and must
 * pass after the agent's fix.
 */

const recordingClock = () => {
  const delays: number[] = [];
  return { delays, clock: { sleep: async (ms: number) => { delays.push(ms); } } };
};

const scriptedFetch = (...responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>): { calls: string[]; fetch: FetchLike } => {
  const queue = [...responses];
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url: string) => {
      calls.push(url);
      const next = queue.shift();
      if (!next) throw new Error("scripted fetch exhausted");
      return next;
    },
  };
};

describe("[GP-001 acceptance] retryFetch / HTTP 429 Retry-After", () => {
  test("A1. 429 with Retry-After \"2\" requests an EXACT 2000 ms delay via the injected clock, then retries and returns the subsequent 200", async () => {
    const { delays, clock } = recordingClock();
    const { fetch } = scriptedFetch(
      { status: 429, headers: { "retry-after": "2" } },
      { status: 200, body: "ok" },
    );
    const result = await retryFetch("https://demo.example/resource", { fetch, clock });
    expect(result.status).toBe(200);
    expect(result.body).toBe("ok");
    expect(result.attempts).toBe(2);
    expect(result.exhausted).toBe(false);
    expect(delays, "Retry-After is SECONDS: exactly one 2000 ms delay must be requested").toEqual([2000]);
  });

  test("A2. max_attempts = 3: three consecutive 429s exhaust after exactly 3 attempts with two 2000 ms delays", async () => {
    const { delays, clock } = recordingClock();
    const { fetch, calls } = scriptedFetch(
      { status: 429, headers: { "retry-after": "2" } },
      { status: 429, headers: { "retry-after": "2" } },
      { status: 429, headers: { "retry-after": "2" } },
    );
    const result = await retryFetch("https://demo.example/resource", { fetch, clock });
    expect(result.exhausted).toBe(true);
    expect(result.attempts).toBe(3);
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([2000, 2000]);
  });

  test("A3. a non-429 non-success response (500) does NOT enter the 429 retry path: one attempt, no delay", async () => {
    const { delays, clock } = recordingClock();
    const { fetch, calls } = scriptedFetch({ status: 500, body: "boom" });
    const result = await retryFetch("https://demo.example/resource", { fetch, clock });
    expect(result.status).toBe(500);
    expect(result.attempts).toBe(1);
    expect(result.exhausted).toBe(false);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  test("A4. a plain 200 on the first attempt returns immediately: one attempt, no delay, body preserved", async () => {
    const { delays, clock } = recordingClock();
    const { fetch } = scriptedFetch({ status: 200, body: "first-shot" });
    const result = await retryFetch("https://demo.example/resource", { fetch, clock });
    expect(result.status).toBe(200);
    expect(result.body).toBe("first-shot");
    expect(result.attempts).toBe(1);
    expect(delays).toEqual([]);
  });
});
