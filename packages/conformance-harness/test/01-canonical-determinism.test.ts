import { describe, expect, test } from "vitest";
import { refCanonicalize } from "../src/reference/canonical.js";
import { sut } from "../src/sut.js";
import canonicalVectors from "../vectors/canonical-vectors.json";

const canonicalize = sut.canonical.canonicalize;

/** AREA 1 — Canonical serialization determinism. */
describe("[C-01] canonical serialization determinism", () => {
  test("[C-01-01] repeated serialization of the same value is byte-identical (100x)", () => {
    const v = canonicalVectors.vectors[12]!.input; // nested NFD/NFC case
    const first = canonicalize(v);
    for (let i = 0; i < 100; i++) expect(canonicalize(v)).toBe(first);
  });

  test("[C-01-02] independent fresh instances (JSON round-trip) serialize identically", () => {
    for (const { input } of canonicalVectors.vectors) {
      const a = canonicalize(JSON.parse(JSON.stringify(input)));
      const b = canonicalize(JSON.parse(JSON.stringify(input)));
      expect(a).toBe(b);
    }
  });

  test("[C-01-03] SUT agrees with independent reference on every canonical vector", () => {
    for (const { id, input, expected } of canonicalVectors.vectors) {
      expect(refCanonicalize(input), `reference self-check failed on ${id}`).toBe(expected);
      expect(canonicalize(input), `SUT/reference disagreement on ${id}`).toBe(expected);
    }
  });

  test("[C-01-04] canonical form is round-trip idempotent (parse(serialize(x)) reserializes to itself)", () => {
    for (const { id, input } of canonicalVectors.vectors) {
      const c1 = canonicalize(input);
      const c2 = canonicalize(JSON.parse(c1));
      expect(c2, `not idempotent on ${id}`).toBe(c1);
    }
  });

  test("[C-01-05] arrays preserve order (never sorted)", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([3, 1, 2])).not.toBe(canonicalize([1, 2, 3]));
  });

  test("[C-01-06] floats / NaN / Infinity / beyond-safe integers are rejected", () => {
    for (const bad of [1.5, -1.5, NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 53), 1e308]) {
      expect(() => canonicalize({ n: bad }), `expected rejection of ${bad}`).toThrow();
      expect(() => refCanonicalize({ n: bad }), `reference must also reject ${bad}`).toThrow();
    }
  });

  test("[C-01-07] FAIL: spec rule 4 says -0 is rejected; the SUT accepts it and silently maps it to 0 (0/-0 hash ambiguity)", () => {
    // Frozen rule in the SUT's own spec header (canonical.ts rule 4): floats,
    // NaN, Infinity AND -0 are rejected. The reference implements the rule;
    // the SUT returns "{\"n\":0}" for -0 instead of throwing.
    expect(() => refCanonicalize({ n: -0 })).toThrow();
    expect(() => canonicalize({ n: -0 })).toThrow();
  });

  test("[C-01-08] undefined values: omitted in objects, rejected in arrays", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe("{\"b\":1}");
    expect(() => canonicalize([undefined])).toThrow();
    expect(() => canonicalize([1, undefined, 2])).toThrow();
  });

  test("[C-01-09] non-plain objects (Date/Map/Set/TypedArray/bigint/symbol) rejected", () => {
    expect(() => canonicalize({ d: new Date(0) })).toThrow();
    expect(() => canonicalize({ m: new Map() })).toThrow();
    expect(() => canonicalize({ s: new Set() })).toThrow();
    expect(() => canonicalize({ b: new Uint8Array(1) })).toThrow();
    expect(() => canonicalize({ n: 1n })).toThrow();
    expect(() => canonicalize({ s: Symbol("x") })).toThrow();
  });

  test("[C-01-10] lone surrogates are escaped (JSON.stringify semantics) and agree with reference", () => {
    const withLone = { k: "a\uD800b" }; // unpaired high surrogate
    expect(canonicalize(withLone)).toBe(refCanonicalize(withLone));
    expect(JSON.parse(canonicalize(withLone)).k).toBe("a\uD800b");
  });
});
