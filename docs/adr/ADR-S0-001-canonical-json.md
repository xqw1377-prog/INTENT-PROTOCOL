# ADR-S0-001 — Canonical JSON rules for hashing

- **Status**: PROPOSED (awaiting Commander review)
- **Scope**: P0-S0 Schema Freeze — `packages/protocol-schema/src/canonical.ts`
- **Implements**: Tech Arch §6.1, ADR-005 ("Canonical JSON + domain-separated hash")

## Decision

`canonicalize()` serializes a parsed JSON value as:

1. Object keys sorted by **UTF-16 code unit order** (RFC 8785 / JCS compatible).
2. `undefined` fields omitted; explicit `null` preserved and distinguishable from absent.
3. Strings **NFC-normalized** before escaping (escape set identical to `JSON.stringify`).
4. Numbers restricted to **safe integers** (`|n| ≤ 2^53-1`); `-0`, floats, NaN, Infinity rejected. Monetary values MUST be `Decimal` strings.
5. **Keys are not NFC-normalized** — only values are. Normalizing keys could collapse two distinct keys into one, making the canonical form ambiguous.
6. Arrays keep order; no whitespace anywhere.

## Rationale

- The spec mandates "字段顺序、数值格式和 Unicode 归一化必须固定" but does not name a standard. UTF-16 sort + NFC gives JCS-compatible output for the integer-only subset we accept, so a future cross-language implementation can adopt RFC 8785 verbatim plus a "reject non-integers" rule.
- Rejecting floats (rather than re-serializing them) eliminates the largest source of cross-language drift — IEEE-754 shortest-roundtrip formatting differs across JS/Java/Go/Python.

## Consequences

- Any change to these rules invalidates every golden digest. `fixtures/golden-vectors.json` + `generate-golden.mjs --check` is the drift gate.
- Known deviation from JCS: JCS allows arbitrary doubles; we reject them. Documented in SCHEMA-VERSIONING.md.
