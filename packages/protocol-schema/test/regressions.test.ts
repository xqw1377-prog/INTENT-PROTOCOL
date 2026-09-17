/**
 * Regression tests for defects found by the independent conformance harness
 * (Builder B, packages/conformance-harness) against the S0 baseline snapshot.
 * Every schema-valid object must be sealable; every hashable value must be canonicalizable.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IntentContractSchema, SettlementInstructionSchema, canonicalize, u64be,
} from "../src/index.js";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const GOLDEN = JSON.parse(readFileSync(join(PKG, "fixtures/golden-vectors.json"), "utf8"));
const validIntent = GOLDEN.valid.find((v: any) => v.schema_version === "intent.v1").input;
const validSettlement = GOLDEN.valid.find((v: any) => v.schema_version === "settlement.v1").input;

describe("schema admits only sealable values", () => {
  test("unsafe integer in criterion.threshold rejected at parse (C-10-03)", () => {
    const bad = JSON.parse(JSON.stringify(validIntent));
    bad.success_criteria[0].threshold = 2 ** 53;
    expect(() => IntentContractSchema.parse(bad)).toThrow();
    bad.success_criteria[0].threshold = 2 ** 53 - 1; // safe integer boundary
    expect(() => IntentContractSchema.parse(bad)).not.toThrow();
  });

  test("calendar-invalid timestamps rejected (C-13-05)", () => {
    for (const ts of ["2026-13-01T00:00:00.000Z", "2026-09-45T00:00:00.000Z", "2026-09-17T99:99:99.999Z", "2026-02-30T00:00:00.000Z"]) {
      expect(() => IntentContractSchema.parse({ ...validIntent, created_at: ts }), ts).toThrow();
    }
    expect(() => IntentContractSchema.parse({ ...validIntent, created_at: "2026-02-28T00:00:00.000Z" })).not.toThrow();
  });

  test("u64 nonce range-checked: 2^64-1 ok, 2^64 rejected (C-13-07b)", () => {
    expect(() => SettlementInstructionSchema.parse({ ...validSettlement, nonce: "18446744073709551615" })).not.toThrow();
    expect(() => u64be("18446744073709551615" as any)).not.toThrow();
    expect(() => SettlementInstructionSchema.parse({ ...validSettlement, nonce: "18446744073709551616" })).toThrow();
  });

  test("-0 rejected by canonicalizer (C-01-07)", () => {
    expect(() => canonicalize({ n: -0 })).toThrow(/-0/);
  });
});
