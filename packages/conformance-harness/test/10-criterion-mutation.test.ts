import { describe, expect, test } from "vitest";
import { refHashObject } from "../src/reference/hash.js";
import { validIntent } from "../src/lib/fixtures.js";
import { sut, sealWith, contentHashOf } from "../src/sut.js";

const { IntentContractSchema } = sut.objects;

const sealIntent = (x: unknown) => sealWith(IntentContractSchema, x);
const contentHash = contentHashOf;

/** AREA 10 — Criterion mutation must be hash-visible and stale seals must fail. */
describe("[C-10] criterion mutation", () => {
  const sealed = sealIntent(validIntent());
  const H0 = contentHash(sealed);
  const criteria = () => JSON.parse(JSON.stringify(sealed.success_criteria)) as Array<Record<string, unknown>>;

  test("[C-10-00] control: baseline hash agrees with the independent reference", () => {
    const { content_hash: _c, signature: _s, ...payload } = sealed as Record<string, unknown>;
    void _c; void _s;
    expect(H0).toBe(refHashObject("intent-protocol/v1/intent", "intent.v1", payload));
  });

  test("[C-10-01] mutating a criterion assertion changes the hash; stale declared content_hash is rejected by seal()", () => {
    const mutated = [...criteria()];
    mutated[0] = { ...mutated[0]!, assertion: "All suites run — trust me." };
    const mutatedIntent = validIntent({ success_criteria: mutated });
    const h1 = contentHash(sealIntent(mutatedIntent));
    expect(h1).not.toBe(H0);
    expect(() => sealIntent({ ...mutatedIntent, content_hash: H0 })).toThrow(/content_hash mismatch/);
  });

  test("[C-10-02] mutating threshold value changes the hash; number vs string threshold are distinct", () => {
    const t1 = [...criteria()]; t1[0] = { ...t1[0]!, threshold: { suites: 17, must_pass: true } };
    const t2 = [...criteria()]; t2[0] = { ...t2[0]!, threshold: { suites: "17", must_pass: true } };
    expect(contentHash(sealIntent(validIntent({ success_criteria: t1 })))).not.toBe(H0);
    expect(contentHash(sealIntent(validIntent({ success_criteria: t1 }))))
      .not.toBe(contentHash(sealIntent(validIntent({ success_criteria: t2 }))));
  });

  test("[C-10-03] FAIL: schema admits thresholds that canonicalization rejects (2^53 is integer but not safe) — schema-valid object cannot be sealed", () => {
    // z.number().int() accepts 2^53; the frozen canonical rule 4 rejects
    // non-safe integers. Protocol requirement under test: every schema-valid
    // object must be sealable. The SUT accepts the parse and then blows up at
    // hashing time, splitting validation from canonicalization.
    const t = [...criteria()];
    t[0] = { ...t[0]!, threshold: 9007199254740992 };
    const parsed = IntentContractSchema.parse(validIntent({ success_criteria: t })); // accepted by schema
    expect(() => sealIntent(parsed)).not.toThrow(); // required: sealable — actually throws
  });

  test("[C-10-04] reordering criteria changes the hash (array order is semantic)", () => {
    const reordered = [...criteria()].reverse();
    expect(contentHash(sealIntent(validIntent({ success_criteria: reordered })))).not.toBe(H0);
  });

  test("[C-10-05] removing or adding a criterion changes the hash", () => {
    expect(contentHash(sealIntent(validIntent({ success_criteria: criteria().slice(0, 1) })))).not.toBe(H0);
    const extra = [...criteria(), { ...criteria()[0]!, criterion_id: "crit-extra" }];
    expect(contentHash(sealIntent(validIntent({ success_criteria: extra })))).not.toBe(H0);
  });

  test("[C-10-06] criterion evidence_requirements mutation (required true->false) changes the hash", () => {
    const mutated = criteria();
    (mutated[0]!.evidence_requirements as Array<Record<string, unknown>>)[0]!.required = false;
    expect(contentHash(sealIntent(validIntent({ success_criteria: mutated })))).not.toBe(H0);
  });

  test("[C-10-07] mutating criterion kind MACHINE->HUMAN changes the hash", () => {
    const mutated = criteria();
    mutated[0] = { ...mutated[0]!, kind: "HUMAN" };
    expect(contentHash(sealIntent(validIntent({ success_criteria: mutated })))).not.toBe(H0);
  });

  test.todo("[C-10-08][GAP] Milestone acceptance-criteria immutability (Milestone object documented in arch doc §6 but NOT delivered in the S0 snapshot)");
});
