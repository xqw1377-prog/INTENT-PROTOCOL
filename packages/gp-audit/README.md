# GP0 Independent Contract Audit (Builder D)

Status: **GP0 AUDIT COMPLETE / AWAITING COMMANDER VERDICT**

- Audited main SHA: `5e44297f4f9b1b2faa4c6bef67d30d5e6ff01d94`
- Normative inputs: `docs/GOLDEN-PATH-V1.md`, `docs/GATES.md` (GP additions), frozen G1 trust chain (`docs/TRUST-CHAIN.md` @ e28a22e lineage, closed at c1a85cb6)
- Order: Issue #8 (Builder D activation)
- Executable evidence: `test/gp0-contract-audit.test.ts` — **6/6 PASS** (`npx vitest run packages/gp-audit`)

## Verdict recommendation: **NOT-ELIGIBLE** (one blocker, one-paragraph fix)

Everything audited is machine-testable and internally consistent except a
single missing authorization binding (B1 below). Once amended, this audit
flips to PASS-ELIGIBLE with no re-audit of the rest required — the amendment
is additive and does not touch any other finding.

---

## Findings

### B1 (BLOCKER) — settlement recipient (payee) authorization is unbound

- G1-frozen `MilestoneV1.allocation` carries `{asset, amount}` and **no
  recipient** (cannot be changed — G1 freeze). `SettlementInstructionV1.outputs[].recipient`
  is therefore chosen freely at settlement-formation time.
- The GP0 contract pins WHO/WHEN/WHETHER (receipt authority, exactly-once,
  2-of-2) but never pins **to whom** the 10 USDC-test must flow. Every GP1–GP5
  PASS rule as written can be satisfied while paying a party other than the
  agent that claimed and executed GP-001.
- This is exactly the "missing identity binding" class Issue #8 §11 requires
  me to surface: the economic guard prevents *double* release, not *wrong-payee*
  release.
- **Required amendment (additive, §7 + GP4/GP5):** the bounty runtime records
  the claimant `SubjectRef` at CLAIM; settlement formation MUST set
  `outputs[].recipient` to that recorded claimant; GP4 gains a negative case
  (recipient ≠ recorded claimant → settlement REJECTED) and GP5 asserts the
  released payee equals the claimant.

### Non-blocking clarifications

- **C1 — decision vocabulary mapping.** G1-frozen `DecisionResult` enum is
  `{VALID, INVALID, INSUFFICIENT, DISPUTED}`. The contract's "verifier ACCEPT"
  language must be pinned as `result == "VALID"` so no implementer invents an
  `ACCEPT` enum value (wire violation).
- **C2 — Task Freeze Record artifact.** §1 requires repository URL, base SHA,
  allowed/forbidden path sets, max-attempt policy value, deadline, and
  escrow_ref to be "frozen task facts" but does not name WHERE. Require a
  committed machine-readable task-freeze record (e.g. `gp-001-task.json`,
  hash-committed into the Intent) as a GP2 entry condition; the max-attempt
  NUMBER is currently a hidden free variable.
- **C3 — "uninterrupted" (GP5).** Pin: one orchestration session with a
  monotonic execution trace recorded in the Proof Pack; process restarts do
  not invalidate the run as long as the trace and state transitions are
  complete and replay-verified.
- **C4 — fake timer semantics.** "Injectable or fake-timer compatible" must
  assert the **2000 ms delay value semantically** via the injected clock (not
  wall-clock), so determinism does not dilute the acceptance criterion.
- **C5 — verifier distinctness scope.** Distinct identities are mechanically
  decidable from `verifier_id` / `verifier_digest` (and both decisions must
  share the six R9 binding fields). Operator-level sybil resistance is out of
  GP scope; signature enforcement remains S1-deferred per G1 — consistent, no
  action needed at GP0.

### Positive verifications (executable)

- **Settlement formula fidelity:** doc-derived independent implementation
  reproduces the G1 golden KAT `sha256:718731ce…` — GP0 §4 restates the frozen
  byte protocol with zero drift [GP0-E01, GP0-E06].
- **Nonce-bump attack executed:** same receipt + nonce 7→8 changes
  settlement_key [GP0-E02]; a key-only escrow double-releases (vulnerability
  demonstrated); the contract's two-layer model blocks both exact replay and
  nonce-bump [GP0-E04].
- **Economic key nonce-invariance** verified [GP0-E03].
- **Frozen-fact text guards:** asset triple, reward scale rule, uniqueness
  key, "settlement_key alone MUST NOT…", the nonce-bump negative case,
  no-manual-path clause, static-scan-insufficiency clause, and 2-of-2 are all
  pinned verbatim in-doc and asserted [GP0-E05].
- **G1 zero-semantic-modification:** freeze commit 5e44297 touches exactly
  `docs/GOLDEN-PATH-V1.md` + `docs/GATES.md` (542 insertions, nothing else);
  runtime state explicitly lives outside G1 objects; AssetRef stays opaque
  labels (no CAIP semantics reintroduced).

---

## GP0 Audit Matrix

Owner legend: **C** = Builder C, **D** = Builder D, **CMD** = Commander.
Every row's evidence is black-box machine evidence; Builder C self-report is
never evidence (Issue #8 forbidden list).

| Rule | Contract text | Evidence method | Owner | PASS signal | Failure signal |
|---|---|---|---|---|---|
| R1.1 single demo | §1 GP-001 only | scope check: no second scenario in repo/task records | CMD | one bounty id exists | any second authorized demo |
| R1.2 task facts frozen | §1 list | Task Freeze Record committed + hash-committed into Intent (C2) | C | record digests verify | missing/free fact |
| R1.3 determinism | §1 injectable clock | fake-timer test asserting 2000 ms semantically (C4) | C | deterministic rerun equal | wall-clock dependence |
| R1.4 acceptance criteria 1–8 | §1 | frozen acceptance suite executed in clean env | D (verifier A) | suite green on agent commit | any criterion red |
| R1.5 verifier independence | §1 "logs are evidence, not authority" | verifier A re-runs suite from own checkout | D | independent rerun output matches | trust of agent logs |
| R2.1 asset triple | §2 | text guard [GP0-E05] + runtime object assertion | D | exact triple in settlement | any field drift |
| R2.2 reward "10" | §2 | allocation + outputs amount assertion | D | `"10"` canonical decimal | different amount |
| R2.3 scale ≤ 6 | §2 | G1 S-SCALE check on settlement | D | parses at decimals 6 | scale > 6 accepted |
| R2.4 local-first / mainnet denied | §2 | escrow adapter selection evidence | C+D | local suite green before devnet; no mainnet endpoint | mainnet reachable |
| R3.1 legal transitions | §3 four machines | model-based transition tests | C | all legal edges reachable | legal edge rejected |
| R3.2 invalid rejected | §3 | negative transition suite | C | every illegal edge throws | any illegal edge applied |
| R3.3 hard invariants ×5 | §3 | property tests at engine boundaries | C+D | invariant holds after each op | any violation |
| R3.4 recovery deterministic | §3 | crash-injection + replay tests | C | state converges, replay no-op | divergence |
| R4.1 key = G1 formula | §4 | KAT vs golden vector [GP0-E01] | D | `sha256:718731ce…` reproduced | formula drift |
| R4.2 economic key unique | §4A | UNIQUE constraint + ledger tests | C | second release rejected | duplicate row possible |
| R4.3 nonce-bump blocked | §4A/§7.3 | attack test [GP0-E02/E04] + GP4 case 3 | D | already-released result | second transfer |
| R4.4 crash preserves | §4A | crash between stages, retry | C | still exactly one release | double/zero release |
| R4.5 both layers tested | §4 | GP4 machine suite covers A and B separately | D | both suites green | one layer untested |
| R5.1 execution inputs | §5 | runner input manifest | C | all inputs pinned from freeze | free input |
| R5.2 execution outputs | §5 | ExecutionRef manifest completeness | C | all listed artifacts produced | missing artifact |
| R5.3 SEALED + merkle | §5 | G1 S-MERKLE recompute | D | root recomputes | root mismatch accepted |
| R5.4 agent cannot authorize | §5 | permission boundary tests (negative) | D | agent-originated decision/receipt/release attempts all rejected | any success |
| R6.1 distinct identities | §6 | field-decidable check | D | verifier_id/digest distinct | same identity twice |
| R6.2 same binding | §6 | six R9 fields equal across decisions and vs milestone | D | all equal | divergent binding |
| R6.3 2-of-2 | §6 | receipt engine policy test (incl. 1-of-2 negative) | D | receipt iff both VALID (C1) | receipt on single ACCEPT |
| R6.4 decision_hashes shape | §6 | G1 S-RCPT-SET | D | sorted unique non-empty | unsorted/duplicate |
| R6.5 no manual path | §6/§9 | black-box negative tests | D | all manual attempts rejected | any manual receipt |
| R7.1 receipt-only authority | §7 | settlement input fuzz: only receipt hash accepted | D | non-receipt authorities rejected | any alternative accepted |
| R7.2 forbidden authorities | §7 list | negative input suite | D | all rejected | any accepted |
| R7.3 eight negative cases | §7 | GP4 case table (machine) | D | all 8 behave as specified | any case leaks |
| R8.1 full objects | §8 | Proof Pack content audit | D | all six object kinds present | missing object |
| R8.2 raw evidence | §8 | artifact hash recompute from raws | D | hashes match | unrecomputable artifact |
| R8.3 settlement evidence | §8 | ledger history + states + refs | C | complete history present | missing transition |
| R8.4 verify.mjs recomputes | §8 | third-party run in clean env | D | all recomputations succeed | any mismatch |
| R8.5 no-trust verification | §8 | verifier with ONLY the pack (no builder state) | D | full chain verifies | external dependency needed |
| R9.1 one success path | §9 | code-path/trace equivalence demo vs runtime | D | same authority boundary | privileged branch |
| R9.2 forbidden patterns | §9 list | static scan (necessary, not sufficient) | D | zero matches | any match |
| R9.3 black-box negative | §9.2 | unverified submission → no receipt/release | D | blocked | bypass |
| R9.4 static insufficient | §9 | evidence must include 9.2 AND 9.3 AND 9.4 | D | all three present | scan-only evidence |
| R10.GP0 | §10 GP0 | this audit | D | no untestable/contradictory rule (B1 pending) | blocker |
| R10.GP1 | §10 GP1 | state-machine suites + Builder D replay | C+D | all bullets green | any red |
| R10.GP2 | §10 GP2 | real execution + tamper + clean-env rerun | C+D | all bullets green | any red |
| R10.GP3 | §10 GP3 | dual-verifier run + wire conformance (G1 baseline) | D | all bullets green | any red |
| R10.GP4 | §10 GP4 | negative case table + recovery | C+D | all bullets green | any red |
| R10.GP5 | §10 GP5 | one run + Proof Pack verify (C3 definition) | C+D | full chain + replay blocked | any break |
| R11 roles | §11 | boundary violations monitored per gate | CMD | no violation | any crossing |
| R12 freeze discipline | §12 | change control on contract file | CMD | amendments via CMD only | silent edit |

## Reproduction

```bash
npx vitest run packages/gp-audit   # 6/6 PASS at the audited SHA
```
