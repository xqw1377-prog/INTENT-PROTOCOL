# @intent/protocol-schema

P0-S0 Schema Freeze for Intent Protocol: the six canonical protocol objects, deterministic canonical serialization, and domain-separated hashing.

**Status: IMPLEMENTED / AWAITING COMMANDER REVIEW** (not P0-PASS)

## Objects (Appendix A, Tech Arch V0.1)

| Object | `schema_version` | Schema | Self-digest |
|--------|------------------|--------|-------------|
| IntentContractV1 | `intent.v1` | `IntentContractSchema` | `seal()` / `contentHash()` |
| CriterionV1 | `criterion.v1` | `CriterionSchema` | hashed inside parent intent |
| EvidenceArtifactV1 | `artifact.v1` | `EvidenceArtifactSchema` | `seal()` |
| EvidenceBundleV1 | `bundle.v1` | `EvidenceBundleSchema` | `seal()` + `merkleRoot()` |
| VerificationDecisionV1 | `decision.v1` | `VerificationDecisionSchema` | `seal()` + `proofBinding()` |
| SettlementInstructionV1 | `settlement.v1` | `SettlementInstructionSchema` | `seal()` + `settlementKey()` |

## Rules (frozen — see docs/adr)

- `canonicalize()`: UTF-16 key sort, NFC-required keys (non-NFC keys rejected), NFC-normalized values, integers only, `-0` rejected, no whitespace (ADR-S0-001/004).
- `hashObject(domain, schema_version, payload)` = `SHA256(domain || 0x00 || version || 0x00 || canonical)` (ADR-S0-002).
- `proof_binding` binds decision → frozen intent + revision + evidence root + policy (anti replay).
- `settlement_key` binds instruction → proof_binding + escrow + nonce (anti double spend).
- `seal()` validates, computes `content_hash`, and rejects a declared-but-wrong digest.
- Schema-level economic consistency (Commander rulings, ADR-S0-004): canonical non-negative Decimals; `criterion_id`/`constraint_id` uniqueness; SEALED `merkle_root` must recompute; settlement `total_amount` must equal exact `decimalSum(outputs)`; decision `proof_binding` must recompute.

## Golden vectors

`fixtures/golden-vectors.json` is the freeze artifact. Regenerate / drift-check:

```bash
npm run build
node packages/protocol-schema/scripts/generate-golden.mjs          # regenerate
node packages/protocol-schema/scripts/generate-golden.mjs --check  # exit 1 on drift
```

## Out of scope (P0-S0)

State machines, workflows, events/outbox, adapters, contracts, UI — see docs/OPEN-QUESTIONS.md for deferred rulings.
