import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

  test("[SUT-LOAD-04] dependency pinning: runtime zod version must equal the capture's recorded version; gate captures must read it from the pinned lockfile, not live node_modules", () => {
    const capture = JSON.parse(readFileSync(new URL("../sut-snapshot/capture.json", import.meta.url), "utf8"));
    const mode = capture.mode ?? "worktree";
    const source = capture.zod_version_source ?? (mode === "git-sha" ? null : "live-node_modules");
    if (mode === "git-sha") {
      // Gate evidence: pinned source must be paired with the pinned dependency.
      expect(source, "gate capture must record zod from the pinned lockfile").toBe("pinned-lockfile");
      expect(capture.pinned_sha).toMatch(/^[0-9a-f]{40}$/);
    }
    const runtimeZod = createRequire(import.meta.url)("zod/package.json").version;
    expect(runtimeZod, `runtime zod ${runtimeZod} != recorded ${capture.zod_version} (dependency drift)`).toBe(capture.zod_version);
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

  test.todo("[PKG-ENTRY-01][GAP] live package barrel + `@intent/protocol-schema` import: NOT evaluated — packaging-layer concern outside S0 gate scope (reconciliation-18: the original live-tree-drift blocker is CLOSED; the SUT is pinned at a pushed SHA captured from the git object database in mode=git-sha, so no concurrent-edit vector exists)");
});
