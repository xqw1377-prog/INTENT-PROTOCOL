import { createHash } from "node:crypto";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const SEP = Uint8Array.from([0]);
function sha256(...chunks: Uint8Array[]): Uint8Array {
  const h = createHash("sha256");
  for (const c of chunks) h.update(c);
  return new Uint8Array(h.digest());
}
function hashBytes32(h: string): Uint8Array {
  if (!/^sha256:[0-9a-f]{64}$/.test(h)) throw new Error(`r9: malformed hash ${h}`);
  return Uint8Array.from(Buffer.from(h.slice(7), "hex"));
}
function uuidBytes16(uuid: string): Uint8Array {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) throw new Error(`r9: malformed UUID ${uuid}`);
  return Uint8Array.from(Buffer.from(uuid.replace(/-/g, ""), "hex"));
}
function u32be(n: number): Uint8Array {
  const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return new Uint8Array(b);
}

export interface R9Inputs { intent_hash: string; milestone_id: string; milestone_revision: number; bundle_id: string; evidence_root: string; policy_hash: string; }
export function proofBinding(p: R9Inputs): string {
  return `sha256:${Buffer.from(sha256(utf8("intent-protocol/v1/proof-binding"), SEP, hashBytes32(p.intent_hash), uuidBytes16(p.milestone_id), u32be(p.milestone_revision), uuidBytes16(p.bundle_id), hashBytes32(p.evidence_root), hashBytes32(p.policy_hash))).toString("hex")}`;
}

export function deriveUuid(seed: string): string {
  const b = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const hex = b.slice(0, 12) + "4" + b.slice(13, 16) + "8" + b.slice(17, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const sha256Hex = (bytes: Buffer | string): string => "sha256:" + createHash("sha256").update(bytes).digest("hex");
