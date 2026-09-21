# ADR-S0-005 — Final S0 semantic closure: R9–R14

- **Status**: RULED (Commander PR #4 review, 2026-09-17)
- **Scope**: `src/hash.ts`, `src/primitives.ts`, `src/objects.ts`, `src/canonical.ts`, docs
- **Effect**: after the commit implementing this ADR, the S0 semantic surface is FROZEN. Commander will not extend schema/hash rules further unless independent conformance finds a concrete contradiction or security defect.

## Rulings and enforcement

| # | Ruling | Enforcement |
|---|--------|-------------|
| R9 | `proof_binding` must bind `milestone_id` and `bundle_id` — binding to revision/root/policy alone is insufficient (cross-object replay). | `proofBinding()` preimage now includes both UUIDs (UTF-8) plus a domain prefix; `VerificationDecisionSchema` recompute-check updated |
| R10 | A `seal()`ed object must re-parse under its own strict schema, and re-sealing is idempotent. | Regression test: `Schema.parse(seal(x))` and `seal(seal(x)) === seal(x)` |
| R11 | UUIDs are frozen to lowercase, standard hyphenated 8-4-4-4-12 form. | `UUIDSchema` strict regex (replaces `z.uuid()`, which accepted uppercase/non-hyphenated) |
| R12 | V1 settlement is **single-asset** (all `outputs[].asset` identical triple); every amount's scale ≤ `asset.decimals`; Budget `execution_cap ≤ total`. | `SettlementInstructionSchema` + `BudgetSpecSchema` superRefines; `decimalCompare`/`decimalScale` (BigInt, no floats) |
| R13 | Canonical profile formally named **`IPC-JSON-1`**; drop all "JCS compatible" claims; reject unpaired surrogates. | `CANONICAL_PROFILE` export; `hasLoneSurrogate()` check on keys and values; docs updated |
| R14 | All remaining S0 OPEN QUESTIONS closed (see below). | `docs/OPEN-QUESTIONS.md` rewritten — no OPEN items remain |

## R14 closures (adopted per Commander freeze directive)

Commander ruled that the remaining questions are closed. Builder A's provisional resolutions are **ratified as the frozen semantics** (exact per-item wording lives in the PR #4 review; if any item differs there, correct via follow-up ruling):

- **OQ-1** → profile named `IPC-JSON-1` (R13), own closed spec, no JCS claim.
- **OQ-4** → `state` stays inside the hash preimage ONLY for `EvidenceBundle` (OPEN/SEALED carries data invariants); other objects carry no lifecycle fields.
- **OQ-5** → `SubjectRef` = `<kind>:<id>`, kinds {user,org,agent,verifier,arbitrator,service,operator}, `@` allowed in id.
- **OQ-6** → signature schemes frozen to {ed25519, secp256k1, eip191, eip712, passkey-p256}.
- **OQ-7** → `AssetRef` = `{network, asset, decimals}`, CAIP-2-flavored network id.
- **OQ-9** → `signature`/`change_reason` remain schema-optional; freeze-time signing is a workflow rule (S1), not wire-required.

## Consequences

- Golden digests changed again vs. `12173d0` (R9 binding formula). Superseded, not drift.
- New negative vectors: `uppercase-uuid`, `non-hyphenated-uuid`, `multi-asset-settlement`, `amount-scale-exceeds-asset-decimals`, `execution-cap-over-total`, `unpaired-surrogate-value`, `unpaired-surrogate-key`.
- New semantic-mutation vector: `different-milestone-or-bundle-id-changes-proof-binding`.
