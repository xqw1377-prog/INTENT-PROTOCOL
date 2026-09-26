# @intent/gp4-settlement — GP4-A + GP4-B

GP4 local settlement, scope of this package per the Commander GP4 order:

- **GP4-A** — settlement identity + persistence schema
- **GP4-B** — atomic economic release guard

GP4-C..F and GP5+ are **NOT IMPLEMENTED** here (HOLD). MAINNET is **DENIED**.

## 1. Schema (GP4-A)

Persistence layout under one ledger root (all record files are IPC-JSON-1
canonical bytes via the frozen `canonicalize`):

```
escrows/<escrow_ref>/escrow.json                             EscrowEntryV1
escrows/<escrow_ref>/releases/<receipt-hash-hex>.json        ReleaseRecordV1   ← ECONOMIC GUARD
escrows/<escrow_ref>/instructions/<settlement-key-hex>.json  InstructionRecordV1
```

- `EscrowEntryV1` (`gp4-escrow.v1`): escrow_ref (path-safe grammar
  `^[a-z0-9][a-z0-9._-]{0,63}$`), asset triple, amount (decimal string,
  scale ≤ asset.decimals), **`outcome_receipt_hash` bound at creation and
  immutable**, state `LOCKED|ELIGIBLE|RELEASED`, **`release_enabled`
  default `false`**, created_at/updated_at (unix seconds).
- `ReleaseRecordV1` (`gp4-release.v1`): the economic release fact —
  escrow_ref, outcome_receipt_hash, settlement_key, amount, asset, released_at.
- `InstructionRecordV1` (`gp4-instruction.v1`): settlement_key idempotency
  ledger — settlement_key, escrow_ref, outcome_receipt_hash, nonce (u64
  decimal string), first_seen_at.
- On-disk names use the bare 64-hex body (`:` is illegal on NTFS).

## 2. Unique constraint / atomic guard location (GP4-B)

**`src/guard.ts` — `atomicPublish()`**: uniqueness of the economic release
key `(escrow_ref, outcome_receipt_hash)` is the kernel-atomic `link(2)`
syscall creating `escrows/<escrow_ref>/releases/<receipt-hash-hex>.json`.
NOT an application-layer exists→insert: the OS fails every loser with
`EEXIST` no matter how concurrent the attempts, and the file appears
fully-formed or not at all (write temp O_EXCL → fsync → link).

Instruction idempotency (`settlement_key`) uses the same primitive on
`instructions/<settlement-key-hex>.json` — advisory layer only.

## 3. Transaction boundary

The single `linkSync()` for the release file **is** the commit point of
economic release. Before it: read-only validation. After it: idempotent
bookkeeping (escrow state flip via atomic rename-replace, instruction
record). A crash after the boundary is repaired by `EscrowLedger.open()`
re-syncing state from the guard file — the guard file is the authority,
`escrow.json` state is a cache.

## 4. EconomicReleaseKey construction path

```
receipt bytes (untrusted)
  → frozen G1 seal(OutcomeReceiptSchema)          [tamper check inside]
  → outcome_receipt_hash = receipt.content_hash
  → pair = (escrow_ref, outcome_receipt_hash)
  → guard file = escrows/<escrow_ref>/releases/<hex(outcome_receipt_hash)>.json
```

`settlement_key` is always RE-DERIVED by the engine via the frozen G1
`settlementKey({outcome_receipt_hash, escrow_ref, nonce})` — a caller
-supplied key is never trusted.

## 5. Receipt canonical source

`packages/gp3-verification/artifacts/receipt.json` (frozen GP2/GP3 output,
content_hash `sha256:da577b3d…c7706380`), consumed as untrusted DATA and
re-sealed through the frozen G1 library. There is no second identity
derivation. Zero code imports from any GP1/GP2/GP3 package (statically
asserted by test B-17).

## 6. Concurrency race tests

- `B-12`: in-process storm, 16 concurrent attempts, 16 distinct nonces →
  exactly 1 `RELEASED`.
- `B-13`: true multi-process race — 10 concurrent OS processes
  (`node --experimental-strip-types scripts/attempt-release.ts`), distinct
  nonces → exactly 1 `RELEASED`, 9 `ALREADY_RELEASED`; a second wave of 10
  further attempts (nonces 101–110) is entirely idempotent; one release
  file across the whole ledger forever.

## Hard-gate behavior

- `release_enabled` defaults to **false** (hold; committed policy
  `gp-001-settlement-hold-v1.json` parses to false, authority
  `outcome-receipt-only`).
- Network allowlist: `solana-devnet`, `local-ledger` — everything else
  (including any mainnet label) is **DENIED**.
- Same receipt + different nonce (different settlement_key) can never
  produce a second economic release.
