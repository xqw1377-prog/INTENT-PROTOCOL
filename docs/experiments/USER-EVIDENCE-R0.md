# USER-EVIDENCE-R0 — Experiment Contract (UE-0 Freeze)

Status: **PASS / FROZEN-R0 (Commander sign-off 2026-10-03 @ CUT-2R1
ca0c646). UE-0 / UE-1 / UE-2 / UE-3 / UE-4 / UE-5 = PASS / FROZEN-R0.
Technical readiness for EXPERIMENT-001 = YES — repository self-proof
phase CLOSED by Commander order; user-evidence-r0 code is FROZEN (no
further changes without a new cut). PMF / payer demand / commercial
viability remain NO-EVIDENCE — that is what EXPERIMENT-001 exists to
test.**

Authority: Commander order `USER-EVIDENCE-R0 / CUT-1 = GO` (2026-10-01);
`USER-EVIDENCE-R0 / CUT-2..CUT-4 = GO` (2026-10-03, repo-authority directive:
land the remaining experiment machinery in priority order — UE-2 runner,
UE-3+UE-4 proof/replay, UE-5 ledger).
Product north star: a real repo owner freezes Tier-1 rules BEFORE work
begins; a real external worker does the task; a third party replays the
proof; we observe whether the payer acknowledges the Tier-1 entitlement as
irrevocable. Technical proof ≠ user evidence — never conflated.

## 1. Standing boundaries

```text
EXPERIMENT MODE   = PRE-MONEY / TESTNET-VALUE ONLY
CLAIMS            = SINGLE CLAIMANT / SERIAL ONLY (hard-coded for R0)
TIER 1            = YES
TIER 2 EXECUTION  = NO — pre-declaration recorded, no dispute machinery
AUTO RELEASE      = NO (silence→release authority = HOLD, separate gate)
CHAIN WRITE       = NOT REQUIRED (no chain writes in UE-R0)
GP-001 FROZEN TASK FREEZE RECORD = UNTOUCHED (separate object below)
MAINNET           = DENIED
REAL FUNDS        = DENIED
Web/marketplace/frontend/wallet onboarding = HOLD
```

## 2. RealTaskExperimentV1 — schema (UE-0)

A NEW object, deliberately separate from the historical GP-001 Task Freeze
Record. Frozen fields (NO free Tier-1 judging variable may remain after
START):

```text
experiment_id
repository_url
base_commit_sha

payer_identity
worker_identity            (bound at claim time; single claimant)

acceptance_suite          (the frozen FAIL→PASS regression + full-suite spec)
acceptance_suite_sha256

lockfile_path
lockfile_sha256

allowed_paths
forbidden_paths           (tests / fixtures / CI / workflows / lockfile)

max_diff_lines
new_dependencies_allowed  = false (hard-coded false in R0)

network                   = disabled (hard-coded in R0)
determinism_runs          = N (frozen at freeze time; default 3)

tier1_reward
tier2_reward              (declared, priced, NOT executed in R0)

claim_mode                = SINGLE_CLAIMANT (hard-coded)

payer_precommit_text      (exact wording; hash-bound to ruleset_hash)
payer_precommit_timestamp

ruleset_hash              (sha256 over canonical ruleset bytes — single
                           source: the same constants the validators run)
```

## 3. UE-0 PASS conditions (CUT-1R form — dual-hash contract binding)

```text
UE0-R1 precommit flips when Tier1 amount changes
UE0-R2 precommit flips when Tier2 amount changes
UE0-R3 payer/worker identity change invalidates binding (every frozen
      command too; identity-stable on unchanged input)
UE0-R4 all required fields strict-validated (each miss named)
UE0-R5 all sha256 fields exact grammar ^sha256:[0-9a-f]{64}$

Dual hash (single source, schema.ts):
  VERIFICATION_RULESET_HASH = verification rules + frozen COMMANDS only
  CONTRACT_FREEZE_HASH      = payer + claimant + tier1_reward + tier2_reward
                             + claim mode + auto_release=ABSENT +
                             tier2_execution=ABSENT + verification_ruleset_hash
  payer_precommit binding → CONTRACT_FREEZE_HASH + exact words + timestamp.
  The precommit commits to the MONEY and the RULES — a post-hoc tier1/tier2
  swap is structurally detectable (product constitution enforced here).
```

## 4. UE-1 — Real Task Freezer (CUT-1R form — command freeze, real enforcement)

CLI: `intent experiment freeze <repo> <task-config>` — the contract freezes
COMMAND STRINGS (not just test paths; real repos are not all Vitest):
regression_command / baseline_health_command / patched_acceptance_command /
optional build+typecheck / package_manager / install_command — all inside the
hashed contract. Preflight in a temp STAGING dir, ATOMIC publish only after
every check passes; ANY miss → INELIGIBLE with the output dir untouched.

```text
UE1-R1 regression_command REALLY FAILS at base (executed in sandbox)
UE1-R2 baseline_health_command REALLY PASSES at base (executed in sandbox)
UE1-R3 dependency env reconstructed CLEAN-ROOM from the frozen lockfile
      (vendored node_modules removed first; npm ci with frozen lockfile)
UE1-R4 network access attempt REALLY FAILS inside the sandbox
      (macOS sandbox-exec (version 1)(allow default)(deny network*);
       Linux unshare -n) — negatively probed: TCP 1.1.1.1:53 must FAIL,
       local execution must still work
UE1-R5 same frozen commands + same base reproduce the SAME results N times
UE1-R6 failed freeze leaves ZERO publishable artifact set (stale outputs
      from a previous run are never overwritten or mistaken for success)

Deferred to UE-2 with explicit gates (NOT claimed by UE-1):
  UE2-PATH-DENY          forbidden-path patch enforcement
  UE2-DEPENDENCY-DENY    dependency-addition rejection
```

### 4a. CUT-1R2 — artifact persistence (final UE-1 form)

```text
UE1-R6A publish is GENERATION-ATOMIC: the complete generation is built in
      a sibling temp dir, fsync-verified, self-checked (staged task
      re-derives the staged ruleset/contract/hashes), then RENAMED into
      place. outDir must NOT pre-exist (no overwrite, no mixed generations;
      a second freeze into the same dir is refused with the old set intact).
      Publish success → 4/4 same-generation artifacts; failure → 0/4.
UE1-R6B injected publish failure (unwritable parent) exposes ZERO partial
      new generation and ZERO staging residue.

UE1-R7  contract-freeze.json on disk is EXACTLY ContractFreezeV1
      (contractFreezeOf(experiment)) — the same object the hash commits.
UE1-R8  canonical-hash(contract-freeze.json) == manifest.contract_freeze_hash
UE1-R9  canonical-hash(ruleset.json)        == manifest.verification_ruleset_hash
UE1-R10 precommitBinding(task.json)          == manifest.precommit_binding

The four artifacts form a self-verifying closure:
task.json derives ruleset.json + contract-freeze.json; the manifest hashes
both; the precommit binding re-derives from the task alone. A portable
verifier (UE-4) will re-check exactly these identities from disk.
```

## 5. Later cuts

UE-2 (runner) / UE-3 (proof builder) / UE-4 (third-party replayer) /
UE-5 (user-evidence recorder) were design-only under CUT-1; CUT-2..CUT-4
(2026-10-03) authorize their implementation (§7–§10 below). `experiments/001/`
may still only be created when a REAL maintainer + REAL repo + REAL bug
exist. No fictional fixtures.

## 6. Final experiment ledger (the ONLY allowed report form)

```text
REAL PAYER / REAL TASK / REAL EXTERNAL WORKER / PAYER PRE-COMMIT
BASE RED / PATCH GREEN / FULL SUITE / THIRD-PARTY REPLAY (SAME|DIFFERENT)
PAYER ACCEPTS TIER-1 ENTITLEMENT / POST-HOC RULE CHANGE REQUEST (0|N)
REPEAT-FUND INTENT (YES|NO|NOT ASKED)
→ exactly one of: THESIS STRENGTHENED | THESIS MIXED | THESIS CHALLENGED
One experiment ≠ product-market fit.
```

---

## 7. CUT-2 — UE-2 Real Task Runner (pre-execution policy wall)

CLI: `intent experiment run <repo> <freeze-pack> <patch> <ran-at> [out]`.
Order of authority: intake closure → policy wall → dependency wall →
clean-room execution. The two gates deferred from UE-1 land here.

```text
UE2-R0  INTAKE   the freeze pack re-verifies from disk (UE1-R7..R10
      discipline re-enforced at intake): ruleset/contract must be exactly
      what task.json derives; all manifest hashes re-derive. A broken pack
      refuses the run BEFORE anything executes (no record, no commands).
UE2-PATH-DENY   a touched path matching any forbidden glob → INVALID
      (reason names the path), ZERO commands executed. Includes the frozen
      suite files, the lockfile, CI/workflows — the tests that define
      Tier-1 can never be touched by the patch that claims it.
UE2-SCOPE       a touched path matching NO allowed glob (and no forbidden
      glob) → INVALID out-of-scope. Scope is allowed-allowlist, not
      deny-list.
UE2-DIFF-BOUND  total diff lines (added + removed, excluding +++, ---)
      over max_diff_lines → INVALID, no execution.
UE2-BINARY      a binary patch → INVALID (R0: text diffs only).
UE2-DEPENDENCY-DENY  the dependency sections (dependencies,
      devDependencies, peerDependencies, optionalDependencies,
      bundledDependencies, overrides, resolutions) of any touched
      package.json must be IDENTICAL before/after; a newly created
      package.json must carry all-empty sections; deleting one counts as
      changing every dependency → INVALID. new_dependencies_allowed is
      hard-coded false and enforced HERE, not by trust.
UE2-BASE-RED    the run re-proves regression_command FAILS on the frozen
      base at run time (clean-room materialized, sandboxed) — the pack
      never trusts the freeze-time red.
UE2-BYTES       lockfile + acceptance-suite bytes re-hash to the frozen
      values before AND after the patch (drift = INVALID).
UE2-ACCEPT      patched_acceptance_command PASSES with the patch applied
      (network-denied sandbox); a clean-applying patch that does not fix
      the bug → INVALID patched-acceptance-red.
UE2-HEALTH      baseline_health_command still PASSES on the patched tree
      (no existing test broken).
UE2-DET         N consecutive patched-acceptance runs all green
      (flaky = INVALID determinism-unstable).
UE2-RECORD      every execution recorded (stage, command, exit code,
      stdout sha256, duration); verdict VALID iff every check holds —
      there is no other path to VALID. Records write atomically and are
      never overwritten.

Normative grammar (frozen):
  patch format = unified diff (git diff form), text files only
  touched path = union of a/b sides of every file entry + rename from/to
  glob         = "**" crosses "/", "*" does not; forbidden wins over allowed
```

### 7a. CUT-2R — UE-2 blocker closures (AUDIT-A)

```text
UE2-R-PATH  (A1) path canonicalization is a PURE-LAYER wall that runs
      before any glob and any command. A touched path is admissible
      ONLY as a canonical repo-relative POSIX path: no leading "/",
      no ".."/"." segments, no empty segments, no backslash, no NUL,
      no ":" (kills Windows drive/colon forms). Quoted headers are
      unquoted FIRST, then canonicalized. Symlink patches (git mode
      120000 anywhere in the diff) are rejected outright in R0.
      Additionally, after base materialization and BEFORE any command,
      no component of any touched path may be a symlink in the base
      tree (writing through a symlinked directory modifies bytes the
      hashes never covered). Machine-tested with zero-command
      negatives: ../ traversal, absolute header, rename-to-../,
      quoted traversal, empty/dot segments, symlink patch, and a
      canonical in-scope path through a base-tree symlink.
      Git's own apply safety is NEVER relied upon.

UE2-R-INSTALL (A2) the install boundary is EXPLICIT and choice B is
      frozen for R0: install_command is a bootstrap phase whose only
      authority is dependency materialization — lifecycle scripts are
      FORCE-disabled via environment (project .npmrc cannot re-enable
      them), so no dependency code executes during install. The
      bootstrap is NOT trusted: after install, the acceptance-suite
      bytes and lockfile bytes are RE-HASHED against the frozen values
      (post-install-suite-drift / post-install-lockfile-drift =
      INVALID with zero verdict commands executed). The same boundary
      is enforced identically by the portable verifier's re-execution.
      UE-1 freeze preflight semantics are UNTOUCHED (CUT-1R2 is a
      separate landed cut).
```

### 7b. CUT-2R1 — INSTALL AUTHORITY (the A2 closure; Commander GO 2026-10-03)

```text
R0 INSTALL CONTRACT (single source: schema.ts)
  package_manager = npm ONLY (non-npm repos are INELIGIBLE for
                    EXPERIMENT-001 — by ruling, acceptable)
  install_command = EXACTLY "npm ci --ignore-scripts"
  execution       = DIRECT ARGV: execFile("npm", ["ci","--ignore-
                    scripts"]) in BOTH the runner and the portable
                    verifier — install is a dependency-materialization
                    operation, never shell authority. Chaining is
                    structurally impossible: no other string can be
                    frozen.

INSTALL-R1  non-canonical install_command (curl|sh, node setup.js,
      npm install, extra flags, pnpm/yarn forms, non-npm
      package_manager) is rejected at FREEZE and at INTAKE — before
      anything executes, nothing published.
INSTALL-R2  shell chaining after the canonical prefix
      ("npm ci --ignore-scripts && …", "; …") = rejected — exact-match,
      no parsing games.
INSTALL-R3  a hostile root lifecycle script (fixture: preinstall that
      appends to the frozen acceptance suite) does NOT execute — the
      canonical argv runs with --ignore-scripts (flag) + env double-
      disable; the suite bytes survive install and the run stays
      VALID. Post-install re-hash retained as defense-in-depth, not as
      the only boundary.
INSTALL-R4  runner and portable verifier execute the exact same argv
      contract — verified at source level (schema.ts is the single
      literal source; run.ts derives, verify.mjs re-declares) and
      behaviorally (hostile-repo VALID verdict reproduced end-to-end
      by the replayer's independent direct-argv execution).

UE5 WORDING (CUT-2R1): payer_attestation = SIGNED renders
      "SIGNED_STATEMENT / RECORDED" and "PAYER ATTESTATION: SIGNED /
      NOT MACHINE-VERIFIED" — the machine verifies NO signature; a
      signed observation is recorded, never presented as
      machine-attested. ("PAYER-ATTESTED" is retired until real
      signature verification exists.)
```

## 8. CUT-3 — UE-3 Portable Outcome Proof pack

CLI: `intent experiment proof <repo> <freeze-pack> <patch> <run-record>
<built-at> <out-dir>`. The pack IS the entire portable Tier-1 evidence.

```text
PACK CONTENTS (exactly nine files, no more, no less)
  task.json / ruleset.json / contract-freeze.json / freeze-manifest.json
    — byte-verbatim copies of the freeze generation
  worker.patch     — the patch bytes (hash-bound to the run record)
  run-record.json  — byte-verbatim UE-2 record
  base.bundle      — git bundle carrying the EXACT frozen base commit
                     (local clone → pinned ref ue-base → bundle; self-checked
                     by cloning the bundle back and rev-parsing)
  verify.mjs       — the standalone third-party verifier (see §9)
  proof-manifest.json — root of trust: sha256 + byte size of every file,
                     re-derived freeze identities, patch sha, tier1_verdict

UE3-ATOMIC   generation-atomic publish (staging sibling → fsync → full
      self-check → rename); outDir must not pre-exist; 9/9 or 0/9.
UE3-BASE-BYTES  the bundle ALONE materializes the exact frozen base
      (rev-parse == base_commit_sha); suite + lockfile byte hashes
      re-verify from the bundle contents.
UE3-VERBATIM  worker.patch and run-record.json enter byte-identical.
UE3-NO-INVALID  only a run whose DERIVED verdict is VALID may enter a
      Tier-1 proof pack (INVALID runs are evidence, not entitlement).
UE3-VERDICT   tier1_verdict is a FUNCTION of the record, never an
      assertion: VALID iff verdict==VALID ∧ every check field equals its
      required constant ∧ determinism is a full n/n (n>=1) ∧ runs
      non-empty and well-formed. Flipping any single check flips it.
```

## 9. CUT-3 — UE-4 Third-party replayer (verify.mjs)

STANDALONE BY CONTRACT: plain JavaScript, Node built-ins only, zero
imports from src/ — every identity formula, policy rule, and execution
step is re-implemented independently (verifier independence over code
sharing). Third party: unpack the pack, run `node verify.mjs` with only
node+git+npm on PATH. Four stages, in order:

```text
UE4-INTEGRITY  exact 9-file set; every file's sha256 + byte size must
      match proof-manifest.json; no unlisted file survives.
UE4-CLOSURE    freeze identities re-derive from the pack bytes alone
      (ruleset/contract projection, both hash formulas, precommit
      binding, hard-coded contracts: network=disabled,
      new_dependencies=false, SINGLE_CLAIMANT).
UE4-BINDING    the manifest's tier1_verdict re-derives from
      run-record.json; record is hash-bound to THIS freeze and patch.
UE4-REALITY    the full pipeline re-executes from the pack ALONE: clone
      the bundle at ue-base, verify suite/lockfile bytes, policy wall,
      clean-room install, net-sandbox probe, base red, patch apply,
      patched green, baseline green, N-run determinism. The reproduced
      verdict MUST equal the recorded one.

Tamper lattice (all machine-tested):
  one flipped byte in worker.patch          → integrity FAIL
  edited run record (no manifest rehash)    → integrity FAIL
  edited money term + rehashed manifest     → closure FAIL
  fully rehashed coordinated lie (swapped
  patch, consistent record + manifest)      → binding passes,
                                              REALITY FAILS — the bytes
                                              have to actually work
  standalone run (bare node, cwd = pack)    → same verdict, no repo,
                                              no vitest, no service
```

### 9a. CUT-2R — UE-4 blocker closure (AUDIT-B)

```text
UE4-R-TRUST  (B1) a proof pack can NEVER vouch for its own verifier.
      Trust root: packages/user-evidence-r0/VERIFIER-RELEASE.json —
      package-external, frozen sha256 of portable-replay.mjs.
        · proof-manifest.json stamps verifier_sha256 (== the hash of
          the verify.mjs bytes in the pack) so the identity is
          checkable BEFORE running anything;
        · when the verifier runs FROM THE REPOSITORY (release file
          present), a pack whose embedded verify.mjs differs from the
          release — even with a fully rehashed manifest — fails at
          integrity (verifier-identity). Machine-tested with exactly
          that coordinated swap;
        · standalone mode prints VERIFIER_SHA256 for OUT-OF-BAND
          comparison and states outright that a pack cannot vouch for
          its own verifier — the printed value is a convenience,
          never a proof;
        · third-party order (frozen in the release file): obtain the
          release from a trusted source → compare the pack's
          verify.mjs hash → only then run.
      Also closed: proof-manifest.files must list EXACTLY the expected
      file set (minus the manifest itself) — an attacker cannot
      silently drop an entry they chose not to rehash
      (manifest-file-set).
```

## 10. CUT-4 — UE-5 user-evidence recorder + final ledger

CLI: `intent experiment ledger <proof-pack> <observations.json> <out>`.
The ledger is the ONLY allowed report form (§6). Technical evidence and
user evidence live in separate fields and are never conflated (PT-5R1).

```text
UE5-R1  VERIFIED-ONLY  user evidence may be recorded ONLY on top of a
      proof pack whose INDEPENDENT replay PASSES with reproduced Tier-1
      verdict VALID. The replay report binds to the pack by manifest
      hash AND a digest over every pack byte — a pack tampered after
      the replay is refused (stale-report attack closed).
UE5-R2  ACCEPT-FLIPS   payer rejection → THESIS CHALLENGED; acceptance
      requires the payer's VERBATIM words + timestamp as a durable
      record (never reconstructed from memory).
UE5-R3  RULE-CHANGE    any post-hoc rule-change attempt (with one
      detail per attempt) blocks STRENGTHENED → MIXED.
UE5-R4  DETERMINISTIC  same observations → byte-identical ledger.
UE5-R5  APPEND-ONLY    a written ledger is never overwritten.
UE5-RENDER  the ledger renders the exact §6 line form; the verdict is
      derived, not asserted.

Frozen verdict mapping (total, no free variable):
  payer does NOT accept the Tier-1 entitlement      → THESIS CHALLENGED
  payer accepts ∧ any post-hoc rule-change attempt  → THESIS MIXED
  payer accepts ∧ 0 attempts ∧ repeat-fund ≠ YES    → THESIS MIXED
  payer accepts ∧ 0 attempts ∧ repeat-fund = YES    → THESIS STRENGTHENED
third_party_replay = DIFFERENT refuses the ledger entirely (an
irreproducible pack carries no user evidence). One experiment ≠
product-market fit; the ledger records, it never advertises.
```

### 10a. CUT-2R — UE-5 blocker closures (AUDIT-C)

```text
UE5-R-PROVENANCE (C1) user evidence is HUMAN observation; the machine
      cannot verify humans, so it must never be presented as machine
      proof. Every observation carries: observation_source
      (INTERVIEW / GITHUB_COMMENT / EMAIL / SIGNED_STATEMENT /
      OTHER), observer_identity, source_record (the exact observed
      text/reference) and source_record_sha256 (RECOMPUTED — a
      mismatch refuses the observation). The final report separates
      the evidence classes explicitly and permanently:
        TECHNICAL EVIDENCE = VERIFIED            (replay-derived)
        USER EVIDENCE      = OBSERVED / UNSIGNED (payer_attestation
                             = UNSIGNED_RECORDED)
                        or  = PAYER-ATTESTED     (= SIGNED)
      Never one conflated PASS.

UE5-R-FINALITY (C2) one experiment cannot silently produce
      contradictory final ledgers. Discipline (R0, deliberately
      simple): observations append as observations/001.json, 002.json,
      … (each immutable, each bound to the CURRENT pack bytes);
      the FINAL ledger is ONE file per experiment
      (final-ledger.json), derived from the LATEST observation,
      written ONCE, never regenerated (no-overwrite). Revisions stay
      recorded; the final word cannot fork.
```


