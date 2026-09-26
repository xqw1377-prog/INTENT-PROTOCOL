#!/usr/bin/env node
/**
 * OFFLINE signer: reads the computed (unsigned) decisions, signs each
 * content_hash with the verifier's Ed25519 private key, and writes the
 * signed artifacts. Run AFTER `npm run test` computes the unsigned decisions,
 * then commit the artifacts. The formal test suite does NOT need private keys.
 *
 * Usage: node scripts/sign-decisions.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { sign as edSign } from "node:crypto";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reg = JSON.parse(readFileSync(path.join(pkgDir, "keys", "verifier-registry.json"), "utf8"));
const artDir = path.join(pkgDir, "artifacts");
mkdirSync(artDir, { recursive: true });

for (const role of ["functional", "policy"]) {
  const unsignedPath = path.join(artDir, `decision-${role}-unsigned.json`);
  if (!existsSync(unsignedPath)) { console.error(`missing ${unsignedPath} — run tests first`); process.exit(1); }
  const unsigned = JSON.parse(readFileSync(unsignedPath, "utf8"));
  const entry = reg.keys.find((k) => k.verifier_id === `verifier:gp3-${role}`);
  if (!entry) { console.error(`no key for verifier:gp3-${role}`); process.exit(1); }
  const privPem = readFileSync(path.join(pkgDir, "keys", "private", `${entry.key_id}.pem`), "utf8");
  const ch = unsigned.content_hash;
  const sig = edSign(null, Buffer.from(ch, "utf8"), privPem).toString("base64");
  const signed = { ...unsigned, signature: { scheme: "ed25519", signer: entry.verifier_id, key_id: entry.key_id, value: sig } };
  writeFileSync(path.join(artDir, `decision-${role}.json`), JSON.stringify(signed, null, 2) + "\n");
  console.log(`signed decision-${role}.json (content_hash ${ch.slice(7, 19)}...)`);
}
console.log("done — commit the signed artifacts; formal tests need no private keys");
