import { describe, expect, test } from "vitest";
import { refCanonicalize } from "../src/reference/canonical.js";
import { sut } from "../src/sut.js";

const { canonicalize } = sut.canonical;
const { hashObject, Domain } = sut.hash;

const h = (v: unknown) => hashObject(Domain.Intent, "intent.v1", v);

/** AREA 5 — Unicode normalization edge cases (NFC choice, UTF-16 ordering, surrogates). */
describe("[C-05] unicode normalization", () => {
  test("[C-05-01] value-level NFC/NFD equivalence: canonically equivalent strings hash identically", () => {
    const valuePairs: Array<[string, string]> = [
      ["\u00e9", "e\u0301"],            // é composed vs e + combining acute
      ["\uac00", "\u1100\u1161"],       // Hangul GA composed vs decomposed jamo
      ["\u212b", "A\u030a"],            // Angstrom sign composes from A + ring
      ["\u00e9", "\u00e9"],             // identity control
    ];
    for (const [nfc, nfd] of valuePairs) {
      expect(canonicalize({ s: nfd }), `nfd ${JSON.stringify(nfd)}`).toBe(canonicalize({ s: nfc }));
      expect(h({ s: nfd })).toBe(h({ s: nfc }));
    }
  });


  test("[C-05-03] only NFC (not NFKC/NFKD) is applied: compatibility-distinct forms stay distinct", () => {
    const compatPairs: Array<[string, string]> = [
      ["\uFF21", "A"],   // fullwidth A
      ["\u2163", "IV"],  // roman numeral IV
      ["\u33A1", "m2"],  // squared m²
    ];
    for (const [x, y] of compatPairs) {
      expect(canonicalize({ s: x })).not.toBe(canonicalize({ s: y }));
      expect(h({ s: x })).not.toBe(h({ s: y }));
    }
  });

  test("[C-05-04] key sorting is UTF-16 code-unit order, not code-point order", () => {
    const astralFirst: Record<string, number> = { "\uFFFF": 1, "\uD800\uDC00": 0 };
    expect(canonicalize(astralFirst)).toBe("{\"𐀀\":0,\"￿\":1}");
    expect(canonicalize(astralFirst)).toBe(refCanonicalize(astralFirst));
    const astralFirst2: Record<string, number> = { "\uE000": 1, "\uD840\uDC00": 0 };
    expect(canonicalize(astralFirst2)).toBe(refCanonicalize(astralFirst2));
  });

  test("[C-05-05] an object holding BOTH the NFC and NFD spelling of one key must not produce ambiguous canonical JSON", () => {
    // If two raw keys collapse onto the same normalized key, canonical output
    // contains duplicate keys — not a valid, unambiguous canonical form. The
    // reference rejects this; the SUT emits `{"é":…,"é":…}` (duplicate keys).
    const obj: Record<string, number> = {};
    obj["\u00e9"] = 1;   // NFC key
    obj["e\u0301"] = 2;  // NFD key, distinct own property
    const out = canonicalize(obj);
    const reparsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.keys(reparsed).length, `canonical text has duplicate keys: ${out}`).toBe(2);
  });


  test("[C-05-07] U+2028/U+2029 are emitted raw — valid JSON, agrees with reference; recorded as cross-language hazard", () => {
    const v = { s: "a\u2028b\u2029c" };
    expect(canonicalize(v)).toBe(refCanonicalize(v));
    expect(canonicalize(v).includes("\u2028")).toBe(true);
    expect(JSON.parse(canonicalize(v)).s).toBe("a\u2028b\u2029c");
  });

  test("[C-05-08] normalization happens at canonicalization, not before: NFD input value canonicalizes to the NFC form", () => {
    const goalNfd = { statement: "goal with é inside", target_state: "t", domain: "d" };
    const goalNfc = { statement: "goal with é inside", target_state: "t", domain: "d" };
    expect(canonicalize({ g: goalNfd })).toBe(canonicalize({ g: goalNfc }));
  });
});
