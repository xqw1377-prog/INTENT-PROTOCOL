#!/usr/bin/env node
/**
 * Freeze the System Under Test.
 *
 * Builder A edits packages/protocol-schema/src live while this harness runs
 * (observed: objects.ts/states.ts/index.ts/primitives.ts all changed DURING
 * the first verification pass). A conformance verdict is only meaningful
 * against a frozen input set, so the harness attacks a verbatim copy stored
 * in sut-snapshot/, and every report pins the captured file digests.
 *
 * Re-run this script to re-verify against a newer Builder A state; the
 * previous snapshot is replaced and capture.json records the new digests.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../../protocol-schema/src");
const destDir = path.resolve(here, "../sut-snapshot/protocol-schema-src");

mkdirSync(destDir, { recursive: true });
const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
const digests = [];
for (const f of files) {
  copyFileSync(path.join(srcDir, f), path.join(destDir, f));
  const buf = readFileSync(path.join(srcDir, f));
  digests.push({ file: `packages/protocol-schema/src/${f}`, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length });
}

let head = "unknown";
try {
  head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(here, "../.."), encoding: "utf8" }).trim();
} catch { /* git not available */ }

const zodVersion = JSON.parse(readFileSync(path.resolve(here, "../../../node_modules/zod/package.json"), "utf8")).version;

const capture = {
  captured_at: new Date().toISOString(),
  source_git_head: head,
  source_dir: "packages/protocol-schema/src",
  zod_version: zodVersion,
  files: digests,
  note: "Verbatim copy of Builder A's protocol-schema source at capture time. The harness imports ONLY this snapshot; the live tree is never loaded by tests.",
};
writeFileSync(path.resolve(here, "../sut-snapshot/capture.json"), JSON.stringify(capture, null, 2) + "\n");
console.log(`captured ${files.length} files at ${capture.captured_at} (git ${head.slice(0, 8)})`);
