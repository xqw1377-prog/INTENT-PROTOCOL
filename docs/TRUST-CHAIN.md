# Intent Protocol Trust Chain

Status: COMMANDER-RULED / G1 NORMATIVE

## Core chain

```
Frozen Intent
-> MilestoneV1
-> ExecutionRef
-> EvidenceBundleV1
-> VerificationDecisionV1
-> OutcomeReceiptV1
-> SettlementInstructionV1
```

## Authority boundaries

### VerificationDecisionV1
A signed verifier assertion about evidence. It may be VALID, INVALID, INSUFFICIENT, or DISPUTED according to the verification model. A VerificationDecision is not payment authority.

### OutcomeReceiptV1
The protocol-recognized accepted outcome for one milestone revision after the verification policy is satisfied. Receipt formation/aggregation logic executes in S1, but the receipt wire/hash object and deterministic bindings are frozen in G1.

### SettlementInstructionV1
Settlement is authorized only from an accepted OutcomeReceipt. A raw VerificationDecision / proof_binding is never settlement authority.

---

## Frozen wire contracts

These field names and schema_version literals are normative for G1. Builder A and Builder B MUST implement these exact names; semantic aliases are not conforming.

### MilestoneV1

`schema_version = "milestone.v1"`

Required fields:
- `milestone_id: UUID`
- `intent_hash: Hash`
- `milestone_revision: U32 >= 1`
- `criterion_ids: string[]` — non-empty, unique, array order is canonical/significant
- `verification_policy_hash: Hash`
- `settlement_policy_hash: Hash`
- `allocation: { asset: AssetRef, amount: Decimal }`
- `content_hash?: Hash`
- `signature?: Signature`

Rules:
- `allocation.amount` scale <= `allocation.asset.decimals`.
- changing any required field changes the object digest.
- Milestone identity is the tuple `(intent_hash, milestone_id, milestone_revision)`.

Hash domain:
`intent-protocol/v1/milestone`

### OutcomeReceiptV1

`schema_version = "outcome-receipt.v1"`

Required fields:
- `receipt_id: UUID`
- `intent_hash: Hash`
- `milestone_id: UUID`
- `milestone_revision: U32 >= 1`
- `evidence_root: Hash`
- `verification_policy_hash: Hash`
- `decision_hashes: Hash[]` — non-empty, unique, strictly lexicographically ascending
- `accepted_result: "ACCEPTED"`
- `issued_at: Timestamp`
- `content_hash?: Hash`
- `signature?: Signature`

Rules:
- `decision_hashes` is the deterministic accepted-decision set committed by the receipt.
- duplicates or non-sorted decision_hashes are invalid.
- receipt formation/verification-policy satisfaction is S1; the S0 object only freezes the commitment structure.
- changing any required field changes the object digest.

Hash domain:
`intent-protocol/v1/outcome-receipt`

### SettlementInstructionV1

`schema_version = "settlement.v1"`

Required fields:
- `settlement_id: UUID`
- `escrow_ref: string`
- `outcome_receipt_hash: Hash`
- `nonce: U64`
- `outputs: SettlementOutput[]` — non-empty
- `total_amount: Decimal`
- `expires_at?: Timestamp`
- `content_hash?: Hash`

Forbidden authority fields in V1:
- `decision_id`
- `proof_binding`

Rules:
- all outputs use the exact same `AssetRef` triple.
- every output amount scale <= asset.decimals.
- total_amount scale <= asset.decimals.
- total_amount == exact sum(outputs.amount).
- settlement authorization is structurally receipt-gated by `outcome_receipt_hash`.

Hash domain:
`intent-protocol/v1/settlement-instruction`

Settlement idempotency key is frozen as:

```
settlement_key = SHA256(
  "intent-protocol/v1/settlement-key" || 0x00
  || outcome_receipt_hash[32]
  || UTF8(escrow_ref) || 0x00
  || nonce_u64be[8]
)
```

The variable-length escrow_ref is terminated by the explicit `0x00` separator before the fixed-width nonce.

---

## G1 trust primitives

1. IntentContractV1
2. CriterionV1
3. MilestoneV1
4. EvidenceArtifactV1
5. EvidenceBundleV1
6. VerificationDecisionV1
7. OutcomeReceiptV1
8. SettlementInstructionV1

## Deferred to S1

The following are not S0 structural parsing requirements:
- lookup/existence of referenced ledger objects
- verification-policy aggregation execution
- receipt issuance workflow authorization
- freeze-time signature enforcement
- lifecycle transition machinery

G1 still requires the S0 objects to carry enough deterministic data to make those S1 checks unambiguous.
