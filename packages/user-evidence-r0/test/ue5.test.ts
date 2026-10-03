/** USER-EVIDENCE-R0 CUT-4 machine tests — UE-5 user-evidence ledger. */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freezeExperiment } from "../src/freeze.ts";
import { runWorkerPatch } from "../src/run.ts";
import { buildProofPack } from "../src/proof.ts";
import { replayPack } from "../src/portable-replay.mjs";
import { recordLedger, thesisVerdictOf, type LedgerObservationsV1 } from "../src/ledger.ts";
import { fixableConfig, fixPatch, makeFixableRepo } from "./helpers.ts";

let tmp = "";
let repoDir = "";
let proofDir = "";
let report: unknown;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "ue5-test-"));
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
    recorded_at: "2026-10-03T17:30:00.000Z",
    ...over,
  };
}

describe("[UE-5 CUT-4] user-evidence ledger", () => {
  test("[UE5-R1-VERIFIED-ONLY] user evidence requires a PASSING independent replay bound to THESE pack bytes", () => {
    // a tampered pack is refused even when a (stale) report is supplied
    const c = path.join(tmp, "tampered");
    cpSync(proofDir, c, { recursive: true });
    writeFileSync(path.join(c, "worker.patch"), readFileSync(path.join(c, "worker.patch"), "utf8") + "\n");
    expect(() => recordLedger(c, observations(), path.join(tmp, "l1.json"), { replayReport: report })).toThrow(/LEDGER-REFUSED \(replay\): pack-binding/);
    // ...and refused again when it re-replays itself
    expect(() => recordLedger(c, observations(), path.join(tmp, "l2.json"))).toThrow(/LEDGER-REFUSED/);
    // the honest pack with the honest report records fine
    expect(recordLedger(proofDir, observations(), path.join(tmp, "l3.json"), { replayReport: report }).verdict).toBe("THESIS STRENGTHENED");
  });

  test("[UE5-R2-ACCEPT-FLIPS] payer rejection reads THESIS CHALLENGED; verbatim words + timestamp are durable record", () => {
    const out = path.join(tmp, "l4.json");
    const l = recordLedger(proofDir, observations({ payer_accepts_tier1: false, payer_ack_verbatim: "", repeat_fund_intent: "NOT_ASKED" }), out, { replayReport: report });
    expect(l.verdict).toBe("THESIS CHALLENGED");
    expect(l.user_evidence.payer_ack_verbatim).toBe("");
    const ledger = JSON.parse(readFileSync(out, "utf8"));
    expect(ledger.technical.tier1_verdict).toBe("VALID");
    expect(ledger.technical.third_party_replay).toBe("SAME");
    // the ack path keeps the durable record
    const l2 = recordLedger(proofDir, observations(), path.join(tmp, "l5.json"), { replayReport: report });
    expect(l2.user_evidence.payer_ack_verbatim).toContain("earned the Tier-1 reward");
    expect(l2.user_evidence.payer_ack_timestamp).toBe("2026-10-03T17:00:00.000Z");
  });

  test("[UE5-R3-RULE-CHANGE] any post-hoc rule-change attempt blocks STRENGTHENED (→ MIXED); NOT_ASKED repeat-fund also → MIXED", () => {
    expect(thesisVerdictOf({ payer_accepts_tier1: true, posthoc_rule_change_attempts: 0, repeat_fund_intent: "YES" })).toBe("THESIS STRENGTHENED");
    expect(thesisVerdictOf({ payer_accepts_tier1: true, posthoc_rule_change_attempts: 1, repeat_fund_intent: "YES" })).toBe("THESIS MIXED");
    expect(thesisVerdictOf({ payer_accepts_tier1: true, posthoc_rule_change_attempts: 0, repeat_fund_intent: "NOT_ASKED" })).toBe("THESIS MIXED");
    expect(thesisVerdictOf({ payer_accepts_tier1: true, posthoc_rule_change_attempts: 0, repeat_fund_intent: "NO" })).toBe("THESIS MIXED");
    expect(thesisVerdictOf({ payer_accepts_tier1: false, posthoc_rule_change_attempts: 0, repeat_fund_intent: "YES" })).toBe("THESIS CHALLENGED");
    const l = recordLedger(
      proofDir,
      observations({ posthoc_rule_change_attempts: 1, posthoc_rule_change_details: ["payer asked to add a code-review requirement after seeing the patch"] }),
      path.join(tmp, "l6.json"),
      { replayReport: report },
    );
    expect(l.verdict).toBe("THESIS MIXED");
    expect(l.user_evidence.posthoc_rule_change_details).toHaveLength(1);
    expect(l.rendered).toContain("POST-HOC RULE CHANGE REQUEST: 1");
  });

  test("[UE5-R4-DETERMINISTIC] the same observations produce a byte-identical ledger", () => {
    const a = path.join(tmp, "la.json");
    const b = path.join(tmp, "lb.json");
    recordLedger(proofDir, observations(), a, { replayReport: report });
    recordLedger(proofDir, observations(), b, { replayReport: report });
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
  });

  test("[UE5-R5-IMMUTABLE] a ledger is append-only — never overwritten", () => {
    const out = path.join(tmp, "lc.json");
    recordLedger(proofDir, observations(), out, { replayReport: report });
    const bytes = readFileSync(out, "utf8");
    expect(() => recordLedger(proofDir, observations(), out, { replayReport: report })).toThrow(/LEDGER-REFUSED \(out-exists\)/);
    expect(readFileSync(out, "utf8")).toBe(bytes);
  });

  test("[UE5-RENDER] the rendered ledger IS the frozen §6 report form", () => {
    const l = recordLedger(proofDir, observations(), path.join(tmp, "ld.json"), { replayReport: report });
    const lines = l.rendered.split("\n");
    expect(lines.map((x) => x.split(":")[0])).toEqual([
      "REAL PAYER", "REAL TASK", "REAL EXTERNAL WORKER", "PAYER PRE-COMMIT",
      "BASE RED / PATCH GREEN / FULL SUITE", "THIRD-PARTY REPLAY",
      "PAYER ACCEPTS TIER-1 ENTITLEMENT", "POST-HOC RULE CHANGE REQUEST",
      "REPEAT-FUND INTENT", "VERDICT",
    ]);
    expect(l.rendered).toContain("VERDICT: THESIS STRENGTHENED");
  });

  test("[UE5-DIFFERENT-REPLAY] an irreproducible pack carries NO user evidence (refused)", () => {
    expect(() =>
      recordLedger(proofDir, observations({ third_party_replay: "DIFFERENT" }), path.join(tmp, "le.json"), { replayReport: report }),
    ).toThrow(/third_party_replay/);
    // acceptance without verbatim words is refused too
    expect(() =>
      recordLedger(proofDir, observations({ payer_ack_verbatim: "  " }), path.join(tmp, "lf.json"), { replayReport: report }),
    ).toThrow(/payer_ack_verbatim/);
    expect(execFileSync("ls", [tmp], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".json") && f.startsWith("le"))).toEqual([]);
  });
});
