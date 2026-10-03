/**
 * USER-EVIDENCE-R0 / UE-2 (CUT-2) — freeze-pack intake closure.
 *
 * Every consumer (runner, proof builder, replayer, ledger) re-derives the
 * FULL closure from disk before doing anything: ruleset.json and
 * contract-freeze.json must be EXACTLY the objects task.json derives, and
 * the manifest hashes must re-verify (UE1-R7..R10 discipline, re-enforced
 * at intake instead of trusted from a prior check).
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import {
  assertFreezeComplete,
  contractFreezeHash,
  contractFreezeOf,
  precommitBinding,
  verificationRulesetHash,
  verificationRulesetOf,
  type RealTaskExperimentV1,
} from "./schema.ts";
import type { FreezeManifest } from "./freeze.ts";

export class FreezePackError extends Error {
  constructor(readonly reason: string, message: string) {
    super(`FREEZE-PACK-INVALID (${reason}): ${message}`);
  }
}

export const FREEZE_PACK_FILES = ["task.json", "ruleset.json", "contract-freeze.json", "freeze-manifest.json"] as const;

export interface FreezePack {
  dir: string;
  task: RealTaskExperimentV1;
  manifest: FreezeManifest;
}

const HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** Re-derive every freeze identity from the four on-disk artifacts; throw on ANY mismatch. */
export function verifyFreezePackDir(dir: string): FreezePack {
  const read = (f: string): unknown => {
    const p = path.join(dir, f);
    if (!existsSync(p)) throw new FreezePackError("missing-file", f);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      throw new FreezePackError("unparsable", `${f}: ${String((e as Error).message)}`);
    }
    return parsed;
  };

  const task = read("task.json") as RealTaskExperimentV1;
  const rulesetFile = read("ruleset.json");
  const contractFile = read("contract-freeze.json");
  const manifest = read("freeze-manifest.json") as FreezeManifest;

  try {
    assertFreezeComplete(task);
  } catch (e) {
    throw new FreezePackError("task-incomplete", String((e as Error).message));
  }
  if (manifest.schema_version !== "freeze-manifest.v2") throw new FreezePackError("manifest-schema", String(manifest.schema_version));
  if (manifest.eligibility !== "ELIGIBLE") throw new FreezePackError("not-eligible", String(manifest.eligibility));
  if (manifest.experiment_id !== task.experiment_id) throw new FreezePackError("id-mismatch", "manifest vs task experiment_id");
  if (manifest.base_commit_sha !== task.base_commit_sha) throw new FreezePackError("base-mismatch", "manifest vs task base_commit_sha");
  for (const [field, value] of [
    ["acceptance_suite_sha256", task.acceptance_suite_sha256],
    ["lockfile_sha256", task.lockfile_sha256],
    ["verification_ruleset_hash", verificationRulesetHash(verificationRulesetOf(task))],
    ["contract_freeze_hash", contractFreezeHash(task)],
    ["precommit_binding", precommitBinding(task)],
  ] as const) {
    if (!HASH_RE.test(value)) throw new FreezePackError("hash-grammar", `${field}`);
  }
  if (JSON.stringify(verificationRulesetOf(task)) !== JSON.stringify(rulesetFile)) {
    throw new FreezePackError("ruleset-not-derived", "ruleset.json is not the ruleset task.json derives");
  }
  if (JSON.stringify(contractFreezeOf(task)) !== JSON.stringify(contractFile)) {
    throw new FreezePackError("contract-not-derived", "contract-freeze.json is not the contract task.json derives");
  }
  if (manifest.acceptance_suite_sha256 !== task.acceptance_suite_sha256) throw new FreezePackError("suite-hash", "manifest vs task acceptance_suite_sha256");
  if (manifest.lockfile_sha256 !== task.lockfile_sha256) throw new FreezePackError("lockfile-hash", "manifest vs task lockfile_sha256");
  if (manifest.verification_ruleset_hash !== verificationRulesetHash(verificationRulesetOf(task))) throw new FreezePackError("ruleset-hash", "manifest.verification_ruleset_hash does not re-derive");
  if (manifest.contract_freeze_hash !== contractFreezeHash(task)) throw new FreezePackError("contract-hash", "manifest.contract_freeze_hash does not re-derive");
  if (manifest.precommit_binding !== precommitBinding(task)) throw new FreezePackError("precommit-binding", "manifest.precommit_binding does not re-derive");

  return { dir, task, manifest };
}
