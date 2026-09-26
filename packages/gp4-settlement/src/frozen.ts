/**
 * Type-level bridge to the FROZEN G1 seal() (packages/protocol-schema).
 *
 * The frozen generic `seal<T>(schema: z.ZodType<T & Hashable>, input)` can
 * only express schemas whose zod Input type equals their Output type. Every
 * G1 wire schema carries transforms (HashSchema maps string → `sha256:…`
 * template literal), so its zod Input ≠ Output and the frozen signature
 * cannot typecheck a direct call. This bridge performs a pure TYPE-LEVEL
 * double cast; the frozen seal() implementation is exactly what runs at
 * runtime — parse, frozen-domain contentHash, and declared-hash tamper
 * rejection all stay inside the frozen library.
 */
import { seal } from "@intent/protocol-schema";
import type { Hash } from "@intent/protocol-schema";
import type { z } from "zod";

interface HashableLike {
  schema_version: string;
  content_hash?: Hash | undefined;
  signature?: unknown;
}

export function frozenSeal<T extends HashableLike>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown,
): T & { content_hash: Hash } {
  return seal(schema as unknown as z.ZodType<T & HashableLike>, input) as T & { content_hash: Hash };
}
