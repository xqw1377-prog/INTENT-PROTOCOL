/**
 * B1 VERIFIER AUTHENTICITY — Ed25519 key registry (Issue #32 GP3-R1).
 *
 * Each verifier role has a frozen keypair: the PRIVATE key is generated
 * fresh, used to sign decision.content_hash, and NEVER committed. The PUBLIC
 * key + key_id are frozen in a committed registry. The receipt engine
 * verifies every decision signature against the registry before accepting.
 */
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface VerifierKeyEntry {
  verifier_id: string;
  key_id: string;
  public_key_pem: string;
  algorithm: "ed25519";
  frozen_at: string;
}

export interface VerifierRegistry {
  schema_version: "gp3-verifier-keys.v1";
  keys: VerifierKeyEntry[];
}

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = path.join(pkgDir, "keys", "verifier-registry.json");
const PRIVATE_KEYS_DIR = path.join(pkgDir, "keys", "private");

export const VERIFIER_ROLES = ["verifier:gp3-functional", "verifier:gp3-policy"] as const;

export function loadRegistry(): VerifierRegistry {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as VerifierRegistry;
}

export function publicKeyFor(verifierId: string): string {
  const reg = loadRegistry();
  const entry = reg.keys.find((k) => k.verifier_id === verifierId);
  if (!entry) throw new Error(`no key registered for ${verifierId}`);
  return entry.public_key_pem;
}

/** Sign content_hash with the verifier's Ed25519 private key. Key is read from disk (gitignored) or generated if absent. */
export function signDecision(verifierId: string, contentHash: string): { signature: string; key_id: string } {
  const reg = loadRegistry();
  const entry = reg.keys.find((k) => k.verifier_id === verifierId);
  if (!entry) throw new Error(`no key registered for ${verifierId}`);
  const privPath = path.join(PRIVATE_KEYS_DIR, `${entry.key_id}.pem`);
  if (!existsSync(privPath)) {
    throw new Error(`private key not found for ${verifierId} at ${privPath} — generate first (keys are gitignored)`);
  }
  const privPem = readFileSync(privPath, "utf8");
  const signature = edSign(null, Buffer.from(contentHash, "utf8"), privPem).toString("base64");
  return { signature, key_id: entry.key_id };
}

/** Verify a decision signature against the frozen public-key registry. */
export function verifyDecisionSignature(verifierId: string, contentHash: string, signatureB64: string): boolean {
  const reg = loadRegistry();
  const entry = reg.keys.find((k) => k.verifier_id === verifierId);
  if (!entry) return false;
  try {
    return edVerify(null, Buffer.from(contentHash, "utf8"), entry.public_key_pem, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Bootstrap: generate keypairs and write the registry + gitignored private keys.
 * Run once: `node -e "import('./packages/gp3-verification/src/keys.ts').then(m => m.bootstrapKeys())"`
 * After bootstrap, commit ONLY the registry; private keys stay gitignored.
 */
export function bootstrapKeys(): void {
  const keys: VerifierKeyEntry[] = [];
  mkdirSync(PRIVATE_KEYS_DIR, { recursive: true });
  for (const role of VERIFIER_ROLES) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const keyId = `gp3-${role.split(":")[1]}-ed25519-v1`;
    const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    writeFileSync(path.join(PRIVATE_KEYS_DIR, `${keyId}.pem`), privPem);
    keys.push({ verifier_id: role, key_id: keyId, public_key_pem: pubPem, algorithm: "ed25519", frozen_at: new Date().toISOString() });
  }
  const registry: VerifierRegistry = { schema_version: "gp3-verifier-keys.v1", keys };
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
  console.log(`bootstrapKeys: wrote ${keys.length} public keys to registry; private keys at ${PRIVATE_KEYS_DIR} (gitignored)`);
}
