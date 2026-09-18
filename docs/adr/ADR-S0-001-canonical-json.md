# ADR-S0-001 — IPC-JSON-1: canonical JSON rules for hashing

- **Status**: RULED (Commander 2026-09-17, incl. R13)
- **Scope**: P0-S0 Schema Freeze — `packages/protocol-schema/src/canonical.ts`
- **Implements**: Tech Arch §6.1, ADR-005 ("Canonical JSON + domain-separated hash")

## Decision

The protocol's canonical JSON profile is formally named **`IPC-JSON-1`** (`CANONICAL_PROFILE` export). It is **not** RFC 8785 / JCS and must not be described as "JCS compatible" — it is a stricter profile.

`canonicalize()` serializes a parsed JSON value as:

1. Object keys sorted by **raw UTF-16 code unit order**.
2. `undefined` fields omitted; explicit `null` preserved and distinguishable from absent.
3. Strings **NFC-normalized** before escaping (escape set identical to `JSON.stringify`).
4. Numbers restricted to **safe integers** (`|n| ≤ 2^53-1`); `-0`, floats, NaN, Infinity rejected. Monetary values MUST be `Decimal` strings.
5. **Keys must already be NFC** — a non-NFC key is *rejected*, never normalized (Commander ruling 2026-09-17, supersedes the earlier "verbatim keys" choice). This prevents both normalize-merge collisions and visually-equivalent NFC/NFD keys becoming two different field identities. Only string *values* are NFC-normalized.
6. **Unpaired UTF-16 surrogates are rejected** in both keys and values (R13).
7. Arrays keep order; no whitespace anywhere.

## Rationale

- The spec mandates "字段顺序、数值格式和 Unicode 归一化必须固定" but does not name a standard; IPC-JSON-1 is the protocol's own closed profile (R13), not a subset claim on any external standard.
- Rejecting floats (rather than re-serializing them) eliminates the largest source of cross-language drift — IEEE-754 shortest-roundtrip formatting differs across JS/Java/Go/Python.

## Consequences

- Any change to these rules invalidates every golden digest. `fixtures/golden-vectors.json` + `generate-golden.mjs --check` is the drift gate.
- Cross-language implementers target IPC-JSON-1 directly (see SCHEMA-VERSIONING.md); JCS tooling is a useful starting point but does not by itself conform (JCS allows doubles and does not enforce NFC/surrogate rules).
