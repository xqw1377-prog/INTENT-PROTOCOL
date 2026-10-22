/* PRODUCT-UX-R2 (VALUE-FIRST) — Facilitated Experiment UI (vanilla, no deps).
   The user sees a contract product — HOME · CONTRACT · WORK · PROOF · OUTCOME —
   not an experiment runner. Internal F1–F5 names remain in comments only.
   Every displayed state comes from /api/state, which derives it from the
   experiment artifacts by calling the frozen verification boundaries.
   This script never computes verdicts, hashes, or entitlements — it renders
   them. UE-2 VALID alone NEVER renders EARNED (D6). */

const $ = (sel) => document.querySelector(sel);
let STATE = null;
let VIEW = null; // user-side view override via nav; null = phase default

async function api(path, body, method = "POST") {
  // actions are ALWAYS explicit-method requests — a missing body must never
  // silently turn an action into a GET (caught by the browser walkthrough)
  const init = method === "GET" ? undefined : { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mono = (s) => `<span class="mono">${esc(s)}</span>`;
const note = (s) => `<p class="note">${s}</p>`;

/* ── header: contract state pill + independent facts (never merged, D7) ── */
const FACT_LABELS = [
  ["rules_state", "RULES"],
  ["primary_verification", "TIER 1"],
  ["replay", "REPLAY"],
  ["payer_response", "PAYER"],
];
const FACT_CLASS = { FROZEN: "frozen", EARNED: "frozen", PASS: "frozen", VALID: "frozen", NOT_EARNED: "invalid", FAIL: "invalid", INVALID: "invalid", PENDING: "pending", DRAFT: "pending", NONE: "pending", OPEN: "pending", RECORDED: "frozen" };

function contractState(state) {
  if (state.facts.tier1_entitlement === "EARNED") return "EARNED";
  if (state.facts.rules_state === "FROZEN") return "FROZEN";
  return "UNFROZEN";
}

function renderHeader(state) {
  const cs = contractState(state);
  const pill = $("#state-pill");
  pill.textContent = cs;
  pill.className = "state-pill " + cs.toLowerCase();
  $("#facts-strip").innerHTML =
    `<span class="fact"><span class="k">PHASE</span><span class="v">${esc(state.phase.replace(/_/g, " "))}</span></span>` +
    FACT_LABELS.map(([key, label]) => {
      const v = state.facts[key];
      return `<span class="fact"><span class="k">${label}</span><span class="v ${FACT_CLASS[v] || ""}">${esc(v)}</span></span>`;
    }).join("") +
    (state.facts.ledger === "FINALIZED" ? `<span class="fact"><span class="k">LEDGER</span><span class="v frozen">FINALIZED</span></span>` : "");
}

function renderNav(state) {
  const unlocked = {
    CONTRACT: true,
    WORK: ["FROZEN", "SUBMITTED", "VERIFYING", "AWAITING_PAYER", "FINALIZED"].includes(state.phase),
    PROOF: ["SUBMITTED", "VERIFYING", "AWAITING_PAYER", "FINALIZED"].includes(state.phase),
    OUTCOME: ["AWAITING_PAYER", "FINALIZED"].includes(state.phase),
  };
  const active = VIEW || phaseDefaultView(state);
  document.querySelectorAll(".navlink").forEach((b) => {
    const v = b.dataset.view;
    b.disabled = !unlocked[v];
    b.classList.toggle("active", v === active);
    b.title = unlocked[v] ? "" : "not reached yet";
  });
  $("#brand-home").style.visibility = state.phase === "DRAFT" && !state.hasDraft ? "hidden" : "visible";
}

function phaseDefaultView(state) {
  if (state.phase === "DRAFT" || state.phase === "READY_TO_FREEZE" || state.phase === "CHECKING") return "CONTRACT";
  if (state.phase === "FROZEN") return "WORK";
  if (state.phase === "SUBMITTED" || state.phase === "VERIFYING") return "PROOF";
  if (state.phase === "AWAITING_PAYER") return window.location.hash === "#f5" ? "OUTCOME" : "PROOF";
  if (state.phase === "FINALIZED") return "OUTCOME";
  return "CONTRACT";
}

function technicalDetails(entries) {
  if (!entries.length) return "";
  return `<details class="tech"><summary>View technical details</summary><div class="body">${entries.map(([k, v]) => `${esc(k).padEnd(24, " ")} ${esc(v)}`).join("\n")}</div></details>`;
}

const busy = (msg) => {
  $("#main").innerHTML = `<h1 class="page-title">${esc(msg)}</h1><p class="note">This runs the real frozen machinery — no simulation, no optimistic results.</p>`;
};

/* ── HOME — the 10-second value screen ── */
function renderHome() {
  $("#main").innerHTML = `
    <div class="home-hero">
      <h1 class="home-title">Freeze the rules before work.<br/>Prove the outcome after work.</h1>
      <p class="home-tagline">Intent lets both sides agree on what “done” means before work begins — then independently proves whether the outcome met those rules.</p>
      <p class="home-promise">No moving the goalposts.</p>
    </div>

    <div class="arc-strip">
      <div class="arc-step"><span class="arc-k">BEFORE WORK</span><span class="arc-v">What counts as done?</span></div>
      <div class="arc-step"><span class="arc-k">FROZEN CONTRACT</span><span class="arc-v">The goalposts can no longer move.</span></div>
      <div class="arc-step"><span class="arc-k">WORK HAPPENS</span><span class="arc-v">&nbsp;</span></div>
      <div class="arc-step"><span class="arc-k">PROOF</span><span class="arc-v">Did the outcome satisfy the frozen contract?</span></div>
      <div class="arc-step earned"><span class="arc-k">EARNED</span><span class="arc-v">No longer anyone's opinion.</span></div>
    </div>

    <div class="twosided">
      <div class="side">
        <div class="side-role">FOR THE MAINTAINER</div>
        <p class="side-line">"Protect me from fake completion."</p>
        <p class="note">Don't pay for work that only looks done.</p>
      </div>
      <div class="side middle">
        <div class="side-role">INTENT</div>
        <p class="side-line">Freeze the standard.<br/>Prove the outcome.</p>
      </div>
      <div class="side">
        <div class="side-role">FOR THE WORKER</div>
        <p class="side-line">"Protect me from moving goalposts."</p>
        <p class="note">Don't finish first and hear new standards later.</p>
      </div>
    </div>

    <div class="actions home-cta">
      <button class="primary" id="btn-define">Define an outcome →</button>
      <span class="note">Rules are frozen only when both sides have seen and agreed to the complete terms.</span>
    </div>`;
  $("#btn-define").addEventListener("click", () => { VIEW = "CONTRACT"; render(STATE); });
}

/* ── CONTRACT · draft (F1 prepare, D4/D5) — conditions still open ── */
function renderContractDraft(state) {
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
        ? `<div class="card frozen-card"><div class="card-title">Readiness</div><div class="card-value frozen">READY TO FREEZE</div><div class="note">The machine re-checked everything and the reviewed inputs still match.</div></div>`
        : `<div class="card"><div class="card-title">Readiness</div><div class="error-note">REVIEWED INPUTS CHANGED — re-check before freezing (${esc(readiness.reason)})</div></div>`
      : `<div class="card" style="border-color:var(--invalid)"><div class="card-title">Readiness</div><div class="error-note">NOT ELIGIBLE — ${esc(eligibility.reason)}</div></div>`
    : `<p class="note">Nothing is assumed green until the real check runs.</p>`;

  $("#main").innerHTML = `
    <div class="state-banner unfrozen-banner">DRAFT CONDITIONS — still open to discussion</div>
    <h1 class="page-title">Define an outcome</h1>
    <p class="page-subtitle">Say what counts as done before anyone starts working. Nothing here is frozen yet.</p>
    <p class="note">${esc(state.operating_mode || "")}</p>
    <form id="prepare-form">
      <h2 class="section-title">Who</h2>
      <div class="form-grid">
        ${field("payer_identity", "Rule author / acceptor (maintainer)", d.payer_identity, { ph: "must be selected before preparation" })}
        ${field("worker_identity", "Assigned worker", d.worker_identity, { ph: "must be selected before preparation" })}
      </div>
      <p class="note">Claim mode: <strong>Single claimant</strong> — this contract is frozen for this worker only.</p>

      <h2 class="section-title">The work</h2>
      <div class="form-grid">
        ${field("repoPath", "Repository (local path for the experiment)", d.repoPath, { full: true })}
        ${field("base_commit_sha", "Base commit (exact)", d.base_commit_sha)}
        ${field("tier1_reward", "Reward for the frozen part (declared, experimental)", d.tier1_reward || "")}
        ${field("tier2_reward", "Discretionary part", "0", { disabled: true, hint: "Zero for EXPERIMENT-001 — the Tier-2 engine is not used in this experiment." })}
        <div class="form-field full">
          <label for="f-issue_url">Issue <span class="badge unfrozen">Context — not part of the frozen contract</span></label>
          <input id="f-issue_url" data-field="issue_url" value="${esc(n.issue_url || "")}" />
        </div>
        <div class="form-field full">
          <label for="f-summary">What is the work, in one line <span class="badge unfrozen">Context — not part of the frozen contract</span></label>
          <textarea id="f-summary" data-field="summary">${esc(n.summary || "")}</textarea>
        </div>
      </div>

      <h2 class="section-title">What counts as done (rules — decided now, judged later by machine)</h2>
      <div class="form-grid">
        ${field("regression_command", "The promised bug must be fixed (rule: red on base)", d.regression_command, { full: true })}
        ${field("baseline_health_command", "Everything else must stay healthy (rule: green on base)", d.baseline_health_command, { full: true })}
        ${field("patched_acceptance_command", "After the work (rule)", d.patched_acceptance_command, { full: true })}
        ${field("acceptance_suite", "Acceptance suite file (explicit — never guessed)", d.acceptance_suite ?? "", { full: true, ph: "test/regression.test.ts" })}
        ${field("acceptance_full_suite", "Full-suite files (comma-separated, explicit)", (d.acceptance_full_suite ?? []).join(", "), { full: true, ph: "test/green.test.ts" })}
        ${field("allowed_paths", "Files the work may touch", (d.allowed_paths || []).join(", "), { ph: "src/**" })}
        ${field("forbidden_paths", "Files the work must not touch", (d.forbidden_paths || []).join(", "), { ph: "test/**, package-lock.json, .github/**" })}
        ${field("max_diff_lines", "Size bound (changed lines)", d.max_diff_lines ?? 40)}
        ${field("determinism_runs", "Determinism (N runs)", d.determinism_runs ?? 3)}
        <div class="form-field full"><label>Install</label><input value="npm ci --ignore-scripts" disabled /></div>
        <div class="form-field full"><label>Network during verification</label><input value="Denied (verification sandbox)" disabled /><span class="hint">Describes the verification-sandbox commands — not a claim that dependency install never used the network.</span></div>
      </div>
      <div class="actions">
        <button class="primary" type="submit">Save conditions</button>
        <span class="note">Still unfrozen. Any change invalidates readiness and requires re-checking.</span>
      </div>
    </form>
    <hr class="divider-strong" />
    <h2 class="section-title">Check it for real</h2>
    ${eligCard}
    <div class="actions">
      <button class="secondary" id="btn-check" ${state.hasDraft ? "" : "disabled"}>Check eligibility</button>
      ${readiness.ready ? `<button class="primary" id="btn-to-review">Review before freezing →</button>` : ""}
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
  $("#btn-to-review")?.addEventListener("click", () => renderContractReview(STATE));
}

/* ── CONTRACT · review + freeze moment (F1, D5) ── */
function renderContractReview(state) {
  const s = state.eligibility.draft;
  const e = state.eligibility;
  const proven = [
    ["The promised bug is real", "its frozen test fails on the base, proven at prepare"],
    ["Everything else is healthy", "the rest of the suite is green on the base"],
    ["No network during verification", "denial verified in the sandbox"],
    ["Dependencies reconstruct cleanly", "clean-room install"],
    ["The result is deterministic", `${esc(String(e.proven.determinism))} reproductions`],
  ];
  $("#main").innerHTML = `
    <div class="state-banner frozen-banner">CHECKED AND CURRENT — everything below has been verified by the machine. The next action freezes it.</div>
    <h1 class="page-title">Review the complete terms before freezing</h1>
    <p class="page-subtitle">Freezing is the moment the goalposts lock. After this, satisfying these rules creates an irreversible entitlement to the frozen reward.</p>

    <h2 class="section-title">Proven at prepare (evidence, not the frozen checklist)</h2>
    <ul class="check-list">${proven.map(([l, sub]) => `<li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">${l}</span> <span class="sub-line">${sub}</span></span></li>`).join("")}</ul>

    <h2 class="section-title">WHAT COUNTS AS DONE <span class="badge frozen-tag">to be frozen</span></h2>
    <div class="kv">
      <span class="k">Rule author / acceptor</span><span class="v">${esc(s.payer_identity)}</span>
      <span class="k">Assigned worker</span><span class="v">${esc(s.worker_identity)} (single claimant — frozen for this worker only)</span>
      <span class="k">Reward for the frozen part</span><span class="v">${esc(s.tier1_reward)} <span class="note">(declared, experimental)</span></span>
      <span class="k">Discretionary part</span><span class="v">0 — not used in this experiment</span>
      <span class="k">The promised bug must be fixed</span><span class="v mono">${esc(s.regression_command)}</span>
      <span class="k">Everything else must stay healthy</span><span class="v mono">${esc(s.baseline_health_command)}</span>
      <span class="k">Files the work may touch</span><span class="v mono">${esc(s.allowed_paths.join(", "))}</span>
      <span class="k">Files that must not change</span><span class="v mono">${esc(s.forbidden_paths.join(", "))}</span>
      <span class="k">Size bound</span><span class="v">${esc(String(s.max_diff_lines))} changed lines</span>
      <span class="k">Determinism</span><span class="v">${esc(String(s.determinism_runs))} consecutive passes</span>
      <span class="k">Install</span><span class="v mono">npm ci --ignore-scripts</span>
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
      <p class="cardinal">If these conditions are satisfied, the frozen reward is earned. <strong>You cannot later turn that earned amount into discretionary review because you dislike the implementation.</strong></p>
      <p class="note">The operator records your agreement as OBSERVED consent — declared identity, not authenticated; not a verified signature.</p>
      <label class="ack-row"><input type="checkbox" id="ack" /><span>I understand that these rules cannot be changed after freezing.</span></label>
      <div class="actions">
        <button class="primary" id="btn-freeze" disabled>Freeze this outcome</button>
        <button class="secondary" id="btn-back">← Edit conditions</button>
      </div>
    </div>`;
  $("#ack").addEventListener("change", (ev) => { $("#btn-freeze").disabled = !ev.target.checked; });
  $("#btn-back").addEventListener("click", () => renderContractDraft(STATE));
  $("#btn-freeze").addEventListener("click", async () => {
    busy("Freezing — re-running the preflight from the reviewed snapshot and locking the contract…");
    try {
      const eligibility = STATE.eligibility;
      await api("/api/freeze", { precommitAcknowledged: true, reviewId: eligibility.review_id, reviewedTerms: eligibility.draft });
      VIEW = "CONTRACT";
      await refresh();
    } catch (err) {
      await refresh();
      alert(err.message);
    }
  });
}

/* ── CONTRACT · frozen — the living contract card ── */
function renderContractFrozen(state) {
  const f = state.frozen;
  const n = state.notes || {};
  $("#main").innerHTML = `
    <div class="state-banner frozen-banner">FROZEN OUTCOME CONTRACT — rules locked before work began. The goalposts can no longer move.</div>
    <div class="contract-card">
      <div class="contract-title">${esc(n.summary || "The work")}</div>
      <div class="contract-kv">
        <span class="k">Reward</span><span class="v">${esc(f.tier1_reward)}</span>
        <span class="k">Worker</span><span class="v">${esc(f.worker_identity)}</span>
        <span class="k">Frozen at</span><span class="v">${esc(f.frozen_at ?? "—")}</span>
        <span class="k">Claim mode</span><span class="v">Single claimant</span>
      </div>
      <div class="contract-section">WHAT COUNTS AS DONE</div>
      <ul class="check-list">
        <li><span class="check-mark">✓</span><span class="main-line">The promised bug is fixed <span class="sub-line">frozen test goes red → green</span></span></li>
        <li><span class="check-mark">✓</span><span class="main-line">Existing behavior stays healthy <span class="sub-line">rest of the suite stays green</span></span></li>
        <li><span class="check-mark">✓</span><span class="main-line">Only approved files change <span class="sub-line">${esc(f.allowed_paths.join(", "))}</span></span></li>
        <li><span class="check-mark">✓</span><span class="main-line">Protected files stay untouched <span class="sub-line">${esc(f.forbidden_paths.join(", "))}</span></span></li>
        <li><span class="check-mark">✓</span><span class="main-line">No dependency changes</span></li>
        <li><span class="check-mark">✓</span><span class="main-line">Patch within ${esc(String(f.max_diff_lines))} changed lines</span></li>
        <li><span class="check-mark">✓</span><span class="main-line">Deterministic ${esc(String(f.determinism_runs))}/${esc(String(f.determinism_runs))} verification runs</span></li>
        <li><span class="check-mark">✓</span><span class="main-line">Independent replay reaches the same verdict</span></li>
      </ul>
      <div class="contract-section">OUTCOME — when the work is done</div>
      <p class="cardinal">If every line above holds, <strong>this part is earned</strong> — and that conclusion is independently replayable by anyone.</p>
      <p class="note">Discretionary part — not used in this experiment.</p>
      <div class="actions">
        <a class="secondary" href="/api/freeze-file/task.json">Download frozen task (task.json)</a>
        <a class="secondary" href="/api/freeze-file/ruleset.json">ruleset.json</a>
        <button class="primary" id="btn-goto-work">Go to WORK →</button>
      </div>
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
  $("#btn-goto-work").addEventListener("click", () => { VIEW = "WORK"; render(STATE); });
}

/* ── FROZEN integrity error (D5/D7) ── */
function renderFrozenIntegrityError(state, why) {
  $("#main").innerHTML = `
    <h1 class="page-title">Evidence error — the frozen claim is blocked</h1>
    <p class="error-note">${esc(why)}</p>
    <p class="note">This is an evidence error, not a frozen contract. Operator inspection is required; the UI will not present these terms as agreed.</p>`;
}

/* ── WORK (F2 + F3) — the deal from the worker side ── */
function renderWork(state) {
  const sub = state.submitted;
  if (sub) {
    $("#main").innerHTML = `
      <div class="state-banner frozen-banner">WORK SUBMITTED — the exact bytes are locked for this run</div>
      <h1 class="page-title">Your work is in</h1>
      <div class="card frozen-card"><div class="card-title">Submission</div><div class="card-value frozen">worker.patch · ${esc(String(sub.bytes))} bytes · immutable for this run</div></div>
      <p class="note">It cannot be replaced after submission for this run. Verification judges exactly these bytes against exactly the frozen rules.</p>
      <div class="actions"><button class="primary" id="btn-goto-proof">Go to PROOF →</button></div>`;
    $("#btn-goto-proof").addEventListener("click", () => { VIEW = "PROOF"; render(STATE); });
    return;
  }
  const f = state.frozen;
  const n = state.notes || {};
  $("#main").innerHTML = `
    <div class="state-banner frozen-banner">THE RULES ARE LOCKED — they cannot change for this work</div>
    <h1 class="page-title">Work against the frozen contract</h1>
    <p class="page-subtitle">${esc(n.summary || "")} ${n.issue_url ? `<span class="badge unfrozen">Context — not part of the frozen contract</span> ${esc(n.issue_url)}` : ""}</p>
    <div class="card outcome-card" style="border-color:var(--frozen-line)">
      <div class="card-title">You earn</div>
      <div class="card-value frozen" style="font-size:26px">${esc(f.tier1_reward)}</div>
      <div class="note">When every frozen condition below holds. Decided by machine, not by mood.</div>
    </div>
    <h2 class="section-title">You earn it when</h2>
    <ul class="check-list">
      <li><span class="check-mark">✓</span><span class="main-line">The promised bug is fixed <span class="sub-line">frozen test: red → green</span></span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Existing tests stay green</span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Only allowed files change <span class="sub-line">${esc(f.allowed_paths.join(", "))}</span></span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Protected files stay untouched <span class="sub-line">${esc(f.forbidden_paths.join(", "))}</span></span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Dependencies stay unchanged</span></li>
      <li><span class="check-mark">✓</span><span class="main-line">The patch stays within ${esc(String(f.max_diff_lines))} changed lines</span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Deterministic verification passes ${esc(String(f.determinism_runs))}/${esc(String(f.determinism_runs))}</span></li>
      <li><span class="check-mark">✓</span><span class="main-line">Independent replay reaches the same result</span></li>
    </ul>
    <p class="cardinal">These conditions were frozen before you started and cannot be changed for this work.</p>
    <p class="note">Discretionary part — not used in this experiment.</p>
    <hr class="divider-strong" />
    <h2 class="section-title">Submit your work</h2>
    <p class="page-subtitle">One patch for this run.</p>
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
      <div class="actions"><button class="primary" id="btn-submit" disabled>Submit for proof</button></div>
    </div>`;

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
      VIEW = "PROOF";
      await refresh();
    } catch (e) {
      await refresh();
      alert(e.message);
    }
  });
}

async function doVerify() {
  busy("Proving the outcome — Stage A: running the frozen rules (clean-room base, network-denied sandbox, N determinism runs)…");
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
  busy("Proving the outcome — Stage B: independent replay from the anchored verifier, rebuilding the frozen base, reapplying the exact patch…");
  try {
    const r = await api("/api/replay");
    await refresh();
  } catch (e) {
    await refresh();
    alert(e.message);
  }
}

/* ── PROOF (F4, D6) — "Prove the outcome" ── */
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
  "patched-acceptance-red": "The promised bug is not fixed — the frozen regression is still red",
  "baseline-broken": "Existing tests no longer pass",
  "determinism-unstable": "Verification was not deterministic",
};

function renderVerification(state) { // F4 · PROOF view (internal name kept for the frozen routing contract)
  const r = state.runRecord;
  const derived = r?.derived ?? "PENDING";

  if (!r) {
    $("#main").innerHTML = `
      <h1 class="page-title">Prove the outcome</h1>
      <p class="page-subtitle">The patch is submitted and immutable for this run. Stage A has not run yet.</p>
      <div class="actions"><button class="primary" id="btn-verify2">Run Stage A — primary verification</button>
      <span class="note">If a run was interrupted, nothing is fabricated: the submitted bytes are kept and the operator must inspect.</span></div>`;
    $("#btn-verify2").addEventListener("click", () => doVerify());
    return;
  }

  if (derived === "INVALID") {
    const key = String(r.invalid_reason ?? "").split(":")[0];
    $("#main").innerHTML = `
      <div class="card" style="border-color:var(--invalid)"><div class="card-title">Outcome</div><div class="card-value" style="color:var(--invalid)">NOT EARNED IN THIS RUN</div></div>
      <h1 class="page-title">A frozen rule was not satisfied</h1>
      <div class="kv"><span class="k">Why</span><span class="v">${esc(INVALID_REASONS[key] ?? r.invalid_reason)}</span></div>
      <p class="note">The frozen rules decided — the terms on the contract page. INVALID is terminal for this submission; there is no retry and no patch replacement. A new attempt requires operator action.</p>
      <p class="note">A payer-response step is not available on this path.</p>`;
    return;
  }

  const humanRows = [
    ["The frozen base is genuine", r.checks?.freeze_closure === "VERIFIED" ? "verified" : "—"],
    ["The promised bug really failed on the base", r.checks?.base_regression_recheck === "RED" ? "confirmed" : "—"],
    ["The patch stayed inside the frozen scope", r.policy_result === "OK" ? "yes" : "—"],
    ["No dependency changes", r.checks?.dependency_policy === "OK" ? "yes" : "—"],
    ["The promised bug is fixed", r.checks?.patched_acceptance === "GREEN" ? "yes — frozen test green" : "—"],
    ["Everything else still healthy", r.checks?.baseline_health_patched === "GREEN" ? "yes — suite green" : "—"],
    ["Same answer every time", r.determinism ?? "—"],
  ];

  if (derived === "VALID" && state.facts.replay === "PENDING") {
    $("#main").innerHTML = `
      <h1 class="page-title">Prove the outcome</h1>
      <div class="card frozen-card"><div class="card-title">Stage A</div><div class="card-value frozen">PRIMARY VERIFICATION — PASS</div></div>
      <ul class="check-list">${humanRows.map(([l, v]) => `<li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">${esc(l)}</span><span class="sub-line">${esc(v)}</span></span></li>`).join("")}</ul>
      <p class="cardinal">Stage A passed. <strong>Stage B — independent replay — is required before anything is earned.</strong></p>
      <div class="replay-steps">
        <div class="replay-step"><span class="rs-n">1</span>Rebuild the frozen base</div>
        <div class="replay-step"><span class="rs-n">2</span>Apply the exact submitted patch</div>
        <div class="replay-step"><span class="rs-n">3</span>Run the exact frozen rules</div>
        <div class="replay-step"><span class="rs-n">4</span>Compare the verdict — it must match</div>
      </div>
      <div class="actions"><button class="primary" id="btn-replay">Run Stage B — independent replay</button></div>`;
    $("#btn-replay").addEventListener("click", () => doReplay());
    return;
  }

  if (derived === "VALID" && state.facts.replay === "FAIL") {
    $("#main").innerHTML = `
      <h1 class="page-title">Prove the outcome</h1>
      <div class="card frozen-card"><div class="card-title">Stage A</div><div class="card-value frozen">PRIMARY VERIFICATION — PASS</div></div>
      <div class="card" style="border-color:var(--invalid)"><div class="card-title">Stage B</div><div class="card-value" style="color:var(--invalid)">INDEPENDENT REPLAY — FAIL / UNTRUSTED</div></div>
      <p class="error-note">${esc(state.replayUntrustedReason ?? "replay failed")}</p>
      <p class="cardinal">The Stage A result may stand, but nothing is earned until the replay independently agrees. Operator action required — no automatic retry.</p>`;
    return;
  }

  // EARNED — only on derived VALID ∧ fresh-bound replay PASS (D6)
  $("#main").innerHTML = `
    <div class="card frozen-card"><div class="card-title">Stage A</div><div class="card-value frozen">PRIMARY VERIFICATION — PASS</div></div>
    <ul class="check-list">${humanRows.map(([l, v]) => `<li><span class="check-mark">✓</span><span class="check-body"><span class="main-line">${esc(l)}</span><span class="sub-line">${esc(v)}</span></span></li>`).join("")}</ul>
    <div class="card frozen-card"><div class="card-title">Stage B</div><div class="card-value frozen">INDEPENDENT REPLAY — PASS (same verdict, current pack binding)</div></div>
    <hr class="divider-strong" />
    <div class="earned-moment">
      <div class="earned-word">EARNED</div>
      <p class="earned-line">The outcome satisfied the rules frozen before work began.</p>
      <p class="earned-line">This conclusion is independently replayable — by anyone, offline, from the proof pack alone.</p>
      <p class="earned-boundary">Earned is a protocol fact. Paid is a separate event.</p>
      <div class="twosided earned-sides">
        <div class="side"><div class="side-role">FOR THE WORKER</div><p class="side-line">The standard cannot be changed after delivery.</p></div>
        <div class="side"><div class="side-role">FOR THE MAINTAINER</div><p class="side-line">The outcome had to satisfy every frozen condition.</p></div>
      </div>
      <div class="triad">
        <div class="triad-cell"><span class="triad-k">PROTOCOL FACT</span><span class="triad-v frozen">Earned</span></div>
        <div class="triad-cell"><span class="triad-k">PAYMENT</span><span class="triad-v">Not part of this experiment</span></div>
        <div class="triad-cell"><span class="triad-k">ACCEPTOR'S OPINION</span><span class="triad-v">Asked separately, recorded separately</span></div>
      </div>
      <p class="note">This is a derived protocol result. It is not a maintainer approval.</p>
      <p class="note">Machine replay was facilitated by the operator on this machine — it is machine evidence of replayability, not by itself evidence of third-party participation.</p>
    </div>
    <div class="actions" style="justify-content:center">
      <a class="secondary" href="/api/proof-file/proof-manifest.json">View proof → manifest</a>
      <a class="secondary" href="/api/proof-file/verify.mjs">verify.mjs</a>
      <button class="primary" id="btn-goto-f5">Go to OUTCOME — record the response →</button>
    </div>
    ${technicalDetails([["contract freeze hash", state.frozen?.contract_freeze_hash], ["precommit binding", state.frozen?.precommit_binding]])}`;
  $("#btn-goto-f5").addEventListener("click", () => { window.location.hash = "#f5"; VIEW = "OUTCOME"; renderPayerResponse(STATE); });
}

/* ── OUTCOME (F5, D9) — the human answer, kept strictly separate ── */
function renderPayerResponse(state) {
  const latest = state.latestObservation;
  // Review round-3: FINALIZED is consumed ONLY from the verified ledger view
  // (facts.ledger === FINALIZED); a tampered/stale ledger on disk is never
  // rendered as finalized, and the machine-result block renders CURRENT
  // verified facts — no hardcoded EARNED / PASS wording.
  const finalized = state.facts.ledger === "FINALIZED" && state.finalLedger ? state.finalLedger : null;
  const f = state.facts;
  const earnedNow = f.tier1_entitlement === "EARNED";
  const machine = `
    <div class="card frozen-card"><div class="card-title">What the proof established — a technical fact</div>
      <div class="card-value frozen">THE FROZEN PART — ${earnedNow ? "EARNED" : f.tier1_entitlement}</div>
      <div class="kv" style="margin-top:8px">
        <span class="k">Primary verification</span><span class="v">${f.primary_verification === "VALID" ? "Pass (derived)" : f.primary_verification}</span>
        <span class="k">Independent replay</span><span class="v">${f.replay === "PASS" ? "Pass (same verdict, current binding)" : f.replay}</span>
      </div>
    </div>`;

  if (state.finalLedgerUnverified) {
    $("#main").innerHTML = `
      ${machine}
      <hr class="divider-strong" />
      <h1 class="page-title">Ledger integrity error</h1>
      <p class="error-note">A final ledger exists on disk but does NOT verify against the current evidence. It is not shown as finalized.</p>
      <ul class="check-list">${(state.evidenceErrors || []).map((e) => `<li><span class="check-mark">!</span><span class="main-line mono">${esc(e)}</span></li>`).join("")}</ul>
      <p class="note">Operator inspection required. The machine result above reflects the currently verified facts only.</p>`;
    return;
  }

  if (finalized) {
    $("#main").innerHTML = `
      <h1 class="page-title">OUTCOME — the record, closed</h1>
      ${machine}
      <hr class="divider-strong" />
      <div class="kv">
        <span class="k">What was promised</span><span class="v">${esc(finalized.task?.summary ?? "The frozen conditions on the contract page")}</span>
        <span class="k">What was frozen</span><span class="v frozen">the complete terms — locked before work began</span>
        <span class="k">What the proof established</span><span class="v frozen">Tier 1 earned</span>
        <span class="k">What is now irreversible</span><span class="v frozen">the earned conclusion — independently replayable</span>
        <span class="k">Acceptor's answer</span><span class="v">${esc(finalized.user_evidence.payer_accepts_tier1 ? "Accepted" : "Rejected")} — recorded, not a machine fact</span>
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
    <div class="human-divider"><span>HUMAN RESPONSE</span></div>
    <h1 class="page-title">Now record the response</h1>
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

        <div id="closure-panel" hidden style="margin-top:14px">
          <div class="card evidence-card">
            <h2 class="section-title" style="margin-top:0">Operator closure of the unresolved follow-up (D9)</h2>
            <p class="note">The acceptor chose Answer later. The operator may close the follow-up explicitly: the hesitation is recorded verbatim, Q3 stays NOT_ASKED (never a No, never "never asked"), provenance is preserved.</p>
            <div class="form-field full"><label>Hesitation verbatim</label><textarea id="closure-hesitation" placeholder="Payer: ask me again next week."></textarea></div>
            <div class="form-field full" style="margin-top:10px"><label>Why the experiment closes without an answer</label><textarea id="closure-reason" placeholder="Session ended before the payer decided on repeat funding."></textarea></div>
            <div class="actions"><button class="primary" type="button" id="btn-close-followup">Close follow-up (operator)</button></div>
          </div>
        </div>

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

  const q = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
  const form = $("#f5-form");
  if (form) {
    const update = () => {
      $("#q1-yes").hidden = q("q1") !== "yes";
      $("#q1-no").hidden = q("q1") !== "no";
      $("#q2-yes").hidden = q("q2") !== "yes";
      const later = q("q3") === "ANSWER_LATER";
      $("#closure-panel").hidden = !later;
      const btn = $("#btn-record");
      btn.disabled = !(q("q1") && q("q2") && q("q3")) || later;
      btn.textContent = later ? "Answer later — use the operator closure below" : "Record response";
    };
    form.addEventListener("change", update);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const q1 = q("q1");
      const q3 = q("q3");
      if (q3 === "ANSWER_LATER") {
        // P0-4: nothing is recorded on Answer later; the explicit operator closure below writes the FIRST observation
        $("#closure-panel").hidden = false;
        $("#closure-hesitation").focus();
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
  $("#btn-close-followup")?.addEventListener("click", async () => {
    const q1 = q("q1");
    const hesitation = $("#closure-hesitation").value.trim();
    const reason = $("#closure-reason").value.trim();
    if (!hesitation || !reason) {
      alert("Closure requires BOTH the hesitation verbatim and the reason the experiment closes without an answer.");
      return;
    }
    if (!q1 || !q("q2")) {
      alert("Answer Q1 and Q2 first — the closure record carries the complete payer response.");
      return;
    }
    try {
      await api("/api/close-followup", {
        payer_accepts: q1 === "yes",
        payer_ack_verbatim: q1 === "yes" ? $("#q1-verbatim").value.trim() : "",
        no_reason: q1 === "no" ? $("#q1-why").value.trim() : "",
        rule_change_attempts: q("q2") === "yes" ? 1 : 0,
        rule_change_details: q("q2") === "yes" ? [$("#q2-what").value.trim()].filter(Boolean) : [],
        hesitation_verbatim: hesitation,
        close_reason: reason,
        observation_source: "INTERVIEW",
        observer_identity: "operator",
      });
      await refresh();
    } catch (e) {
      alert(e.message);
    }
  });
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

/* ── router: user-side views over the frozen phase machine ── */
function render(state) {
  STATE = state;
  renderHeader(state);
  renderNav(state);
  if (state.transient.checking) return busy("Checking eligibility — running the real preflight…");
  if (state.transient.verifying) return busy("Verifying — running the frozen verification machinery…");
  if (state.frozenError || state.freezeVerified === false) {
    return renderFrozenIntegrityError(state, state.frozenError || "the freeze generation does not re-verify (closure failed)");
  }
  if (state.frozenTermsMatch === false) {
    return renderFrozenIntegrityError(state, "published terms differ from the reviewed snapshot (D5) — operator inspection required");
  }
  // HOME: only before any draft exists
  if (state.phase === "DRAFT" && !state.hasDraft && !VIEW) return renderHome();

  const view = VIEW || phaseDefaultView(state);
  if (view === "CONTRACT") {
    if (state.phase === "DRAFT" || state.phase === "READY_TO_FREEZE" || state.phase === "CHECKING") {
      return state.phase === "READY_TO_FREEZE" && VIEW === null ? renderContractReview(state) : renderContractDraft(state);
    }
    return renderContractFrozen(state);
  }
  if (view === "WORK") return renderWork(state);
  if (view === "PROOF") return renderVerification(state);
  if (view === "OUTCOME") return renderPayerResponse(state);

  if (state.phase === "DRAFT" || state.phase === "READY_TO_FREEZE") return renderContractDraft(state);
  if (state.phase === "FROZEN") return renderWork(state);
  if (state.phase === "SUBMITTED") {
    // submitted → the PROOF view is the landing view (outcome panels for INVALID / replay-fail / pending)
    return renderVerification(state);
  }
  if (state.phase === "AWAITING_PAYER") {
    // F4 EARNED (renderVerification) is the landing view of AWAITING_PAYER;
    // the payer screen (F5) is an explicit step: #f5
    if (window.location.hash === "#f5") return renderPayerResponse(state);
    return renderVerification(state);
  }
  if (state.phase === "FINALIZED") return renderPayerResponse(state);
  busy("Working…");
}

async function refresh() {
  const state = await api("/api/state", undefined, "GET");
  VIEW = null;
  render(state);
}

document.querySelectorAll(".navlink").forEach((b) => {
  b.addEventListener("click", () => {
    if (b.disabled) return;
    VIEW = b.dataset.view;
    if (VIEW !== "OUTCOME") window.location.hash = "";
    render(STATE);
  });
});
$("#brand-home").addEventListener("click", () => { VIEW = null; render(STATE); });

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
