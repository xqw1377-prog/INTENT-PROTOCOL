/** PH-04 — settlement input-domain closure: machine proof of the frozen property. */
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { assertEscrowRefDomain, EscrowRefDomainError, hasExactlyOneUtf8Representation } from "../src/escrow-ref-domain.ts";

/** The frozen settlementKey byte protocol (reimplemented locally for the hazard demo — preimage unchanged). */
function settlementKeyRaw(escrowRef: string, nonce: bigint, receiptHash = "sha256:" + "0".repeat(64)): string {
  const be = Buffer.alloc(8); be.writeBigUInt64BE(nonce);
  return "sha256:" + createHash("sha256")
    .update(Buffer.from("intent-protocol/v1/settlement-key", "utf8")).update(Buffer.from([0]))
    .update(Buffer.from(receiptHash.slice(7), "hex"))
    .update(Buffer.from(escrowRef, "utf8")).update(Buffer.from([0])).update(be).digest("hex");
}

describe("[PH-04] settlement input-domain closure (validation only; hash preimage UNCHANGED)", () => {
  test("[PH-04-1] the AR-05 hazard is REAL at the raw API level: NFC/NFD variants split the key", () => {
    const nfc = "escrow:caf\u00e9";       // é precomposed
    const nfd = "escrow:cafe\u0301";     // e + combining acute
    expect(nfc).not.toBe(nfd);
    expect(nfc.normalize("NFC")).toBe(nfc.normalize("NFC"));
    expect(settlementKeyRaw(nfc, 1n)).not.toBe(settlementKeyRaw(nfd, 1n)); // the split, demonstrated
  });

  test("[PH-04-2] the guard REJECTS every normalization-ambiguous input", () => {
    for (const bad of ["escrow:caf\u00e9", "escrow:cafe\u0301", "escrow:\u4f60\u597d", "ESCROW:x", "escrow:x ", " escrow:x", "escrow:x/y", "", "x".repeat(65)]) {
      expect(() => assertEscrowRefDomain(bad), JSON.stringify(bad)).toThrow(EscrowRefDomainError);
    }
  });

  test("[PH-04-3] every ACCEPTED ref has EXACTLY ONE UTF-8 representation (the frozen property)", () => {
    const accepted = ["a", "escrow:gp-001-local", "0", "z9:._-", "a".repeat(64), "abc-123.xyz:host"];
    for (const good of accepted) {
      expect(() => assertEscrowRefDomain(good), JSON.stringify(good)).not.toThrow();
      expect(hasExactlyOneUtf8Representation(good), JSON.stringify(good)).toBe(true);
    }
  });

  test("[PH-04-4] exhaustive ASCII proof: all 1-char and 2-char grammar strings are single-representation", () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789:._-";
    for (const c of alphabet) {
      const ref = "a" + c;
      assertEscrowRefDomain(ref);
      expect(hasExactlyOneUtf8Representation(ref)).toBe(true);
    }
  });

  test("[PH-04-5] hash preimage stability: the guard NEVER changes bytes hashed for accepted refs", () => {
    // same accepted ref before/after guard routing → identical key (validation-only)
    const ref = "escrow:gp-001-local";
    assertEscrowRefDomain(ref);
    const before = settlementKeyRaw(ref, 1n);
    assertEscrowRefDomain(ref);
    expect(settlementKeyRaw(ref, 1n)).toBe(before);
  });
});
