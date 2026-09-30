#!/usr/bin/env node
/**
 * T2-05 crash-after-submit child (SUBMITTED-handshake protocol, T2-R1).
 *
 *   build tx
 *   sendRawTransaction()            <- the submit
 *   obtain signature
 *   stdout: "SUBMITTED <signature>" <- handshake: submit has HAPPENED
 *   DO NOT confirm, DO NOT observe the chain
 *   sleep forever                   <- crash-bound; the parent SIGKILLs us
 *
 * The parent waits for the SUBMITTED line BEFORE killing, proving the kill
 * happened AFTER the submit reached the RPC — never a guess by timer.
 *
 * Spawned by t2-matrix.mjs: node --experimental-strip-types scripts/t2-send-once.mjs
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { Keypair } from "@solana/web3.js";
import { devnetConnection, buildReleaseTx } from "../src/chain.ts";
import { FROZEN, PINNED } from "../src/index.ts";

const KEYS = path.join(homedir(), "intent-testnet-r1-keys");
const load = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(KEYS, `${n}.json`), "utf8"))));

const connection = devnetConnection();
const { tx } = await buildReleaseTx(
  connection,
  PINNED.programId,
  { escrowRef: FROZEN.anchors.escrowRef, outcomeReceiptHash: FROZEN.anchors.outcomeReceiptHash },
  { operator: load("operator"), treasury: load("treasury") },
);
// THE SUBMIT — resolve it, take the signature, announce, then go silent
const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
process.stdout.write(`SUBMITTED ${signature}\n`);
// crash-bound: no confirmation, no chain observation, no exit.
// The interval keeps the event loop alive so ONLY the parent's SIGKILL ends
// this process — the death cause itself is part of the evidence.
setInterval(() => {}, 1 << 30);
await new Promise(() => {});
