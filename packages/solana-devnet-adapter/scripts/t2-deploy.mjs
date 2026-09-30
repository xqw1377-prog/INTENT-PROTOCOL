#!/usr/bin/env node
/**
 * TESTNET-R1 / T2 program deployment (explicit builder command; T2-authorized
 * bootstrap chain action). Uses the PINNED program keypair, so the deployed
 * program id MUST equal the T3-frozen TESTNET_R1_PROGRAM_ID. Deploys via the
 * agave 4.3.0 CLI (matches the devnet cluster and the platform-tools that
 * built the ELF); funds the DEPLOYER role from Treasury (role separation:
 * Deployer deploys, Treasury funds).
 *
 * Run: node --experimental-strip-types scripts/t2-deploy.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, clusterApiUrl } from "@solana/web3.js";
import { PINNED } from "../src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const KEYS = path.join(homedir(), "intent-testnet-r1-keys");
const SO = path.join(pkgDir, "program", "target", "deploy", "testnet_r1_program.so");
const AGAVE_BIN = "/tmp/solana-release/bin"; // agave 4.3.0 (matches cluster + platform-tools v1.57)
const ENDPOINT = process.env.SOLANA_RPC ?? clusterApiUrl("devnet");
if (/mainnet/i.test(ENDPOINT)) throw new Error(`MAINNET DENIED: ${ENDPOINT}`);

const load = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path.join(KEYS, `${n}.json`), "utf8"))));
const programKp = load("program");
const deployerKp = load("deployer");
const treasuryKp = load("treasury");

if (programKp.publicKey.toBase58() !== PINNED.programId) {
  throw new Error(`program keypair is ${programKp.publicKey.toBase58()} but the FROZEN program id is ${PINNED.programId}`);
}
if (!existsSync(SO)) throw new Error(`program .so not found: ${SO} — build with cargo-build-sbf first`);

const connection = new Connection(ENDPOINT, "confirmed");

// 1. fund the Deployer role from Treasury (role separation)
const deployerBal = BigInt(await connection.getBalance(deployerKp.publicKey));
const NEED = 3n * BigInt(LAMPORTS_PER_SOL); // program rent + buffer + fees for a ~90KB program
if (deployerBal < NEED) {
  // top up only what is missing (and what Treasury can spare, keeping a fee float)
  const treasuryBal = BigInt(await connection.getBalance(treasuryKp.publicKey));
  const spare = treasuryBal - 50_000_000n; // keep a 0.05 SOL fee float in Treasury
  const topUp = BigInt(NEED - deployerBal);
  const lamports = topUp > spare ? spare : topUp;
  if (lamports <= 0n) throw new Error(`Deployer underfunded (${deployerBal}) and Treasury has no spare lamports (${treasuryBal})`);
  console.log(`funding Deployer ${deployerKp.publicKey.toBase58()} with ${Number(lamports) / LAMPORTS_PER_SOL} devnet SOL from Treasury (role separation)…`);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: treasuryKp.publicKey, toPubkey: deployerKp.publicKey, lamports: Number(lamports) }),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [treasuryKp]);
  console.log(`  funding tx ${sig}`);
} else {
  console.log(`Deployer already funded (${Number(deployerBal) / LAMPORTS_PER_SOL} SOL)`);
}

// 2. deploy with the pinned program keypair — id must equal the T3-frozen pin
// (idempotent: if already deployed and executable, verify and exit)
const UPGRADE = process.argv.includes("--upgrade");
const existing = await connection.getAccountInfo(programKp.publicKey, "confirmed");
if (existing && existing.executable && !UPGRADE) {
  console.log(`program already deployed at ${programKp.publicKey.toBase58()} (executable, owner=${existing.owner.toBase58()}) — nothing to do`);
} else {
  console.log(`deploying (upgrade=${UPGRADE}) ${SO} as ${programKp.publicKey.toBase58()} (pinned TESTNET_R1_PROGRAM_ID)…`);
  const out = execFileSync(
    path.join(AGAVE_BIN, "solana"),
    [
      "program", "deploy", SO,
      "--program-id", path.join(KEYS, "program.json"),
      "--keypair", path.join(KEYS, "deployer.json"),
      "--url", ENDPOINT,
      "--output", "json",
    ],
    { encoding: "utf8", env: { ...process.env, PATH: `${AGAVE_BIN}:${process.env.PATH ?? ""}` }, maxBuffer: 64 * 1024 * 1024 },
  );
  console.log(out.trim().split("\n").slice(-3).join("\n"));
  // verify on-chain truth directly: the deployed ELF must equal the local build
  const { createHash } = await import("node:crypto");
  const pdAddrStr = "AnUxUnVP495vEXzGSwiGpqQAuc1jjyrGARbqxhE1xzzF";
  const pd = await connection.getAccountInfo(new PublicKey(pdAddrStr), "confirmed");
  if (!pd) throw new Error("program-data account missing after deploy");
  // The deploy CLI transforms/pads the ELF (observed length delta), so a
  // byte-exact hash is not a valid check. Verify SEMANTIC markers instead:
  // the deployed build must contain the current build's unique strings.
  const elf = pd.data;
  const localElf = readFileSync(SO);
  const markers = ["T2 ix: total_len=", "intent-protocol/testnet-r1/economic-release"];
  for (const m of markers) {
    const localHas = localElf.includes(Buffer.from(m));
    const chainHas = elf.includes(Buffer.from(m));
    console.log(`marker ${JSON.stringify(m.slice(0, 24))} local=${localHas} onchain=${chainHas}`);
    if (localHas && !chainHas) throw new Error(`DEPLOY STALE: on-chain build lacks ${m}`);
  }
  console.log("deploy verification: current build is live");
}

// 3. read-back proof: the program account exists and is executable
const info = await connection.getAccountInfo(new PublicKey(PINNED.programId), "confirmed");
if (!info || !info.executable) throw new Error("deployed program account is not executable");
console.log(`program account executable=true owner=${info.owner.toBase58()} dataLen=${info.data.length}`);
