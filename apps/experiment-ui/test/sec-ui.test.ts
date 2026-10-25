/** SECURITY-R1 / S3 gates — local UI mutation authority (SEC-5 / SEC-6). */
import { request, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createExperimentServer, CSRF_HEADER } from "../server/index.ts";
import { experimentPaths } from "../server/state.ts";
import { call, pageToken } from "./client.ts";

const draftBody = {
  repoPath: "/nonexistent/repo",
  base_commit_sha: "0".repeat(40),
  payer_identity: "payer@example",
  worker_identity: "worker@example",
  tier1_reward: "1",
  regression_command: "npm test",
  baseline_health_command: "npm test",
  patched_acceptance_command: "npm test",
  allowed_paths: ["src/**"],
  forbidden_paths: ["test/**"],
  acceptance_suite: "test/a.test.ts",
  acceptance_full_suite: ["test/a.test.ts"],
};

let exp = "";
let port = 0;
let base = "";
let server: Server;
const servers: Server[] = [];

async function start(dir: string): Promise<{ server: Server; port: number }> {
  const s = createExperimentServer(dir);
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  servers.push(s);
  const addr = s.address();
  if (!addr || typeof addr !== "object") throw new Error("no port");
  return { server: s, port: addr.port };
}

/** Raw request — lets a test forge Host / Origin exactly as an attacker's browser or rebinding DNS would. */
function raw(opts: { method: string; path: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: opts.method, path: opts.path, headers: opts.headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

beforeAll(async () => {
  exp = mkdtempSync(path.join(tmpdir(), "sec-ui-exp-"));
  ({ server, port } = await start(exp));
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  for (const s of servers) s.close();
  rmSync(exp, { recursive: true, force: true });
});

const draftPath = () => experimentPaths(exp).draft;
const host = () => `127.0.0.1:${port}`;

describe("[SEC-5] cross-origin mutation is DENIED", () => {
  test("[SEC-5a] classic CSRF form post (text/plain JSON, foreign Origin, no token) → 403, nothing written", async () => {
    const r = await raw({ method: "POST", path: "/api/prepare", headers: { host: host(), origin: "https://evil.example", "content-type": "text/plain" }, body: JSON.stringify(draftBody) });
    expect(r.status).toBe(403);
    expect(existsSync(draftPath())).toBe(false);
  });

  test("[SEC-5b] foreign Origin is refused even with a valid token and JSON", async () => {
    const r = await raw({ method: "POST", path: "/api/prepare", headers: { host: host(), origin: "https://evil.example", "content-type": "application/json", [CSRF_HEADER]: await pageToken(base) }, body: JSON.stringify(draftBody) });
    expect(r.status).toBe(403);
    expect(existsSync(draftPath())).toBe(false);
  });

  test("[SEC-5c] missing Origin is refused", async () => {
    const r = await raw({ method: "POST", path: "/api/prepare", headers: { host: host(), "content-type": "application/json", [CSRF_HEADER]: await pageToken(base) }, body: JSON.stringify(draftBody) });
    expect(r.status).toBe(403);
  });

  test("[SEC-5d] own Origin without the token, or with a wrong token, is refused", async () => {
    const headers = { host: host(), origin: base, "content-type": "application/json" };
    expect((await raw({ method: "POST", path: "/api/prepare", headers, body: JSON.stringify(draftBody) })).status).toBe(403);
    expect((await raw({ method: "POST", path: "/api/prepare", headers: { ...headers, [CSRF_HEADER]: "f".repeat(64) }, body: JSON.stringify(draftBody) })).status).toBe(403);
    expect(existsSync(draftPath())).toBe(false);
  });

  test("[SEC-5e] own Origin + token but non-JSON content-type → 415", async () => {
    const r = await raw({ method: "POST", path: "/api/prepare", headers: { host: host(), origin: base, "content-type": "text/plain", [CSRF_HEADER]: await pageToken(base) }, body: JSON.stringify(draftBody) });
    expect(r.status).toBe(415);
    expect(existsSync(draftPath())).toBe(false);
  });

  test("[SEC-5f] DNS rebinding: a foreign Host cannot read the page token or state", async () => {
    const token = await pageToken(base);
    for (const p of ["/", "/api/state", "/web/app.js"]) {
      const r = await raw({ method: "GET", path: p, headers: { host: `evil.example:${port}` } });
      expect(r.status, p).toBe(403);
      expect(r.body).not.toContain(token);
    }
  });

  test("[SEC-5g] the token is per process — another server's token is refused", async () => {
    const other = mkdtempSync(path.join(tmpdir(), "sec-ui-other-"));
    try {
      const b = await start(other);
      const otherToken = await pageToken(`http://127.0.0.1:${b.port}`);
      expect(otherToken).not.toBe(await pageToken(base));
      const r = await raw({ method: "POST", path: "/api/prepare", headers: { host: host(), origin: base, "content-type": "application/json", [CSRF_HEADER]: otherToken }, body: JSON.stringify(draftBody) });
      expect(r.status).toBe(403);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("[SEC-5h] static files never resolve outside web/", async () => {
    const r = await raw({ method: "GET", path: "/web/../server/index.ts", headers: { host: host() } });
    expect(r.status).toBe(404);
    expect(r.body).not.toContain("createExperimentServer");
  });
});

describe("[SEC-6] the legitimate page flow PASSES", () => {
  test("[SEC-6a] index.html carries a fresh 64-hex token and is not cacheable", async () => {
    const res = await fetch(base + "/");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toMatch(/<meta name="intent-csrf" content="[0-9a-f]{64}"/);
  });

  test("[SEC-6b] malformed JSON from the page → 400 (not 500)", async () => {
    const r = await raw({ method: "POST", path: "/api/prepare", headers: { host: host(), origin: base, "content-type": "application/json", [CSRF_HEADER]: await pageToken(base) }, body: "{not json" });
    expect(r.status).toBe(400);
    expect(existsSync(draftPath())).toBe(false);
  });

  test("[SEC-6c] page Origin + token + JSON → the mutation lands (localhost name accepted too)", async () => {
    const r = await call(base, "POST", "/api/prepare", draftBody);
    expect(r.status).toBe(200);
    expect(existsSync(draftPath())).toBe(true);
    const viaLocalhost = await raw({ method: "POST", path: "/api/prepare", headers: { host: `localhost:${port}`, origin: `http://localhost:${port}`, "content-type": "application/json", [CSRF_HEADER]: await pageToken(base) }, body: JSON.stringify(draftBody) });
    expect(viaLocalhost.status).toBe(200);
  });
});
