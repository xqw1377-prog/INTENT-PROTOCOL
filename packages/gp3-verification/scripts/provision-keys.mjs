#!/usr/bin/env node
/**
 * OFFLINE key provisioning — NOT part of the verification path.
 * Run once to generate Ed25519 keypairs and write the committed registry.
 * Private keys are written to keys/private/ (gitignored).
 *
 * Usage: node scripts/provision-keys.mjs
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keysDir = path.join(pkgDir, "keys");
const privDir = path.join(keysDir, "private");

mkdirSync(privDir, { recursive: true });
const keys = [];
for (const role of ["verifier:gp3-functional", "verifier:gp3-policy"]) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = `gp3-${role.split(":")[1]}-ed25519-v1`;
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  writeFileSync(path.join(privDir, `${keyId}.pem`), privPem);
  keys.push({ verifier_id: role, key_id: keyId, public_key_pem: pubPem, algorithm: "ed25519", frozen_at: new Date().toISOString() });
}
const registry = { schema_version: "gp3-verifier-keys.v1", keys };
writeFileSync(path.join(keysDir, "verifier-registry.json"), JSON.stringify(registry, null, 2) + "\n");
console.log(`provisioned ${keys.length} Ed25519 keypairs; private keys at ${privDir} (gitignored)`);
