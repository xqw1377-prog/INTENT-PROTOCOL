# ADR-S0-006 — G1 exact-wire corrections: B1–B5

- **Status**: RULED (Commander adjudication of PR #4 remediation; wire frozen in docs/TRUST-CHAIN.md)
- **Scope**: `src/hash.ts`, `src/objects.ts`, `src/primitives.ts`, docs
- **Supersedes**: the provisional encodings/closures noted in ADR-S0-002, ADR-S0-003, and ADR-S0-005 (OQ-5, OQ-7, R9 encoding, settlement authority)

## Rulings and enforcement

| # | Ruling | Enforcement |
|---|--------|-------------|
| B1 | R9 `proof_binding` hashes `milestone_id` and `bundle_id` as **16-byte binary UUIDs**, not UTF-8 text. | `proofBinding()` converts each canonical UUID to its 16 raw bytes; golden `sha256:e2d7869e…` verified three-way (impl / TS oracle / Python KAT) |
| B2 | `EvidenceArtifact` and `EvidenceBundle` support `content_hash` seal round-trip like every other hashable object. | Optional `content_hash` field + `DOMAINS` mapping; `seal()` computes/verifies over `object − {content_hash, signature}`; re-seal idempotent; wrong declared hash rejected |
| B3 | `SubjectRef` identifier charset drops `@`. | `SubjectRefSchema` regex `[A-Za-z0-9._-]{1,128}` after `<kind>:` |
| B4 | `AssetRef` declares no CAIP-style semantics; `network`/`asset`/`decimals` are structural fields resolved by adapters. | `AssetRefSchema` structural-only; docs updated |
| B5 | `MilestoneV1` + `OutcomeReceiptV1` added; `SettlementInstructionV1` is **receipt-gated** on `outcome_receipt_hash` — `decision_id`/`proof_binding` are unrepresentable, and no legacy proof-keyed `settlement_key` call shape exists. | `MilestoneSchema` (`milestone.v1`), `OutcomeReceiptSchema` (`outcome-receipt.v1`), `SettlementInstructionSchema` (`settlement.v1`), `settlementKey()` accepts `{outcome_receipt_hash, escrow_ref, nonce}` only |

## Frozen trust chain (docs/TRUST-CHAIN.md)

```
Frozen Intent → MilestoneV1 → ExecutionRef → EvidenceBundleV1
  → VerificationDecisionV1 → OutcomeReceiptV1 → SettlementInstructionV1
```

- `VerificationDecisionV1` is a verifier assertion, not payment authority.
- `OutcomeReceiptV1.decision_hashes` is non-empty, unique, strictly lexicographically ascending.
- `settlement_key = SHA256("intent-protocol/v1/settlement-key" || 0x00 || outcome_receipt_hash || utf8(escrow_ref) || 0x00 || nonce_u64be)`; golden `sha256:718731ce…`.

## Consequences

- The G1 object surface is now eight trust primitives (see docs/SCHEMA-VERSIONING.md for the literal set).
- Golden vectors regenerated for `milestone.v1` and `outcome-receipt.v1` and for the receipt-gated `settlement.v1` wire.
