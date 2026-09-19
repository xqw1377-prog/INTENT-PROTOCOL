#!/usr/bin/env python3
"""Independent Python implementation of the FROZEN settlement-key byte
protocol (docs/TRUST-CHAIN.md @ e28a22e, Commander freeze), used to
cross-check the golden known-answer vector in vectors/settlement-key-vector.json.
A third implementation (besides the TS oracle and the SUT) guards against a
shared-mode error in either.

Frozen protocol (exact):
  settlement_key = SHA256(
    "intent-protocol/v1/settlement-key" || 0x00
    || outcome_receipt_hash[32]
    || UTF8(escrow_ref) || 0x00
    || nonce_u64be[8]
  )

The variable-length escrow_ref is terminated by the explicit 0x00 separator
before the fixed-width nonce. Settlement keys bind the RECEIPT (the protocol's
settlement authority), never a raw VerificationDecision / proof_binding.
"""
import hashlib
import json
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
vec = json.loads((here / "../vectors/settlement-key-vector.json").read_text(encoding="utf-8"))
c = vec["case"]

preimage = b"".join([
    vec["domain"].encode("ascii"),
    b"\x00",
    bytes.fromhex(c["outcome_receipt_hash"][7:]),
    c["escrow_ref"].encode("utf-8"),
    b"\x00",
    int(c["nonce"]).to_bytes(8, "big"),
])
computed = "sha256:" + hashlib.sha256(preimage).hexdigest()

if computed != vec["expected"]:
    print(f"KAT MISMATCH: python={computed} vector={vec['expected']}")
    sys.exit(1)
print(f"settlement-key golden KAT ok ({computed}) — python implementation agrees with the vector")
