import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { sut } from "../src/sut.js";

/**
 * SUT-LOAD area. The harness attacks a FROZEN snapshot of
 * @intent/protocol-schema (see sut-snapshot/capture.json); these checks pin
 * that the snapshot is loadable and internally consistent.
 */
describe("SUT loadability", () => {
  test("[SUT-LOAD-00] snapshot capture.json exists and pins 7 source files", () => {
    const capture = JSON.parse(readFileSync(new URL("../sut-snapshot/capture.json", import.meta.url), "utf8"));
    expect(capture.files.length).toBe(7);
    expect(capture.source_git_head).toMatch(/^[0-9a-f]{40}$/);
  });

  test("[SUT-LOAD-01] snapshot modules export the documented API", () => {
    expect(typeof sut.canonical.canonicalize).toBe("function");
    expect(typeof sut.hash.hashObject).toBe("function");
    expect(typeof sut.merkle.merkleRoot).toBe("function");
    expect(typeof sut.objects.seal).toBe("function");
    expect(typeof sut.objects.contentHash).toBe("function");
    expect(sut.primitives.HashSchema).toBeDefined();
    expect(sut.states.EvidenceBundleState).toBeDefined();
  });

  test("[SUT-LOAD-02] sha256 empty-string known answer (NIST)", () => {
    expect(sut.hash.hashBytes(new Uint8Array([]))).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("[SUT-LOAD-03] sha256 'abc' known answer (NIST FIPS 180-2)", () => {
    expect(sut.hash.hashBytes(new TextEncoder().encode("abc"))).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test.todo("[PKG-ENTRY-01][GAP] live package barrel + `@intent/protocol-schema` import: NOT evaluated against the frozen snapshot — Builder A edits the live tree concurrently (drift observed twice during verification); re-run scripts/capture-sut.mjs and add an entry-point suite once the SUT stabilizes");
});
