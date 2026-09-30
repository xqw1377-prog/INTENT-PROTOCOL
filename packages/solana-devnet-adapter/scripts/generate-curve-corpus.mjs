#!/usr/bin/env node
/**
 * Generate and COMMIT the frozen curve edge corpus (PDA-CONFORMANCE
 * erratum closure, T3-R2): vectors/curve-corpus.json.
 *
 * Cases cover the pathological encodings a random corpus essentially never
 * hits — identity/negative-zero, non-canonical y (p, p+1), plus a normal
 * valid point and deterministic on/off-curve digests. For every case we
 * record THREE verdicts:
 *
 *   runtime_expected  curve25519-dalek CompressedEdwardsY::decompress()
 *                     (the validator runtime's own library)
 *   our_js            our BigInt field-arithmetic predicate (src/pda.ts)
 *   web3_expected     @solana/web3.js PublicKey.isOnCurve
 *
 * Closure contract: our_js == runtime_expected for EVERY case (asserted at
 * generation; the suite re-asserts). Any web3 ≠ runtime divergence is
 * EXPECTED and RECORDED, never silently smoothed over.
 *
 * Run: node --experimental-strip-types scripts/generate-curve-corpus.mjs
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { isOnEd25519Curve, base58Decode, PINNED } from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");

const P = 2n ** 255n - 19n;

/** little-endian 256-bit BigInt → 32-byte hex string */
function leHex(n) {
  let s = "";
  for (let i = 0; i < 32; i++) {
    s += Number((n >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, "0");
  }
  return s;
}
const bytesToHex = (bytes) => Buffer.from(bytes).toString("hex");
const hexToBytes = (hex) => new Uint8Array(Buffer.from(hex, "hex"));

// ————————————————— deterministic on/off-curve digests —————————————————
function firstDigestWith(dalekOfJs /* our predicate == dalek, asserted later */, want) {
  for (let i = 0; i < 10_000; i++) {
    const digest = createHash("sha256").update(`intent-protocol/testnet-r1/edge-corpus/${i}`).digest();
    if (dalekOfJs(digest) === want) return bytesToHex(digest);
  }
  throw new Error(`no digest with predicate=${want} found`);
}

const cases = [];

function addCase(name, hex, note) {
  const bytes = hexToBytes(hex);
  cases.push({
    name,
    encoding_hex: hex,
    our_js: isOnEd25519Curve(bytes),
    web3_expected: PublicKey.isOnCurve(Buffer.from(bytes)),
    note,
  });
}

addCase("identity-y1-sign0", leHex(1n), "neutral element encoding (x=0, y=1): must decompress to the identity point");
addCase("negative-zero-y1-sign1", leHex(1n | (1n << 255n)), "y=1 with the x-sign bit set (negative zero): pathological sign-on-x=0 encoding");
addCase("y-zero", leHex(0n), "y=0 encoding");
addCase("y-equals-p", leHex(P), "non-canonical y = field prime p");
addCase("y-equals-p-plus-1", leHex(P + 1n), "non-canonical y = p+1");
addCase("normal-valid-point", bytesToHex(base58Decode(PINNED.treasury)), "an actual on-chain account key (on-curve by construction)");
addCase("hash-digest-off-curve", firstDigestWith(isOnEd25519Curve, false), "first deterministic digest whose candidate is OFF-curve (a real PDA seed case)");
addCase("hash-digest-on-curve", firstDigestWith(isOnEd25519Curve, true), "first deterministic digest whose candidate is ON-curve (a reject case for findProgramAddress)");

// ————————————————— PDA-EVIDENCE-HARDENING-R1: wider boundary coverage —————————————————
addCase("y-zero-sign1", leHex(1n << 255n), "y=0 with sign bit set: x^2=-1 residue, nonzero x so sign is meaningful");
addCase("y-two-canonical-offcurve", leHex(2n), "smallest canonical OFF-CURVE encoding: y=2 sign=0 (x^2 non-residue)");
addCase("basepoint", "5866666666666666666666666666666666666666666666666666666666666666", "ed25519 basepoint — canonical on-curve reference");
addCase("all-ff-y-max-sign1", "ff".repeat(32), "all-0xFF: y=2^255-1 sign=1, non-canonical (y mod p = 18)");
addCase("y-max-sign0", leHex(2n ** 255n - 1n), "y=2^255-1 sign=0 — same non-canonical y, opposite sign");
addCase("y-p-minus-1", leHex(P - 1n), "y=p-1 sign=0 — largest canonical encoding");

// deterministic digest stream — breadth coverage of both residue classes
// (shares methodology with rust --curve-corpus but a distinct salt)
for (let i = 0; i < 64; i++) {
  const digest = createHash("sha256").update(`intent-protocol/testnet-r1/edge-corpus-stream/${i}`).digest();
  addCase(`digest-stream-${String(i).padStart(4, "0")}`, bytesToHex(digest), "deterministic digest stream — broad input-space coverage");
}

// ————————————————— run the Rust tool: dalek verdicts = runtime authority —————————————————
// Worktree-scoped target dir: a shared dir can serve a binary built from a
// different checkout (cargo exit 0, stale output — observed in practice).
const targetDir = path.join(tmpdir(), "intent-adapter-cargo-target-" + createHash("sha256").update(pkgDir).digest("hex").slice(0, 12));
execFileSync("cargo", ["build", "-q"], {
  cwd: path.join(pkgDir, "rust"),
  env: { ...process.env, CARGO_TARGET_DIR: targetDir },
});
const bin = path.join(targetDir, "debug", "t1-golden-vectors");
const rustVerdicts = JSON.parse(execFileSync(bin, ["--curve-cases", ...cases.map((c) => c.encoding_hex)], { encoding: "utf8" }).trim());
if (rustVerdicts.length !== cases.length) throw new Error("rust verdict count mismatch");

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const r = rustVerdicts[i];
  c.runtime_expected = r.dalek; // curve25519-dalek = the validator runtime's authority
  c.rust_custom = r.custom;
  c.divergence = c.web3_expected !== c.runtime_expected ? "WEB3_VS_RUNTIME" : "NONE";
  // CLOSURE ASSERTIONS — refuse to write the corpus if any fails
  if (c.our_js !== c.runtime_expected) throw new Error(`CLOSURE FAIL [${c.name}]: our_js=${c.our_js} but runtime(dalek)=${c.runtime_expected}`);
  if (c.rust_custom !== c.runtime_expected) throw new Error(`CLOSURE FAIL [${c.name}]: rust custom=${c.rust_custom} but runtime(dalek)=${c.runtime_expected}`);
}

const corpus = {
  schema_version: "pda-curve-edge-corpus.v1",
  authority: "curve25519-dalek CompressedEdwardsY::decompress() — the Solana validator runtime's own curve library (agave → solana-program → create_program_address)",
  closure_rule: "our_js == rust_custom == runtime_expected for EVERY case; web3 vs runtime divergences are EXPECTED and RECORDED, never smoothed over",
  generated_with: { rust_tool: "t1-golden-vectors --curve-cases", web3: "PublicKey.isOnCurve" },
  cases,
};
const out = path.join(pkgDir, "vectors/curve-corpus.json");
writeFileSync(out, JSON.stringify(corpus, null, 2) + "\n");
console.log(`wrote ${out} (${cases.length} cases; divergences: ${cases.filter((c) => c.divergence !== "NONE").map((c) => c.name + ":" + c.divergence).join(", ") || "none"})`);
