import { describe, expect, test } from "vitest";
import { deepShuffleKeys, permutations, validIntent, withKeyOrder } from "../src/lib/fixtures.js";
import { sut, sealWith, contentHashOf } from "../src/sut.js";

const { canonicalize } = sut.canonical;
const { IntentContractSchema } = sut.objects;

const sealIntent = (x: unknown) => sealWith(IntentContractSchema, x);
const contentHash = contentHashOf;

/** AREA 3 — Property-order mutation must not change meaning or hash. */
describe("[C-03] property-order mutation", () => {
  test("[C-03-01] all 24 insertion orders of a 4-key object yield identical canonical text", () => {
    const keys = ["alpha", "beta", "gamma", "delta"];
    const base = { alpha: 1, beta: 2, gamma: 3, delta: 4 };
    const expected = canonicalize(base);
    for (const order of permutations(keys)) {
      expect(canonicalize(withKeyOrder(base, order))).toBe(expected);
    }
  });

  test("[C-03-02] deep key-order shuffles of a full Intent yield identical content_hash", () => {
    const intent = validIntent();
    const h0 = contentHash(sealIntent(intent));
    for (let mask = 0; mask < 8; mask++) {
      const shuffled = deepShuffleKeys(intent, (depth, i) => ((depth + i + mask) % 2) === 0) as Record<string, unknown>;
      expect(contentHash(sealIntent(shuffled)), `mask=${mask}`).toBe(h0);
    }
  });

  test("[C-03-03] raw JSON text with reordered keys yields identical canonical text", () => {
    const textA = `{"goal": {"statement": "s", "target_state": "t", "domain": "d"}, "schema_version": "x", "version": 1}`;
    const textB = `{"version": 1, "schema_version": "x", "goal": {"domain": "d", "target_state": "t", "statement": "s"}}`;
    expect(canonicalize(JSON.parse(textA))).toBe(canonicalize(JSON.parse(textB)));
  });

  test("[C-03-04] integer-like keys sort as strings (UTF-16), not numerically", () => {
    expect(canonicalize({ "10": "b", "2": "a" })).toBe("{\"10\":\"b\",\"2\":\"a\"}");
  });

  test("[C-03-05] guard: reordering an ARRAY (success_criteria) must change the hash", () => {
    const i1 = sealIntent(validIntent());
    const criteria = JSON.parse(JSON.stringify(i1.success_criteria)).reverse();
    const i2 = sealIntent(validIntent({ success_criteria: criteria }));
    expect(contentHash(i2)).not.toBe(contentHash(i1));
  });

  test("[C-03-06] schema parse result is order-insensitive (zod object key order irrelevant)", () => {
    const intent = validIntent();
    const flipped = withKeyOrder(intent, [...Object.keys(intent)].reverse());
    expect(IntentContractSchema.parse(flipped)).toEqual(IntentContractSchema.parse(intent));
  });
});
