<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-11 (**Phase A COMPLETE** — F1/F2/F3 injections closed via one shared `dex-escape.js`; OxyDex+PulseDex (+Data Unifier/OverDex, which embed the same modules) re-bundled EXPORT-INERT, fixtures re-recorded `manifestHash`-only; a "filename renders escaped" gate is green in both runners. **Phases B (CSP) + C (storage hygiene) pending** — need the owner F4/F7 decisions + ride the batched fleet re-bundle) · **Created:** 2026-07-11 · **Executes:** `audits/PRIVACY-SECURITY-AUDIT-FINDINGS-2026-07-01.md` (F1–F7) · **Consolidates** the audit's "each finding → its own dated brief" into ONE phased remediation (the findings share the `escapeHTML` helper + the EXPORT-INERT re-bundle machinery; seven tiny briefs would fragment that)

# Security & storage-hygiene remediation — F1–F7 (untrusted→DOM, CSP, erase-my-data)

> **Why now (urgent).** The 2026-07-01 privacy/security audit **fixed nothing** ("every finding [gets] its
> own dated gated change-brief") and **no remediation brief was ever created** — the findings have sat open
> for 10 days. One is a **live, stored XSS (HIGH)** in a health-data app, verified still present on `main`
> 2026-07-11: `oxydex-app.js:321` inserts a persisted, unescaped filename into `innerHTML`, so a file named
> `<img src=x onerror=…>.csv` **auto-executes its payload on every subsequent visit**, in the origin that
> holds the user's profile + cached raw night. There is **no CSP** to blunt it and **no shared `escapeHTML`**
> in the codebase. This brief closes the whole set, ordered by severity + re-bundle economics.

**Threat model (why a "100%-local single-user" app still cares).** The no-network invariant blunts *exfil*,
but the injection still runs in the app origin: it can read the profile (`tepna_profile`), the cached raw
recording (F4), and the Integrator's IndexedDB longitudinal store, and can drive the export/clipboard path or
corrupt results. The realistic vector is **a maliciously-named capture file** (downloaded, shared, or crafted)
— exactly the input Tepna is built to ingest. Script-injection is not acceptable regardless of exfil.

---

## Phase A — the injections (F1 · F2 · F3) — ✅ DONE 2026-07-11 · display-only · EXPORT-INERT
> **EXECUTED 2026-07-11.** Added the ONE canonical escaper **`dex-escape.js`** (`escapeHTML` — bare global +
> `DexEsc`), loaded first in every shell that embeds the sinks (OxyDex, PulseDex, **Data Unifier, OverDex** —
> the last two also inline `oxydex-util.js`/`oxydex-dsp.js`, so they needed it too). OxyDex's pre-existing
> `escHTML` now **delegates** to it (single source, no per-app copy). Sinks converted: **F1** `oxydex-app.js`
> filename chip → `escHTML(name)`; **F3** `oxydex-dsp.js` error block → `escHTML(String(e))`; **F2**
> `pulsedex-app.js` comparison card → `escapeHTML()` on `priLab`/`refLab`/`res.error`/`res.note`. Re-bundled
> all four (EXPORT-INERT — fixtures re-recorded `manifestHash` only, output bytes unchanged; equiv gate green).
> A `Security — untrusted filename renders escaped (F1/F2/F3)` group (functional escaper + DOM-render + source-
> mirror) is green in both runners. On-touch Biome formatting of the touched files rode this re-bundle
> (BIOME-FORMATTER Phase 2). **F-note (deferred to a follow-up):** the PulseDex recordings-switcher / sidebar
> `innerHTML` sinks interpolate only derived numerics (dates/coverage/modeLabel), NOT raw filenames — no
> additional injection there; audited clear.

The actual XSS. All three are "untrusted string → `innerHTML`" where a sibling call already uses `.textContent`
(the escaping is *inconsistent* — the classic gap). Fix = one shared escaper + convert the sinks.

- **F1 (HIGH) — OxyDex stored XSS.** `oxydex-app.js:321` `chip.innerHTML='📂 Reload: <strong>'+name+'</strong>'`
  where `name = localStorage 'oxydex_last_name'` (the persisted raw filename, re-inserted by `_oxyRestoreLast()`
  every load). **Fix:** build `<strong>` as an element and set `.textContent`, OR route `name` through
  `escapeHTML()` before interpolation.
- **F3 (LOW–MED) — OxyDex error→DOM.** `oxydex-dsp.js:314–316` `errEl.innerHTML='…<code…>'+String(e)+'</code>…'`.
  **Fix:** `.textContent` on the `<code>` (or `escapeHTML(String(e))`). Fold into the OxyDex re-bundle with F1.
- **F2 (MED) — PulseDex reflected XSS.** `pulsedex-app.js:134` `cmpData.label=f.name` → `:187` `refLab`/`priLab`
  → `:~204` `'<th…>'+refLab+'</th>'` → `:231` `card.innerHTML=…tbl…`. **Fix:** `escapeHTML()` on
  `priLab`/`refLab` **and** any `res.error`/`res.note` interpolated into the same `innerHTML`.

**The shared helper.** Add ONE `escapeHTML(s)` (`& < > " '` → entities; null/number-safe) to a module BOTH
apps already co-load so there's no new load-order edge — **recommended home: `oxydex-util.js`** (already a
shared util) exposed as `DexEsc.escapeHTML` / a bare `escapeHTML`, or a tiny new `dex-escape.js` added to the
co-load lists. Do NOT hand-roll per-app copies (that recreates the inconsistency). Prefer `.textContent` where
the surrounding markup is static (F1/F3); use `escapeHTML()` where untrusted text sits inside a built HTML
string (F2 table cells).

**Gate/re-bundle (A):** `oxydex-app.js`+`oxydex-dsp.js` → re-bundle **OxyDex**; `pulsedex-app.js` → re-bundle
**PulseDex**. Display-only, `compute()`/export untouched → **EXPORT-INERT**: each app's code-gated fixtures
**re-record `manifestHash` only** (NOT regenerated — output bytes are unchanged; §🔏). Add a `Dex-Test-Suite`
**source-mirror + functional** group asserting a crafted `<img onerror>` filename renders **escaped** (no live
element) for both apps — a real regression lock, not just a grep.

## Phase B — Content-Security-Policy (F7) — hardens no-network at the browser layer
- **F7 (LOW–MED).** No `<meta http-equiv="Content-Security-Policy">` in any `.src.html`/bundle. Add one to each
  `.src.html` `<head>`. **Baseline (compatible today):**
  `default-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'` —
  `connect-src 'none'` alone kills every `fetch`/`XHR`/`WebSocket`/`EventSource`/`sendBeacon`, turning "100%
  local" into a **browser-enforced** property behind the `no-network` gate.
- **⚠ DECISIONS (owner, record in-brief before landing):**
  1. **`script-src`/`style-src`:** the bundles are inline `<script>`/`<style>`, so a strict `script-src` needs
     `'unsafe-inline'` (weakens XSS defense — but Phase A already fixes the injections) OR a build-time
     nonce/hash (requires teaching the owned bundler — bigger). **Recommend:** ship `default-src 'self'` +
     `connect-src 'none'` now (most of the value, zero bundler change); defer nonce-based `script-src` to a
     follow-up only if wanted.
  2. **Demo `fetch('uploads/…')`:** any page that fetches committed demo files needs `connect-src 'self'`, not
     `'none'`. **Decide per page** (the deploy/served pages vs the dev pages) — record the tradeoff.
- **Gate/re-bundle (B):** a `<meta>` in each `.src.html` `<head>` is an inline-shell edit → **re-bundle all 8**
  (heaviest leg; `manifestHash` moves on all). EXPORT-INERT (fixtures re-record `manifestHash`). Add a
  CSP-presence assertion to the suite; verify `no-network.html` still green (CSP should *reinforce* it).

## Phase C — storage hygiene & erase-my-data (F4 · F5 · F6) — EXPORT-INERT, decisions needed
- **F4 (MED) — raw night + raw filename cached forever.** `oxydex-dsp.js:287` writes the whole raw CSV +
  unscrubbed filename to `localStorage` (no TTL/cap); the raw name is F1's injection vector, so this *compounds*
  F1. **⚠ DECISION:** (a) drop the raw-CSV cache, keep a small "last session" descriptor; or (b) keep the
  "📂 Reload" convenience but **scrub the cached name** (`SignalFrame.scrubFilename`) + gate the raw cache
  behind explicit opt-in + a "stored on this device" disclosure. (HRVDex `hrvdex_rows_v1` = the lighter
  precedent.) **Recommend (a)** unless the reload convenience is valued — dropping raw-at-rest is the
  minimization-clean choice and removes the F1 payload entirely.
- **F5 (MED) — "Clear" doesn't clear; no erase-all path.** OxyDex `clearAll()` (`oxydex-app.js:43`) never
  `removeItem`s `oxydex_last_csv`/`_name`; suite-wide there is no single control that wipes the union of health
  data (`tepna_profile`, each node's keys, and the Integrator IndexedDB `ganglior_integrator`). **Fix:** (1)
  OxyDex `clearAll()` also removes its raw cache; (2) a shared **"Erase all data on this device"** control
  (new `dex-forget.js` / profile-panel button) clearing the full known key-set **and**
  `indexedDB.deleteDatabase('ganglior_integrator')`, with a short "what's stored here" disclosure. **Keep the
  erase key-list beside the storage-key inventory so it can't drift** (a gate leg enumerating current keys).
- **F6 (LOW) — legacy profile keys linger.** `dex-profile.js migrate()` (`:175`) writes `tepna_profile` from
  the 6 legacy per-node keys but never deletes them (stale identity duplicates). **Fix:** `migrate()`
  `removeItem`s each legacy key it successfully folds forward (idempotent; still never fabricates). Pairs with
  F5 (both storage-hygiene; `dex-profile.js` → re-bundle the 6 profile apps).
- **Gate/re-bundle (C):** storage behavior only → **EXPORT-INERT** across the touched apps. Add a functional
  group: after `clearAll()`/erase, the enumerated key-set is empty and the IndexedDB store is gone.

---

## Sequencing & re-bundle economics
- **A first (urgent, smallest):** OxyDex + PulseDex only. Land it on its own even if B/C wait — the HIGH XSS
  should not sit behind a fleet re-bundle.
- **B + C fold into the Phase-3 batched fleet re-bundle** (`OPEN-BRIEFS`/sequence): CSP touches all 8 and C
  touches 6, so pair them with the already-deferred version-into-bundle stamping + OWN-THE-BUILD Part C +
  §5.9 noscript — pay the fleet churn **once**. (A is separate because it's urgent and only 2 apps.)
- **Every leg is EXPORT-INERT** (display/storage/transport only): per §🔏, re-record each moved bundle's
  `manifestHash` in `BUILD-MANIFEST.json` + its fixtures' `manifestHash` (NOT regenerate outputs), and drop a
  `bump: patch` changeset per work-unit. No metric/contract/units change → PATCH, not MINOR.

## Done-when
- **A:** F1/F2/F3 sinks escaped (shared `escapeHTML`/`.textContent`); OxyDex+PulseDex re-bundled, GATE-A updated,
  fixtures re-recorded; a source-mirror+functional "filename renders escaped" group green in both runners;
  `verify-provenance` A/B + `?full` green; changeset dropped.
- **B:** CSP decisions recorded + `<meta>` in all 8 `.src.html`; all 8 re-bundled + ledgered; CSP-presence gate
  + `no-network.html` green.
- **C:** F4/F5/F6 decisions recorded + landed; erase-all clears the enumerated key-set + IndexedDB; storage
  gate green; touched apps re-bundled + ledgered.
- All three: `Dex-Test-Suite.html?full` all-green, `verify-provenance.html` clean, release changesets folded.
- **Follow-up:** spawn `SECURITY-REMEDIATION-FOLLOWUPS-…` only for anything deferred (e.g. nonce-based
  `script-src`, or the audit's untraced additional sinks F-note); else say so in this brief's DONE header.

## Scope guard
Display/storage/transport only — MUST NOT touch `compute()`, any node-export/`ganglior.*` schema, the Clock
Contract, metric identity/units, or the `fascia` alias (so every leg stays EXPORT-INERT). Edit `*.js` +
`*.src.html`, re-bundle via the owned build (`tools/build.mjs`), never the bundled `.html` directly.

## Cross-references
- `audits/PRIVACY-SECURITY-AUDIT-FINDINGS-2026-07-01.md` — the audit this executes (F1–F7 detail + gate impacts).
- `audits/PRIVACY-SECURITY-AUDIT-PROMPT.md` — the charter (no-network invariant, untrusted→DOM, storage-min).
- `no-network.html` + the `no-network` CI workflow — the transport invariant CSP reinforces (Phase B).
- `CLAUDE.md` §🔏 (re-bundle/EXPORT-INERT/fixture rules) · §📦 (changeset per work-unit) · §📌 (this brief's lifecycle).
- The Phase-3 batched re-bundle (see `OPEN-BRIEFS-POST-TRIO-2026-07-06-BRIEF.md` + the deferred version-stamp / OWN-THE-BUILD Part C / §5.9 items) — where Phases B+C ride.
