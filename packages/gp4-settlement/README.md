# @intent/gp4-settlement — GP4-A + GP4-B (R1/R2/R3 remediated)

GP4 local settlement, scope of this package per the Commander GP4 order:

- **GP4-A** — settlement identity + persistence schema
- **GP4-B** — atomic economic release guard

GP4-C..F and GP5+ are **NOT IMPLEMENTED** here (HOLD). MAINNET is **DENIED**.

## 1. Schema (GP4-A)

Persistence layout under one ledger root (all record files are IPC-JSON-1
canonical bytes via the frozen `canonicalize`):

```
escrows/<escrow_ref>/escrow.json                        EscrowEntryV1
escrows/<escrow_ref>/releases/<receipt-hash-hex>.json   ReleaseRecordV1   ← ECONOMIC GUARD
```

- `EscrowEntryV1` (`gp4-escrow.v1`): escrow_ref (path-safe grammar
  `^[a-z0-9][a-z0-9._-]{0,63}$`), asset triple (**only the frozen GP-001
  triple `solana-devnet/USDC-test/6`**), amount (decimal string, scale ≤
  asset.decimals), `outcome_receipt_hash` bound at creation and immutable,
  state `LOCKED|ELIGIBLE|RELEASED` (ELIGIBLE is a legacy-read-only value —
  never written before the guard), `release_enabled`, created/updated unix
  seconds.
- `ReleaseRecordV1` (`gp4-release.v1`): the economic release fact —
  escrow_ref, outcome_receipt_hash, settlement_key, amount, asset,
  released_at.
- **NO instruction persistence** (P1-A): the settlement_key instruction
  idempotency ledger (`InstructionRecordV1`, `instructions/` tree) is GP4-C
  scope and is deliberately absent. The settlement_key is still re-derived
  by the engine (frozen G1 `settlementKey`) and returned in results.
- On-disk names use the bare 64-hex body (`:` is illegal on NTFS).

## 2. HOLD authority isolation (R1)

The production API is **hold-by-construction**:

- `EscrowLedger.createEscrow` takes NO field that can enable release; every
  production escrow is created `release_enabled=false`, and
  `attemptRelease` on it always returns `REJECTED_HOLD`.
- A plain caller smuggling `release_enabled: true` past the type system is
  `REJECTED_INVALID` at the API boundary.
- The ONLY way to create a release-enabled escrow is the explicit,
  separately-named verification entry point:
  `LocalVerificationLedger.createEscrowForVerification()` — distinct class,
  distinct method, trivially greppable, never to be called by production
  settlement code.
- Threat-model note: an attacker who can hand-write ledger FILES can forge
  `release_enabled:true` — but such an attacker can delete the guard file
  too; the file system itself is the trust boundary, not the API.

## 3. Frozen asset triple closure (R2)

The ONLY releasable triple is `solana-devnet / USDC-test / 6` (GOLDEN-PATH-V1
§2). No second asset domain (no `local-ledger` label), no generalization.
Non-frozen triples are rejected at escrow **creation** (`REJECTED_INVALID`)
AND at the **release** layer (`DENIED_ASSET`, proven against hand-forged
escrow.json). Mainnet and every other label: DENIED.

## 4. Unique constraint / atomic guard location (GP4-B)

**`src/guard.ts` — `atomicPublish()`**: uniqueness of the economic release
key `(escrow_ref, outcome_receipt_hash)` is the kernel-atomic `link(2)`
syscall creating `escrows/<escrow_ref>/releases/<receipt-hash-hex>.json`.
NOT an application-layer exists→insert: the OS fails every loser with
`EEXIST` no matter how concurrent the attempts, and the file appears
fully-formed or not at all (write temp O_EXCL → fsync → link).

## 5. Transaction boundary (R3)

The single `linkSync()` for the release file is the **FIRST authoritative
mutation** of `attemptRelease` and the commit point of economic release:

```
steps 1–9   read-only validation — every rejection leaves the ledger
            byte-identical (proven by the treeDigest zero-write test B-18)
step  9     LOCKED→ELIGIBLE→RELEASED walk is LOGICAL ONLY — ELIGIBLE is
            never persisted before the guard (it is never written at all;
            escrow.json goes LOCKED → RELEASED after the guard)
step 10     link() = economic commit — the transaction boundary
step 11     idempotent cache bookkeeping (escrow.json → RELEASED)
```

Crash semantics (guard file is the authority; escrow.json is a cache):

- crash BEFORE the guard → on disk: `releases/` empty, state `LOCKED` —
  nothing authoritative happened; release still proceeds exactly-once
  later (test B-19)
- crash AFTER the guard, before the cache write → `open()` re-syncs state
  to `RELEASED` from the guard file (test A-09a)
- legacy/torn `ELIGIBLE` on disk (impossible under the new boundary) →
  normalized: guard present ⇒ `RELEASED`, guard absent ⇒ demoted to
  `LOCKED` — no guard means no release ever happened (test A-09b)

## 6. EconomicReleaseKey construction path

```
receipt bytes (untrusted)
  → frozen G1 seal(OutcomeReceiptSchema)          [tamper check inside]
  → outcome_receipt_hash = receipt.content_hash
  → pair = (escrow_ref, outcome_receipt_hash)
  → guard file = escrows/<escrow_ref>/releases/<hex(outcome_receipt_hash)>.json
```

`settlement_key` is always RE-DERIVED by the engine via the frozen G1
`settlementKey({outcome_receipt_hash, escrow_ref, nonce})` — a
caller-supplied key is never trusted.

## 7. Receipt canonical source

`packages/gp3-verification/artifacts/receipt.json` (frozen GP2/GP3 output,
content_hash `sha256:da577b3d…c7706380`), consumed as untrusted DATA and
re-sealed through the frozen G1 library. There is no second identity
derivation. Zero code imports from any GP1/GP2/GP3 package (asserted by
test B-17).

## 8. Concurrency race tests

- `B-12`: in-process storm, 16 concurrent attempts, 16 distinct nonces →
  exactly 1 `RELEASED`.
- `B-13`: true multi-process race — 10 concurrent OS processes
  (`node --experimental-strip-types scripts/attempt-release.ts`), distinct
  nonces → exactly 1 `RELEASED`, 9 `ALREADY_RELEASED`; a second wave of 10
  further attempts (nonces 101–110) is entirely idempotent; one release
  file across the whole ledger forever.
