# Governance Amendments

Explicit amendments to frozen governance surfaces. Each entry is scoped and
recorded here so that no frozen surface is widened silently. Freezing authority
remains with the Commander; entries below are PROPOSED until ratified.

## AMEND-001 — `.gitattributes` admitted to the GP-ID-R1 identity scope allowlist

Status: RATIFIED (Commander, MAIN-CLOSURE-R1). Terms: no wildcard expansion, no
directory-wide exemption, no other root artifact implied.

Context:
`packages/golden-path/identity/test/identity-v3.test.ts` [V3.11] asserts that the
GP-001 identity materialization touched only identity-scoped paths. `.gitattributes`
was introduced later as a repository byte-integrity control (it carries `pack/** -text`
and the other `-text` directives that keep the GP5 proof pack byte-stable across
checkouts). It consequently appeared as a scope violation against a frozen allowlist
that predates it.

Classification — the reason this is an amendment and not a silent widening:
- `.gitattributes` is a **repository byte-integrity control**.
- It is a **non-semantic governance artifact**: it holds no protocol semantics,
  no wire bytes, and no hashes. It only directs Git's line-ending/attribute handling.
- It is not, and must not be treated as, part of the frozen protocol surface.

Decision:
`.gitattributes` is admitted to the identity scope allowlist **explicitly**.

Constraints preserved:
- The allowlist stays an exact-match list; no wildcard and no directory prefix is added.
- No other root-level artifact is admitted by this amendment.
- The amendment does not relax any protocol, wire, or hash assertion.

## Reconciliation (REMOTE-MATERIALIZATION-R2 governance reconcile)

AMEND-001 stands as a **RATIFIED HISTORICAL GOVERNANCE DECISION**. The final
MAIN-CLOSURE-R1 line has since replaced V3.11's semantics with a pinned
freeze-window (`BASE(3fbef70)..materialization(545cb43)`), so `.gitattributes`
no longer participates in that historical window: the pinned window contains
identity-scoped paths only, and the post-materialization guard freezes the
identity objects themselves. Therefore this amendment does **not** require
admitting `.gitattributes` into the CURRENT V3.11 allowlist, and nothing in the
current implementation may be read as narrowing or revoking the ratified
decision. `.gitattributes` remains a repository byte-integrity control and a
non-semantic governance artifact.
