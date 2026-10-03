/* FRONTEND-R1 (HOLD-6 contract) — Facilitated Experiment UI (vanilla, no deps).
   Every displayed state comes from /api/state, which derives it from the
   experiment artifacts by calling the frozen verification boundaries.
   This script never computes verdicts, hashes, or entitlements — it renders
   them. UE-2 VALID alone NEVER renders EARNED (D6). */

const $ = (sel) => document.querySelector(sel);
let STATE = null;

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mono = (s) => `<span class="mono">${esc(s)}</span>`;
const note = (s) => `<p class="note">${s}</p>`;

/* ── header: independent facts that never merge (D7) ── */
const FACT_LABELS = [
  ["rules_state", "RULES"],
  ["primary_verification", "TIER 1"],
  ["replay", "REPLAY"],
  ["payer_response", "PAYER"],
];
const FACT_CLASS = { FROZEN: "frozen", EARNED: "frozen", PASS: "frozen", VALID: "frozen", NOT_EARNED: "invalid", FAIL: "invalid", INVALID: "invalid", PENDING: "pending", DRAFT: "pending", NONE: "pending", OPEN: "pending", RECORDED: "frozen" };

function renderHeader(state) {
  const dot = $("#phase-dot");
  dot.className = "phase-dot " + ({ FROZEN: "frozen", READY_TO_FREEZE: "ready", AWAITING_PAYER: "awaiting", CHECKING: "checking", VERIFYING: "checking" }[state.phase] || "pending");
  $("#phase-name").textContent = state.phase.replace(/_/g, " ");
  $("#facts-strip").innerHTML =
    FACT_LABELS.map(([key, label]) => {
      const v = state.facts[key];
      return `<span class="fact"><span class="k">${label}</span><span class="v ${FACT_CLASS[v] || ""}">${esc(v)}</span></span>`;
    }).join("") +
    (state.facts.ledger === "FINALIZED" ? `<span class="fact"><span class="k">LEDGER</span><span class="v frozen">FINALIZED</span></span>` : "");
}

function technicalDetails(entries) {
  if (!entries.length) return "";
  return `<details class="tech"><summary>View technical details</summary><div class="body">${entries.map(([k, v]) => `${esc(k).padEnd(24, " ")} ${esc(v)}`).join("\n")}</div></details>`;
}

const busy = (msg) => {
  $("#main").innerHTML = `<h1 class="page-title">${esc(msg)}</h1><p class="note">This runs the real frozen machinery — no simulation, no optimistic results.</p>`;
};

/* ── F1 · DRAFT: Prepare the task (D4/D5) ── */
function renderPrepare(state) {
  const d = state.draft || {};
  const n = state.notes || {};
  const eligibility = state.eligibility;
  const field = (id, label, value, opts = {}) =>
    `<div class="form-field ${opts.full ? "full" : ""}">
      <label for="f-${id}">${label}${opts.req ? "" : ""}</label>
      <input id="f-${id}" data-field="${id}" value="${esc(value ?? "")}" placeholder="${esc(opts.ph || "")}" ${opts.disabled ? "disabled" : ""} />
      ${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ""}
    </div>`;

  const readiness = state.readiness || { ready: false, reason: "run Check eligibility" };
  const eligCard = eligibility
    ? eligibility.ok
      ? readiness.ready
        ? `<div class="card frozen-card"><div class="card-title">Eligibility</div><div class="card-value frozen">ELIGIBLE FOR FREEZE</div><div class="note">Prepare report is current and matches the reviewed inputs.</div></div>`
        : `<div class="card"><div class="card-title">Eligibility</div><div class="error-note">REVIEWED INPUTS CHANGED — re-check eligibility before freeze (${esc(readiness.reason)})</div></div>`
      : `<div class="card" style="border-color:var(--invalid)"><div class="card-title">Eligibility</div><div class="error-note">NOT ELIGIBLE — ${esc(eligibility.reason)}</div></div>`
    : `<p class="note">Checks are pending until you run them — nothing is assumed green.</p>`;

  $("#main").innerHTML = `
    <h1 class="page-title">Prepare the task</h1>
    <p class="page-subtitle">Define what must be true before anyone starts working.</p>
    <p class="note">${esc(state.operating_mode || "")}</p>
    <form id="prepare-form">
      <h2 class="section-title">Who</h2>
      <div class="form-grid">
        ${field("payer_identity", "Payer (maintainer)", d.payer_identity, { ph: "must be selected before preparation" })}
        ${field("worker_identity", "Assigned worker", d.worker_identity, { ph: "must be selected before preparation" })}
      </div>
      <p class="note">Claim mode: <strong>Single claimant</strong> — this task is frozen for this worker only.</p>

      <h2 class="section-title">Context</h2>
      <div class="form-grid">
        ${field("repoPath", "Repository (local path for the experiment)", d.repoPath, { full: true })}
        ${field("base_commit_sha", "Base commit (exact)", d.base_commit_sha)}
        ${field("tier1_reward", "Tier-1 reward (declared, experimental)", d.tier1_reward || "")}
        ${field("tier2_reward", "Tier-2 reward", "0", { disabled: true, hint: "Zero for EXPERIMENT-001 — Tier-2 engine is not used in this experiment." })}
        <div class="form-field full">
          <label for="f-issue_url">Issue <span class="badge unfrozen">Unfrozen context</span></label>
          <input id="f-issue_url" data-field="issue_url" value="${esc(n.issue_url || "")}" />
        </div>
        <div class="form-field full">
          <label for="f-summary">Summary <span class="badge unfrozen">Unfrozen context</span></label>
          <textarea id="f-summary" data-field="summary">${esc(n.summary || "")}</textarea>
        </div>
      </div>

      <h2 class="section-title">What must be true (rules — not completed checks)</h2>
      <div class="form-grid">
        ${field("regression_command", "Regression command (rule: red on base)", d.regression_command, { full: true })}
        ${field("baseline_health_command", "Baseline command (rule: green on base)", d.baseline_health_command, { full: true })}
        ${field("patched_acceptance_command", "Patched acceptance command (rule)", d.patched_acceptance_command, { full: true })}
        ${field("acceptance_suite", "Acceptance suite file (explicit — never guessed)", d.acceptance_suite ?? "", { full: true, ph: "test/regression.test.ts" })}
        ${field("acceptance_full_suite", "Full-suite files (comma-separated, explicit)", (d.acceptance_full_suite ?? []).join(", "), { full: true, ph: "test/green.test.ts" })}
        ${field("allowed_paths", "Allowed paths", (d.allowed_paths || []).join(", "), { ph: "src/**" })}
        ${field("forbidden_paths", "Protected paths", (d.forbidden_paths || []).join(", "), { ph: "test/**, package-lock.json, .github/**" })}
        ${field("max_diff_lines", "Diff bound (changed lines)", d.max_diff_lines ?? 40)}
        ${field("determinism_runs", "Determinism (N runs)", d.determinism_runs ?? 3)}
        <div class="form-field full"><label>Install</label><input value="npm ci --ignore-scripts" disabled /></div>
        <div class="form-field full"><label>Network during verification</label><input value="Denied (verification sandbox)" disabled /><span class="hint">Describes the verification-sandbox commands — not a claim that dependency install never used the network.</span></div>
      </div>
      <div class="actions">
        <button class="primary" type="submit">Save configuration</button>
        <span class="note">Nothing is frozen yet. Any change here invalidates readiness and requires re-checking.</span>
      </div>
    </form>
    <hr class="divider-strong" />
    <h2 class="section-title">Check eligibility</h2>
    ${eligCard}
    <div class="actions">
      <button class="secondary" id="btn-check" ${state.hasDraft ? "" : "disabled"}>Check eligibility</button>
      ${readiness.ready ? `<button class="primary" id="btn-to-review">Review before freeze →</button>` : ""}
    </div>`;

  $("#prepare-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const get = (id) => document.querySelector(`[data-field="${id}"]`).value;
    try {
      await api("/api/prepare", {
        repoPath: get("repoPath").trim(),
        base_commit_sha: get("base_commit_sha").trim(),
        payer_identity: get("payer_identity").trim(),
        worker_identity: get("worker_identity").trim(),
        tier1_reward: get("tier1_reward").trim(),
        tier2_reward: "0",
        allowed_paths: get("allowed_paths").split(",").map((s) => s.trim()).filter(Boolean),
        forbidden_paths: get("forbidden_paths").split(",").map((s) => s.trim()).filter(Boolean),
        max_diff_lines: Number(get("max_diff_lines")) || 40,
        determinism_runs: Number(get("determinism_runs")) || 3,
        regression_command: get("regression_command").trim(),
        baseline_health_command: get("baseline_health_command").trim(),
        patched_acceptance_command: get("patched_acceptance_command").trim(),
        acceptance_suite: get("acceptance_suite").trim(),
        acceptance_full_suite: get("acceptance_full_suite").split(",").map((s) => s.trim()).filter(Boolean),
        notes: { issue_url: get("issue_url").trim(), summary: get("summary").trim(), payer_quote: "" },
      });
      await refresh();
    } catch (e) {
      alert(e.message);
    }
  });
  $("#btn-check")?.addEventListener("click", async () => {
    busy("Checking eligibility — running the real preflight…");
    try {
      await api("/api/check-eligibility");
      await refresh();
    } catch (e) {
      await refresh();
      alert(e.message);
    }
  });
  $("#btn-to-review")?.addEventListener("click", () => renderReadyToFreeze(STATE));
}

/* ── F1 · READY_TO_FREEZE: full terms + pre-commit moment (D5) ── */
function renderReadyToFreeze(state) {
  const s = state.eligibility.draft;
  const e = state.eligibility;
  const proven = [
    ["Base regression is red", "rule proven at prepare"],
    ["Baseline is green", "rule proven at prepare"],
    ["Network denial verified in the sandbox", "verification-sandbox commands"],
    ["Install succeeded", "clean-room dependency reconstruction"],
    ["Deterministic", `${esc(String(e.proven.determinism))} reproductions`],
  ];
  $("#main").innerHTML = `
    <div class="card frozen-card"><div class="card-title">Status</div><div class="card-value frozen">READY TO FREEZE</div></div>
    <h1 class="page-title">Review the complete terms before freezing</h1>
    <p class="page-subtitle">Everything below has been checked. If you freeze now, satisfying these rules creates an irreversible Tier-1 entitlement.</p>

    <h2 class="section-title">Proven at prepare (evidence, not the frozen checklist)</h2>
    <ul class="check-list">${proven.map(([l, sub]) => `<li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">${l}</span> <span class="sub-line">${sub}</span></span></li>`).join("")}</ul>

    <h2 class="section-title">The complete terms <span class="badge frozen-tag">to be frozen</span></h2>
    <div class="kv">
      <span class="k">Payer</span><span class="v">${esc(s.payer_identity)}</span>
      <span class="k">Assigned worker</span><span class="v">${esc(s.worker_identity)} (single claimant — frozen for this worker only)</span>
      <span class="k">Tier-1 reward</span><span class="v">${esc(s.tier1_reward)} <span class="note">(declared, experimental)</span></span>
      <span class="k">Tier-2 reward</span><span class="v">0 — not used in this experiment</span>
      <span class="k">Base commit</span><span class="v mono">${esc(s.base_commit_sha)}</span>
      <span class="k">Regression rule</span><span class="v mono">${esc(s.regression_command)}</span>
      <span class="k">Baseline rule</span><span class="v mono">${esc(s.baseline_health_command)}</span>
      <span class="k">Patched acceptance rule</span><span class="v mono">${esc(s.patched_acceptance_command)}</span>
      <span class="k">Install</span><span class="v mono">npm ci --ignore-scripts</span>
      <span class="k">Allowed paths</span><span class="v mono">${esc(s.allowed_paths.join(", "))}</span>
      <span class="k">Protected paths</span><span class="v mono">${esc(s.forbidden_paths.join(", "))}</span>
      <span class="k">Diff bound</span><span class="v">${esc(String(s.max_diff_lines))} changed lines</span>
      <span class="k">Determinism</span><span class="v">${esc(String(s.determinism_runs))} consecutive passes</span>
    </div>

    <h2 class="section-title">Earning requires BOTH</h2>
    <ul class="check-list">
      <li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">Primary verification (deterministic run of the frozen rules)</span></span></li>
      <li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">Independent portable replay (same verdict, from the proof pack alone)</span></span></li>
    </ul>

    <hr class="divider-strong" />
    <div class="card frozen-card" style="padding:24px">
      <h2 class="section-title" style="margin-top:0">Before you freeze — the full pre-commit text</h2>
      <p class="cardinal mono" style="font-size:13px">${esc(state.precommit_statement)}</p>
      <p class="cardinal">If these conditions are satisfied, the Tier-1 reward is earned. <strong>You cannot later turn that earned Tier-1 amount into discretionary review because you dislike the implementation.</strong></p>
      <p class="note">The operator records your agreement as OBSERVED consent — declared identity, not authenticated; not a verified signature.</p>
      <label class="ack-row"><input type="checkbox" id="ack" /><span>I understand that these Tier-1 rules cannot be changed after freezing.</span></label>
      <div class="actions">
        <button class="primary" id="btn-freeze" disabled>Freeze these rules</button>
        <button class="secondary" id="btn-back">← Edit configuration</button>
      </div>
    </div>`;
  $("#ack").addEventListener("change", (ev) => { $("#btn-freeze").disabled = !ev.target.checked; });
  $("#btn-back").addEventListener("click", () => renderPrepare(STATE));
  $("#btn-freeze").addEventListener("click", async () => {
    busy("Freezing — re-running the preflight from the reviewed snapshot and publishing atomically…");
    try {
      const eligibility = STATE.eligibility;
      await api("/api/freeze", { precommitAcknowledged: true, reviewId: eligibility.review_id, reviewedTerms: eligibility.draft });
      await refresh();
    } catch (err) {
      await refresh();
      alert(err.message);
    }
  });
}

/* ── FROZEN integrity error (D5/D7) ── */
function renderFrozenIntegrityError(state, why) {
  $("#main").innerHTML = `
    <h1 class="page-title">Evidence error — the frozen claim is blocked</h1>
    <p class="error-note">${esc(why)}</p>
    <p class="note">This is an evidence error, not a frozen task. Operator inspection is required; the UI will not present these terms as agreed.</p>`;
}

/* ── F2 · Frozen Task (worker) ── */
function renderFrozenTask(state) {
  const f = state.frozen;
  const n = state.notes || {};
  $("#main").innerHTML = `
    <h1 class="page-title">Fix this</h1>
    <p class="page-subtitle">The rules of this task can no longer be changed.</p>
    ${n.issue_url || n.summary ? `<p class="note"><span class="badge unfrozen">Unfrozen context</span> ${esc(n.issue_url)} — ${esc(n.summary)}</p>` : ""}
    <div class="card outcome-card" style="border-color:var(--frozen-line)">
      <div class="card-title">Tier-1 reward (declared, experimental)</div>
      <div class="card-value frozen" style="font-size:26px">${esc(f.tier1_reward)}</div>
      <div class="note">Earned when the frozen conditions below are satisfied.</div>
    </div>
    <div class="kv"><span class="k">Assigned worker</span><span class="v">${esc(f.worker_identity)}</span><span class="k">Claim mode</span><span class="v">Single claimant</span></div>
    <h2 class="section-title">You earn the reward when</h2>
    <ul class="check-list">
      <li><span class="check-mark">✓</span><span class="main-line">The bug is fixed</span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Existing tests stay green</span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Only allowed files change <span class="sub-line">${esc(f.allowed_paths.join(", "))}</span></span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Protected files stay untouched <span class="sub-line">${esc(f.forbidden_paths.join(", "))}</span></span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Dependencies stay unchanged</span></li>
      <li><span class="check-mark">✓</span><span class="main-line">The patch stays within ${esc(String(f.max_diff_lines))} changed lines</span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Deterministic verification passes ${esc(String(f.determinism_runs))}/${esc(String(f.determinism_runs))}</span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Independent replay reaches the same result</span></li>
    </ul>
    <p class="cardinal">These conditions were frozen before you started and cannot be changed for this experiment.</p>
    <p class="note">Tier 2 — not used in this experiment.</p>
    <div class="actions">
      <a class="secondary" href="/api/freeze-file/task.json">Download frozen task (task.json)</a>
      <a class="secondary" href="/api/freeze-file/ruleset.json">ruleset.json</a>
      <button class="primary" id="btn-goto-submit">Submit your work →</button>
    </div>
    ${technicalDetails([
      ["base SHA", f.base_commit_sha],
      ["ruleset hash", f.verification_ruleset_hash],
      ["contract freeze hash", f.contract_freeze_hash],
      ["precommit binding", f.precommit_binding],
      ["regression", f.commands.regression_command],
      ["baseline", f.commands.baseline_health_command],
      ["acceptance", f.commands.patched_acceptance_command],
      ["trust anchor", "docs/experiments/EXPERIMENT-001.md"],
    ])}`;
  $("#btn-goto-submit").addEventListener("click", () => renderSubmit(STATE));
}

/* ── F3 · Submit Work (P1) ── */
function renderSubmit(state) {
  const sub = state.submitted;
  $("#main").innerHTML = `
    <h1 class="page-title">Submit your work</h1>
    <p class="page-subtitle">Submit one patch for this verification run.</p>
    ${sub ? `
      <div class="card frozen-card"><div class="card-title">Submitted</div><div class="card-value frozen">worker.patch · ${esc(String(sub.bytes))} bytes · immutable for this run</div></div>
      <p class="note">This exact patch will be verified. It cannot be replaced after submission for this run.</p>
      <div class="actions"><button class="primary" id="btn-verify">Run primary verification</button></div>
    ` : `
      <div class="form-field full">
        <label for="patch-input">Choose .patch file</label>
        <input type="file" id="patch-input" accept=".patch,.diff,text/plain" />
        <span class="hint">or paste the unified diff below</span>
      </div>
      <div class="form-field full">
        <label for="patch-text">Paste unified diff</label>
        <textarea id="patch-text" style="min-height:160px" placeholder="diff --git a/src/add.ts b/src/add.ts&#10;--- a/src/add.ts&#10;+++ b/src/add.ts&#10;@@ …"></textarea>
      </div>
      <p class="note" id="patch-preview"></p>
      <div class="card" style="border-color:var(--frozen-line)">
        <p class="cardinal"><strong>This exact patch will be verified. It cannot be replaced after submission for this run.</strong></p>
        <p class="note">An invalid outcome is terminal for this submission — there is no retry and no patch replacement; a new attempt requires operator action.</p>
        <div class="actions"><button class="primary" id="btn-submit" disabled>Submit for verification</button></div>
      </div>`}
  `;
  if (sub) {
    $("#btn-verify").addEventListener("click", () => doVerify());
    return;
  }
  let bytes = null;
  const update = () => {
    const file = $("#patch-input").files[0];
    const text = $("#patch-text").value;
    if (file) bytes = file;
    else if (text.trim()) bytes = new Blob([text]);
    else bytes = null;
    $("#patch-preview").innerHTML = bytes ? `worker.patch · ${esc(String(bytes.size))} bytes` : "";
    $("#btn-submit").disabled = !bytes;
  };
  $("#patch-input").addEventListener("change", update);
  $("#patch-text").addEventListener("input", update);
  $("#btn-submit").addEventListener("click", async () => {
    const text = bytes instanceof Blob ? await bytes.text() : "";
    busy("Submitting — placing the exact bytes as the submission marker…");
    try {
      const r = await api("/api/submit", { patch: text });
      note(`Submitted: ${r.bytes} bytes. Immutable for this run.`);
      await refresh();
    } catch (e) {
      await refresh();
      alert(e.message);
    }
  });
}

async function doVerify() {
  busy("Primary verification — running the frozen UE-2 rules (clean-room base, network-denied sandbox, N determinism runs)…");
  try {
    const r = await api("/api/verify");
    await refresh();
    if (r.verdict !== "VALID") console.info("primary invalid:", r.invalid_reason);
  } catch (e) {
    await refresh();
    alert(e.message);
  }
}

async function doReplay() {
  busy("Independent replay — verifying the trusted verifier against the EXPERIMENT-001 anchor, rebuilding the frozen base, reapplying the exact patch…");
  try {
    const r = await api("/api/replay");
    await refresh();
  } catch (e) {
    await refresh();
    alert(e.message);
  }
}

/* ── F4 · Verification (D6) ── */
const INVALID_REASONS = {
  "forbidden-path": "A protected file was changed",
  "out-of-scope": "A file outside the allowed paths was changed",
  "non-canonical-path": "The patch touched a path that is not a safe repo-relative path",
  "symlink-patch": "The patch changed a symlink",
  "symlink-in-path": "The patch wrote through a symlink",
  "diff-over-bound": "The patch exceeded the frozen size bound",
  "dependency-change": "Dependencies changed",
  "post-install-suite-drift": "The frozen suite bytes changed during install",
  "patch-not-applicable": "The patch does not apply to the frozen base",
  "patched-acceptance-red": "The bug is not fixed — the frozen regression is still red",
  "baseline-broken": "Existing tests no longer pass",
  "determinism-unstable": "Verification was not deterministic",
};

function renderVerification(state) {
  const r = state.runRecord;
  const replay = state.replayReport;
  const derived = r?.derived ?? "PENDING";

  if (!r) {
    $("#main").innerHTML = `
      <h1 class="page-title">Verification</h1>
      <p class="page-subtitle">The patch is submitted and immutable for this run. Primary verification has not completed.</p>
      <div class="actions"><button class="primary" id="btn-verify2">Run primary verification</button>
      <span class="note">If a run was interrupted, nothing is fabricated: the submitted bytes are kept and the operator must inspect.</span></div>`;
    $("#btn-verify2").addEventListener("click", () => doVerify());
    return;
  }

  if (derived === "INVALID") {
    const key = String(r.invalid_reason ?? "").split(":")[0];
    $("#main").innerHTML = `
      <div class="card" style="border-color:var(--invalid)"><div class="card-title">Outcome</div><div class="card-value" style="color:var(--invalid)">TIER 1 NOT EARNED IN THIS RUN</div></div>
      <h1 class="page-title">A frozen rule was not satisfied</h1>
      <div class="kv"><span class="k">Reason</span><span class="v">${esc(INVALID_REASONS[key] ?? r.invalid_reason)}</span></div>
      <p class="note">Frozen rule that decided it: the terms shown on the task page. This verification run is complete — INVALID is terminal for this submission; there is no retry and no patch replacement. A new attempt requires operator action.</p>
      <p class="note">A payer-response step is not available on this path.</p>`;
    return;
  }

  const rows = [
    ["Frozen base", r.checks?.freeze_closure === "VERIFIED" ? "Verified" : "—"],
    ["Regression on base", r.checks?.base_regression_recheck === "RED" ? "Red" : "—"],
    ["Patch scope", r.policy_result === "OK" ? "Pass" : "—"],
    ["Dependency policy", r.checks?.dependency_policy === "OK" ? "Pass" : "—"],
    ["Regression after patch", r.checks?.patched_acceptance === "GREEN" ? "Green" : "—"],
    ["Existing suite", r.checks?.baseline_health_patched === "GREEN" ? "Green" : "—"],
    ["Determinism", r.determinism ?? "—"],
  ];

  if (derived === "VALID" && state.facts.replay === "PENDING") {
    $("#main").innerHTML = `
      <div class="card frozen-card"><div class="card-title">Stage A</div><div class="card-value frozen">PRIMARY VERIFICATION — PASS</div></div>
      <ul class="check-list">${rows.map(([l, v]) => `<li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">${esc(l)}</span><span class="sub-line">${esc(v)}</span></span></li>`).join("")}</ul>
      <p class="cardinal">Primary verification passed. <strong>Independent replay is required before Tier 1 is considered earned.</strong></p>
      <div class="actions"><button class="primary" id="btn-replay">Run independent replay</button></div>`;
    $("#btn-replay").addEventListener("click", () => doReplay());
    return;
  }

  if (derived === "VALID" && state.facts.replay === "FAIL") {
    $("#main").innerHTML = `
      <div class="card frozen-card"><div class="card-title">Stage A</div><div class="card-value frozen">PRIMARY VERIFICATION — PASS</div></div>
      <div class="card" style="border-color:var(--invalid)"><div class="card-title">Stage B</div><div class="card-value" style="color:var(--invalid)">INDEPENDENT REPLAY — FAIL / UNTRUSTED</div></div>
      <p class="error-note">${esc(state.replayUntrustedReason ?? "replay failed")}</p>
      <p class="cardinal">The primary result may stand, but the entitlement remains unverified. Operator action is required — there is no automatic retry.</p>`;
    return;
  }

  // EARNED — only on derived VALID ∧ fresh-bound replay PASS
  $("#main").innerHTML = `
    <div class="card frozen-card"><div class="card-title">Stage A</div><div class="card-value frozen">PRIMARY VERIFICATION — PASS</div></div>
    <ul class="check-list">${rows.map(([l, v]) => `<li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">${esc(l)}</span><span class="sub-line">${esc(v)}</span></span></li>`).join("")}</ul>
    <div class="card frozen-card"><div class="card-title">Stage B</div><div class="card-value frozen">INDEPENDENT REPLAY — PASS (same verdict, current pack binding)</div></div>
    <hr class="divider-strong" />
    <div style="text-align:center; padding: 24px 0 8px">
      <div class="card-title" style="text-align:center">TIER 1</div>
      <div style="font-size:44px; font-weight:700; letter-spacing:0.04em; color:var(--earned)">EARNED</div>
      <p class="cardinal" style="margin-top:14px"><strong>This reward has been earned under the rules frozen before work began.</strong></p>
      <p class="note">Primary verification and independent replay reached the same Tier-1 verdict.</p>
      <p class="note">This is a derived protocol result. It is not a maintainer approval.</p>
      <p class="note">Machine replay was facilitated by the operator on this machine — it is machine evidence of replayability, not by itself evidence of third-party participation.</p>
    </div>
    <div class="actions" style="justify-content:center">
      <a class="secondary" href="/api/proof-file/proof-manifest.json">Download proof manifest</a>
      <a class="secondary" href="/api/proof-file/verify.mjs">verify.mjs</a>
      <button class="primary" id="btn-goto-f5">Record the payer's response →</button>
    </div>
    ${technicalDetails([["contract freeze hash", state.frozen?.contract_freeze_hash], ["precommit binding", state.frozen?.precommit_binding]])}`;
  $("#btn-goto-f5").addEventListener("click", () => { window.location.hash = "#f5"; renderPayerResponse(STATE); });
}

/* ── F5 · Payer Response (D9) ── */
function renderPayerResponse(state) {
  const latest = state.latestObservation;
  const finalized = state.finalLedger;
  const machine = `
    <div class="card frozen-card"><div class="card-title">Machine result — a technical fact</div>
      <div class="card-value frozen">TIER 1 — EARNED</div>
      <div class="kv" style="margin-top:8px">
        <span class="k">Primary verification</span><span class="v">Pass (derived)</span>
        <span class="k">Independent replay</span><span class="v">Pass (same verdict, current binding)</span>
      </div>
    </div>`;

  if (finalized) {
    $("#main").innerHTML = `
      <h1 class="page-title">FINALIZED</h1>
      ${machine}
      <hr class="divider-strong" />
      <div class="kv">
        <span class="k">Technical result</span><span class="v frozen">Tier 1 earned</span>
        <span class="k">Payer response</span><span class="v">${esc(finalized.user_evidence.payer_accepts_tier1 ? "Accepted" : "Rejected")} — recorded, not a machine fact</span>
        <span class="k">Post-hoc rule change</span><span class="v">${esc(String(finalized.user_evidence.posthoc_rule_change_attempts))}</span>
        <span class="k">Repeat funding</span><span class="v">${esc(finalized.user_evidence.repeat_fund_intent)}</span>
        <span class="k">User evidence class</span><span class="v">${esc(finalized.user_evidence.attestation_class)}</span>
        <span class="k">Experiment conclusion</span><span class="v">${esc(finalized.verdict)}</span>
      </div>
      <p class="note"><strong>One experiment is not evidence of product-market fit.</strong></p>
      ${technicalDetails([["final ledger", "final-ledger.json (written once)"], ["ledger sha…", "see final-ledger.json on disk"]])}`;
    return;
  }

  $("#main").innerHTML = `
    ${machine}
    <hr class="divider-strong" />
    <h1 class="page-title">Now record the payer's response</h1>
    <p class="page-subtitle">Above the line: technical fact. Below the line: human evidence — observed, declared identity, not authenticated.</p>
    ${latest ? `
      <div class="card evidence-card"><div class="card-title">Recorded (observation ${esc(String(state.observations.latest_seq))})</div>
        <div class="kv">
          <span class="k">Q1 earned?</span><span class="v">${latest.payer_accepts_tier1 ? "Yes" : "No"}</span>
          <span class="k">Q2 rule-change attempts</span><span class="v">${esc(String(latest.posthoc_rule_change_attempts))}</span>
          <span class="k">Q3 repeat funding</span><span class="v">${esc(latest.repeat_fund_intent)}</span>
          <span class="k">Evidence class</span><span class="v">USER EVIDENCE — OBSERVED / UNSIGNED</span>
        </div>
      </div>` : `
      <form id="f5-form">
        <h2 class="section-title">Question 1</h2>
        <p class="cardinal">According to the rules you agreed to before work began, has this worker earned the Tier-1 reward?</p>
        <div class="actions" style="margin-top:8px">
          <label><input type="radio" name="q1" value="yes" /> Yes</label>
          <label><input type="radio" name="q1" value="no" /> No</label>
        </div>
        <div id="q1-yes" hidden class="form-field full" style="margin-top:12px"><label>In your own words</label><textarea id="q1-verbatim" placeholder="Yes. Under the frozen rules, this worker earned Tier 1."></textarea></div>
        <div id="q1-no" hidden class="form-field full" style="margin-top:12px"><label>Tell us why</label><textarea id="q1-why"></textarea></div>

        <h2 class="section-title">Question 2</h2>
        <p class="cardinal">After seeing the result, did you attempt to change any Tier-1 rule?</p>
        <div class="actions" style="margin-top:8px">
          <label><input type="radio" name="q2" value="no" /> No</label>
          <label><input type="radio" name="q2" value="yes" /> Yes</label>
        </div>
        <div id="q2-yes" hidden class="form-field full" style="margin-top:12px"><label>What would you change?</label><textarea id="q2-what"></textarea><span class="hint">Recorded as evidence only — it is not permission to edit the frozen contract.</span></div>

        <h2 class="section-title">Question 3</h2>
        <p class="cardinal">Would you fund another task using this structure?</p>
        <div class="actions" style="margin-top:8px">
          <label><input type="radio" name="q3" value="YES" /> Yes</label>
          <label><input type="radio" name="q3" value="NO" /> No</label>
          <label><input type="radio" name="q3" value="ANSWER_LATER" /> Answer later</label>
        </div>
        <p class="note">"Answer later" keeps the question unresolved — it is not a No, and it blocks finalizing until answered or explicitly closed by the operator.</p>

        <div class="actions">
          <button class="primary" type="submit" id="btn-record" disabled>Record response</button>
        </div>
      </form>`}

    <hr class="divider-strong" />
    <div class="card evidence-card">
      <h2 class="section-title" style="margin-top:0">Evidence classes (always separate)</h2>
      <div class="kv">
        <span class="k">Technical evidence</span><span class="v frozen">VERIFIED</span>
        <span class="k">User evidence</span><span class="v">OBSERVED / UNSIGNED</span>
      </div>
      <p class="note">Declared identities; observed input; no authenticated accounts; no machine-verified signatures.</p>
      ${latest && latest.repeat_fund_intent !== "NOT_ASKED" ? `
        <div class="actions"><button class="primary" id="btn-finalize">Finalize experiment</button><span class="note">The final experiment ledger can only be created once.</span></div>` : ""}
      ${latest && latest.repeat_fund_intent === "NOT_ASKED" ? `<p class="note">Follow-up was closed by the operator as NOT_ASKED (explicit closure, provenance recorded). You may finalize.</p><div class="actions"><button class="primary" id="btn-finalize">Finalize experiment</button></div>` : ""}
    </div>`;

  const form = $("#f5-form");
  if (form) {
    const q = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
    const update = () => {
      $("#q1-yes").hidden = q("q1") !== "yes";
      $("#q1-no").hidden = q("q1") !== "no";
      $("#q2-yes").hidden = q("q2") !== "yes";
      $("#btn-record").disabled = !(q("q1") && q("q2") && q("q3"));
    };
    form.addEventListener("change", update);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const q1 = q("q1");
      const q3 = q("q3");
      if (q3 === "ANSWER_LATER") {
        alert("The repeat-funding question is unresolved ('Answer later'). Nothing is recorded yet — answer Yes/No to record, or ask the operator to close the follow-up explicitly.");
        return;
      }
      const payload = {
        payer_accepts: q1 === "yes",
        payer_ack_verbatim: q1 === "yes" ? $("#q1-verbatim").value.trim() : "",
        no_reason: q1 === "no" ? $("#q1-why").value.trim() : "",
        rule_change_attempts: q("q2") === "yes" ? 1 : 0,
        rule_change_details: q("q2") === "yes" ? [$("#q2-what").value.trim()].filter(Boolean) : [],
        repeat_fund: q3,
        observation_source: "INTERVIEW",
        observer_identity: "operator",
      };
      try {
        await api("/api/observe", payload);
        await refresh();
      } catch (e) {
        alert(e.message);
      }
    });
  }
  $("#btn-finalize")?.addEventListener("click", async () => {
    if (!confirm("The final experiment ledger can only be created once. Finalize now?")) return;
    try {
      await api("/api/finalize", {});
      await refresh();
    } catch (e) {
      alert(e.message);
    }
  });
}

/* ── router by phase ── */
function render(state) {
  STATE = state;
  renderHeader(state);
  if (state.transient.checking) return busy("Checking eligibility — running the real preflight…");
  if (state.transient.verifying) return busy("Verifying — running the frozen verification machinery…");
  if (state.frozenError || state.freezeVerified === false) {
    return renderFrozenIntegrityError(state, state.frozenError || "the freeze generation does not re-verify (closure failed)");
  }
  if (state.frozenTermsMatch === false) {
    return renderFrozenIntegrityError(state, "published terms differ from the reviewed snapshot (D5) — operator inspection required");
  }
  if (state.phase === "DRAFT" || state.phase === "READY_TO_FREEZE") return renderPrepare(state);
  if (state.phase === "FROZEN") return renderFrozenTask(state);
  if (state.phase === "SUBMITTED") {
    // submitted → verification view (outcome panels for INVALID / replay-fail / pending)
    return renderVerification(state);
  }
  if (state.phase === "AWAITING_PAYER") {
    // the EARNED page (F4) is the landing view; the payer-response screen is an explicit step
    if (window.location.hash === "#f5") return renderPayerResponse(state);
    return renderVerification(state);
  }
  if (state.phase === "FINALIZED") return renderPayerResponse(state);
  busy("Working…");
}

async function refresh() {
  const state = await api("/api/state");
  render(state);
}

$("#footer-details-toggle").addEventListener("click", () => {
  const el = $("#footer-details");
  el.hidden = !el.hidden;
  if (!el.hidden && !el.textContent) {
    el.textContent =
      "Experiment trust anchor (docs/experiments/EXPERIMENT-001.md):\n" +
      "  MAIN                    fe18be0a5eb9536a7d2e0325352cb6ed0d7bbc90\n" +
      "  implementation audit    ca0c64673a759a713c2cf18813cb22b7fc005741\n" +
      "  VERIFIER-RELEASE sha256 25286e96bd346bd34fa093d40968f690ae357a4d9ece59f9af6c925747cb6027\n" +
      "  portable-replay sha256  292d580430dbe39c2978060340d2e4d27dd8debcfc807ba5f0a5e6157cbc8493";
  }
});

refresh().catch((e) => {
  $("#main").innerHTML = `<h1 class="page-title">Cannot reach the orchestrator</h1><p class="error-note">${esc(e.message)}</p>`;
});
