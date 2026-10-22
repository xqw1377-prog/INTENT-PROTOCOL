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

## EXPERIMENT-001-AMENDMENT-1 — sponsored-relationship adjudication

Status: **RATIFIED (Commander order 2026-10-22 “根据你的建议执行”， adopting
the operator's decision-point path 1; this entry IS that adjudication,
recorded by the operator on order).**

```text
BASIS
  = round-1 refusal (gcode-preview: "We don't pay for contributions.
    This is a hobby project. Non-commercial.", 2026-10-03, verbatim in
    EXPERIMENT-001-CANDIDATES.md) + round-2 structural finding (the
    {npm+lockfile ∧ offline-pure-suite ∧ payer-culture ∧ small-bug}
    intersection is empty in the searched pool)

CHANGE (recruitment + recording semantics for EXPERIMENT-001 only)
  = the symbolic Tier-1 reward is funded by the experiment SPONSOR
    (the Commander), never by the maintainer
  = ledger/identity recording: funder = SPONSOR (declared identity);
    maintainer role = rule-co-author + ACCEPTOR
  = the F5 question keeps its frozen wording; under this framing its
    answer is ACKNOWLEDGMENT evidence — "the maintainer accepts that
    the frozen Tier-1 was earned under rules agreed before work began"
  = every ledger/conclusion of a sponsored run MUST name the framing
    (e.g. "THESIS MIXED (SPONSORED-RELATIONSHIP)"); such conclusions
    are NOT citable as maintainer-as-payer / payment-behavior evidence
    in any later claim (PRODUCT-THESIS-R0's PAYER-ACCEPTS line is NOT
    converted by a sponsored run)
  = the charter ledger line "REAL PAYER 0→1" is NOT converted by a
    sponsored run; it stays 0 until a maintainer-funded transaction
  = a maintainer who refused the payer role may be re-approached under
    these terms ONLY in a new round, with the terms change stated up
    front and the prior refusal acknowledged (new-round re-approach,
    not same-round shopping)

UNCHANGED
  = PRE-MONEY / symbolic amount only · REAL FUNDS DENIED · MAINNET
    DENIED · single claimant · Tier-1 only · no auto-release · UI /
    protocol expansion HOLD
  = the frozen flow (PREP → F1 … F5 → FINALIZE), the trust anchor,
    and UE-0..UE-5 frozen bytes
  = recruitment discipline (experiment first, no protocol/blockchain
    talk, one qualifying question, plain reply = agree, no signatures)
```
