/**
 * SECURITY-R1 / S3 — test client that talks to the orchestrator exactly like
 * its own page does: read the per-process token from index.html, then send
 * every mutation with the page Origin, JSON content-type, and the token header.
 */
import { CSRF_HEADER } from "../server/index.ts";

const tokens = new Map<string, string>();

export async function pageToken(base: string): Promise<string> {
  const cached = tokens.get(base);
  if (cached) return cached;
  const html = await (await fetch(base + "/")).text();
  const m = html.match(/<meta name="intent-csrf" content="([0-9a-f]{64})"/);
  if (!m) throw new Error("index.html carries no mutation token");
  tokens.set(base, m[1]!);
  return m[1]!;
}

export async function call(base: string, method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const init: RequestInit =
    method === "GET"
      ? { method }
      : {
          method,
          headers: { "content-type": "application/json", origin: base, [CSRF_HEADER]: await pageToken(base) },
          body: JSON.stringify(body ?? {}),
        };
  const res = await fetch(base + p, init);
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
