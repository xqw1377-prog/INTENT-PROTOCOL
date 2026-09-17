# Intent Protocol Commander Contract

## Authority

The Commander owns:
- architecture boundaries
- stage goals and priority
- implementation task contracts
- evidence requirements
- gate decisions
- PASS / REJECT / HOLD adjudication

The Commander does not infer completion from reports. Evidence is required.

## Evidence doctrine

```text
REPORT != EVIDENCE
CODE EXISTS != CORRECT IMPLEMENTATION
TEST PASS != PROTOCOL PASS
ONE AGENT PASS != GATE PASS
UNKNOWN != PASS
```

A gate may pass only when the required implementation evidence, independent verification, negative-path tests, and reproducibility evidence are present.

## Change control

Builders MUST NOT silently change:
- canonical schema semantics
- hash/canonicalization rules
- gate definitions
- protocol trust boundaries
- settlement semantics
- on-chain/off-chain boundary
- role separation between Executor and Verifier

Ambiguities must be recorded as OPEN QUESTION.

## Prohibited before explicit gate approval

- mainnet deployment
- token issuance
- NFT/SFT productization
- DAO/governance token design
- multi-chain expansion
- 10K Protocol code merge
- production custody
- autonomous value transfer without policy and proof checks

## Branch ownership

Each work package has one implementation owner. Independent verification must remain isolated from implementation helpers where practical.

## Merge rule

Only Commander-reviewed work may merge to `main`. A PR being green is necessary but not sufficient.
