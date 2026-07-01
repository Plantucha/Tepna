<!--
  DEEP-AUDIT-FIXES-2026-06-30-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-06-30 (all three §§ executed; both gates green) · **Created:** 2026-06-30 · **Owner brand:** Tepna
**Executes:** [`DEEP-AUDIT-FINDINGS-2026-06-30.md`](DEEP-AUDIT-FINDINGS-2026-06-30.md) (its prioritized punch-list)
**Closes:** `SIGNAL-ADAPTER-AND-FRONTIER-2026-06-23-BRIEF §622` — CLOSED 2026-06-30 by §1 (crude `spectral()` proxy deleted; the only spectral source is now Lomb–Scargle).

## Execution log (2026-06-30)
- **§1 (MED) — DONE + gate-green.** Removed the two `(night)` display rows (`pulsedex-render.js`), the
  `spNight` proxy call + `vlfNight`/`tpNight` `lastResult` fields (`pulsedex-app.js`), the dead
  `spectral()` fn + its bare-global re-export item (`pulsedex-dsp.js`), and the `'vlf (night)'` /
  `'total pwr (night)'` aliases (`pulsedex-registry.js`). External-JS-only → **PulseDex re-bundled
  `manifestHash 1a8b99cf8a4c → 4ad7ee5b9982`**, `buildHash 17ee0d96c509` UNCHANGED. **EXPORT-INERT** —
  the two code-gated fixtures (`equiv` + `events`) reproduce byte-identical (Phase-9 equivalence gate
  30/0; GATE-B outputHashes unchanged) → `manifestHash` re-recorded in `FIXTURE-PROVENANCE.json`, NOT
  regenerated. NEW regression group *"PulseDex spectral honesty — proxy row + borrowed grade removed"*
  (11/0, both runners). Legacy `uploads/PulseDex_*_summary.{json,csv}` samples still carry the two keys
  — left as-is per plan (not code-gated).
- **§2 (LOW/process) — DONE + gate-green.** Added a `bootRig()` helper (warm via `about:blank` +
  **retry-once** with a longer watchdog) and routed `renderCoverageIntegratorPB` through it
  (`Dex-Test-Suite.html`, not bundled → no re-bundle). The Integrator-PB rig is green (9/9) across two
  cold reloads; the all-green pill is deterministic. (SKIP-state fallback not needed — no timeout recurred.)
- **§3 (LOW / product-decision) — DONE (Option A) + gate-green.** Owner chose Option A. Added a
  read-only **mg/dL⇄mmol/L display toggle**: new `GluDisp` helper (`glucodex-render.js`, exposed
  `window.GluDisp`) reformats every surfaced glucose value/threshold/axis at the render boundary only
  (÷18.018; mmol band edges use the STANDARDIZED consensus cutoffs 3.0/3.9/10.0/13.9, not naive
  division). Routed through `glucodex-render.js` (TIR legend + chart axes), `glucodex-app.js` (KPI grid ·
  variability · sessions · patterns · PPGR · fusion · daypart · metrics table · context + the topbar
  toggle UI, JS-injected), `glucodex-profile.js` (hero chips + target label). **Default = mg/dL** —
  chosen because mg/dL is itself a metric unit AND the CGM-consensus/constant-native one, so the
  mandate's "metric default" holds while the SI molar mmol/L is the alternate switch (the
  lowest-correctness-risk reading; a one-line flip if a mmol/L default is later preferred).
  Compute/storage/export **stay mg/dL** → External-JS-only (+ a JS-injected `<style>`) → **GlucoDex
  re-bundled `manifestHash 267987038e2f → 650c1738827e`**, `buildHash ebb3b3ab196a` UNCHANGED.
  **EXPORT-INERT** (`env.equiv.glucodex` byte-identical → `manifestHash` re-recorded, NOT regenerated).
  NEW regression group *"GlucoDex mmol/L display toggle — boundary-only, mg/dL default"* (14/0, both
  runners; `glucodex-render.js`+`-app.js` added to both source lists). **Both unit modes verified
  in-page:** mg/dL view byte-consistent with before; mmol/L converts every dashboard metric with the
  standardized bands.
- **Gates:** `Dex-Test-Suite.html` **all-green 1608/104, 0 failing** (full render-coverage incl. GlucoDex
  9/9, Integrator-PB 9/9, PulseDex 15/15); `verify-provenance.html` **GATE A 8/8 + GATE B reproducible**,
  `__provenanceOK=true`.
- **Discovered during execution → `DEEP-AUDIT-FIXES-FOLLOWUPS-2026-06-30-BRIEF.md`:** (1) the brief's
  aside "`spectral` is NOT on the namespaced `PulseDex` surface" was slightly off — `spectral` was in
  the `!__DEX_NAMESPACED__` bare-global re-export list, removed as part of §1. (2) §3's surface is
  larger than a "toggle": the advanced profile **target-INPUT** fields (bidirectional mmol input
  parsing), the Ganglior event-stream export preview, and the CSV upload-format hint are **deliberately
  left mg/dL** (inputs mirror stored mg/dL; the event stream mirrors the canonical mg/dL node-export;
  the hint is a file-format example). Captured in the follow-ups brief.

# Deep-audit fixes — PulseDex spectral honesty · test-gate determinism · GlucoDex units

> **Read `CLAUDE.md` first** — the two gates (`Dex-Test-Suite.html`, `verify-provenance.html`), the
> Clock Contract, the frozen `Ganglior`/`fascia` identifiers, and the **edit-`*.js`/`.src.html`,
> never the bundled `*.html`, then re-bundle** rule. This brief turns the three findings in the
> 2026-06-30 deep-audit into ordered, gate-checked edits. Everything the audit VERIFIED CLEAN
> (Clock Contract · Baevsky SI/CSI units · glycemic constants · fabricated-absence gates · cross-node
> PB noisy-OR · `std()`/SDNN unification · provenance) is **out of scope — do not re-investigate it.**

The suite is in strong shape. There is exactly **one real surfaced-number defect** (§1, MED), **one
test-infra red** that makes the canonical all-green pill non-deterministic (§2, LOW/process), and
**one units-mandate presentation gap** that is a product decision, not a correctness bug (§3, LOW).
Do them in this order — correctness first.

---

## §1 · (MED, the real defect) PulseDex surfaces + `validated`-badges two whole-night spectral rows from the crude `spectral()` `rmssd²` proxy, not Lomb–Scargle

**What's wrong.** On any **long** recording the PulseDex metrics table (and its CSV export) renders
two extra frequency rows — **"VLF (night)"** and **"Total Pwr (night)"** (unit ms²) — directly under
the real Lomb–Scargle "VLF Power" / "Total Power" rows. Their values come from the legacy
`spectral()` estimator (`hf = rmssd(a)**2`; `lf = max(0, tp·0.35 − hf·0.1)`; `vlf = tp − hf − lf`),
**not** the Lomb–Scargle PSD every adjacent row uses. In the committed samples the crude VLF diverges
**4–11×** from the real LS VLF on the *same file* (e.g. `PulseDex_2026-06-13_1701_summary`: LS `vlf`
1166 vs crude `vlfNight` 8921 = 7.65×; `_2026-06-13_1055`: 1384 vs 15033 = 10.9×). Worse, both rows
inherit a **`validated`** evidence disc with a Task-Force / Lomb–Scargle citation via registry label
aliases — a crude variance-residual presented as a method-validated band power. `vlfNight` is the
genuinely wrong number (a residual after subtracting an `rmssd²` HF guess + an arbitrary 0.35/0.1 LF
split, no PSD basis); `tpNight` is numerically defensible (whole-night RR variance ≈ total power by
Parseval) but is **mis-cited** as Lomb–Scargle.

**Scope note (why MED not HIGH):** these two rows are **app-display + summary-CSV only**. They are
**absent from the headless `buildNodeExport`** (`pulsedex-dsp.js:797` — `frequency:{lf,hf,vlf,lfhf}`
are all Lomb–Scargle), so the cross-node `ganglior.node-export` and all fusion are **unaffected**.

### Fix — drop the two rows + the proxy (the cheapest honest fix)

The real "VLF Power" row already covers VLF from the LS PSD, and a trustworthy whole-night ULF is
**not recoverable** from the `rmssd²` proxy — so remove the rows rather than dress them up. All edits
are external-JS; **grep `spectral(` fleet-wide first** to confirm the only caller is `pulsedex-app.js`
(it is today; `spectral` is NOT on the namespaced `PulseDex` surface and is referenced by no test).

1. **`pulsedex-render.js` (lines ~182–183)** — delete the whole conditional spread that appends the
   two rows:
   ```js
   ...(r.longRec?[['VLF (night)',      r.vlfNight,'ms²','—','neutral','Whole-night VLF/ULF — only resolvable over long records'],
                  ['Total Pwr (night)',r.tpNight, 'ms²','—','neutral','Whole-night total spectral variance']]:[]),
   ```
   The CSV export reads `window.__summaryRows` (the same `rows` array, `:230`), so removing them here
   removes them from the tidy CSV too — no separate CSV edit needed.

2. **`pulsedex-app.js`** — delete the proxy call and its two output fields:
   - line ~381: remove `const spNight = longRec ? spectral(a) : null;`
   - line ~455: in the `lastResult` literal drop `tpNight:spNight?spNight.tp:null, vlfNight:spNight?spNight.vlf:null,`
     — **keep** the LS row `tp:sp.tp, hf:sp.hf, lf:sp.lf, vlf:sp.vlf,` exactly as-is.

3. **`pulsedex-dsp.js` (lines ~102–109)** — `spectral()` is now dead. **Delete the function.** This
   is the branch the earlier `SIGNAL-ADAPTER §622` item left open ("if it's dead code, delete it; if
   live anywhere, route it to LS") — the audit proved it was live + surfaced; removing its sole caller
   makes deletion correct. (`rmssd`, `mean` etc. that it used stay — they have other callers.)

4. **`pulsedex-registry.js` (ALIAS map, lines ~124–125)** — remove the two `(night)` aliases so no
   surfaced label can ever borrow the `validated` `tp`/`vlf` grade again:
   - drop `'total pwr (night)':'tp',`  (keep `'total power':'tp','total pwr':'tp'`)
   - drop `'vlf (night)':'vlf',`       (keep `'vlf power':'vlf'`)

### Gate cost — one PulseDex re-bundle, EXPORT-INERT

- **Re-bundle PulseDex** from `PulseDex.src.html` after the `.js` edits.
- **GATE A:** PulseDex `manifestHash` moves off the committed **`1a8b99cf8a4c`** → hand-update its
  entry in `BUILD-MANIFEST.json` to the value `verify-provenance.html` reads back. `buildHash`
  **`17ee0d96c509` stays UNCHANGED** (external-JS-only; no inline-script/style `.src.html` edit) — do
  not touch it.
- **GATE B — EXPORT-INERT, no regeneration.** `vlfNight`/`tpNight` never entered `buildNodeExport`, so
  both PulseDex code-gated fixtures (`pulsedex_equiv` + `pulsedex_events`) are **byte-identical**.
  Confirm via the `env.equiv.pulsedex` equivalence leg staying green, then **re-record only their
  producing-bundle `manifestHash`** in `FIXTURE-PROVENANCE.json` — do **not** regenerate them.
- The committed `uploads/PulseDex_*_summary.{json,csv}` that still carry `vlfNight`/`tpNight` are
  **legacy SAMPLES (pre-R1, no provenance), not code-gated fixtures** → **no GATE-B action**. They
  become harmlessly stale (HRVDex reads by header name and ignores unknown columns). Leave them; do
  not regenerate.

### Regression assertion (make the finding a permanent gate — `tests/dex-tests.js`, both runners)

The clean, durable gate is **structural** (no need for a magnitude-diff test once the proxy is gone):
- **Registry:** assert PulseDex's resolver maps **no `… (night)` label onto a `validated` entry** —
  e.g. `PulseDexRegistry.idForLabel('vlf (night)')` and `('total pwr (night)')` resolve to `null`
  (or a non-`validated` id), and `spectral` is no longer a reachable symbol.
- **Render shape:** drive `renderSummary` (or inspect `window.__summaryRows`) on a long-recording
  result and assert **no row label matches `/\(night\)/`** and every surfaced spectral row's note
  cites Lomb–Scargle.
- Source-mirror (optional): assert `pulsedex-dsp.js` no longer defines `function spectral(`.

Then: **`Dex-Test-Suite.html` all-green** + **`verify-provenance.html` GATE A 8/8 + GATE B
reproducible**.

---

## §2 · (LOW / process) The Integrator-PB render-coverage rig's cold iframe-boot watchdog hard-fails → the all-green pill is non-deterministic

**What's wrong.** On a **cold** load, `Dex-Test-Suite.html` can settle to `✕ 1 failing / 100 groups`,
and the single failing assertion is **`Render coverage — Integrator periodic breathing → DOM · bundle
loads in iframe`**. It is **not** a product defect — the audit drove the rig's exact product path
(`normalizeFile×2 → runFusion → renderAll → showView('findings')`) directly in `Integrator.html` and
**every assertion the rig would make passes** (1 corroborated PB block, conf **0.872** exact, both
observers, card + evidence badge reach `#findTable`). The red is purely an **iframe-boot watchdog
race**: `renderCoverageIntegratorPB` (`Dex-Test-Suite.html` ~line 664) is the **3rd sequential boot**
of the shared `#rig` iframe, navigating a **cold** `Integrator.html` under a fixed
`setTimeout(resolve, 9000)` watchdog (~:670); if `rig.onload` doesn't fire inside 9 s, `booted=false`
and `add(g, 'bundle loads in iframe', booted)` (~:671) reds. The **sibling** generic Integrator-
computed rig boots the *same* bundle warm and passes 9/9. A boot **timeout is inconclusive**, but is
being treated as a hard FAIL — so it reds the canonical signal every future audit/contributor relies
on. (Same timing class as `GENERIC-EMIT-GATE-FOLLOWUPS §3` / `GATE-LIVE-RUNNABILITY §4` /
`SIGNAL-ADAPTER-FOLLOWUPS-IX §3`, but those addressed rig-COUNT drift, not a persistent single-leg
hard-fail on the pill.)

**Constraint:** the harness `add(g, name, pass, detail)` (`:359`) is **boolean-only** and the summary
counts `pass:!!pass` — there is **no skip state** today.

### Fix — test-infra ONLY, NO re-bundle, no fixture change

Primary (lowest-risk, keeps teeth — do this):
- **(b) Warm first.** Guarantee `Integrator.html` boots at least once **before** `renderCoverageIntegratorPB`
  so the PB rig hits a warm HTTP cache. Either reorder so the generic Integrator-computed
  `renderCoverageApp` runs before the PB rig, or pre-fetch once (`await fetch('Integrator.html')`, or a
  throwaway warm `rig.src='Integrator.html'` load) during rig setup.
- **(a) Retry once.** Wrap the boot Promise so a watchdog timeout **retries** `rig.src='Integrator.html'`
  one time with a fresh, slightly longer watchdog (~12 s) before it is allowed to record failure. A
  single inconclusive timing event must not red the pill.

Fallback (only if timeouts still recur after (a)+(b)) — add a **real SKIP** so a persistent boot
timeout is YELLOW, not RED:
- Extend `add` to take a status (`'pass' | 'fail' | 'skip'`) or add an `addSkip(g, name, detail)`;
  count skips **separately** in `#summary` (not folded into failing) and render them yellow. On the
  retried timeout, `addSkip(g, 'bundle loads in iframe — boot timed out (inconclusive)')` and
  `return g` instead of `add(..., booted)`. The all-green pill then reflects **assertions that
  actually ran**.
- **(d) Optional isolation.** Give the PB rig a **dedicated iframe** (not the shared `#rig`) and/or a
  larger watchdog so it doesn't inherit teardown latency from the two prior heavy boots.

**Do not** weaken the assertion into an unconditional `true` — that removes the teeth. Warm+retry keeps
it a genuine boot check while removing the cold-start flake.

### Verify
Cold-load `Dex-Test-Suite.html` (hard-refresh), wait for the render-coverage rigs to finish booting
(~50 s — watch the group count stop climbing), confirm `#summary` reads **all-green**, and repeat
across **2–3 cold reloads** to prove determinism. `verify-provenance.html` is untouched (no bundle
changed).

---

## §3 · (LOW / product decision) GlucoDex renders glucose only in mg/dL — no mmol/L display path

**What's wrong (and why it's LOW).** Every GlucoDex surface — TIR 70–180, TBR <54/<70, TAR >180/250,
GMI, nocturnal-hypo <70 — is **mg/dL**, and there is **no mmol/L display toggle anywhere** (the only
mmol/L references in the codebase are the `parseCSV` unit auto-detect and the how-to-collect docs).
`CLAUDE.md`'s units mandate is "metric is the default on first load; an alternate display switch is
permissible," and for glucose the **SI unit is mmol/L** while mg/dL is US-customary — so the suite
currently defaults to (and only offers) the non-SI unit for this one field. It is **LOW / not a
correctness defect** because mg/dL is a metric-derived mass-concentration (not "imperial" like lb/ft/
°F) and the **entire CGM consensus** (Battelino 2019 TIR bands; the GMI/LBGI/HBGI/J-index constants)
is **authored in mg/dL** — so *computing* in mg/dL is correct and the numbers are right. This is a
**presentation-mandate gap**, and resolving it is a **product call** — surface it to the owner; do not
guess.

> **DECISION (2026-06-30): Option A executed — a display-only mg/dL⇄mmol/L toggle, default mg/dL. See
> the Execution log at the top of this brief.** The original either/or framing is preserved below for the record.

### Two mutually-exclusive resolutions (owner picks ONE)

**Option A — implement a read-only mmol/L ⇄ mg/dL DISPLAY switch (mandate-compliant).**
- **Compute stays mg/dL** — internal storage, all formulas, and every fixture are unchanged (correct
  per the consensus/constants). Convert **only at the render boundary**: `mmol/L = mg/dL ÷ 18.018`
  (`MGDL_PER_MMOL` already exists at `glucodex-dsp.js:17`; `quantity.js` already canonicalizes glucose
  to mmol/L with `÷18.0182`). No `parseCSV`/analyze/`buildNodeExport`/fixture change.
- **Default:** the letter of the mandate is **mmol/L default, mg/dL as the switch**. Flag the tension
  explicitly before building: the whole UI + every threshold **label/band** is mg/dL-native, so a
  mmol/L default means re-expressing them (TIR 3.9–10.0, TBR <3.0/<3.9, TAR >10.0/13.9, etc.). That is
  real display work — **scope it with the owner**, who may prefer the pragmatic clinical reading
  (mg/dL default + mmol/L toggle). Get the default decided in writing before starting.
- **Gate:** display-only. GlucoDex `manifestHash` `267987038e2f`→new; `buildHash` may move **iff** a
  `.src.html` `<style>`/markup toggle is added (verify — if the toggle is pure external-JS + inline
  style, buildHash `ebb3b3ab196a` stays). compute/export/fixtures untouched → GATE B **re-record
  manifestHash only, no regeneration**. Add a small unit-conversion display test (both runners).

**Option B — record the exception, no code.**
- Add an explicit **mg/dL-canonical CGM carve-out** to `CLAUDE.md §Units`: glucose is stored,
  computed, **and displayed** in mg/dL because the CGM consensus + all glycemic constants are authored
  there, and mg/dL is a metric-derived mass-concentration, not an imperial unit. This closes the
  finding as *intentional*. Cheapest; leaves the suite offering only the non-SI unit for the one field
  whose SI unit (mmol/L) is in routine clinical use outside the US.

**Recommendation:** take it to the owner. If they want mandate-compliance → **Option A** with the
default explicitly chosen. Do **not** implement A without that call, and do **not** silently pick a
default.

---

## Acceptance (any PR off this brief)
- [x] **§1 done:** the two `(night)` rows + `spectral()` + the two `(night)` registry aliases removed;
      edited `pulsedex-*.js` (never the bundled `.html`); **PulseDex re-bundled**; `BUILD-MANIFEST.json`
      PulseDex `manifestHash` updated (off `1a8b99cf8a4c`), `buildHash` `17ee0d96c509` unchanged;
      `pulsedex_equiv` + `pulsedex_events` confirmed byte-identical and `manifestHash` re-recorded in
      `FIXTURE-PROVENANCE.json` (NOT regenerated); new structural regression assertion added.
- [x] **§2 done:** render-coverage boot watchdog made non-fatal (warm-first + retry-once, optional
      skip-state); **no re-bundle, no fixture change**; `Dex-Test-Suite.html` all-green **deterministic
      across ≥2 cold reloads**.
- [x] **§3 (Option A) done:** owner chose Option A → read-only mg/dL⇄mmol/L **display-only** toggle
      (compute stays mg/dL), **default = mg/dL** (rationale in the execution log), standardized mmol
      bands; GlucoDex re-bundled `267987038e2f→650c1738827e` (export-inert, fixture re-recorded);
      regression group added; both modes verified in-page. Deferred target-INPUT conversion → followups.
- [x] **Both gates green:** `Dex-Test-Suite.html` all-green · `verify-provenance.html` GATE A 8/8 +
      GATE B reproducible. Clock Contract untouched; no new unbadged metric; no cross-node runtime
      dependency added; the `ganglior.node-export` / `ganglior_events` schema preserved.
- [x] **Lifecycle:** on completion flip this brief's header to `Status: DONE — <date>` (filename
      frozen), sync the `DOCS-INDEX.md` row, and either spawn
      `DEEP-AUDIT-FIXES-FOLLOWUPS-2026-06-30-BRIEF.md` with any residue discovered during execution or
      state "no residue" in the header. Mark `SIGNAL-ADAPTER-AND-FRONTIER §622` closed.
