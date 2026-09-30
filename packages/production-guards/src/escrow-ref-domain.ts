/**
 * PRODUCTION-HARDENING-R0 / PH-04 — settlement input-domain closure.
 *
 * AR-05 (audit, TRUE/B): the G1 settlementKey() accepts an arbitrary JS
 * string as escrow_ref, so Unicode normalization variants ("é" vs
 * "e\u0301") produce DIFFERENT idempotency keys for the same visual ref.
 * The frozen hash byte-protocol CANNOT and MUST NOT change (PH-00 class 4).
 * The closure is therefore VALIDATION-ONLY at the production entry point:
 *
 *   every accepted escrow_ref has EXACTLY ONE UTF-8 representation
 *   (pure ASCII grammar ⇒ no NFC/NFD ambiguity ⇒ no key split)
 *
 * The grammar matches the GP4 settlement runtime's frozen ESCROW_REF_RE
 * (class 1 change: same accepted domain, new pre-call assertion).
 */
export const ESCROW_REF_GRAMMAR = /^[a-z0-9][a-z0-9:._-]{0,63}$/;

export class EscrowRefDomainError extends Error {
  constructor(readonly escrowRef: string, reason: string) {
    super(`escrow_ref input-domain rejection (${reason}): ${JSON.stringify(escrowRef)}`);
  }
}

/** Throws on any escrow_ref outside the frozen ASCII grammar. */
export function assertEscrowRefDomain(escrowRef: string): void {
  if (typeof escrowRef !== "string") throw new EscrowRefDomainError(String(escrowRef), "not-a-string");
  if (escrowRef.length === 0) throw new EscrowRefDomainError(escrowRef, "empty");
  if (escrowRef.length > 64) throw new EscrowRefDomainError(escrowRef, "over-length");
  if (!ESCROW_REF_GRAMMAR.test(escrowRef)) {
    // precise reason for auditability
    if (/[A-Z]/.test(escrowRef)) throw new EscrowRefDomainError(escrowRef, "uppercase-not-in-grammar");
    if (/[^\x00-\x7F]/.test(escrowRef)) throw new EscrowRefDomainError(escrowRef, "non-ascii (Unicode normalization ambiguity — exactly the AR-05 key-split hazard)");
    throw new EscrowRefDomainError(escrowRef, "grammar");
  }
}

/**
 * Machine-provable uniqueness: for every string the grammar accepts, NFC(×n)
 * is the identity and its UTF-8 encoding is canonical. Used by tests to
 * prove the single-representation property, not by production callers.
 */
export function hasExactlyOneUtf8Representation(escrowRef: string): boolean {
  if (!ESCROW_REF_GRAMMAR.test(escrowRef)) return false;
  const nfc = escrowRef.normalize("NFC");
  const nfd = escrowRef.normalize("NFD");
  return nfc === escrowRef && nfd === escrowRef && Buffer.from(nfc, "utf8").equals(Buffer.from(escrowRef, "utf8"));
}
