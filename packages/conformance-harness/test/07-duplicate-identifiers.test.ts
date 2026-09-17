import { describe, expect, test } from "vitest";
import { ARTIFACT_HASHES, validBundle, validIntent } from "../src/lib/fixtures.js";
import { sut, sealWith, contentHashOf } from "../src/sut.js";

const { IntentContractSchema, EvidenceBundleSchema } = sut.objects;
const { merkleRoot } = sut.merkle;

/**
 * AREA 7 — Duplicate identifiers.
 *
 * The written schema states no uniqueness constraint on criterion_id /
 * constraint_id, so "schema accepts same-id different-content" is a documented
 * GAP (title tag): two same-id criteria are mutually ambiguous for any
 * verifier resolving criteria by id. NEVER counted as PASS.
 */
describe("[C-07] duplicate identifiers", () => {
  test("[C-07-01][GAP] schema accepts duplicate criterion_id with different content (no uniqueness constraint)", () => {
    const intent = validIntent() as { success_criteria: Array<Record<string, unknown>> };
    const dup = { ...intent.success_criteria[0]!, assertion: "MUTATED but same criterion_id" };
    const parsed = IntentContractSchema.parse(validIntent({ success_criteria: [...intent.success_criteria, dup] }));
    expect(parsed.success_criteria.filter((c) => c.criterion_id === "crit-tests").length).toBe(2);
  });

  test("[C-07-02][GAP] schema accepts duplicate constraint_id with different content", () => {
    const intent = validIntent() as { constraints: Array<Record<string, unknown>> };
    expect(() =>
      IntentContractSchema.parse(validIntent({ constraints: [...intent.constraints, { ...intent.constraints[0]!, statement: "different statement, same constraint_id" }] })),
    ).not.toThrow();
  });

  test("[C-07-03] SEALED bundle rejects duplicate artifact hashes (delivered superRefine)", () => {
    expect(() =>
      EvidenceBundleSchema.parse(validBundle({
        artifact_hashes: [ARTIFACT_HASHES.a1, ARTIFACT_HASHES.a1],
        merkle_root: "sha256:" + "ab".repeat(32),
        sealed_at: "2026-09-17T01:00:00.000Z",
      })),
    ).toThrow(/duplicate artifact_hash/);
  });

  test("[C-07-04][GAP] OPEN bundle still accepts duplicate artifact hashes and duplicate run_ids (guard only covers SEALED)", () => {
    expect(() =>
      EvidenceBundleSchema.parse(validBundle({
        state: "OPEN",
        artifact_hashes: [ARTIFACT_HASHES.a1, ARTIFACT_HASHES.a1],
        run_ids: ["44444444-4444-4444-8444-444444444444", "44444444-4444-4444-8444-444444444444"],
      })),
    ).not.toThrow();
  });

  test("[C-07-05] merkle root de-duplicates by design: [X] and [X,X] share one root (set semantics)", () => {
    expect(merkleRoot([ARTIFACT_HASHES.a1])).toBe(merkleRoot([ARTIFACT_HASHES.a1, ARTIFACT_HASHES.a1]));
  });

  test("[C-07-06] duplicate ids do NOT hide mutation: same-id different-content criteria change the intent hash", () => {
    const base = sealWith(IntentContractSchema, validIntent());
    const criteria = JSON.parse(JSON.stringify(base.success_criteria));
    criteria[0] = { ...criteria[0], assertion: "tampered" };
    const mutated = sealWith(IntentContractSchema, validIntent({ success_criteria: criteria }));
    expect(contentHashOf(mutated)).not.toBe(contentHashOf(base));
  });

  test("[C-07-07][GAP] duplicate keys in raw JSON text collapse last-wins BEFORE canonicalization (JS parse semantics)", () => {
    const textA = '{"a":1,"a":2}';
    const textB = '{"a":2}';
    const { canonicalize } = sut.canonical;
    expect(canonicalize(JSON.parse(textA))).toBe(canonicalize(JSON.parse(textB)));
  });
});
