#!/usr/bin/env node
/**
 * TESTNET-R1 / T3 devnet materialization (explicit builder command).
 *
 * Authorized by Commander order T3=GO. What it does:
 *   - generates (once, reused thereafter) the five role keypairs OUTSIDE the
 *     repository at ~/intent-testnet-r1-keys/ (chmod 600): program,
 *     deployer, operator, treasury, claimant, plus the mint keypair
 *   - devnet airdrop to the Treasury payer (devnet SOL — test-only)
 *   - creates the USDC-test SPL mint (decimals 6, mint authority Treasury,
 *     freeze authority null)
 *   - creates the Treasury and Claimant token accounts (ATAs)
 *   - mints EXACTLY 100 USDC-test (the escrow cap ceiling) to the Treasury
 *     ATA — cycle/escrow caps are structurally satisfiable, never exceeded
 *   - seals ClaimantPayoutBindingV1 (binding_hash via the frozen formula)
 *   - writes materialization/appendix-a.json (the committed record) and
 *     verifies it when it already exists
 *
 * Hard boundaries enforced here: mainnet endpoints rejected; NO program
 * deployment; NO settlement/release transaction; secrets never written into
 * the repository tree.
 *
 * Run: node --experimental-strip-types scripts/t3-materialize.mjs [--create|--verify]
 */
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram,
  Transaction, sendAndConfirmTransaction, clusterApiUrl,
} from "@solana/web3.js";
import { getAssociatedTokenAddress, createMint, createAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import { sealBinding, verifyBinding } from "../src/binding.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const KEYS_DIR = path.join(homedir(), "intent-testnet-r1-keys");
const RECORD = path.join(pkgDir, "materialization", "appendix-a.json");

const MODE = process.argv.includes("--create") ? "create" : process.argv.includes("--verify") ? "verify" : (existsSync(RECORD) ? "verify" : "create");

const ENDPOINT = process.env.SOLANA_RPC ?? clusterApiUrl("devnet");
if (/mainnet/i.test(ENDPOINT)) throw new Error(`MAINNET DENIED: ${ENDPOINT}`);

const connection = new Connection(ENDPOINT, "confirmed");

// ————————————————— keypairs (outside the repo, reused if present) —————————————————

function loadOrCreate(name) {
  const file = path.join(KEYS_DIR, `${name}.json`);
  if (existsSync(file)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
  mkdirSync(KEYS_DIR, { recursive: true });
  const kp = Keypair.generate();
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  chmodSync(file, 0o600);
  console.log(`generated keypair '${name}' -> ${file} (pubkey ${kp.publicKey.toBase58()}) — SECRET, never committed`);
  return kp;
}

const programKp = loadOrCreate("program");
const deployerKp = loadOrCreate("deployer");
const operatorKp = loadOrCreate("operator");
const treasuryKp = loadOrCreate("treasury");
const claimantKp = loadOrCreate("claimant");
const mintKp = loadOrCreate("mint");

const roles = {
  programId: programKp.publicKey.toBase58(),
  deployer: deployerKp.publicKey.toBase58(),
  operator: operatorKp.publicKey.toBase58(),
  treasury: treasuryKp.publicKey.toBase58(),
  claimantWallet: claimantKp.publicKey.toBase58(),
};

const distinct = new Set(Object.values(roles));
if (distinct.size !== Object.values(roles).length) throw new Error("role keypairs are NOT all distinct");

// ————————————————— frozen inputs —————————————————

const CLAIM_ID = "c1a4e7d2-3f3b-4a59-9e02-7b6d5c8f1a23"; // gp-001-claim.json (committed fixture)
const CLAIMANT = "agent:gp-001-demo";
const DECIMALS = 6;
const CAPS = { perRelease: "10", escrowTotalMax: "100", cycleCumulativeMax: "100" };
const SUPPLY_BASE_UNITS = "100000000"; // 100 USDC-test × 10^6 — exactly the escrow cap ceiling

async function airdropIfNeeded(pubkey, lamports) {
  const bal = await connection.getBalance(pubkey);
  if (bal >= 150_000_000) { console.log(`payer ${pubkey.toBase58().slice(0, 8)}… balance ${bal / LAMPORTS_PER_SOL} SOL — no airdrop`); return; }
  // the devnet faucet is aggressively rate-limited: retry with backoff
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      console.log(`airdropping 1 devnet SOL to ${pubkey.toBase58().slice(0, 8)}… (attempt ${attempt})`);
      const sig = await connection.requestAirdrop(pubkey, lamports);
      await connection.confirmTransaction(sig, "confirmed");
      return;
    } catch (e) {
      console.log(`airdrop attempt ${attempt} failed: ${String(e.message).slice(0, 120)}`);
      if (attempt === 6) throw e;
      await new Promise((r) => setTimeout(r, 15_000 * attempt));
    }
  }
}

async function create() {
  await airdropIfNeeded(treasuryKp.publicKey, LAMPORTS_PER_SOL);

  const mint = mintKp.publicKey;
  console.log(`creating USDC-test mint ${mint.toBase58()} (decimals ${DECIMALS}, mintAuthority=treasury, freezeAuthority=null)`);
  const mintSig = await createMint(connection, treasuryKp, treasuryKp.publicKey, null, DECIMALS, mintKp);

  const treasuryAta = await getAssociatedTokenAddress(mint, treasuryKp.publicKey);
  const claimantAta = await getAssociatedTokenAddress(mint, claimantKp.publicKey);
  console.log(`creating treasury ATA ${treasuryAta.toBase58()}`);
  const tAtaSig = await createAssociatedTokenAccount(connection, treasuryKp, mint, treasuryKp.publicKey);
  console.log(`creating claimant ATA ${claimantAta.toBase58()}`);
  const cAtaSig = await createAssociatedTokenAccount(connection, treasuryKp, mint, claimantKp.publicKey);

  console.log(`minting ${SUPPLY_BASE_UNITS} base units (100 USDC-test) to treasury ATA`);
  const mintToSig = await mintTo(connection, treasuryKp, mint, treasuryAta, treasuryKp.publicKey, BigInt(SUPPLY_BASE_UNITS));

  const slot = await connection.getSlot("confirmed");
  const boundAt = new Date().toISOString();

  const binding = sealBinding({
    schema_version: "claimant-payout-binding.v1",
    claim_id: CLAIM_ID,
    claimant: CLAIMANT,
    network: "solana-devnet",
    wallet_pubkey: roles.claimantWallet,
    token_account: claimantAta.toBase58(),
    mint: mint.toBase58(),
    bound_at: boundAt,
  });
  if (!verifyBinding(binding)) throw new Error("binding self-verification failed");

  const record = {
    schema_version: "testnet-r1-appendix-a.v1",
    materialized_at: boundAt,
    mode: "T3",
    endpoint: ENDPOINT,
    chain: {
      cluster: "devnet",
      slot_at_materialization: slot,
      genesis_hash: (await connection.getGenesisHash()),
      solana_core: (await connection.getVersion())["solana-core"],
    },
    program_id: { pubkey: roles.programId, note: "pinned at T3 BEFORE deployment; deployment is a T2-authorized bootstrap action" },
    mint: {
      pubkey: mint.toBase58(),
      decimals: DECIMALS,
      mint_authority: roles.treasury,
      freeze_authority: null,
      create_tx_signature: mintSig,
      supply_base_units: SUPPLY_BASE_UNITS,
      supply_tx_signature: mintToSig,
      provenance: "created by the Treasury role for TESTNET-R1 via the SPL Token program on devnet; test-only token, zero real-fund value",
    },
    roles: {
      deployer: { pubkey: roles.deployer, authority: "devnet program deployment ONLY; cannot authorize settlements" },
      operator: { pubkey: roles.operator, authority: "may request settlements ALREADY authorized by GP4 semantics; cannot alter claimant/amount/receipt/asset" },
      treasury: { pubkey: roles.treasury, authority: "test USDC source; mint authority; balance under hard cap" },
    },
    claimant_payout_binding: binding,
    token_accounts: {
      treasury_ata: treasuryAta.toBase58(),
      claimant_ata: claimantAta.toBase58(),
      treasury_ata_tx: tAtaSig,
      claimant_ata_tx: cAtaSig,
    },
    caps: CAPS,
    custody: {
      secrets_dir: "~/intent-testnet-r1-keys/ (OUTSIDE this repository)",
      files: ["program.json", "deployer.json", "operator.json", "treasury.json", "claimant.json", "mint.json"],
      permissions: "0600",
      note: "secrets are NEVER committed; see materialization/CUSTODY.md",
    },
  };

  mkdirSync(path.dirname(RECORD), { recursive: true });
  writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  console.log(`\nwrote ${path.relative(pkgDir, RECORD)}`);
  console.log(JSON.stringify({ programId: roles.programId, mint: mint.toBase58(), claimantAta: claimantAta.toBase58(), bindingHash: binding.binding_hash }, null, 2));
}

async function verify() {
  const record = JSON.parse(readFileSync(RECORD, "utf8"));
  const mint = new PublicKey(record.mint.pubkey);
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) throw new Error("VERIFY FAIL: mint account not found on devnet");
  const treasuryAta = new PublicKey(record.token_accounts.treasury_ata);
  const claimantAta = new PublicKey(record.token_accounts.claimant_ata);
  const tAcct = await getAccount(connection, treasuryAta);
  const cAcct = await getAccount(connection, claimantAta);
  if (tAcct.mint.toBase58() !== mint.toBase58() || cAcct.mint.toBase58() !== mint.toBase58()) throw new Error("VERIFY FAIL: ATA mint mismatch");
  if (!verifyBinding(record.claimant_payout_binding)) throw new Error("VERIFY FAIL: binding hash");
  const supply = await connection.getTokenSupply(mint);
  console.log("VERIFY OK:", JSON.stringify({
    mint: mint.toBase58(),
    supply: supply.value.amount,
    treasury_balance: tAcct.amount.toString(),
    claimant_balance: cAcct.amount.toString(),
    program_id: record.program_id.pubkey,
    binding_hash: record.claimant_payout_binding.binding_hash,
  }, null, 2));
}

if (MODE === "create") await create();
else await verify();
