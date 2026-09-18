/**
 * Single choke point for loading the System Under Test.
 *
 * The SUT is a FROZEN SNAPSHOT of Builder A's packages/protocol-schema/src,
 * captured by scripts/capture-sut.mjs (see capture.json for digests, git head
 * and capture time). Tests never import the live tree: Builder A edited the
 * source concurrently during the first verification pass, and a conformance
 * verdict must be reproducible against a fixed input.
 *
 * NOTHING in this harness may import SUT internals except through this file,
 * and NOTHING in src/reference/ may import the SUT at all.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as canonical from "../sut-snapshot/protocol-schema-src/canonical.js";
import * as hash from "../sut-snapshot/protocol-schema-src/hash.js";
import * as merkle from "../sut-snapshot/protocol-schema-src/merkle.js";
import * as objects from "../sut-snapshot/protocol-schema-src/objects.js";
import * as primitives from "../sut-snapshot/protocol-schema-src/primitives.js";
import * as states from "../sut-snapshot/protocol-schema-src/states.js";

export const sut = { canonical, hash, merkle, objects, primitives, states };
export { canonical, hash, merkle, objects, primitives, states };

/**
 * SUT QUALITY NOTE (recorded in the report): the SUT's generic seal()/
 * contentHash() constrain `content_hash` to the branded `Hash` template
 * literal type, but z.infer of HashSchema yields plain `string`, so the SUT's
 * own schemas are not statically assignable to its own seal(). Runtime
 * behavior is unaffected; these wrappers confine the necessary cast to one
 * documented place.
 */
export function sealWith(schema: unknown, input: unknown): Record<string, unknown> & { content_hash: string } {
  return objects.seal(schema as never, input) as Record<string, unknown> & { content_hash: string };
}
export function contentHashOf(o: unknown): string {
  return objects.contentHash(o as never) as string;
}

const SNAP_DIR = path.resolve(import.meta.dirname, "../sut-snapshot/protocol-schema-src");

/** sha256 of every SUT snapshot file, embedded in the report to pin the exact implementation under test. */
export function sutFileDigests(): Array<{ file: string; sha256: string; bytes: number }> {
  const names = ["canonical.ts", "hash.ts", "merkle.ts", "objects.ts", "primitives.ts", "states.ts", "index.ts"];
  return names.map((n) => {
    const buf = readFileSync(path.join(SNAP_DIR, n));
    return { file: `sut-snapshot/protocol-schema-src/${n}`, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
  });
}
