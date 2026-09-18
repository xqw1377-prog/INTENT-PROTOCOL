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

At minimum the receipt binds:
- receipt identity and schema version
- intent hash/commitment
- milestone_id and milestone_revision
- evidence_root
- verification_policy_hash
- deterministic accepted decision set (ids/hashes or a decision-set root)
- accepted outcome/result
- issued_at
- content_hash
- optional protocol attestation/signature

### SettlementInstructionV1
Settlement is authorized from an accepted OutcomeReceipt. It must bind outcome_receipt_hash, escrow_ref, nonce, outputs and total. A raw VerificationDecision/proof_binding cannot directly authorize settlement.

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
