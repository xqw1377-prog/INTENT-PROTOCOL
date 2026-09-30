#!/usr/bin/env node
/**
 * Regenerate vectors/curve-corpus.json — the PDA-CONFORMANCE-R1 on-curve
 * boundary corpus.
 *
 * Run: node --experimental-strip-types scripts/generate-curve-corpus.mjs
 *      (requires cargo for the rust t1-golden-vectors binary; builds to
 *      CARGO_TARGET_DIR or ~/intent-adapter-cargo-target)
 *
 * Column semantics (frozen):
 *   runtime_expected — NORMATIVE. What the validator decides. Label produced
 *     by curve25519-dalek CompressedEdwardsY::decompress() — the same code the
 *     validator's PDA path executes (agave v3.1.8 → solana-pubkey 3.0.0 →
 *     solana-address 2.8.0 → bytes_are_curve_point → decompress().is_some()).
 *     Cross-verified during generation against solana-pubkey's own
 *     bytes_are_curve_point (identical result).
 *   web3_expected — COMPATIBILITY OBSERVATION ONLY (@solana/web3.js
 *     PublicKey.isOnCurve, strict @noble/curves decoding). A mismatch vs
 *     runtime_expected is recorded as KNOWN_CLIENT_RUNTIME_DIVERGENCE and is
 *     NEVER a failure — the runtime column governs.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const P = 2n ** 255n - 19n;

function le(y, sign) {
  const b = Buffer.alloc(32);
  let v = y;
  for (let i = 0; i < 32; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  if (sign) b[31] |= 0x80;
  return b.toString("hex");
}

const bin = (() => {
  const target = process.env.CARGO_TARGET_DIR ?? path.join(tmpdir(), "intent-adapter-cargo-target");
  execFileSync("cargo", ["build", "-q"], { cwd: path.join(pkgDir, "rust"), env: { ...process.env, CARGO_TARGET_DIR: target } });
  return path.join(target, "debug", "t1-golden-vectors");
})();

const entries = [
  ["CURVE-01", le(1n, false), "identity point: y=1 sign=0 (x=0)"],
  ["CURVE-02", le(1n, true), "negative zero: y=1 sign=1 — dalek accepts, strict decoders reject"],
  ["CURVE-03", le(P, false), "non-canonical y=p sign=0 — dalek reduces mod p (y=0)"],
  ["CURVE-04", le(P + 1n, false), "non-canonical y=p+1 sign=0 — dalek reduces mod p (y=1, identity)"],
  ["CURVE-05", le(0n, false), "y=0 sign=0: x^2=-1 is a residue (p ≡ 1 mod 4) — order-4 point"],
  ["CURVE-06", le(0n, true), "y=0 sign=1: same point, nonzero x so sign is meaningful"],
  ["CURVE-07", le(2n, false), "smallest OFF-CURVE canonical encoding: y=2 sign=0 (x^2 non-residue)"],
  ["CURVE-08", "5866666666666666666666666666666666666666666666666666666666666666", "ed25519 basepoint — canonical on-curve reference"],
  ["CURVE-09", "ff".repeat(32), "all-0xFF: y=2^255-1 sign=1, non-canonical (y mod p = 18)"],
  ["CURVE-10", le(2n ** 255n - 1n, false), "y=2^255-1 sign=0 — same non-canonical y, opposite sign"],
  ["CURVE-11", le(P - 1n, false), "y=p-1 sign=0 — largest canonical encoding"],
];

// deterministic digest stream — the SAME domain the rust --curve-corpus
// differential iterates: sha256(0x51 || i:u64le || domain)
for (let i = 0; i < 64; i++) {
  const h = createHash("sha256");
  h.update(Buffer.from([0x51]));
  const le64 = Buffer.alloc(8);
  le64.writeBigUInt64LE(BigInt(i));
  h.update(le64);
  h.update("intent-protocol/testnet-r1/curve-conformance");
  entries.push([`DIGEST-${String(i).padStart(4, "0")}`, h.digest().toString("hex"), "deterministic digest stream (same domain as rust --curve-corpus)"]);
}

const cases = entries.map(([id, hex, note]) => {
  const out = JSON.parse(execFileSync(bin, ["--on-curve", hex], { encoding: "utf8" }).trim());
  const web3 = PublicKey.isOnCurve(Buffer.from(hex, "hex"));
  if (out.custom !== out.dalek) throw new Error(`${id}: custom predicate != dalek (${out.custom} vs ${out.dalek}) — NOT writing corpus`);
  const c = { id, encoding_hex: hex, note, runtime_expected: out.dalek, web3_expected: web3 };
  if (web3 !== out.dalek) c.divergence = "KNOWN_CLIENT_RUNTIME_DIVERGENCE";
  return c;
});

const corpus = {
  schema_version: "pda-curve-corpus.v1",
  authority: "validator runtime — agave v3.1.8 pins solana-pubkey 3.0.0 → solana-address 2.8.0 → bytes_are_curve_point → curve25519-dalek 4.1.3 CompressedEdwardsY::decompress().is_some(); reached identically by sol_create_program_address, sol_try_find_program_address, and invoke_signed signer derivation",
  normative_column: "runtime_expected — our JS and Rust predicates MUST equal it",
  observational_column: "web3_expected — @solana/web3.js PublicKey.isOnCurve (strict @noble/curves decoding); divergence is a RECORDED FACT, never a failure",
  cases,
};

const out = path.join(pkgDir, "vectors", "curve-corpus.json");
writeFileSync(out, JSON.stringify(corpus, null, 2) + "\n");
const divergent = cases.filter((c) => c.divergence).map((c) => c.id);
console.log(`wrote ${out} (${cases.length} cases; runtime-vs-web3 divergent: ${divergent.join(", ") || "none"})`);
