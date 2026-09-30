# PDA-CONFORMANCE — Runtime Authority Evidence (hardened record)

Governance status at the time of this document:

```text
PDA-CONFORMANCE-ERRATA-1 = CLOSED / FROZEN   (Commander, remote audit of
                                            pda-conformance-r1 @ c50162e)
TESTNET-R1 / T3            = PASS / FROZEN
TESTNET-R1 / T2            = PASS / FROZEN
TESTNET-R1 / T4            = PASS / FROZEN
PDA-EVIDENCE-HARDENING-R1  = forward-port of the stronger regression
                             evidence, NOT a re-opening of the errata
```

Authority freeze (Commander):

```text
PDA curve authority = validator/runtime semantics
                    = curve25519-dalek compatible decompression
web3.js             = client oracle / compatibility oracle
                    ≠ canonical chain authority
```

## 1. The normative path — what actually decides PDA validity on chain

The validator's PDA predicate is reached by exactly three paths. All converge
on `Pubkey::create_program_address` → `bytes_are_curve_point`:

```text
SBF program:  sol_create_program_address  ─┐
              sol_try_find_program_address ┼─► Pubkey::create_program_address
CPI:          invoke_signed signer seeds  ─┘        │
                                                    ▼
                                          bytes_are_curve_point
                                                    │
                                                    ▼
                            curve25519-dalek CompressedEdwardsY::decompress()
```

| Runtime path | Agave v3.1.8 callsite | Role |
|---|---|---|
| `sol_create_program_address` syscall | `syscalls/src/lib.rs` → `SyscallCreateProgramAddress` (returns `Pubkey::create_program_address(...)`, error ⇒ candidate invalid) | on-chain PDA derivation |
| `sol_try_find_program_address` syscall | `syscalls/src/lib.rs` → `SyscallTryFindProgramAddress` (same call inside the 255→1 bump loop) | canonical bump search |
| `invoke_signed` PDA signer validation | `program-runtime/src/cpi.rs` (signer seeds → `Pubkey::create_program_address` → `BadSeeds`) | the final gate: whether seeds+bump may sign |

Dependency chain (verified against the Agave v3.1.8 workspace manifest and
crates.io resolution):

```text
agave v3.1.8
  → solana-pubkey = "=3.0.0"     (sdk moved to anza-xyz/solana-sdk)
    → solana-address 1.1.0 → solana-address 2.8.0
      → bytes_are_curve_point = CompressedEdwardsY::decompress().is_some()
        → curve25519-dalek 4.1.3
```

Executable confirmation (host-side `bytes_are_curve_point` is literally the
code the validator runs when servicing the SBF syscalls):

| Encoding | **runtime `bytes_are_curve_point`** | dalek `decompress` | web3.js 1.99 `isOnCurve` | our JS | our Rust |
|---|---|---|---|---|---|
| y=1, sign=0 (identity) | **true** | true | true | true | true |
| y=1, sign=1 (negative zero) | **true** | true | false | true | true |
| y=p, sign=0 (non-canonical) | **true** | true | false | true | true |
| y=p+1, sign=0 (non-canonical) | **true** | true | false | true | true |

The runtime column was produced by a scratch probe resolving
`solana-pubkey = "=3.0.0"` — the exact crate the Agave v3.1.8 workspace pins —
and matched `curve25519-dalek 4.1.3` `decompress().is_some()` on every case.

**Not the authority:** `sol_curve_validate_point` is a *different* syscall —
it answers "is this point on the curve" for programs that ask directly, and is
not on the PDA derivation path. For completeness it was checked too:
`solana-curve25519::edwards::validate_edwards` →
`PodEdwardsPoint::validate_point` → the same dalek `decompress`. Same
semantics, but it is recorded here only as completeness evidence — nothing in
PDA derivation routes through it.

## 2. Why web3.js is not the authority

`@solana/web3.js` `PublicKey.isOnCurve` delegates to `@noble/curves` strict
compressed-point decoding, which rejects negative-zero and non-canonical `y`
encodings. The validator's predicate (`dalek::decompress`) accepts both — it
masks the sign bit, reduces `y mod p`, and checks `x²` has a root. Accepting a
candidate as on-curve makes the runtime *reject it for PDA use* (an on-curve
hash is not a valid program address), so a client that is stricter than the
chain can pick a bump the validator considers invalid for `invoke_signed`.
Runtime semantics therefore govern.

Practical reachability: these encodings require a SHA-256 output to hit
specific byte patterns, so they are effectively unreachable in real
derivation. The corpus exists to pin the semantics contract exactly — not to
close a live attack surface.

## 3. Hardening deltas in this record (vs the original errata closure)

| Artifact | Content |
|---|---|
| `vectors/curve-corpus.json` | 78 labeled encodings in the `pda-curve-edge-corpus.v1` schema: the original 8 edge cases + 6 added boundary cases (y=0/sign=1, y=2 smallest canonical off-curve, basepoint, all-0xFF, y=2^255−1/sign=0, y=p−1) + a 64-entry deterministic digest stream. `runtime_expected` (dalek verdict) is **normative**; `web3_expected` is observational; divergences flagged `WEB3_VS_RUNTIME` — now 5 recorded divergent encodings. |
| `vectors/golden.json` | 10 cases: per program id (fixture + actual pinned) one `descent-254` and one `descent-le252` (fixture 251, actual 252) — the 255→bump descent path is permanently exercised. Official-SDK oracle gate unchanged. |
| `src/pda.ts` | exported `pdaCandidateHash` so tests can assert each rejected bump was genuinely on-curve; the curve predicate itself is **unchanged** (already dalek-compatible) |
| test `[T1-12]` | per descent vector: candidates at bumps 255…bump+1 are asserted ON-curve (rejected), the committed bump OFF-curve (accepted), and the hash at the committed bump re-encodes to the committed PDA; also asserts the Commander's coverage floor (≥1 case at bump=254 and ≥1 at bump≤252) |
| worktree-scoped cargo target | the test binary target dir is now `tmpdir/intent-adapter-cargo-target-<sha256(pkgDir)[:12]>` everywhere (5 test sites + `generate-curve-corpus.mjs`): a shared `~/intent-adapter-cargo-target` was observed serving a **stale binary built from a different checkout with `cargo` exit 0** — the dir is now scoped per worktree and rebuilt incrementally on every run |

Regeneration is deterministic: `generate-t1-vectors.mjs` scans
`escrow:bump-descent-<i>` until the required bumps are found;
`generate-curve-corpus.mjs` emits fixed encodings + fixed digest streams and
refuses to write unless `our_js == rust_custom == runtime_expected` on every
case.

## 4. What this hardening did NOT do

- No change to curve predicate semantics — the implementation already matched
  the runtime; this pins it more strongly.
- No change to T3 materialization, the T2 on-chain program, or T4 reconcile.
- No change to G1, GP4/GP5, settlement semantics, or the governance ledger.
- No re-opening of `PDA-CONFORMANCE-ERRATA-1` — this record upgrades the
  already-closed conformance evidence to stronger permanent regression
  evidence (source: `pda-conformance-r1 @ c50162e`, Commander-audited
  `PASS / FROZEN`).
