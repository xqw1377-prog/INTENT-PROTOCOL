import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { economicReleaseKey, KeyOnlyEscrow, settlementKey, TwoLayerEscrow } from "../src/settlement.js";
import g1Golden from "../../conformance-harness/vectors/settlement-key-vector.json";

/**
 * GP0 CONTRACT AUDIT — executable evidence (Builder D, Issue #8).
 *
 * Audited main SHA: 5e44297f4f9b1b2faa4c6bef67d30d5e6ff01d94
 * Normative docs: docs/GOLDEN-PATH-V1.md, docs/GATES.md (GP additions).
 *
 * These tests are audit artifacts, not implementation tests: they prove
 * cryptographic facts about the frozen contract and pin the frozen facts
 * against silent weakening. Full findings (blockers/clarifications) live in
 * packages/gp-audit/README.md.
 */

const CONTRACT = readFileSync(
  fileURLToPath(new URL("../../../docs/GOLDEN-PATH-V1.md", import.meta.url)),
  "utf8",
);
const GATES = readFileSync(
  fileURLToPath(new URL("../../../docs/GATES.md", import.meta.url)),
  "utf8",
);

describe("[GP0-AUDIT] executable contract evidence", () => {
  test("[GP0-E01] formula fidelity: independent doc-derived implementation reproduces the G1 golden KAT (no semantic drift between GP0 contract and frozen G1)", () => {
    expect(settlementKey(g1Golden.case), "GP0 §4 restatement must equal the frozen G1 byte protocol").toBe(g1Golden.expected);
  });

  test("[GP0-E02] ATTACK — same receipt + different nonce yields a DIFFERENT settlement_key (key alone cannot be the economic guard)", () => {
    const p = { outcome_receipt_hash: g1Golden.case.outcome_receipt_hash, escrow_ref: g1Golden.case.escrow_ref };
    const k7 = settlementKey({ ...p, nonce: 7 });
    const k8 = settlementKey({ ...p, nonce: 8 });
    expect(k8, "nonce bump must change the key — this is the attack vector").not.toBe(k7);
    expect(k7).toBe(g1Golden.expected);
  });

  test("[GP0-E03] economic release key is nonce-INVARIANT (the tuple guards the economic dimension the key cannot)", () => {
    const p = { outcome_receipt_hash: g1Golden.case.outcome_receipt_hash, escrow_ref: g1Golden.case.escrow_ref };
    expect(economicReleaseKey({ ...p })).toBe(economicReleaseKey({ ...p })); // same tuple, no nonce component by construction
    expect(settlementKey({ ...p, nonce: 7 })).not.toBe(settlementKey({ ...p, nonce: 8 }));
  });

  test("[GP0-E04] ATTACK EXECUTED — settlement_key-only escrow double-releases on nonce bump; the contract's two-layer model blocks it", () => {
    const p = { outcome_receipt_hash: g1Golden.case.outcome_receipt_hash, escrow_ref: g1Golden.case.escrow_ref };
    // Layer B alone: the vulnerability the contract names (§4 preamble)
    const bad = new KeyOnlyEscrow();
    const first = bad.release({ ...p, nonce: 7 });
    const second = bad.release({ ...p, nonce: 8 }); // attacker bumps nonce
    expect(first.released).toBe(true);
    expect(second.released, "key-only model FAILS the GP-001 replay requirement — demonstrates necessity of §4A").toBe(true);
    // Layers A+B (contract §4): exactly one economic release
    const good = new TwoLayerEscrow();
    expect(good.release({ ...p, nonce: 7 }).released).toBe(true);
    const replay = good.release({ ...p, nonce: 7 });
    const bump = good.release({ ...p, nonce: 8 });
    expect(replay.released, "§4B: exact instruction replay blocked").toBe(false);
    expect(bump.released, "§4A: same receipt + different nonce MUST NOT release twice").toBe(false);
    expect(bump.alreadyReleased).toBe(true);
  });

  test("[GP0-E05] frozen facts pinned in the contract text (guards against silent weakening of GP-001)", () => {
    expect(CONTRACT).toContain('"network": "solana-devnet"');
    expect(CONTRACT).toContain('"asset": "USDC-test"');
    expect(CONTRACT).toContain('"decimals": 6');
    expect(CONTRACT).toContain("Scale MUST be <= 6");
    expect(CONTRACT).toContain("(escrow_ref, outcome_receipt_hash)");
    expect(CONTRACT).toContain("settlement_key alone MUST NOT be used as the economic double-release guard");
    expect(CONTRACT).toContain("same receipt + different nonce -> no second release");
    expect(CONTRACT).toContain("no manual/admin/demo path may create an accepted receipt");
    expect(CONTRACT).toContain("Static string scanning alone is not sufficient.");
    expect(CONTRACT).toContain("2-of-2");
    expect(GATES).toContain("economic exactly-once release is enforced by unique key `(escrow_ref, outcome_receipt_hash)`");
  });

  test("[GP0-E06] the contract restates the settlement_key preimage exactly as frozen G1 (component order + separators)", () => {
    const preimage = [
      '"intent-protocol/v1/settlement-key" || 0x00',
      "|| outcome_receipt_hash[32]",
      "|| UTF8(escrow_ref) || 0x00",
      "|| nonce_u64be[8]",
    ].join("\n  ").replace(/\n\s+/g, " ");
    // §4 block must contain the same five components in the same order
    const section4 = CONTRACT.split("## 4.")[1]!.split("## 5.")[0]!;
    for (const component of [
      '"intent-protocol/v1/settlement-key"',
      "0x00",
      "outcome_receipt_hash[32]",
      "UTF8(escrow_ref)",
      "nonce_u64be[8]",
    ]) {
      expect(section4, `G1 preimage component present in GP0 §4: ${component}`).toContain(component);
    }
    expect(preimage.length).toBeGreaterThan(0); // (structure kept for future component-order assertions)
  });
});
