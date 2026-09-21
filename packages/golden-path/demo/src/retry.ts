/**
 * GP-001 demo task target — retryFetch with the SEEDED BUG (base state).
 *
 * Task: on HTTP 429 the implementation MUST honor the `Retry-After` response
 * header, whose value is DELAY SECONDS, and request that delay (x1000 ms)
 * from the injected clock before retrying. The seeded bug uses the header
 * value directly as MILLISECONDS (e.g. "2" -> 2 ms instead of 2000 ms).
 *
 * Determinism contract (task freeze): NO wall clock, NO real network — both
 * fetch and clock are injected. This file is inside allowed_paths; the agent
 * fixes the bug here without changing the public API or the frozen suite.
 */

export interface FetchResponse {
  status: number;
  body?: string | undefined;
  headers?: Record<string, string>;
}

export interface FetchLike {
  (url: string): Promise<FetchResponse>;
}

export interface ClockLike {
  sleep(ms: number): Promise<void>;
}

export interface RetryOptions {
  fetch: FetchLike;
  clock: ClockLike;
  /** Frozen task policy: max_attempts = 3 (gp-001-task.json). */
  maxAttempts?: number;
}

export interface RetryResult {
  status: number;
  body?: string | undefined;
  attempts: number;
  /** True when maxAttempts was exhausted with only retryable responses. */
  exhausted: boolean;
}

/** Delay used for a 429 without a parseable Retry-After header (unspecified by the freeze; deterministic fallback). */
export const DEFAULT_RETRY_DELAY_MS = 1000;

export async function retryFetch(url: string, opts: RetryOptions): Promise<RetryResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  let attempts = 0;
  for (;;) {
    attempts++;
    const res = await opts.fetch(url);
    if (res.status !== 429) {
      return { status: res.status, body: res.body, attempts, exhausted: false };
    }
    if (attempts >= maxAttempts) {
      return { status: res.status, body: res.body, attempts, exhausted: true };
    }
    const header = res.headers?.["retry-after"];
    const parsed = header !== undefined && /^\d+$/.test(header) ? Number(header) : null;
    // SEEDED BUG: Retry-After is SECONDS; the value must be multiplied by 1000
    // before requesting a delay. As shipped, "2" requests a 2 ms delay.
    const delayMs = parsed !== null ? parsed : DEFAULT_RETRY_DELAY_MS;
    await opts.clock.sleep(delayMs);
  }
}
