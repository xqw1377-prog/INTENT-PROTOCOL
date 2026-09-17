# Schema Versioning & Backward-Compatibility Contract (S0)

Applies to all objects in `packages/protocol-schema`. `schema_version` is a **frozen literal** per object (`"intent.v1"`, `"criterion.v1"`, `"artifact.v1"`, `"bundle.v1"`, `"decision.v1"`, `"settlement.v1"`).

## Version semantics

- `schema_version` is part of the **hash preimage** (`DOMAIN || 0x00 || schema_version || 0x00 || canonical_json`). Two versions of the "same" object can never collide — by design.
- There is no field-level versioning. A version is a complete, frozen type.

## What requires a new schema version (breaking)

Any of:

- adding/removing/renaming a field
- changing a field's type, format (e.g., Decimal string → number), or enum membership
- changing canonicalization or hash construction (ADR-S0-001/002)
- changing field order semantics inside the canonical form (there is none — keys are sorted — but changing *meaning* of a field is breaking)

## What does NOT require a new version (compatible)

- documentation-only changes
- new object types (new `schema_version` literal, new Domain)

> Net rule: **any change that alters the set of valid inputs or any produced digest → new `schema_version`.** Consumers MUST reject unknown `schema_version` values (`unsupported-schema-version` golden vector).

## Migration rules

- Old versions remain parseable forever under their literal; a `vN→vN+1` migrator produces a **new object with a new digest** — never an in-place mutation of an already-anchored hash (mirrors contract upgrade policy A8 / ADR-007).
- `IntentContract.version` (object lineage) is orthogonal to `schema_version` (wire format). AmendIntent bumps `version` and links `parent_hash`; a wire-format change bumps `schema_version`.

## Cross-language implementers

- Serialization: UTF-16-sorted keys, NFC strings, JSON.stringify escape set, **integers only** (reject non-safe-integers; Decimal/u64 as strings). This is RFC 8785 minus floating-point.
- Hash: SHA-256 over `DOMAIN || 0x00 || schema_version || 0x00 || canonical_utf8`.
- Render: `sha256:<64 lowercase hex>`.
- Conformance target: byte-identical output on `fixtures/golden-vectors.json`.
