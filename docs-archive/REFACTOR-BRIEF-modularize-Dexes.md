# Refactor Brief — Modularize OxyDex, PulseDex, HRVDex (match ECGDex / GlucoDex)

> **Goal for the AI coder:** convert the three remaining monolith apps into the
> same multi-file "source + modules → bundled standalone" architecture that
> **ECGDex** and **GlucoDex** already use. **No behavior changes.** This is pure
> structural refactoring: same DOM, same math, same outputs, same look — just
> split out of one giant file into editable modules, then re-bundled.
>
> **Why:** OxyDex is ~13,000 lines in one file — past the size where edits are
> safe or fast. ECGDex/GlucoDex prove the pattern works and stays maintainable.

---

## 0. Current state of the project (June 2026)

| App | Architecture | Files |
|---|---|---|
| **ECGDex** | ✅ **MODULAR (reference)** | `ECGDex.src.html` + `ecgdex-{dsp,render,morph,profile,app}.js` → bundled `ECGDex.html` |
| **GlucoDex** | ✅ **MODULAR (reference)** | `GlucoDex.src.html` + `glucodex-{dsp,render,profile,app}.js` → bundled `GlucoDex.html` |
| **OxyDex** | ❌ monolith | `OxyDex v2.html` (~13k lines) → bundled `OxyDex v2 (standalone).html`. `OxyDex Reference.html` is a design ref, NOT an app. |
| **PulseDex** | ⚠️ partial | `PulseDex.html` (one big `<script>` + already-split `pulsedex-overview.js`) → `PulseDex (standalone).html` |
| **HRVDex** | ❌ monolith | `HRVDex v2.html` (inline Chart.js + one big `<script>`) → `HRVDex v2 (standalone).html` |

Shared: `ans-design.css` (design tokens), `Theme Preview.html`.

---

## 1. The target convention (copy ECGDex/GlucoDex EXACTLY)

### 1a. File layout per app
For an app named `Foo`:
- **`Foo.src.html`** — the editable shell: `<head>` styles, all markup, and at the
  very end a list of `<script src="foo-*.js">` tags (in dependency order) plus one
  small inline `<script>` for page-only glue (chip sync, `#demo` autoload).
- **`foo-dsp.js`** — all signal processing / math / metric computation. No DOM.
- **`foo-render.js`** — chart drawing + HTML-builder helpers (canvas/SVG). 
- **`foo-profile.js`** — user-profile state, personalization formulas, the ANS-age
  hero (only if the app has a profile panel — all three do).
- **`foo-app.js`** — orchestration: file ingest, pipeline calls, DOM population,
  exports, event wiring. Loaded LAST.
- (ECGDex also has `ecgdex-morph.js` for ECG morphology — add app-specific modules
  like this only where a clear seam exists; see §3.)
- **`Foo.html`** (or keep the existing standalone name) — the rebuilt bundle.

### 1b. Module idiom (every `.js` module)
Each module is an IIFE that hangs ONE namespace object off `window`. Copy this header
shape from `ecgdex-dsp.js` / `ecgdex-render.js`:

```js
/* ════ Foo · DSP (foo-dsp.js) … one-paragraph description … ════
   No external libraries. Exposes a single global: window.FOODSP */
(function (global) {
'use strict';
// … private helpers and functions …
global.FOODSP = { genSynthetic, analyze, /* … only what other modules need … */ };
})(window);
```

- **Namespaces** (mirror ECGDex's `ECGDSP`/`ECGUI` and GlucoDex's `GLUDSP`/`GLUUI`):
  - OxyDex → `OXYDSP`, `OXYUI`, `OXYProfile`
  - PulseDex → `PULSEDSP`, `PULSEUI`, `PULSEProfile`
  - HRVDex → `HRVDSP`, `HRVUI`, `HRVProfile`
- **App module** wraps in `(function(){ … })();` (no global arg needed) and reads the
  others via `const DSP=window.OXYDSP, UI=window.OXYUI;` — exactly like
  `glucodex-app.js` line ~13.
- Keep the small shared math helpers (`mean/std/median/quant/rmssd/…`) **duplicated
  locally inside each module that needs them**, the way ECGDex does — do NOT introduce
  a shared util module in this pass (that's a separate, later refactor). Goal here is
  zero behavior change and minimal risk.

### 1c. Script load order in `Foo.src.html` (dependency order, app LAST)
Match ECGDex.src.html (lines ~565–569):
```html
<script src="foo-dsp.js"></script>
<script src="foo-render.js"></script>
<script src="foo-profile.js"></script>
<script src="foo-app.js"></script>
<script>/* tiny page glue only: showChip(), #demo autoload */</script>
```
For HRVDex, the inline **Chart.js** bundle stays a `<script>` in the shell BEFORE the
app modules (it must exist on `window.Chart` before render runs).

### 1d. Bundling
After splitting and verifying the `.src.html` runs identically, rebuild the standalone
with the project's HTML-inliner (the same step that produced `ECGDex.html` from
`ECGDex.src.html`). Keep the existing standalone filenames so links don't break:
- `OxyDex v2.html` (src) → `OxyDex v2 (standalone).html`
- `PulseDex.html` (src) → `PulseDex (standalone).html`
- `HRVDex v2.html` (src) → `HRVDex v2 (standalone).html`

> Note: today OxyDex/PulseDex/HRVDex use the plain name as the *working monolith*.
> After this refactor the plain `.html` becomes the **shell that loads modules**
> (like `ECGDex.src.html`). If you prefer the explicit `.src.html` suffix for clarity,
> rename and update the bundle step — but keep ONE consistent choice and note it.
> **Recommendation:** adopt the `.src.html` suffix for all three (consistency with
> ECGDex/GlucoDex), bundle to the existing standalone names.

---

## 2. How to split safely (the mechanical process)

These files use **global `function`/`var` scope** (esp. OxyDex/HRVDex use ES5
`var` + `function` hoisting and many `window._x` globals). When you move a function
into an IIFE module, its name STOPS being global. So the discipline is:

1. **Inventory globals first.** Grep the monolith for every `window.X`, top-level
   `var X`, and `function X(`. Build a list of which names are referenced across
   would-be module boundaries.
2. **Cut along the existing section-banner seams** (the `// ═══…` comment blocks —
   OxyDex and HRVDex are already neatly sectioned; see §3).
3. **Export across boundaries.** Anything called from another module goes on that
   module's namespace object (`OXYDSP.foo = foo`). Anything still referenced as a
   bare global by inline HTML `onclick=` handlers (OxyDex has many, e.g.
   `onclick="profileChanged()"`, `oninput="profileChanged()"`) MUST remain reachable
   as a bare global — either keep those handler functions in the final app module and
   also assign `window.profileChanged = profileChanged;`, OR convert the inline
   handlers to `addEventListener` wiring in `foo-app.js`. **Prefer keeping behavior
   identical:** re-expose the handler names on `window` from `foo-app.js`. Grep every
   `on{click,input,change,…}=` in the markup and make sure each named function is
   still globally reachable.
4. **Preserve `window._*` cross-module state.** OxyDex/HRVDex pass data between
   profile and render via `window._ansAgeAvg`, `window._ansBreakdown`, `window._upHRrest`,
   `window.allNights`, `window.UP`, etc. Keep using `window.*` for these — do NOT try
   to convert them to module-private state in this pass. They're the existing
   interface; leave it.
5. **Load order matters** because these are plain scripts (no ES modules, no
   `type="module"`). DSP/render/profile must be parsed before app. Chart.js before
   HRVDex's render.
6. **One module at a time, re-verify after each cut** (see §4). Don't split all five
   at once and debug at the end.

> Do NOT convert `var`→`const`/`let`, do NOT rewrite ES5→ES6, do NOT "clean up"
> formulas. Move code verbatim. Behavior parity is the only success criterion.

---

## 3. Per-app cut plan (seams already exist in the source)

### 3a. OxyDex — `OxyDex v2.html` (~13,000 lines; single `<script>` from ~L5342)
Biggest job, but the cleanest internal sectioning. Suggested modules:

- **`oxydex-profile.js`** (`OXYProfile`) — the whole `USER PROFILE` block (~L5346–5970):
  `UP` object, `upLoad/upSave/upFromDOM/upToDOM/upHRmax/upHRmaxSource/upBMI/upBSA/
  upIBW/upMAP/upBMR/upBAP/upPopAvg/upIdealWt/upKarvonenZone/profileDerivedUpdate/
  profileAutoDetectUpdate/recomputeFromProfile/profileChanged/toggleProfile/openProfile/
  initProfile`. Owns the ANS-age hero + the `window._ansAgeAvg/_ansBreakdown/_upHRrest`
  exports. **Re-expose `profileChanged`/`toggleProfile`/`openProfile` on `window`**
  (inline handlers call them).
- **`oxydex-util.js`** *(optional small)* — null-safe DOM helpers + CSV/HTML safety:
  `csvSafe/sanitizeFname/escHTML/safeEl/safeSet/safeStyle/gv/sv/smoothVals/getBaseline/
  computeBaselineArr` (~L5974–6050). Or fold these into the top of `oxydex-dsp.js`.
- **`oxydex-dsp.js`** (`OXYDSP`) — `CFG`, `allNights`, PARSE (`parseCSV/parseSummaryCSV/
  parseJSONL/processNight`), ARTIFACT CLEANING, and ALL the metric tiers
  (`computeNightExtras/computeRollingMetrics/computePatternScores/DFA/computeHRV` and
  the v20.2–v22 metric functions, ~L6371–end-of-compute). No DOM here.
- **`oxydex-render.js`** (`OXYUI`) — every chart drawer + HTML card builder
  (`renderAll/renderNight/render*` and the canvas chart helpers).
- **`oxydex-app.js`** — file `handleFiles/readFile`, pipeline orchestration, the multi-night
  trend view (`_gcWin/_gcSmooth`), exports, and DOM wiring. Loaded last.

Gotchas: keep `window.UP`, `window.allNights`, `window._cacheO2CSV`, `window._csvParseErrors`
as globals (cross-module). OxyDex draws its OWN charts (no Chart.js) — all chart code goes
in `oxydex-render.js`. **Reminder:** OxyDex's HRV is a labeled 1 Hz pulse-rate proxy with
motion/artifact filtering already — it does NOT use ECGDex's RR Malik correction and should
NOT gain it here (different signal; out of scope).

### 3b. PulseDex — `PulseDex.html` (one `<script>` from ~L223; already modern `const`/arrow)
Smallest job — already half-modular (`pulsedex-overview.js` exists). Modules:
- **`pulsedex-dsp.js`** (`PULSEDSP`) — math helpers (`mean/std/rmssd/pnn50/nn50c`),
  the spectral/ANS/Poincaré/BP/VO₂ computations, and the main `analyze`→`r` builder
  (~L300–600). PulseDex already uses RR-interval HRV with correction — keep as is.
- **`mypulsedex-render.js`** (`PULSEUI`) — `renderKPI/renderTable` + chart helpers.
- **`pulsedex-app.js`** — Welltory CSV ingest, `rawToWTRow`/WT export, wiring.
- Keep **`pulsedex-overview.js`** as-is (already a module) — just confirm its global
  name and load it in the right order.

### 3c. HRVDex — `HRVDex v2.html` (inline Chart.js at ~L3196; main `<script>` from ~L3217)
- **Leave the inline Chart.js bundle in the shell** as a plain `<script>` BEFORE the
  app modules (it defines `window.Chart`). Do not move it into a module.
- **`hrvdex-dsp.js`** (`HRVDSP`) — Welltory row parsing (`allRows` build, the `_meanRR/
  _sdnn/_rmssd/_pnn50/_hr` field mapping), the ANS-age composite (`_ageRMSSD/_ageSDNN/
  _ageHR/_clampAge`, ~L3363–3390), and all derived series/metrics.
- **`hrvdex-render.js`** (`HRVUI`) — all the `ch_*` Chart.js chart builders (there are
  dozens: `ch_rmssd/ch_lnrmssd/ch_vei/ch_cvi/ch_crs/ch_bp_components/…`).
- **`hrvdex-profile.js`** (`HRVProfile`) — the profile panel + `computeDerived/
  updateProfile/applyAgeNorms/clearEstimate` (inline handlers call these — re-expose
  on `window`).
- **`hrvdex-app.js`** — CSV upload, `renderAll`, exports, wiring.
- Gotchas: keep `window._ansAgeAvg/_ansAgeLast/_ansBreakdown` globals. Many inline
  `oninput=`/`onchange=` handlers → re-expose their functions on `window`.

---

## 4. Verification after EACH module cut (non-negotiable)

The whole value of this refactor is lost if behavior drifts. After each split:

1. **Open the `.src.html`** and check the console for `ReferenceError`/`is not defined`
   (the #1 failure mode — a function that's no longer global). Fix by exporting it on
   the namespace or re-exposing on `window`.
2. **Load a real data file** (the project has real samples in `uploads/`: O2Ring CSVs
   for OxyDex, Welltory CSV for HRVDex/PulseDex) AND the synthetic/demo path. Confirm
   the page renders fully through to the last card with NO blank sections.
3. **Diff key outputs against the monolith.** Before starting, snapshot the monolith's
   computed numbers for one known file (e.g. screenshot the KPI tiles + export the
   JSON). After refactor, the same file must produce byte-identical metrics. Any
   numeric difference = a bug introduced by the cut.
4. **Test inline handlers** — click the profile toggle, edit an age field, change every
   control that has an `on*=` attribute. A silent broken handler is the second most
   common failure.
5. **Re-bundle and open the standalone**; confirm it matches the `.src.html`.

### Done criteria
- All three apps load module-split sources with zero console errors.
- Real-file and demo paths render identically to the pre-refactor monoliths.
- All exports (CSV/JSON) produce identical content.
- Standalones rebuilt under their existing filenames.
- No formula, threshold, or DOM change anywhere — purely structural.

---

## 5. Suggested order of work
1. **PulseDex first** — smallest, already modern syntax, already half-split. Lowest risk;
   use it to validate the process end-to-end.
2. **HRVDex second** — medium; mind the Chart.js dependency + many inline handlers.
3. **OxyDex last** — biggest; do it once the process is proven. Split in the order
   profile → util → dsp → render → app, verifying after each.
