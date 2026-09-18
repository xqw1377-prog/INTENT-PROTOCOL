#!/usr/bin/env python3
"""Independent Python implementation of the FROZEN R9 proof-binding byte
protocol, used to cross-check the golden known-answer vector in
vectors/proof-binding-vector.json. A third implementation (besides the TS
oracle and the SUT) guards against a shared-mode error in either.

Frozen protocol (Commander ruling, exact):
  SHA256("intent-protocol/v1/proof-binding" || 0x00 || intent_hash[32]
         || milestone_id UUID bytes[16] || milestone_revision u32be[4]
         || bundle_id UUID bytes[16] || evidence_root[32] || policy_hash[32])
"""
import hashlib
import json
import sys
import uuid
from pathlib import Path

here = Path(__file__).resolve().parent
vec = json.loads((here / "../vectors/proof-binding-vector.json").read_text(encoding="utf-8"))
c = vec["case"]

preimage = b"".join([
    vec["domain"].encode("ascii"),
    b"\x00",
    bytes.fromhex(c["intent_hash"][7:]),
    uuid.UUID(c["milestone_id"]).bytes,
    int(c["milestone_revision"]).to_bytes(4, "big"),
    uuid.UUID(c["bundle_id"]).bytes,
    bytes.fromhex(c["evidence_root"][7:]),
    bytes.fromhex(c["policy_hash"][7:]),
])
computed = "sha256:" + hashlib.sha256(preimage).hexdigest()

if computed != vec["expected"]:
    print(f"KAT MISMATCH: python={computed} vector={vec['expected']}")
    sys.exit(1)
print(f"R9 golden KAT ok ({computed}) — python implementation agrees with the vector")
