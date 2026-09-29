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
import { getAssociatedTokenAddress, createMint, createAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID, getAccount, getMint, setAuthority, AuthorityType } from "@solana/spl-token";
import { sealBinding, verifyBinding } from "../src/binding.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..");
const KEYS_DIR = path.join(homedir(), "intent-testnet-r1-keys");
const RECORD = path.join(pkgDir, "materialization", "appendix-a.json");

const MODE = process.argv.includes("--create") ? "create" : process.argv.includes("--verify") ? "verify" : process.argv.includes("--repair") ? "repair" : (existsSync(RECORD) ? "verify" : "create");

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

// ————————————————— provenance repair (T3-R1 blocker B) —————————————————

/** The OLDEST signature in an account's history is its creation transaction. */
async function findCreationSignature(pubkeyB58) {
  const sigs = await connection.getSignaturesForAddress(new PublicKey(pubkeyB58), { limit: 100 }, "confirmed");
  if (sigs.length === 0) throw new Error(`no signature history for ${pubkeyB58}`);
  const oldest = sigs[sigs.length - 1];
  return { signature: oldest.signature, slot: oldest.slot, blockTime: oldest.blockTime ?? null };
}

/** Fetch the tx and PROVE it references the given account. */
async function verifyCreationTx(signature, accountB58, label) {
  const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx) throw new Error(`${label}: creation tx not found: ${signature}`);
  if (tx.meta && tx.meta.err) throw new Error(`${label}: creation tx FAILED on chain: ${JSON.stringify(tx.meta.err)}`);
  const keys = tx.transaction.message.accountKeys.map((k) => k.toString()); // Pubkey objects or plain strings
  if (!keys.includes(accountB58)) throw new Error(`${label}: creation tx does not reference ${accountB58}`);
  return { slot: tx.slot, signature, verified_at: new Date().toISOString() };
}

async function repair() {
  if (!existsSync(RECORD)) throw new Error("no appendix-a.json to repair — run --create first");
  const record = JSON.parse(readFileSync(RECORD, "utf8"));
  const mintB58 = record.mint.pubkey;
  const tAta = record.token_accounts.treasury_ata;
  const cAta = record.token_accounts.claimant_ata;

  console.log("repairing provenance: locating REAL creation transactions…");
  const mintCreation = await findCreationSignature(mintB58);
  const tAtaCreation = await findCreationSignature(tAta);
  const cAtaCreation = await findCreationSignature(cAta);
  console.log(`  mint creation tx    ${mintCreation.signature} (slot ${mintCreation.slot})`);
  console.log(`  treasury ATA tx     ${tAtaCreation.signature} (slot ${tAtaCreation.slot})`);
  console.log(`  claimant ATA tx     ${cAtaCreation.signature} (slot ${cAtaCreation.slot})`);

  const mintProof = await verifyCreationTx(mintCreation.signature, mintB58, "mint");
  const tAtaProof = await verifyCreationTx(tAtaCreation.signature, tAta, "treasury ATA");
  const cAtaProof = await verifyCreationTx(cAtaCreation.signature, cAta, "claimant ATA");

  record.mint.creation_tx = { ...mintProof, method: "oldest signature in account history; tx fetched and account-key membership verified" };
  record.token_accounts.treasury_ata_creation_tx = tAtaProof;
  record.token_accounts.claimant_ata_creation_tx = cAtaProof;
  // T3-R1 erratum: null out the OLD mislabeled fields (createMint() and
  // createAssociatedTokenAccount() return PUBLICKEYS, not signatures)
  record.mint.create_tx_signature = null;
  record.token_accounts.treasury_ata_tx = null;
  record.token_accounts.claimant_ata_tx = null;

  // ————————————————— cap hardening (T3-R1 blocker C) —————————————————
  const onChainMint = await getMint(connection, new PublicKey(mintB58));
  const supply = onChainMint.supply.toString();
  if (supply !== SUPPLY_BASE_UNITS) throw new Error(`supply is ${supply}, expected ${SUPPLY_BASE_UNITS} — refusing to revoke authority`);
  if (onChainMint.mintAuthority !== null) {
    console.log("revoking MintTokens authority (supply is exactly 100 → hard cap)");
    const revokeSig = await setAuthority(
      connection, treasuryKp, new PublicKey(mintB58), treasuryKp.publicKey,
      AuthorityType.MintTokens, null,
    );
    record.mint.mint_authority_revoked = {
      to: null,
      tx_signature: revokeSig,
      at: new Date().toISOString(),
      note: "supply fixed at 100 USDC-test — TOTAL SUPPLY HARD CAP now holds on chain",
    };
    console.log(`  revoke tx ${revokeSig}`);
  } else {
    record.mint.mint_authority_revoked ??= { to: null, note: "already revoked" };
  }
  const after = await getMint(connection, new PublicKey(mintB58));
  if (after.mintAuthority !== null) throw new Error("MINT AUTHORITY STILL PRESENT — hard cap not established");
  record.mint.mint_authority = null;
  record.governance = {
    devnet_materialization_writes: "YES (create mint, create 2 ATAs, mint supply, revoke authority)",
    program_deployment: "NO",
    settlement_tx: "NO",
    release_tx: "NO",
  };
  record.repaired_at = new Date().toISOString();

  writeFileSync(RECORD, JSON.stringify(record, null, 2) + "\n");
  console.log(`appendix-a.json repaired and hardened`);
}

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
      // T3-R1 erratum note: createMint()/createAssociatedTokenAccount() return
      // PUBLICKEYS, not signatures. Creation signatures are located and
      // verified by --repair; only mintTo returns a real signature.
      create_tx_signature: null,
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
      // pubkey returns, NOT signatures (T3-R1 erratum) — real creation txs come from --repair
      treasury_ata_tx: null,
      claimant_ata_tx: null,
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
  const mintInfo = await getMint(connection, mint);
  const treasuryAta = new PublicKey(record.token_accounts.treasury_ata);
  const claimantAta = new PublicKey(record.token_accounts.claimant_ata);
  const tAcct = await getAccount(connection, treasuryAta);
  const cAcct = await getAccount(connection, claimantAta);
  if (tAcct.mint.toBase58() !== mint.toBase58() || cAcct.mint.toBase58() !== mint.toBase58()) throw new Error("VERIFY FAIL: ATA mint mismatch");
  if (!verifyBinding(record.claimant_payout_binding)) throw new Error("VERIFY FAIL: binding hash");

  // T3-R1: HARD CAP must hold on chain — mint authority revoked, supply exactly 100
  if (mintInfo.mintAuthority !== null) throw new Error(`VERIFY FAIL: mint authority STILL ${mintInfo.mintAuthority.toBase58()} — supply is not hard-capped`);
  if (mintInfo.supply.toString() !== SUPPLY_BASE_UNITS) throw new Error(`VERIFY FAIL: supply ${mintInfo.supply} ≠ ${SUPPLY_BASE_UNITS}`);

  // T3-R1: the REAL creation transactions must fetch, be error-free, and reference the accounts
  const checks = [];
  for (const [label, sig, account] of [
    ["mint", record.mint.creation_tx?.signature, record.mint.pubkey],
    ["treasury ATA", record.token_accounts.treasury_ata_creation_tx?.signature, record.token_accounts.treasury_ata],
    ["claimant ATA", record.token_accounts.claimant_ata_creation_tx?.signature, record.token_accounts.claimant_ata],
    ["supply", record.mint.supply_tx_signature, record.token_accounts.treasury_ata],
    ["authority revoke", record.mint.mint_authority_revoked?.tx_signature, record.mint.pubkey],
  ]) {
    if (!sig || typeof sig !== "string" || sig.length < 64 || sig === account) {
      throw new Error(`VERIFY FAIL: ${label} creation signature missing or is a pubkey, not a signature`);
    }
    await verifyCreationTx(sig, account, label);
    checks.push(label);
  }
  console.log("VERIFY OK:", JSON.stringify({
    mint: mint.toBase58(),
    mint_authority: null,
    supply: mintInfo.supply.toString(),
    treasury_balance: tAcct.amount.toString(),
    claimant_balance: cAcct.amount.toString(),
    program_id: record.program_id.pubkey,
    binding_hash: record.claimant_payout_binding.binding_hash,
    creation_txs_verified: checks,
  }, null, 2));
}

if (MODE === "create") await create();
else if (MODE === "repair") await repair();
else await verify();
