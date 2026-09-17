import { describe, expect, test } from "vitest";
import { validIntent } from "../src/lib/fixtures.js";
import { sut } from "../src/sut.js";

const { canonicalize } = sut.canonical;
const { hashObject, Domain } = sut.hash;
const { IntentContractSchema } = sut.objects;

const h = (v: unknown) => hashObject(Domain.Intent, "intent.v1", v);

/** AREA 6 — missing vs null: never conflable, in canonical form or in schema. */
describe("[C-06] missing vs null", () => {
  test("[C-06-01] canonical: null is preserved, undefined is omitted, and the two differ in hash", () => {
    expect(canonicalize({ a: null })).toBe("{\"a\":null}");
    expect(canonicalize({ a: undefined })).toBe("{}");
    expect(canonicalize({})).toBe("{}");
    expect(h({ a: null })).not.toBe(h({}));
    expect(h({ a: undefined })).toBe(h({}));
  });

  test("[C-06-02] canonical: null in arrays is preserved, undefined in arrays is rejected", () => {
    expect(canonicalize([null, 1])).toBe("[null,1]");
    expect(() => canonicalize([undefined])).toThrow();
    expect(() => canonicalize([1, undefined])).toThrow();
  });

  test("[C-06-03] schema: optional fields accept absence but reject explicit null", () => {
    expect(() => IntentContractSchema.parse(validIntent())).not.toThrow();
    for (const field of ["deadline", "parent_hash", "change_reason", "content_hash", "signature"]) {
      expect(() => IntentContractSchema.parse(validIntent({ [field]: null })), `deadline-style optional field ${field}=null`).toThrow();
    }
  });

  test("[C-06-04] schema: required fields reject null and absence", () => {
    for (const field of ["schema_version", "intent_id", "version", "owner_subject", "goal", "success_criteria", "budget", "created_at"]) {
      expect(() => IntentContractSchema.parse(validIntent({ [field]: null })), `required field ${field}=null`).toThrow();
      const absent = validIntent();
      delete (absent as Record<string, unknown>)[field];
      expect(() => IntentContractSchema.parse(absent), `required field ${field} missing`).toThrow();
    }
  });

  test("[C-06-05] nested: budget.total=null and criteria[0]=null are rejected", () => {
    expect(() => IntentContractSchema.parse(validIntent({ budget: { asset: { network: "sim:local", asset: "USD", decimals: 2 }, total: null, execution_cap: "1.00" } }))).toThrow();
    expect(() => IntentContractSchema.parse(validIntent({ success_criteria: [null] }))).toThrow();
    expect(() => IntentContractSchema.parse(validIntent({ goal: { statement: null, target_state: "t", domain: "d" } }))).toThrow();
  });
});
