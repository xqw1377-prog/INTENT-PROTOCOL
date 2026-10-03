/** FRONTEND-R1 / FR-1 gates — status derivation + no duplicated backend truth. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { deriveExperimentFacts, deriveExperimentState, experimentPaths } from "../server/state.ts";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let tmp = "";
const expDir = (): string => {
  tmp = mkdtempSync(path.join(tmpdir(), "fr1-"));
  return tmp;
};

describe("[FR-1] phase derives from artifacts (no second state database)", () => {
  test("empty experiment dir → DRAFT, all facts pending/open", () => {
    const d = expDir();
    try {
      const s = deriveExperimentState(d);
      expect(s.phase).toBe("DRAFT");
      expect(s.facts).toEqual({
        rules_state: "DRAFT",
        submission_state: "NONE",
        primary_verification: "PENDING",
        replay: "PENDING",
        tier1_entitlement: "PENDING",
        payer_response: "NONE",
        ledger: "OPEN",
      });
      expect(s.transient).toEqual({ checking: false, verifying: false });
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("eligibility ok → READY_TO_FREEZE; failed eligibility stays DRAFT; transients are explicit and never persisted", () => {
    const d = expDir();
    try {
      const p = experimentPaths(d);
      writeFileSync(p.eligibility, JSON.stringify({ ok: true }) + "\n");
      expect(deriveExperimentState(d).phase).toBe("READY_TO_FREEZE");
      writeFileSync(p.eligibility, JSON.stringify({ ok: false, reason: "base-not-red" }) + "\n");
      expect(deriveExperimentState(d).phase).toBe("DRAFT");
      expect(deriveExperimentState(d, { checking: true }).phase).toBe("CHECKING");
      expect(deriveExperimentState(d).phase).toBe("DRAFT"); // transient never sticks
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("full lifecycle facts derive independently and never merge", () => {
    const d = expDir();
    try {
      const p = experimentPaths(d);
      mkdirSync(path.join(p.freezeDir));
      writeFileSync(path.join(p.freezeDir, "freeze-manifest.json"), "{}\n");
      expect(deriveExperimentFacts(d).rules_state).toBe("FROZEN");
      expect(deriveExperimentState(d).phase).toBe("FROZEN");

      writeFileSync(p.workerPatch, "diff --git\n");
      expect(deriveExperimentFacts(d).submission_state).toBe("SUBMITTED");
      expect(deriveExperimentState(d).phase).toBe("SUBMITTED");

      writeFileSync(p.runRecord, JSON.stringify({ verdict: "VALID" }) + "\n");
      expect(deriveExperimentFacts(d).primary_verification).toBe("VALID");
      expect(deriveExperimentFacts(d).tier1_entitlement).toBe("PENDING"); // VALID alone must NOT earn

      writeFileSync(p.replayReport, JSON.stringify({ status: "PASS" }) + "\n");
      expect(deriveExperimentFacts(d).tier1_entitlement).toBe("EARNED"); // spec §24: VALID ∧ PASS
      expect(deriveExperimentState(d).phase).toBe("AWAITING_PAYER");

      writeFileSync(p.replayReport, JSON.stringify({ status: "FAIL" }) + "\n");
      expect(deriveExperimentFacts(d).tier1_entitlement).toBe("PENDING");

      writeFileSync(p.runRecord, JSON.stringify({ verdict: "INVALID" }) + "\n");
      writeFileSync(p.replayReport, JSON.stringify({ status: "PASS" }) + "\n");
      expect(deriveExperimentFacts(d).tier1_entitlement).toBe("NOT_EARNED"); // INVALID is terminal for the run
      expect(deriveExperimentState(d).phase).toBe("SUBMITTED"); // facts carry the outcome; no invented retry phase

      mkdirSync(p.observationsDir);
      writeFileSync(path.join(p.observationsDir, "001.json"), "{}\n");
      expect(deriveExperimentFacts(d).payer_response).toBe("RECORDED");

      writeFileSync(p.finalLedger, "{}\n");
      expect(deriveExperimentFacts(d).ledger).toBe("FINALIZED");
      expect(deriveExperimentState(d).phase).toBe("FINALIZED");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("[FR-1] no duplicated backend truth (source discipline)", () => {
  const serverSources = ["server/index.ts", "server/state.ts", "web/app.js"].map((f) => path.join(pkgDir, f));

  test("the server CALLS the frozen modules — imports them, does not reimplement them", () => {
    const src = readFileSync(serverSources[0]!, "utf8");
    expect(src).toContain("packages/user-evidence-r0/src/freeze.ts");
    expect(src).toContain("runPreflight");
    expect(src).toContain("freezeExperiment");
    expect(src).toContain("CANONICAL_INSTALL_COMMAND");
  });

  test("no second implementation of backend truth anywhere in the orchestrator/web layer", () => {
    for (const file of serverSources) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file}: no hash computation`).not.toContain("createHash");
      expect(src, `${file}: no canonical serialization`).not.toContain("deepSort");
      expect(src, `${file}: no glob matching`).not.toContain("globToRegExp");
      expect(src, `${file}: no policy parsing`).not.toContain("parseUnifiedPatch");
      expect(src, `${file}: no verdict recompute`).not.toMatch(/sha256\s*\(/);
    }
  });

  test("frontend red lines: forbidden wording never appears in the UI layer", () => {
    const ui = readFileSync(path.join(pkgDir, "web/app.js"), "utf8") + readFileSync(path.join(pkgDir, "web/index.html"), "utf8");
    for (const banned of ["Payment complete", "Funds released", "Escrow released", "PAYER-ATTESTED", "Auto release", "Create bounty", "Publish", "Launch task"]) {
      expect(ui, banned).not.toContain(banned);
    }
  });
});
