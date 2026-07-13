<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** AUDIT FINDINGS (privacy & security pass per `PRIVACY-SECURITY-AUDIT-PROMPT.md`) · **Created:** 2026-07-13 · **Auditor:** AI agent · **Method:** re-run the charter's invariant + demonstrated-violation method against the *current* (post-remediation) tree — origin-classified static grep of all 8 bundles + orchestrators, storage-key inventory vs `dex-forget.js`, untrusted→DOM sink trace, console/incidental-leak sweep · **Prior pass:** `PRIVACY-SECURITY-AUDIT-FINDINGS-2026-07-01.md` (F1–F7, all remediated) · **Siblings:** `AUDIT-PROMPT.md` (correctness) · `EFFICIENCY-AUDIT-PROMPT.md` (efficiency) · **Posture doc:** `PHI-SURFACE-STATEMENT.md`

# Privacy & security findings — Tepna Dex suite (2026-07-13)

Second run of the `PRIVACY-SECURITY-AUDIT-PROMPT.md` MISSION, 12 days after the first. Framing is
**portable data-protection principles** (minimization · storage-limitation · local-control · transparency ·
security-of-processing), **not** any national regime — and nothing here contradicts the intended-use /
not-a-medical-device disclaimer (LICENSING-BRIEF §6.5) or claims a compliance certification. **This is a
REPORT.** Each accepted finding spawns its own dated gated change-brief; nothing was fixed in this pass.
Every finding carries a **demonstration** (exact file:line / key / traced field); hypotheses are labelled.

**Headline: the 2026-07-01 pass has held.** All of F1–F7 are remediated and gate-backed — the live stored
XSS is gone (F1 closed by *removal* of the reload-last feature, F2/F3 by the shared `dex-escape.js` escaper),
the raw-CSV cache is dropped (F4), a suite-wide `dex-forget.js` "erase all data on this device" exists and is
inventory-gated (F4/F5/F6), CSP ships on all 10 owned bundles with a strict hash-based `script-src` as an
injection backstop (F7 + `SECURITY-CSP-STRICT-SCRIPT-SRC`), and the flagship **`no-network` gate is now wired
into CI** (`tests/browser-gates.mjs` Gate 3). The architecture's central privacy asset — nothing leaves the
machine — is now an *enforced* property, not a convention.

**What this pass found is the residue at the edges of that remediation, not a hole in it.** Three demonstrated
findings, all **LOW / LOW–MED defense-in-depth or hygiene** — no new live injection, no egress, no PII in an
export. Two are *consistency* gaps: a surface class the remediation protected in one dimension but not
another; one is leftover debug logging of raw data. Ordered by severity × certainty.

---

## 0 · The NO-NETWORK invariant (flagship) — STILL HOLDS

**Re-verified.** A fresh origin-classified static grep of all source (`*.js` / `*.src.html`) finds **zero**
transport primitives (`XMLHttpRequest` / `WebSocket` / `EventSource` / `navigator.sendBeacon` / `new Image()`
beacon) outside the audit docs + gate harness, and **zero** remote `src`/`href`/`@font-face`/CSS `url()`. Every
`fetch(` in a bundle remains a same-origin/relative load of a bundled asset or a local `uploads/*` demo file.
The `no-network.html` gate is green and now rides CI (`tests/browser-gates.mjs:122` Gate 3, verdict via
`window.__noNetworkOK`), covering the 8 bundles + the 2 orchestrators. **See N1 for the one scope caveat: the
gate's `PAGES` list stops at those 10 — the standalone analysis pages are neither CSP- nor no-network-covered.**

---

## Demonstrated findings — ordered by severity × certainty

Reporting shape per finding: *invariant · severity · demonstration · principle · proposed one gated change ·
gate impact.*

### N1 · The standalone analysis pages (and `index.html`) enforce neither CSP nor the no-network gate, though they ingest recordings and persist health-derived state — LOW–MED
- **Invariant (security-of-processing, defense-in-depth · consistency):** every user-openable, same-origin
  surface that ingests a recording or persists health-derived data carries the same two backstops the product
  bundles do — a meta-CSP (`connect-src` egress lock + injection lock) and no-network gate coverage.
- **Demonstration:** a CSP-presence grep across every root `*.html` shows the **10 owned bundles** (8 apps +
  `Data Unifier.html` + `OverDex.html` + `Integrator.html`) all carry
  `<meta http-equiv="Content-Security-Policy">`, while **none** of the standalone analysis/research pages do:
  `cgm-hrv-coupling-analysis.html`, `hrv-confound-analysis.html`, `nights-icc-analysis.html`,
  `sensor-trio-power-analysis.html`, `treatment-response-analysis.html`, `odi-bias-analysis.html`,
  `sigma-no-reference-analysis.html`, `qrs-equiv-analysis.html`, `qrs-yield-analysis.html`, the `cohort-*.html`
  harnesses, `PAT Feasibility.html`, `PpgDex Fusion Prototype.html` — **nor `index.html`** (the landing page).
  These are not inert: they load the real corpus, run DSP, and **persist checkpoints** — the localStorage
  `cgmcpl_*`/`hrvconf_*`/`nicc_*`/`striopwr_*`/`txresp_*` keys and the IndexedDB `*_ckpt` DBs. The
  `no-network.html` gate's own scope confirms the gap: `PAGES` is built from `BUILD-MANIFEST.json` bundles +
  the two orchestrators (`no-network.html:124-126`, `browser-gates.mjs:122`) — the analysis pages are booted
  and scanned by **nothing**.
- **The inconsistency is the finding.** `dex-forget.js` *already* treats those pages' persisted state as health
  data worth erasing — it gained `ANALYSIS_KEYS` + `ANALYSIS_IDB` precisely for them
  (`SECURITY-REMEDIATION-FOLLOWUPS §2`, executed). So the suite decided their at-rest data is in-scope for
  **erasure** but never extended the **injection/egress backstop** (CSP + no-network) to the same surfaces. A
  future stray `fetch`/beacon added to an analysis harness — or an XSS via a crafted corpus file rendered on
  one of them — would have no second line of defense and would not red the gate.
- **Principle:** security-of-processing (defense-in-depth), transparency (the "100% local" claim should be
  enforced everywhere it is *made*, and these pages are on the same origin as the product).
- **Proposed one gated change (its own brief):** (1) add the baseline meta-CSP to each analysis page's +
  `index.html`'s `<head>` — `default-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none';
  form-action 'none'` (use `connect-src 'self'` for the pages that `fetch('uploads/…')` the local corpus), and
  where practical the hash-based `script-src` the bundles already use; (2) extend the no-network gate's `PAGES`
  list (and its CSP-presence assertion) to boot/scan the analysis pages so the two invariants ride CI there
  too. Scope down front: the *reference guides* (`* Reference.html`) and pure narrative docs (`Science.html`,
  `Why This Exists.html`) are static and ingest nothing — a lower, optional tier; the **data-ingesting**
  analysis pages are the priority.
- **Gate impact:** the analysis pages are **unbundled loose-`<script src>` HTML** (like the orchestrators the
  gate already covers), so a `<head>` CSP edit is **not** a bundle change — **no `manifestHash` move, no fixture
  churn** for those pages. The work is HTML `<head>` edits + a test-list extension in `tests/dex-tests.js` /
  `no-network.html`'s `PAGES` + `browser-gates.mjs`. **EXPORT-INERT** everywhere.

### N2 · OxyDex leaks the raw filename + raw CSV header bytes to the console on every load (incidental leak) — LOW
- **Invariant (minimization / storage-limitation of incidental copies · transparency):** no debug path emits
  raw signal content or an identifying filename outside the analysis it was loaded for.
- **Demonstration:** four **unconditional** `console.log`s in `oxydex-dsp.js` (no `DEBUG`/verbose guard):
  `:368` logs `file.name` on binary detection; `:380` logs `file.name` **and `text.substring(0, 50)`** — the
  first 50 chars of the raw CSV, i.e. the recording's header line; `:441` logs `cleanText.substring(0, 60)`;
  `:443` logs on summary-format detection. `file.name` is the **raw, unscrubbed** filename — the exact vector
  F4 flagged as able to embed a patient name — and the CSV first-50/60 bytes are raw recording header content
  (device/format identifiers). This is leftover production debug logging of raw health data + identity.
- **Scope of harm (honest):** console output is **local-only** in an offline app — there is no network sink, so
  this is not an exfil path; the no-network invariant contains it. The concern is **minimization/transparency**:
  raw signal + an identifying filename are written to the browser console (persisted in devtools/session logs,
  visible to anyone with the machine open) beyond what the analysis needs. Hence LOW, not MED.
- **Principle:** minimization, transparency.
- **Proposed one gated change:** delete the four `console.log`s, or gate them behind an explicit
  `window.__oxyDebug` flag (default off) **and** scrub the logged name to a vendor+lane tag (reuse
  `SignalFrame.scrubFilename`) + drop the raw-substring dump entirely. Sweep the sibling `oxydex-dsp.js`
  `console.log`s in the same pass (9 total in the file) for any other raw-content dump.
- **Gate impact:** `oxydex-dsp.js` → re-bundle **OxyDex** → GATE-A `manifestHash` update. Logging-only, no
  `compute()`/export change → **EXPORT-INERT** (both OxyDex code-gated fixtures re-record `manifestHash` only,
  not regenerated).

### N3 · PpgDex's error toast is an unescaped `innerHTML` sink (F3-class, in the one node the escaper pass skipped) — LOW
- **Invariant:** untrusted / not-guaranteed-static text never reaches the DOM as markup (the F1/F2/F3
  invariant).
- **Demonstration:** `ppgdex-app.js:783` — `function showErr(msg){ …a.innerHTML='⚠ '+msg… }` (and `:784`
  `showOK` identically). Callers at `:87`, `:119`, `:133` pass `e.message||String(e)` from the parse/compute
  `catch`. The shipped `throw` sites in `ppgdex-dsp.js` use **static** messages, so no attacker-controlled text
  is *proven* to reach it today — this is **hypothesis-adjacent, exactly as F3 was rated** — but the sink is
  demonstrably `innerHTML` over a value the type system does not guarantee is static, and **PpgDex sat outside
  the F1/F2/F3 remediation scope**, so it never received the `dex-escape.js` treatment its siblings did. It is
  the lone inconsistent error path: ECGDex (`:1709-1710`) and GlucoDex (`:1106-1107`) set `.textContent`;
  PulseDex (`:328`) wraps `escapeHTML(res.error)`; OxyDex's F3 was folded into the remediation. Only PpgDex
  still interpolates a `catch` value straight into `innerHTML`.
- **Principle:** security-of-processing.
- **Proposed one gated change:** route `msg` in PpgDex `showErr`/`showOK` through the shared `escapeHTML()`
  (`dex-escape.js`, already loaded fleet-wide), or set `.textContent` on a child node (matching
  ECGDex/GlucoDex). Fold in a source-mirror assertion in the F1/F2 family so the sink stays escaped.
- **Gate impact:** `ppgdex-app.js` → re-bundle **PpgDex** → GATE-A `manifestHash` update. Display-only →
  **EXPORT-INERT** (both PpgDex code-gated fixtures re-record `manifestHash` only).

---

## Not findings — verified this pass & deliberately NOT re-filed

- **F1–F7 remediation holds.** Re-checked each: no reload-last filename chip survives in OxyDex (feature
  removed); PulseDex `res.error` is `escapeHTML`-wrapped; `oxydex_last_csv`/`_name` are gone (only defensively
  cleared); `dex-forget.js` `LOCAL_KEYS` ∪ `ANALYSIS_KEYS` cover **every** app storage key the inventory grep
  found, and its coverage is drift-gated; CSP + strict `script-src` ship on all 10 owned bundles.
- **Other filename/vendor→DOM sinks are safe.** `oxydex-render.js:1662` renders `n.fname` via
  `sanitizeFname()` — which **does** HTML-escape (`oxydex-util.js:26-31`, `<>&"'` + backtick →
  entities). CPAPDex pushes `f.name` into `peerMsgs` but renders it via `setStatus()`, which uses
  **`.textContent`** (`cpapdex-app.js:26`). `data-unifier-app.js` / `overdex-app.js` wrap every `vendor`/file
  `name` in `esc()`; `integrator-render.js` uses `esc()` on all warn/tooltip text. PpgDex's `reportNoPPG`
  `summary` is canned labels (`_PPG_FOREIGN_LABEL` + counts), **not** file-derived — safe.
- **Erase-all is complete and discoverable.** `dex-forget.js` deletes `ganglior_integrator` (IndexedDB) + all
  analysis checkpoints; the control mounts in the 6 profile apps' panel (`dex-profile.js:1177`) and in
  CPAPDex/Integrator's footer slot (`SECURITY-REMEDIATION-FOLLOWUPS §3`).
- **`eval`/`new Function` execution-security** — unchanged from the prior pass: only `support.js` (env tooling,
  not a shipped bundle) uses `new Function`; no Dex app does. The only URL `import()` is a Node build tool.
- **Export egress-by-user-action is mature** — contentId identity-free, filename scrubbed on both provenance
  pipes, floating wall-clock keeps exports viewer-timezone-independent, profile never exported
  (`PHI-SURFACE-STATEMENT.md`). Not re-filed.
- **Fonts / no-woff2 / no-CDN and the floating wall-clock time model** — intentional and privacy-correct (per
  charter out-of-scope).

## Hypotheses (unproven — labelled)

- **N3's payload.** No shipped `throw` in PpgDex is proven to carry file-derived text into `showErr`; the
  finding rests on the sink being `innerHTML` over a non-static value in an un-escaped node, not on a
  demonstrated live payload. Fix it as hardening + consistency, not an emergency.
- **Reference guides' DOI links + missing CSP.** The `* Reference.html` guides carry
  `<a href="https://doi.org/…" target="_blank" rel="noopener">` citation links (user-initiated navigation, not
  egress) and no CSP. They ingest nothing, so they are the *lowest* tier of N1 — worth a CSP `default-src
  'self'` for uniformity but not a data-at-risk surface.

## Do-first shortlist (highest value first)

1. **N1** — extend CSP + the no-network gate `PAGES` to the standalone analysis pages + `index.html`. Highest
   value: closes the one place the enforced no-network/injection invariant *isn't* enforced, on surfaces that
   actually ingest recordings. Unbundled → **no re-bundle** for the pages themselves; it's HTML `<head>` +
   test-list work. Aligns the CSP/no-network scope with the erase-all scope the FOLLOWUPS already set.
2. **N2 + N3** — one small **leak-hygiene** brief (both EXPORT-INERT display/logging fixes sharing the escaper +
   re-bundle machinery, mirroring how F1/F2/F3 were consolidated): drop OxyDex's raw-data `console.log`s
   (OxyDex re-bundle) + escape PpgDex's error toast (PpgDex re-bundle). Two bundles, both `manifestHash`-only.

Each accepted item lands as `<NAME>-2026-07-13-BRIEF.md`, honors the re-bundle + GATE-A/fixture and
`Dex-Test-Suite.html?full` + `verify-provenance.html` gates where it applies, and touches no frozen name / the
`ganglior.node-export` schema / the Clock Contract.
