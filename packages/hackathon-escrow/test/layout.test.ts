import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  CRITERIA_MAX,
  INTENT_LEN,
  IX_CREATE,
  PROGRAM_ID,
  REGISTRY_LEN,
  SAMPLE_ANSWER,
  SAMPLE_CRITERIA,
  SUBMISSION_MAX,
  decodeIntent,
  decodeRegistry,
  encodeCancel,
  encodeCreate,
  encodeSettle,
  encodeSubmit,
  encodeVerify,
  hashUtf8,
  sha256,
  verificationResultHash,
} from "../src/index.ts";

function nodeSha(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

describe("hackathon escrow codec", () => {
  test("sha256 matches Node and the empty-string test vector", () => {
    const empty = sha256(new Uint8Array());
    expect(Buffer.from(empty).toString("hex")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    for (const text of ["42", "41", SAMPLE_CRITERIA, "a".repeat(280)]) {
      const bytes = new TextEncoder().encode(text);
      expect(Buffer.from(sha256(bytes)).equals(nodeSha(bytes))).toBe(true);
    }
  });

  test("create instruction matches the on-chain byte layout", () => {
    const expected = hashUtf8(SAMPLE_ANSWER);
    const data = encodeCreate({
      nonce: 7n,
      lamports: 50_000_000n,
      expectedHash: expected,
      criteria: SAMPLE_CRITERIA,
    });
    expect(data[0]).toBe(IX_CREATE);
    const view = new DataView(data.buffer);
    expect(view.getBigUint64(1, true)).toBe(7n);
    expect(view.getBigUint64(9, true)).toBe(50_000_000n);
    expect(Buffer.from(data.slice(17, 49)).equals(Buffer.from(expected))).toBe(true);
    const criteria = new TextEncoder().encode(SAMPLE_CRITERIA);
    expect(view.getUint16(49, true)).toBe(criteria.length);
    expect(criteria.length).toBeLessThanOrEqual(CRITERIA_MAX);
    expect(Buffer.from(data.slice(51)).equals(Buffer.from(criteria))).toBe(true);
  });

  test("intent bytes round-trip through the documented offsets", () => {
    const raw = new Uint8Array(INTENT_LEN);
    raw[0] = 1;
    raw[2] = 2;
    raw.set(hashUtf8("creator-key-material-padded!!").slice(0, 32), 3);
    const criteria = new TextEncoder().encode(SAMPLE_CRITERIA);
    const submission = new TextEncoder().encode(SAMPLE_ANSWER);
    const view = new DataView(raw.buffer);
    view.setBigUint64(68, 50_000_000n, true);
    raw.set(hashUtf8(SAMPLE_CRITERIA), 76);
    raw.set(hashUtf8(SAMPLE_ANSWER), 108);
    raw.set(hashUtf8(SAMPLE_ANSWER), 140);
    view.setUint16(204, criteria.length, true);
    raw.set(criteria, 206);
    view.setUint16(486, submission.length, true);
    raw.set(submission, 488);
    view.setBigUint64(616, 99n, true);

    const decoded = decodeIntent(raw);
    expect(decoded).not.toBeNull();
    expect(decoded?.status).toBe(2);
    expect(decoded?.amount).toBe(50_000_000n);
    expect(decoded?.criteria).toBe(SAMPLE_CRITERIA);
    expect(decoded?.submission).toBe(SAMPLE_ANSWER);
    expect(decoded?.createdSlot).toBe(99n);
    expect(Buffer.from(decoded?.criteriaHash ?? []).equals(Buffer.from(hashUtf8(SAMPLE_CRITERIA)))).toBe(true);
  });

  test("verification result hash is sha256(criteria || submission || 0x01)", () => {
    const criteria = hashUtf8(SAMPLE_CRITERIA);
    const submission = hashUtf8(SAMPLE_ANSWER);
    const got = verificationResultHash(criteria, submission);
    const preimage = new Uint8Array(65);
    preimage.set(criteria, 0);
    preimage.set(submission, 32);
    preimage[64] = 1;
    expect(Buffer.from(got).equals(nodeSha(preimage))).toBe(true);
    expect(Buffer.from(hashUtf8("42")).equals(Buffer.from(hashUtf8("41")))).toBe(false);
  });

  test("submit, verify, settle, and cancel discriminators", () => {
    const submit = encodeSubmit("42");
    expect(submit[0]).toBe(2);
    expect(submit.length).toBe(1 + 2 + 2);
    expect(new TextDecoder().decode(submit.slice(3))).toBe("42");
    expect(Array.from(encodeVerify())).toEqual([3]);
    expect(Array.from(encodeSettle())).toEqual([4]);
    expect(Array.from(encodeCancel())).toEqual([5]);
    expect(() => encodeSubmit("")).toThrow();
    expect(() => encodeSubmit("x".repeat(SUBMISSION_MAX + 1))).toThrow();
  });

  test("registry decode reads pubkeys in order", () => {
    const raw = new Uint8Array(REGISTRY_LEN);
    raw[0] = 1;
    raw[1] = 2;
    raw[2] = 9;
    raw[2 + 32] = 8;
    const keys = decodeRegistry(raw);
    expect(keys).toHaveLength(2);
    expect(keys[0]?.[0]).toBe(9);
    expect(keys[1]?.[0]).toBe(8);
  });

  test("program id is the deployed devnet id, not the immutable TESTNET-R1 program", () => {
    expect(PROGRAM_ID).toBe("7a6K1mJVu3vx2RugjYxtfipPGFvqygghD1wTox7bBa2F");
    expect(PROGRAM_ID).not.toBe("ASvnm4pic6a9UDud3CqY51xUfhys5t7mqYrcHbJkDW4F");
  });
});
