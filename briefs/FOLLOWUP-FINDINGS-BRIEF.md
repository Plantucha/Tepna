<!--
  FOLLOWUP-FINDINGS-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-03 · **Created:** (undated — pre-2026-07-03, grandfathered) · **Spawns:** `REGEN-CORPUS-PATH-FOLLOWUPS-2026-08-03-BRIEF.md`

> **All five items settled 2026-08-03 — four were already resolved, P4 was still live and is fixed here.**
>
> - **P1 (HIGH) — unguarded `DOMContentLoaded`: RESOLVED, and its Done-when WITHDRAWN.** Every bundled
>   app now carries the `readyState` guard (swept: 14 sites, all guarded; `metric-registry.js` guards on
>   `document.body` instead, which the brief itself allows). More importantly the **bug class is
>   structurally gone**: OWN-THE-BUILD retired the legacy inliner, and an owned bundle carries each module
>   as *plain inline text* (`oxydex-dsp.js` is 310 KB inside its `<script>` tag), so app code runs during
>   parse and `DOMContentLoaded` fires *after* it. ⚠️ P1's literal Done-when — *"bundled OxyDex
>   auto-restores its last session on reload"* — is **not met and must not be**: `SECURITY-REMEDIATION-2026-07-11`
>   F4/F1 **deleted** that block, because it persisted the whole raw O2Ring CSV plus an unscrubbed filename
>   to localStorage and rebuilt a chip that interpolated the filename into `innerHTML`. The requirement was
>   deliberately withdrawn, not satisfied — recorded here so nobody "restores" it.
> - **P2 (MEDIUM) — `.src.html` edits may not move `buildHash`: OBSOLETE.** `buildHash` is RETIRED as a
>   provenance signal (`CLAUDE.md` §🔏); `manifestHash` is the sole executed-code identity and is a
>   deterministic projection of the inlined assets, so the blind spot P2 asked to investigate no longer
>   exists to investigate.
> - **P3 (MEDIUM) — HRVDex ingest contracts: DONE.** All three named contracts are asserted in
>   `tests/dex-tests.js` — `_hrvSig` (6), `_envToSeed` (8), `commitRows` (9).
> - **P4 (LOW — and the only live one) — CSV vs JSON import: FIXED HERE.** Its severity was under-rated.
>   See below.
> - **P5 (LOW) — cleanups: DONE.** The vestigial `hrvdex_last_csv` key is gone, and `persistHRVRows`
>   (`hrvdex-dsp.js`) no longer swallows quota errors — it halves the tail until the write fits and returns
>   `{capped, total}` (or `{failed}`), citing "FOLLOWUP-FINDINGS P5.2" in its own comment.
>
> **P4 was half-fixed, which is why it survived.** ECGDex has **two** `ganglior.node-export` builders:
> `ecgdex-app.js buildV2` (the app's ⬇ Export) and `ecgdex-dsp.js ecgBuildNodeExport` (the ORCHESTRATE
> path behind Data Unifier / OverDex). P4's fix landed in the app builder only. Since `hrvdex-dsp.js
> _envToSeed` reads exactly `tm.amo50 / tm.mode / tm.mxDMn`, the *same recording* gave HRVDex a populated
> Baevsky-SI through the app and a **null** one through the Unifier — `d_si` and the HTN/BP metrics that
> read `si` silently absent on one path. The DSP builder's own comment claimed *"Field math MIRRORS
> ecgdex-app.js buildV2"*; nothing checked it, and a comment is not a gate.
>
> **Fix:** `baevskyGeom` moved into `ecgdex-dsp.js` as THE single source (the app now delegates), the three
> fields added to the orchestrate builder, and a new gate pins both halves — value parity by construction,
> presence parity by a rewording-proof source scan with an anti-vacuity leg. 17 assertions; **3 mutants
> applied, 3 killed** (drop the keys → 3 reds with the anti-vacuity legs still green; break the scan anchor
> → anti-vacuity reds; restore the diluting denominator → the amo50 leg reds).
>
> Two honest-null defects were fixed on the way, both latent in the original: an all-non-finite NN series
> produced `mxDMn = -Infinity` from the untouched `±Infinity` seeds, and `amo50` denominated on `nn.length`
> rather than the finite count, under-reporting modal amplitude on exactly the noisiest recordings.
>
> **Gates:** `manifestHash 5826304d5daa → e98687121302`, `computeHash 5f63326a8eb5 → 2c6f9ac2c312` (a
> compute-path change, so re-verification was owed and was run). `regen-goldens --node ECGDex` moved
> **exactly 4 fields in exactly 1 fixture** (`synthetic_ecgdex_rich_golden`); the two light goldens and the
> **real** `ECGDex_2026-06-27_equiv` are byte-unchanged, confirming the light/app path is untouched.
> `verify-fixtures` green against the real corpus, `verifiedUnder → 2c6f9ac2c312`. GATE A 9/9, GATE B 29/29,
> `build.mjs --check` clean (11 owned). ECGDex + Data Unifier + OverDex re-bundled.

# Follow-up findings — build brief for an AI coder

**Where this came from.** The 2026-06-21 thread shipped HRVDex *additive ingest*
(every Welltory CSV / ECGDex export appends to one accumulating multi-day table,
deduped, persisted across reloads), an **ECGDex → HRVDex** handoff (HRVDex now
reads ECGDex `ganglior.node-export` JSON; ECGDex's `⬇ HRVDex` CSV now emits all
loaded nights), and the docs for it. See `INGEST-AUDIT-BRIEF.md` §6b for the full
record of what changed. During that work five issues surfaced that were **out of
scope to fix then**. This brief is the to-do list. Items are independent; do them
in priority order, gate after each.

**Read first:** `CLAUDE.md` (authoritative: Clock Contract, bundle workflow,
evidence badges, the FROZEN `ganglior.*` identifiers + `fascia` alias, and the
list of known non-issues you must NOT "fix"). Then `INGEST-AUDIT-BRIEF.md` §0
(ground rules) and §6b (what just shipped).

---

## 0. Ground rules (don't skip)

- **Edit sources, never the bundle.** Each app is `Foo.src.html` + external
  `*-dsp.js` / `*-app.js` / `*-render.js` / `*-registry.js`. The shipped
  `Foo.html` is compiled. Edit inputs, then re-bundle with the inliner
  (`super_inline_html`, `Foo.src.html` → `Foo.html`).
- **Gates after ANY `*-dsp.js` / `*-cross.js` / `*-app.js` change, and after
  re-bundling:**
  1. `Dex-Test-Suite.html` — open, wait ~3 s, read the `#summary` pill. Must be
     **all green** (baseline at end of last thread: **610 passed / 37 groups**).
  2. `verify-provenance.html` — open, confirm **no red verdicts**.
- **buildHash fact (verified this thread).** `buildHash` = SHA-256[0:12] of the
  bundle's `__bundler/template`. A **`*.js`-only edit does NOT move it** — its
  fixtures stay reproducible, no regeneration. A **`.src.html` change** is
  *supposed* to move it (and flip that node's fixtures) — but see **P2**, which is
  about a case where it didn't. No committed `uploads/*.json` fixture stamps
  HRVDex's or ECGDex's hash today, so those two nodes' rebuilds are provenance-safe
  regardless; re-confirm on the rebuilt bundle anyway.
- **Back-compat the contracts.** `tests/dex-tests.js` IS the public contract for
  each module (Node CI runs the same file via `tests/run-tests.mjs`). Add new
  params LAST + optional; expose new data via NEW fields/methods. Don't edit an
  assertion to match a changed signature.
- **Don't touch** `ganglior.*` identifiers, the `ganglior.node-export` schema, or
  the `fascia` alias. Don't re-extract `parseTimestamp` into a shared util
  (mirrored per-node by design). No `@font-face`/CDN.

---

## P1 — `DOMContentLoaded` init silently no-ops in bundled builds (HIGH)

### The bug
The inliner unpacks assets and **injects the app scripts AFTER `DOMContentLoaded`
has already fired** (the bundle bootstrap swaps the document, then runs the app
JS with `document.readyState === 'complete'`). Any code that schedules init with a
bare `document.addEventListener('DOMContentLoaded', fn)` — with **no
`readyState` guard** — never runs `fn` in the shipped bundle. (`INLINER-PATCH-LIST.md`
§ "#21/#75" confirms the inliner deliberately does NOT re-dispatch
`DOMContentLoaded`, so this will not self-heal.)

This was the one shipped bug in HRVDex last thread (restore + `fileInput.multiple`
dead until fixed). It is **already fixed in `hrvdex-app.js`** (lines ~165–176, the
`_hrvInit()` + `readyState!=='loading'` pattern) — use it as the reference.

### Audit result — most nodes are already safe; ONE more is NOT
I grepped every `DOMContentLoaded` in the tree.

**Already safe (guarded with `readyState`/`document.body` — DO NOT TOUCH):**
`integrator-app.js:349`, `glucodex-app.js:995`, `ecgdex-app.js:1549`,
`cpapdex-app.js:311`, `ppgdex-app.js:654`, `oxydex-fusion.js:766`,
`hrvdex-render.js:127,139`, `hrvdex-chartbadges.js:97`, `ganglior-provenance.js:77`,
`metric-registry.js:240`, `dex-patient-gen.js:118`, and `hrvdex-app.js` (fixed).

**The bundle bootstrap loaders** (`OxyDex.html:33`, `HRVDex.html:33`, etc.) are the
inliner's OWN pre-swap code — correct by design, leave them.

**The `*-analysis.html` research tools** (`sensor-trio-power-analysis.js:770`,
`sigma-no-reference-analysis.js:610`) are standalone pages loaded directly, **not
bundled through the inliner**, so `DOMContentLoaded` fires normally for them — no
fix needed, but confirm they are never bundled before dismissing.

**⚠ STILL BROKEN — `OxyDex.src.html` ~line 5960:**
```js
window.addEventListener('DOMContentLoaded', function(){
  var cached, name;
  try { cached = localStorage.getItem(CK) || localStorage.getItem('o2ring_last_csv'); … }
  …  // auto-restore the last O2Ring CSV session
});
```
This is the **same class of bug** as HRVDex had: an unguarded `DOMContentLoaded`
listener gating OxyDex's *“restore last session”* auto-load. In the bundled
`OxyDex.html` it almost certainly **never fires**, so OxyDex silently does not
restore the cached CSV on reopen.

### Task
1. **Confirm the OxyDex symptom first** (so you're fixing a real thing): open the
   bundled `OxyDex.html`, put a value under its cache key (the app's own key — do
   NOT delete keys you didn't write), reload, and check whether the session
   auto-restores. Compare against calling the restore body manually. (This mirrors
   how the HRVDex bug was proven: seed `localStorage`, reload, observe no restore,
   then observe manual call works.)
2. **Fix it** by replacing the unguarded listener with the guarded pattern, e.g.:
   ```js
   function _oxyRestore(){ /* existing body */ }
   if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', _oxyRestore);
   else _oxyRestore();
   ```
   The restore script sits late in `OxyDex.src.html`, so the DOM is already parsed
   when it runs — calling directly is safe. (If it depends on a later element,
   verify that element is above the script; it is for the cache-restore block.)
3. **Sweep for any others.** Re-grep `DOMContentLoaded` across `*-app.js` and the
   `*.src.html` inline scripts; any bare `addEventListener('DOMContentLoaded', …)`
   without a `readyState`/`document.body` guard inside a **bundled** app is the
   same bug. Fix with the same pattern.

### Gotcha — provenance
The OxyDex fix is in `OxyDex.src.html` (a `.src.html` change), so it *may* move
OxyDex's `buildHash` → and OxyDex **does** have committed fixtures
(`uploads/OxyDex_2026-06-13_1056_summary.json`). If the hash moves, those fixtures
flip to a mismatch and must be **regenerated** (drive the app on its committed raw
input, re-export, re-stamp). BUT — per **P2** a `.src.html` *body/inline-script*
change may NOT move the template hash at all. So: after re-bundling, open
`verify-provenance.html`. If OxyDex shows red → regenerate its fixtures. If green →
nothing to do. Decide from the gate, not from assumption.

### Done when
Bundled OxyDex auto-restores its last session on reload; `Dex-Test-Suite.html`
green; `verify-provenance.html` no red (regenerate OxyDex fixtures only if it goes
red).

---

## P2 — Provenance blind spot: `.src.html` body edits may not move `buildHash` (MEDIUM, investigate)

### What was observed
This thread edited **body copy** in `HRVDex.src.html` (the upload-zone `<h3>`/`<p>`
text, the empty-state text, the file-input `accept`), re-bundled, and HRVDex's
`buildHash` stayed **identical** (`7a6ae6a9bd34`) before and after. The rendered
page DID show the new copy, and the `manifestHash` (executed-code fingerprint) did
change — so the rebuild was real, only the **template hash** didn't budge.

`CLAUDE.md` and `verify-provenance.html` describe `buildHash` as a fingerprint of
the `.src.html` skeleton, and state that "a `.src.html` change gives a new hash →
any fixture stamped with the old hash flips to a mismatch." The observation above
suggests the inliner's `__bundler/template` does **not** capture the full
`.src.html` body — the body/markup appears to live (gzipped) in
`__bundler/manifest`, and the template is a thinner shell. If so, **markup/copy
changes in `.src.html` ship without the provenance gate noticing**, which is a
wider blind spot than the documented one ("won't detect external-`*.js` drift").

### Task — verify, then reconcile the docs (and decide if it needs hardening)
1. **Establish ground truth.** For one node, diff the `__bundler/template` content
   of the bundle (the `<script type="__bundler/template">` payload — read it from
   the *file*, not the live DOM; the runtime clears it on unpack) before vs after a
   trivial `.src.html` body edit. Determine exactly what the template includes
   (head only? script-`src` refs only? full body?) and what goes to the manifest.
   Cross-check against `ganglior-provenance.js → buildSource()/buildHash()` to see
   what it actually hashes.
2. **If the template excludes body/markup** (expected from the observation):
   - **Fix the docs** so they're honest: update `CLAUDE.md`'s provenance section
     and `verify-provenance.html`'s preamble to state that `buildHash` fingerprints
     the bundle **shell** (head + asset wiring), NOT `.src.html` body markup nor
     external `*.js` — i.e. it detects shell/structure changes only. This is the
     minimum and is mandatory.
   - **Optional hardening (propose, don't silently adopt):** if provenance should
     actually track shipped code, point the fixture audit at `manifestHash`
     (already computed in `verify-provenance.html`) in addition to `buildHash`, so
     a `*.js`/CSS/body change is detectable. Note the tradeoff: `manifestHash`
     moves on every code edit, so every fixture would need regeneration on every
     ship — which is why `buildHash` was scoped narrowly in the first place. Flag
     this for a human decision rather than unilaterally changing the gate.
3. **If the template DOES include the body** (observation was a fluke / caching):
   say so, and figure out why HRVDex's hash didn't move — that would itself be a
   real bug in the inliner or the provenance helper.

### Done when
The provenance docs match what `buildHash` actually covers, and (if pursued) any
gate change is green on both runners with a human sign-off noted in the PR.

---

## P3 — Test coverage for the new HRVDex ingest contracts (MEDIUM)

### Why
The additive-merge, dedup, and ECGDex-mapping logic shipped **verified live but
with zero assertions**. `INGEST-AUDIT-BRIEF.md` §7 (Definition of Done) requires
new behaviour to be covered in `tests/dex-tests.js` (both runners). These are now
public contracts a future change could silently break:
- `_hrvSig(r)` — the dedup identity (floating `tMs` + core metric tuple). If its
  shape changes, re-imports stop being idempotent or distinct sessions collapse.
- `_envToSeed(env)` — the ECGDex `ganglior.node-export` → HRVDex row mapping. If
  ECGDex's envelope field names move (e.g. `hrv.time.wholeRecordRMSSD`), this
  silently yields 0-rows.
- `commitRows(newRows, {replace})` — additive vs replace + sort.

### Where these live (and the testing wrinkle)
All three are page-scope functions in `hrvdex-dsp.js`, **not module exports**, so
they aren't directly loadable headless like `parseTimestamp` is. Two viable paths:

- **(A) Behavioral, in the browser-only group.** `Dex-Test-Suite.html` already has
  a render-coverage group that drives a real app bundle in an iframe. Extend it (or
  add a `hrvdex-ingest` group) to, inside a loaded `HRVDex.html` iframe: call
  `parseCSV(csv,{replace:true})` then `parseCSV(csv2,{})` and assert `allRows.length`
  (additive + dup-skip); call `ingestGangliorJSON(multiRecJSON,{})` and assert the
  ECGDex rows land with expected `_rmssd/_sdnn`; re-call and assert no growth
  (idempotent). Use the exact fixtures proven this thread: csv1→2 rows, csv2 (one
  exact dup)→3, ECG multiRecording (2 days)→5, re-import→still 5. **Storage rule:**
  snapshot the app's own `hrvdex_rows_v1` key, set it to your test value, and
  restore it after — never `removeItem` a key you didn't create (the test harness
  enforces this).
- **(B) Source-mirror, in the Node-loadable group.** If you want it in
  `run-tests.mjs` too, mirror the small pure pieces (`_hrvSig`, `_envToSeed`) the
  way other node-local fns are source-checked, OR export them onto a testing
  namespace and feed them through `env` in BOTH runners
  (`run-tests.mjs` + `Dex-Test-Suite.html`).

Prefer (A) for behavior; add (B) for the two pure functions if cheap.

### Done when
A `hrvdex-ingest` group asserts additive-merge + dedup + ECGDex-JSON mapping, green
in both runners, and the suite count goes up (not a silently-skipped group).

---

## P4 — ECGDex CSV vs JSON import are not equivalent (LOW)

ECGDex's **Welltory CSV** export (`exportWelltoryCSV` / `_welltoryRowFor` in
`ecgdex-app.js`) computes and ships **AMo50, Mode, MxDMn** (the Baevsky-SI inputs)
from the NN series. ECGDex's **`ganglior.node-export` JSON** does NOT expose those
fields, so `hrvdex-dsp.js → _envToSeed()` sets `_amo50/_mode/_mxdmn = 0`, and every
Baevsky-SI-derived HRVDex metric (`d_si`, the HTN/BP pieces that read `si`) comes
out **NaN for JSON-imported rows but populated for CSV-imported rows**. Same source
recording, two import paths, different metric coverage.

**Options (pick one, note it):**
- Add `amo50`/`mode`/`mxDMn` to ECGDex's envelope under `hrv.time` (or a
  `hrv.geometric` block) — keeps the schema additive, lets `_envToSeed` populate
  them. This is the principled fix; it touches the `ganglior.node-export` payload
  (additive only — new fields, never rename/remove), so re-stamp/regenerate any
  ECGDex fixtures if `buildHash` moves (none stamped today).
- OR document the asymmetry in the HRVDex Reference and leave JSON-path SI as NaN
  (honest-null is acceptable per the Clock/provenance philosophy).

Low priority — it only affects SI-family metrics on the JSON path.

### Done when
Either the envelope carries the geometric inputs and JSON-imported rows get SI, or
the asymmetry is explicitly documented. Gates green.

---

## P5 — Minor cleanups (LOW)

1. **Vestigial `hrvdex_last_csv` key.** In `hrvdex-app.js → clearAll()` there is a
   `localStorage.removeItem('hrvdex_last_csv')`, but **nothing writes or reads**
   that key anywhere (the real persistence key is `hrvdex_rows_v1`). Dead line —
   safe to remove. (Leave `hrvdex_rows_v1` alone.)
2. **Silent persistence quota.** `persistHRVRows()` wraps `localStorage.setItem`
   in a `try/catch` that swallows quota errors — so a very long accumulated history
   would quietly stop persisting with no user signal. Consider: cap the stored
   history (e.g. keep the most recent N measurements, or warn via `setStatus` when
   the write fails) so the failure is visible rather than silent. Match the
   "missing → visible, never fabricated" philosophy. In-memory accumulation for the
   session is unaffected either way; this is only about the saved mirror.

---

## Definition of done (whole brief)

- Sources edited (never bundles); affected `Foo.html` re-bundled with the inliner.
- `Dex-Test-Suite.html` all-green; `verify-provenance.html` no red (regenerate a
  node's fixtures only if its `buildHash` actually moves — confirm from the gate).
- New behaviour (P3) covered by assertions in `tests/dex-tests.js`, green in both
  `run-tests.mjs` and `Dex-Test-Suite.html`.
- No retired badge vocabulary; no `@font-face`/CDN; no `parseTimestamp` extraction;
  no touching `ganglior.*` identifiers / the `fascia` alias.
- Short PR note per item: what changed, which bundles rebuilt, gate results, and —
  for P1/P2 — the before/after evidence (the symptom you reproduced, the hashes you
  diffed).
