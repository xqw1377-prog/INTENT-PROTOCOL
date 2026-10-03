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
admitting `.gitattributes` into the CURRENT V3.11 allowlist, and nothing in
the current implementation may be read as narrowing or revoking the ratified
decision. `.gitattributes` remains a repository byte-integrity control and a
non-semantic governance artifact.

## USER-EVIDENCE-R0-AMENDMENT-1 — install-domain narrowing of the R0 experiment schema

Status: RATIFIED (Commander, CUT-2R1 sign-off 2026-10-03).

```text
BASIS
  = CUT-2R1 install-authority hardening (AUDIT-A / A2 closure)

CHANGE
  = RealTaskExperimentV1 R0 install domain narrowed:
      package_manager: "npm" only
      install_command: "npm ci --ignore-scripts" only
    (single source: packages/user-evidence-r0/src/schema.ts
     CANONICAL_INSTALL_COMMAND + assertInstallAuthority)

SEMANTICS
  = validation-domain tightening only
  = no new economic authority
  = no change to Tier-1 entitlement semantics
  = existing canonical R0 packs remain valid
  = previously admissible non-canonical install configs
    (pnpm/yarn/none, extra flags, chained shell) become INELIGIBLE
  = CUT-1R2 remains landed history; this amendment records that its
    schema surface was TIGHTENED by CUT-2R1, never silently
```

Context: CUT-1R2 (landed at main 13b0145) admitted
`install_command: string` / `package_manager: npm|pnpm|yarn|none`, which the
CUT-2 audit classified as frozen-string → arbitrary-shell authority. CUT-2R1
(@ ca0c646, Commander-signed PASS) closed it to a canonical direct-argv
operation. This entry exists so the narrowing is governed history, not an
unrecorded change to a landed cut.
