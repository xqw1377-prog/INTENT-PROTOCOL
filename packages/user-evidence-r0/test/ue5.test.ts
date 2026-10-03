/** USER-EVIDENCE-R0 CUT-2R machine tests — AUDIT-C blockers C1/C2 (UE5-R-PROVENANCE, UE5-R-FINALITY). */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freezeExperiment } from "../src/freeze.ts";
import { runWorkerPatch } from "../src/run.ts";
import { buildProofPack } from "../src/proof.ts";
import { replayPack } from "../src/portable-replay.mjs";
import { finalizeLedger, recordObservation, thesisVerdictOf, type LedgerObservationsV1 } from "../src/ledger.ts";
import { fixableConfig, fixPatch, makeFixableRepo } from "./helpers.ts";

let tmp = "";
let repoDir = "";
let proofDir = "";
let report: unknown;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "ue5r-test-"));
  const repo = makeFixableRepo();
  repoDir = repo.dir;
  const freezeDir = path.join(tmp, "freeze");
  freezeExperiment(repoDir, fixableConfig(repoDir, repo.sha), freezeDir);
  const patchPath = path.join(tmp, "worker.patch");
  writeFileSync(patchPath, fixPatch(repoDir));
  const recordPath = path.join(tmp, "run-record.json");
  runWorkerPatch({ repoDir, freezePackDir: freezeDir, patchPath, ranAt: "2026-10-03T16:00:00.000Z" }, recordPath);
  proofDir = path.join(tmp, "proof");
  buildProofPack({ freezePackDir: freezeDir, runRecordPath: recordPath, patchPath, repoDir, outDir: proofDir, builtAt: "2026-10-03T16:05:00.000Z" });
  report = replayPack(proofDir, { replayedAt: "2026-10-03T16:10:00.000Z" });
}, 1_200_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

const SOURCE_TEXT = "maintainer, in issue #42, 2026-10-03: According to the rules I agreed to before work began, this worker earned the Tier-1 reward.";
const sha256Text = (s: string): string => "sha256:" + createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

function observations(over: Partial<LedgerObservationsV1> = {}): LedgerObservationsV1 {
  return {
    schema_version: "real-task-ledger-observations.v1",
    third_party_replay: "SAME",
    payer_accepts_tier1: true,
    payer_ack_verbatim: "According to the rules I agreed to before work began, this worker earned the Tier-1 reward.",
    payer_ack_timestamp: "2026-10-03T17:00:00.000Z",
    posthoc_rule_change_attempts: 0,
    posthoc_rule_change_details: [],
    repeat_fund_intent: "YES",
    observation_source: "GITHUB_COMMENT",
    observer_identity: "operator:zcode",
    source_record: SOURCE_TEXT,
    source_record_sha256: sha256Text(SOURCE_TEXT),
    payer_attestation: "UNSIGNED_RECORDED",
    recorded_at: "2026-10-03T17:30:00.000Z",
    ...over,
  };
}

describe("[UE-5 CUT-2R] provenance + finality", () => {
  test("[UE5-R1-VERIFIED-ONLY] observations require a PASSING independent replay bound to THESE pack bytes", () => {
    const expDir = path.join(tmp, "exp-r1");
    const c = path.join(tmp, "tampered");
    cpSync(proofDir, c, { recursive: true });
    writeFileSync(path.join(c, "worker.patch"), readFileSync(path.join(c, "worker.patch"), "utf8") + "\n");
    expect(() => recordObservation(c, observations(), expDir, { replayReport: report })).toThrow(/LEDGER-REFUSED \(replay\): pack-binding/);
    expect(() => recordObservation(c, observations(), expDir)).toThrow(/LEDGER-REFUSED/);
    const f = recordObservation(proofDir, observations(), expDir, { replayReport: report });
    expect(f.seq).toBe(1);
    expect(f.pack_binding.proof_manifest_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("[UE5-R-PROVENANCE] no observation without source/observer/hash-bound record; attestation class splits the report", () => {
    const expDir = path.join(tmp, "exp-prov");
    expect(() => recordObservation(proofDir, observations({ observation_source: undefined as never }), expDir, { replayReport: report })).toThrow(/observation_source/);
    expect(() => recordObservation(proofDir, observations({ observer_identity: " " }), expDir, { replayReport: report })).toThrow(/observer_identity/);
    expect(() => recordObservation(proofDir, observations({ source_record: "different text" }), expDir, { replayReport: report })).toThrow(/source_record_sha256/);
    // unsigned vs signed: attestation class is carried, never conflated with technical proof
    const e1 = path.join(tmp, "exp-unsigned");
    recordObservation(proofDir, observations(), e1, { replayReport: report });
    const l1 = finalizeLedger(proofDir, e1, { replayReport: report });
    expect(l1.user_evidence.attestation_class).toBe("OBSERVED / UNSIGNED");
    expect(l1.rendered).toContain("USER EVIDENCE: OBSERVED / UNSIGNED");
    expect(l1.rendered).toContain("TECHNICAL EVIDENCE: VERIFIED");
    const signedSource = "Signed statement (PGP, detached): the Tier-1 entitlement was earned.";
    const e2 = path.join(tmp, "exp-signed");
    recordObservation(proofDir, observations({ observation_source: "SIGNED_STATEMENT", payer_attestation: "SIGNED", source_record: signedSource, source_record_sha256: sha256Text(signedSource) }), e2, { replayReport: report });
    const l2 = finalizeLedger(proofDir, e2, { replayReport: report });
    expect(l2.user_evidence.attestation_class).toBe("PAYER-ATTESTED");
    expect(l2.rendered).toContain("USER EVIDENCE: PAYER-ATTESTED");
    expect(l2.rendered).toContain("PAYER ATTESTATION: SIGNED");
    expect(l2.verdict).toBe("THESIS STRENGTHENED"); // same behavior, honestly different evidence class
  });

  test("[UE5-R3-RULE-CHANGE] mapping lattice unchanged (total, deterministic)", () => {
    expect(thesisVerdictOf({ payer_accepts_tier1: true, posthoc_rule_change_attempts: 0, repeat_fund_intent: "YES" })).toBe("THESIS STRENGTHENED");
    expect(thesisVerdictOf({ payer_accepts_tier1: true, posthoc_rule_change_attempts: 1, repeat_fund_intent: "YES" })).toBe("THESIS MIXED");
    expect(thesisVerdictOf({ payer_accepts_tier1: true, posthoc_rule_change_attempts: 0, repeat_fund_intent: "NOT_ASKED" })).toBe("THESIS MIXED");
    expect(thesisVerdictOf({ payer_accepts_tier1: true, posthoc_rule_change_attempts: 0, repeat_fund_intent: "NO" })).toBe("THESIS MIXED");
    expect(thesisVerdictOf({ payer_accepts_tier1: false, posthoc_rule_change_attempts: 0, repeat_fund_intent: "YES" })).toBe("THESIS CHALLENGED");
  });

  test("[UE5-R-FINALITY] one experiment, one FINAL ledger: revisions recorded, latest wins, never regenerated", () => {
    const expDir = path.join(tmp, "exp-final");
    recordObservation(proofDir, observations({ payer_accepts_tier1: false, payer_ack_verbatim: "", repeat_fund_intent: "NOT_ASKED", recorded_at: "2026-10-03T18:00:00.000Z" }), expDir, { replayReport: report });
    recordObservation(proofDir, observations({ recorded_at: "2026-10-03T18:30:00.000Z" }), expDir, { replayReport: report });
    // both revisions live, append-only
    const files = execFileSync("ls", [path.join(expDir, "observations")], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
    expect(files).toEqual(["001.json", "002.json"]);
    // final ledger derives from the LATEST observation
    const l = finalizeLedger(proofDir, expDir, { replayReport: report });
    expect(l.finality).toEqual({ observation_seq: 2, observations_total: 2, final: true });
    expect(l.finalized_at).toBe("2026-10-03T18:30:00.000Z");
    expect(l.verdict).toBe("THESIS STRENGTHENED");
    // regeneration is refused — a contradictory second final is structurally impossible
    const bytes = readFileSync(path.join(expDir, "final-ledger.json"), "utf8");
    expect(() => finalizeLedger(proofDir, expDir, { replayReport: report })).toThrow(/LEDGER-REFUSED \(out-exists\)/);
    expect(readFileSync(path.join(expDir, "final-ledger.json"), "utf8")).toBe(bytes);
  });

  test("[UE5-R-FINALITY-EMPTY] no observations → finalize refuses", () => {
    expect(() => finalizeLedger(proofDir, path.join(tmp, "exp-empty"), { replayReport: report })).toThrow(/no-observations/);
  });

  test("[UE5-R4-DETERMINISTIC] same observation + same pack → byte-identical final ledger", () => {
    const a = path.join(tmp, "exp-det-a");
    const b = path.join(tmp, "exp-det-b");
    recordObservation(proofDir, observations(), a, { replayReport: report });
    recordObservation(proofDir, observations(), b, { replayReport: report });
    finalizeLedger(proofDir, a, { replayReport: report });
    finalizeLedger(proofDir, b, { replayReport: report });
    expect(readFileSync(path.join(a, "final-ledger.json"), "utf8")).toBe(readFileSync(path.join(b, "final-ledger.json"), "utf8"));
  });

  test("[UE5-DIFFERENT-REPLAY] an irreproducible pack carries NO user evidence (refused)", () => {
    const expDir = path.join(tmp, "exp-diff");
    expect(() => recordObservation(proofDir, observations({ third_party_replay: "DIFFERENT" }), expDir, { replayReport: report })).toThrow(/third_party_replay/);
    // the refusal left no experiment directory behind
    expect(execFileSync("ls", [tmp], { encoding: "utf8" }).split("\n").filter((f) => f.startsWith("exp-diff"))).toEqual([]);
  });
});
