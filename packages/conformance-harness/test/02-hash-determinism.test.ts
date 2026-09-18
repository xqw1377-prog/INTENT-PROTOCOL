import { describe, expect, test } from "vitest";
import { refHashObject, refProofBinding, refSettlementKey, refU32be, refU64be } from "../src/reference/hash.js";
import { sut } from "../src/sut.js";
import hashVectors from "../vectors/hash-vectors.json";
import { fakeHash } from "../src/lib/fixtures.js";

const { hashObject, Domain, HASH_RE, proofBinding, settlementKey, hashInput, u32be, u64be, fromHash, toHash, isHash } = sut.hash;

/** AREA 2 — Hash determinism and domain separation. */
describe("[C-02] hash determinism", () => {
  test("[C-02-01] hashObject is deterministic across repetitions (50x per vector cell)", () => {
    const payload = hashVectors.payloads[2]!.value;
    const first = hashObject(Domain.Intent, "intent.v1", payload);
    for (let i = 0; i < 50; i++) expect(hashObject(Domain.Intent, "intent.v1", payload)).toBe(first);
  });

  test("[C-02-02] SUT hashObject agrees with independent reference on every (domain, version, payload) cell", () => {
    for (const domain of hashVectors.domains) {
      for (const version of hashVectors.versions) {
        for (const { id, value } of hashVectors.payloads) {
          const expected = refHashObject(domain, version, value);
          expect(hashObject(domain as (typeof Domain)[keyof typeof Domain], version, value), `${domain}|${version}|${id}`).toBe(expected);
        }
      }
    }
  });

  test("[C-02-03] domain separation: same payload+version under different domains yields different hashes", () => {
    const p = { a: 1 };
    const hashes = hashVectors.domains.map((d) => hashObject(d as (typeof Domain)[keyof typeof Domain], "intent.v1", p));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  test("[C-02-04] version separation: same payload+domain under different versions yields different hashes", () => {
    const p = { a: 1 };
    const hashes = hashVectors.versions.map((v) => hashObject(Domain.Intent, v, p));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  test("[C-02-05] hash format: sha256: + 64 lowercase hex; roundtrip fromHash/toHash; malformed rejected", () => {
    const h = hashObject(Domain.Intent, "intent.v1", { a: 1 });
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(HASH_RE.test(h)).toBe(true);
    expect(HASH_RE.test("sha256:" + h.slice(7).toUpperCase())).toBe(false);
    expect(HASH_RE.test(h.slice(0, 70))).toBe(false);
    expect(fromHash(h).length).toBe(32);
    expect(toHash(fromHash(h))).toBe(h);
    expect(isHash("0x" + h.slice(7))).toBe(false);
    expect(() => fromHash("sha256:zz")).toThrow();
  });

  test("[C-02-06] hash_input layout is exactly domain||0x00||version||0x00||canonical", () => {
    const dec = new TextDecoder();
    const input = hashInput(Domain.Intent, "intent.v1", { b: 2, a: 1 });
    const expected = "intent-protocol/v1/intent\u0000intent.v1\u0000{\"a\":1,\"b\":2}";
    expect(dec.decode(input)).toBe(expected);
  });

  test("[C-02-07] u32be/u64be agree with reference on boundary values and reject out-of-range", () => {
    for (const n of [0, 1, 0xffffffff]) {
      expect(Buffer.from(u32be(n)).toString("hex")).toBe(Buffer.from(refU32be(n)).toString("hex"));
    }
    for (const bad of [-1, 2 ** 32, 1.5, NaN]) expect(() => u32be(bad)).toThrow();
    for (const n of [0n, 1n, 0xffffffffffffffffn, 7, 2n ** 63n]) {
      expect(Buffer.from(u64be(n)).toString("hex")).toBe(Buffer.from(refU64be(n)).toString("hex"));
    }
    for (const bad of [-1n, 2n ** 64n]) expect(() => u64be(bad)).toThrow();
  });

  test("[C-02-08] proofBinding ORACLE (R9 six-field formula): idempotent and sensitive to every bound field", () => {
    const p = {
      intent_hash: fakeHash("ab"),
      milestone_id: "aaaaaaaa-0000-4000-8000-000000000001",
      bundle_id: "bbbbbbbb-0000-4000-8000-000000000001",
      milestone_revision: 3,
      evidence_root: fakeHash("cd"),
      policy_hash: fakeHash("ef"),
    };
    const b0 = refProofBinding(p);
    expect(refProofBinding({ ...p })).toBe(b0);
    for (const [field, value] of [
      ["intent_hash", fakeHash("ba")],
      ["milestone_id", "aaaaaaaa-0000-4000-8000-000000000002"],
      ["bundle_id", "bbbbbbbb-0000-4000-8000-000000000002"],
      ["milestone_revision", 4],
      ["evidence_root", fakeHash("dc")],
      ["policy_hash", fakeHash("fe")],
    ] as Array<[string, unknown]>) {
      expect(refProofBinding({ ...p, [field]: value } as typeof p), `sensitivity: ${String(field)}`).not.toBe(b0);
    }
  });

  test("[C-02-09] settlementKey: SUT === independent reference; idempotent, differs per nonce/escrow", () => {
    const p = { proof_binding: fakeHash("11"), escrow_id: "escrow:sim-0001", settlement_nonce: 7n };
    const expected = refSettlementKey({ ...p });
    expect(settlementKey(p)).toBe(expected);
    expect(settlementKey(p)).toBe(expected); // idempotent
    expect(settlementKey({ ...p, settlement_nonce: 8n })).not.toBe(expected);
    expect(settlementKey({ ...p, escrow_id: "escrow:sim-0002" })).not.toBe(expected);
    // u64 boundary accepted
    expect(settlementKey({ ...p, settlement_nonce: 0xffffffffffffffffn })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() => settlementKey({ ...p, settlement_nonce: 2n ** 64n })).toThrow();
  });
});
