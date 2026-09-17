# ADR-S0-002 — Domain-separated hash construction

- **Status**: PROPOSED (awaiting Commander review)
- **Scope**: `packages/protocol-schema/src/hash.ts`, `src/merkle.ts`
- **Implements**: Tech Arch §6.1 hash rules; threat mitigations for Proof Replay and Settlement Double Spend (§17)

## Decision

```
hash_input     = DOMAIN || 0x00 || schema_version || 0x00 || canonical_json(payload)
content_hash   = SHA256(hash_input)                     → "sha256:<64hex>"
proof_binding  = SHA256(intent_hash || rev_u32be || evidence_root || policy_hash)
settlement_key = SHA256(proof_binding || escrow_id || 0x00 || nonce_u64be)
```

Merkle (EvidenceBundle.artifact_hashes):

```
leaf  = SHA256("intent-protocol/v1/merkle-leaf" || 0x00 || artifact_hash)
node  = SHA256("intent-protocol/v1/merkle-node" || 0x00 || left || right)
```

- Leaf hashes are **deduplicated + sorted bytewise** before tree construction, so artifact submission order does not change the root.
- Odd trailing nodes are **promoted** (not duplicated) — duplication allows second-preimage forgery of roots.
- `milestone_revision` is u32-BE, `nonce` u64-BE in the binding preimages (fixed-width, unambiguous concatenation).

## Rationale

- Every preimage carries a domain + schema_version so objects of different kinds/versions can never collide (§6.1 requirement).
- `proof_binding` binds a decision to one frozen intent version + milestone revision + evidence root + policy hash — an old proof cannot be replayed onto a new target (§17 Proof Replay).
- `settlement_key` is the on-chain/off-chain idempotency key; the same instruction can never produce two releases (§17 Double Spend, ADR-011).

## Consequences

- `seal()` refuses to attach a `content_hash` that doesn't recompute — received-object tamper check.
- All digests render as `sha256:<64 lowercase hex>`; other encodings are schema errors.
