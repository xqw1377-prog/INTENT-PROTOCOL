#!/usr/bin/env node
/**
 * T2-05 crash-simulation child: build + send the release tx, then EXIT
 * immediately without ever reading the confirmation result. The parent may
 * also SIGKILL this process mid-flight — either way, no client-side recovery
 * logic runs. Invariant under test: a crashed/lost-response client can never
 * cause a SECOND economic release (the on-chain release PDA is the authority).
 *
 * Spawned by t2-matrix.mjs: node --experimental-strip-types scripts/t2-send-once.mjs <memo>
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { Keypair } from "@solana/web3.js";
import { devnetConnection, buildReleaseTx } from "../src/chain.ts";
import { FROZEN, PINNED } from "../src/index.ts";

const variation = BigInt(process.argv[2] ?? "5");
const KEYS = path.join(homedir(), "intent-testnet-r1-keys");
const load = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(KEYS, `${n}.json`), "utf8"))));

const connection = devnetConnection();
const { tx } = await buildReleaseTx(
  connection,
  PINNED.programId,
  { escrowRef: FROZEN.anchors.escrowRef, outcomeReceiptHash: FROZEN.anchors.outcomeReceiptHash },
  { operator: load("operator"), treasury: load("treasury") },
  variation,
);
// fire-and-forget: never await confirmation, never observe — crash semantics
process.stdout.write(JSON.stringify({ sent: true, signature: await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true }) }) + "\n");
process.exit(0);
