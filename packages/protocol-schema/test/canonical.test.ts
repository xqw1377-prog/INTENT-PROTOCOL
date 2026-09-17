import { describe, expect, test } from "vitest";
import { canonicalize, CanonicalizationError } from "../src/index.js";

describe("canonical JSON rules", () => {
  test("object keys sorted by UTF-16 code unit order", () => {
    expect(canonicalize({ b: 1, a: 2, A: 3 })).toBe('{"A":3,"a":2,"b":1}');
    expect(canonicalize({ "\u00e4": 1, z: 2 })).toBe('{"z":2,"\u00e4":1}');
  });

  test("deep nesting and arrays preserve order", () => {
    expect(canonicalize({ x: [{ y: [3, 2, 1] }] })).toBe('{"x":[{"y":[3,2,1]}]}');
  });

  test("undefined values are omitted; explicit null is preserved and distinct", () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalize({ b: null })).not.toBe(canonicalize({}));
  });

  test("strings are NFC-normalized", () => {
    expect(canonicalize("café")).toBe(canonicalize("café"));
    expect(canonicalize("café")).toBe(canonicalize("caf\u00e9"));
  });

  test("surrogate pairs pass through unchanged", () => {
    expect(canonicalize("x😀y")).toBe('"x😀y"');
  });

  test("keys are NOT normalized: NFC/NFD spellings stay distinct", () => {
    const obj: Record<string, number> = {};
    obj["\u00e9"] = 1; // NFC key
    obj["e\u0301"] = 2; // NFD key — distinct own property
    const out = canonicalize(obj);
    expect(Object.keys(JSON.parse(out)).length).toBe(2);
    // Values still normalize: same text either spelling → same canonical bytes
    expect(canonicalize({ k: "café" })).toBe(canonicalize({ k: "café" }));
  });

  test("numbers must be safe integers; -0 is rejected (0/-0 ambiguity)", () => {
    expect(() => canonicalize(-0)).toThrow(CanonicalizationError);
    expect(() => canonicalize(1.5)).toThrow(CanonicalizationError);
    expect(() => canonicalize(NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Infinity)).toThrow(CanonicalizationError);
    expect(() => canonicalize(2 ** 53)).toThrow(CanonicalizationError);
    expect(canonicalize(2 ** 53 - 1)).toBe(String(2 ** 53 - 1));
  });

  test("bigints and non-plain objects are rejected", () => {
    expect(() => canonicalize(1n)).toThrow(CanonicalizationError);
    expect(() => canonicalize(new Date())).toThrow(CanonicalizationError);
    expect(() => canonicalize(new Map())).toThrow(CanonicalizationError);
  });

  test("no whitespace in output", () => {
    expect(canonicalize({ a: { b: [1, { c: null }] } })).toBe('{"a":{"b":[1,{"c":null}]}}');
  });
});
