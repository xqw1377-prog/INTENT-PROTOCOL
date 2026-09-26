#!/usr/bin/env node
/**
 * OFFLINE key provisioning — NOT part of the verification path.
 *
 * T2 HARDENING (Commander CONFIRMED / dedicated amendment task). Six rules:
 *
 *   1. key version is a REQUIRED parameter — never a hardcoded default
 *   2. the committed verifier-registry.json is NEVER overwritten implicitly:
 *      `promote` refuses by default when a registry already exists
 *   3. replacement requires an explicit --force
 *   4. replacement additionally requires --expect-current-sha256 (and/or
 *      --expect-current-version) pinning the trust root being replaced
 *   5. two-step separation by construction:
 *        generate → private keys (gitignored) + a CANDIDATE registry file;
 *                   never touches verifier-registry.json
 *        promote   → atomic replace of verifier-registry.json, only under
 *                    rules 2–4
 *   6. tests prove a default execution cannot destroy the committed V3 root
 *
 * Exit codes: 0 ok · 2 usage · 3 refusal (registry protected)
 *
 * Usage:
 *   node scripts/provision-keys.mjs generate --version v4 [--keys-dir DIR]
 *        [--roles verifier:gp3-functional,verifier:gp3-policy]
 *   node scripts/provision-keys.mjs promote --candidate FILE [--keys-dir DIR]
 *        --expect-current-sha256 sha256:... [--expect-current-version v3] --force
 */
import { generateKeyPairSync, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(`usage:
  provision-keys.mjs generate --version <vN> [--keys-dir DIR] [--roles a,b]
  provision-keys.mjs promote --candidate FILE [--keys-dir DIR] --expect-current-sha256 sha256:<hex> [--expect-current-version <vN>] --force`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version" || a === "--keys-dir" || a === "--roles" || a === "--candidate"
      || a === "--expect-current-sha256" || a === "--expect-current-version") {
      const v = argv[++i];
      if (v === undefined) usage(`missing value for ${a}`);
      out[a.slice(2)] = v;
    } else if (a === "--force") {
      out.force = true;
    } else {
      usage(`unknown argument: ${a}`);
    }
  }
  return out;
}

const sha256File = (p) => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex");

const [mode, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const keysDir = args["keys-dir"] ? path.resolve(args["keys-dir"]) : path.join(pkgDir, "keys");
const privDir = path.join(keysDir, "private");
const registryPath = path.join(keysDir, "verifier-registry.json");
const candidatePath = args.candidate ? path.resolve(args.candidate) : path.join(keysDir, "verifier-registry.candidate.json");

if (mode === "generate") {
  // Rule 1: version is REQUIRED — no default, ever.
  const version = args.version;
  if (!version || !/^v[0-9]+$/.test(version)) usage("--version <vN> is required (e.g. --version v4)");
  const roles = (args.roles ?? "verifier:gp3-functional,verifier:gp3-policy").split(",").map((s) => s.trim()).filter(Boolean);
  if (roles.length === 0) usage("--roles must list at least one verifier id");

  mkdirSync(privDir, { recursive: true });
  const keys = [];
  for (const role of roles) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const keyId = `gp3-${role.split(":")[1]}-ed25519-${version}`;
    const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    // Rule 5a: private keys land in keys/private/ (gitignored) — ONLY there.
    writeFileSync(path.join(privDir, `${keyId}.pem`), privPem);
    keys.push({ verifier_id: role, key_id: keyId, public_key_pem: pubPem, algorithm: "ed25519", frozen_at: new Date().toISOString() });
  }
  // Rule 5a: the registry output is a CANDIDATE file — verifier-registry.json
  // is never touched by generate.
  const candidate = { schema_version: "gp3-verifier-keys.v1", keys };
  writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + "\n");
  console.log(`generated ${keys.length} ed25519 keypairs (version ${version})`);
  console.log(`private keys : ${privDir} (gitignored)`);
  console.log(`candidate    : ${candidatePath}`);
  console.log(`candidate sha256 = ${sha256File(candidatePath)}`);
  console.log(`registry untouched: ${registryPath} ${existsSync(registryPath) ? "(present, preserved)" : "(absent)"}`);
  process.exit(0);
}

if (mode === "promote") {
  // candidate: explicit --candidate FILE, or the default candidate produced
  // by a prior `generate` in the same keys-dir. It must EXIST.
  if (!existsSync(candidatePath)) usage(`candidate not found: ${candidatePath} (run generate first, or pass --candidate FILE)`);
  if (!args["expect-current-sha256"] && !args["expect-current-version"]) {
    usage("promote requires --expect-current-sha256 (and/or --expect-current-version) pinning the trust root being replaced");
  }
  // Rule 2: refuse to overwrite an existing registry by default.
  if (existsSync(registryPath) && !args.force) {
    console.error(`refusing to overwrite existing registry ${registryPath} (re-run with --force)`);
    process.exit(3);
  }
  if (existsSync(registryPath)) {
    // Rule 4: the CURRENT trust root must match the caller's pinned expectation.
    if (args["expect-current-sha256"]) {
      const current = sha256File(registryPath);
      if (current !== args["expect-current-sha256"]) {
        console.error(`current registry sha256 ${current} != expected ${args["expect-current-sha256"]} — refusing`);
        process.exit(3);
      }
    }
    if (args["expect-current-version"]) {
      const registry = JSON.parse(readFileSync(registryPath, "utf8"));
      const versions = new Set((registry.keys ?? []).map((k) => String(k.key_id ?? "").split("-").pop()));
      if (versions.size !== 1 || !versions.has(args["expect-current-version"])) {
        console.error(`current registry key versions [${[...versions].join(",")}] != expected ${args["expect-current-version"]} — refusing`);
        process.exit(3);
      }
    }
  }
  // Rule 5b: atomic replace (write beside, then rename over).
  const tmp = registryPath + ".tmp-promote";
  writeFileSync(tmp, readFileSync(candidatePath));
  renameSync(tmp, registryPath);
  console.log(`promoted ${candidatePath} -> ${registryPath}`);
  console.log(`new registry sha256 = ${sha256File(registryPath)}`);
  process.exit(0);
}

usage(`unknown or missing mode: ${mode ?? "(none)"}`);
