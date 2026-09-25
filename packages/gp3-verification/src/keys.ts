/**
 * B1 VERIFIER AUTHENTICITY — Ed25519 read-only trust root.
 *
 * The registry (keys/verifier-registry.json) is COMMITTED and READ-ONLY at
 * runtime. There is no key-provisioning function here — key provisioning is
 * an offline operation done by scripts/provision-keys.mjs which is NOT part
 * of the verification path.
 */
import { verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
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

export const VERIFIER_ROLES = ["verifier:gp3-functional", "verifier:gp3-policy"] as const;
const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadRegistry(): VerifierRegistry {
  return JSON.parse(readFileSync(path.join(pkgDir, "keys", "verifier-registry.json"), "utf8"));
}

export function findKey(verifierId: string): VerifierKeyEntry | undefined {
  return loadRegistry().keys.find((k) => k.verifier_id === verifierId);
}

export interface SignatureFields {
  scheme: string;
  signer: string;
  key_id: string;
  value: string;
}

/**
 * FULL signature verification contract:
 *  1. signature.scheme === "ed25519" === registry.algorithm
 *  2. signature.signer === decision.verifier_id
 *  3. signature.key_id === registry.key_id for that verifier_id
 *  4. Ed25519 verify(public_key_pem, content_hash, signature.value)
 * Any mismatch → false.
 */
export function verifyDecisionSignature(verifierId: string, contentHash: string, sig: SignatureFields): boolean {
  if (sig.scheme !== "ed25519") return false;
  if (sig.signer !== verifierId) return false;
  const entry = findKey(verifierId);
  if (!entry) return false;
  if (entry.algorithm !== "ed25519" || entry.algorithm !== sig.scheme) return false;
  if (sig.key_id !== entry.key_id) return false;
  try {
    return edVerify(null, Buffer.from(contentHash, "utf8"), entry.public_key_pem, Buffer.from(sig.value, "base64"));
  } catch {
    return false;
  }
}
