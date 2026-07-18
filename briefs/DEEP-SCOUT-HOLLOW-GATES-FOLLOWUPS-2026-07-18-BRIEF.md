<!--
  DEEP-SCOUT-HOLLOW-GATES-FOLLOWUPS-2026-07-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED — 2026-07-18 · **Created:** 2026-07-18

# Deep-scout hollow gates — follow-ups (the residue that needs a HARNESS, not an assertion)

Follow-up to `DEEP-SCOUT-HOLLOW-GATES-2026-07-18-BRIEF.md` (house `-FOLLOWUPS` pattern). That wave +
its re-scout found **54** hollow gates and closed **33** with both-direction-verified assertions. The
remaining **21** are NOT one-line pins — each needs a piece of test infrastructure the node/corpus lane
does not yet have. This brief carries the three surviving classes.

## §RN — the render layer is never EXECUTED in the node lane (7 hollow gates) — **HARNESS BUILT; 3/7 DONE (PR #187)**

> **UPDATE 2026-07-18 — path (b) BUILT, the 3 HIGH gates CLOSED (PR #187).** The node-lane render-execution
> harness now loads every `*-render.js` into the existing DOM-stubbed `vm` realm (IIFE-isolated so their
> top-level `const {fmtDate,…} = window.X._bare` destructures don't collide with the shared realm; the
> `window/global` attaches still escape), plus `dex-escape.js` for `escapeHTML`, and maps `env.GluDisp` +
> `env.CpapRender` (`OxyDex`/`PulseDex.reviewView` were already exposed). The new group **'Render execution —
> surfaced-value known-answer (§RN harness)'** closes the **3 HIGH** findings by calling / driving the REAL
> render code (zero render source change), both-direction verified: `GluDisp.val(250)` mmol = **13.9**
> (÷→× → 4504.5); `reviewView` Mean-SpO₂ KPI 88→**bad**/93→**warn**/96→**ok** (a ≥85 cut paints hypoxic
> green); `renderReviewView` residual-AHI 40 → **"severe residual events"** (a <5→<50 → "well controlled").
> Node-lane only (browser runs render in iframe rigs → SKIPs). Suite 2967.
>
> **§RN WAVE 2 — 3 more closed (PR #191), §RN now 6/7.** The extraction path (ii) was taken for the three
> inline classifiers: hoisted to pure exposed functions used at their original call sites (behavior-identical
> → **compute-inert, PROVEN by the green equiv/GATE-C legs**), pinned both-direction: `PulseDex.tanakaHRmax`
> (208−0.7·age, the duplicated HRmax copy → 40:180 / 50:173; `0.7→0.9` reds), `hrvRmssdClass` (ok>35/warn>20/
> bad → 45:ok/28:warn/15:bad; `>35→>65` reds), `oxySpo2NightCV` (SD/mean·100 → (4.5,95):4.74; `·100→·10`
> reds). Re-bundled PulseDex/HRVDex/OxyDex (manifestHash moves, outputs unchanged — GATE A/B green; changeset
> `2026-07-18-render-harness-hoisted-classifiers`; **build-docs.mjs refresh of `docs/{HRVDex,OxyDex,PulseDex}
> .html` required** — the deploy drift guard reds otherwise). Suite 2983.
>
> **REMAINING §RN (1):** ecgdex canvas minute-tick (`t/60` axis label, LOW) — pure `getContext('2d')` canvas
> draw with no value seam; not worth a canvas shim. Deferred (a 2× axis label; document only).

**[original analysis, retained]** `tests/run-tests.mjs` loads every `*-render.js` **only as raw text into `env.sources`** (verified in the
`wanted[]` block, ~lines 216–286): the render modules are parsed as strings for source-grep gates, but
**never evaluated as modules**. Consequence: **no value assertion can pin any surfaced render output** in
the node/corpus gate. The only render defects that lane catches are ones that alter a literal some
source-text grep happens to check (mmol edge labels, the `_GLU_MMOL` constant, badge-CSS parity,
null-safety regexes). The re-scout planted 7 defects across all 6 render modules — **all shipped green**,
including three severe surfaced-value breaks (a ~325× mmol glucose error, a hypoxic 88 % SpO₂ painted
green, "well controlled" text on a severe AHI 40). Full table in the parent brief §RN.

**This is a coverage-architecture gap, not 7 bugs.** Two ways to close it — pick one:

- **(a) Wire the browser render-coverage lane into the merge/CI gate.** `Dex-Test-Suite.html?full` already
  boots real app bundles in iframes and drives the renderers (CLAUDE.md §🧪); today it is **on-demand /
  lazy** and NOT part of the headless CI floor. The gap is that render assertions there must actually pin
  **surfaced values** (a wrong-unit glucose, a mis-colored KPI), not just "the rig booted". Requires a
  headless browser in CI (the lane currently SKIPs the directory-listing gates in Node).
- **(b) A node-lane render-execution harness.** Instantiate each render builder against a stub DOM
  (a minimal `document`/element shim) and pin the values it writes — e.g. `GluDisp.val(250)` in mmol mode
  == 13.9, the mean-SpO₂ KPI class at 88 % == `'bad'`, the residual-AHI band at 40 == `'severe'`. This
  keeps everything in the fast Node lane but is real shim work (the render modules touch `document`,
  canvas, and app globals). **Recommended** for the pure-value functions (unit conversions, threshold
  classifiers, hero-number math); leave genuine canvas/SVG drawing to lane (a).

Either way, once render output is executable-and-asserted, the 7 findings become ordinary both-direction
pins. Until then they are **real, shipped, and uncaught** — the highest-severity residue in the whole
wave (patient-facing wrong numbers), so this §RN is the priority.

## §EP-rest — ecg-ppg call-site tolerances + narrow-band — **6/9 DONE; 3 fixture-blocked**

From the parent §EP. **CLOSED:** PR #177 (ECG LF/HF 0.15 + ECG DFA 4..16), PR #193 (PPG DFA 4..16), PR #197
(**PRSA DC/AC + SampEn** — driven through the FULL `ECGDSP.analyze` on a deterministic `genSynthetic` ECG;
DC 7.35 / AC −7.16 seed 20260601, SampEn 0.562 seed 42 chosen because `0.2·SD` is tolerance-sensitive on
that segment), PR #198 (**PPG VLF/LF 0.04** — a clean 0.045 Hz tone over 800 beats resolves the band with no
leakage; the "narrow-band" deferral was wrong).

**REMAINING (3) — each ATTEMPTED and genuinely fixture-blocked (not deferred for convenience):**
- **EDR respiration autocorr window `[2.5,10] s`** — the surfaced `respRate` is the RR-interval RSA
  (spectral HF peak / `_respMedian`), which `genSynthetic` fixes at `respHz0 = 0.235` (~14/min). Post-
  modulating the waveform **amplitude** at 7/min does NOT move it (verified: 14.2→14.5 even at 90 %
  modulation over 1200 s) — the EDR path reads amplitude but the SURFACED resp tracks the RR-interval RSA,
  which amplitude editing can't reach. Needs a **slow-respiration ECG synthesizer** (patch `respHz0`, or a
  from-scratch QRS train with RR-modulated RSA at ~7/min).
- **composite per-beat SQI weights (`0.30·kSQI + …`)** — the weight only matters for beats near the SQI
  threshold; `genSynthetic` (even `scenario:'ambulatory'`) produces beats at `sqi≈1`, so a `0.30→0.50`
  slip moves no surfaced metric (verified: analyzablePct 100→100, correctionRate 0.7→0.7, meanSQI
  0.998→0.999). Needs a **borderline-SQI waveform generator** (many beats engineered to sit at ~0.3).
- **PPG SampEn default tol `r = 0.2·SD`** (LOW) — a default-arg on the internal `sampEn`; same
  analyze-level reachability problem as the ECG SampEn but without a tolerance-sensitive synthetic found.

Each is a bespoke synthetic-signal generator for a single MED/LOW gate — real diminishing returns versus
a slow-resp/borderline-SQI ECG fixture that would also serve other future coverage.

## §AD — adapters (7 hollow gates) — **4/7 DONE (PR #195); no rig needed after all**

From the parent §AD. **The premise that this needed an off-suite rig was wrong for 4 of the 7** — they are
reachable through functions already co-loaded in the suite realm: `NSRR.edfToOxyRows({signals})` drives the
internal `to1Hz`, and `resmed-edf.groupSessionSets([names])` is a pure name-list function
(`env.SignalAdapters.byId('resmed-edf')`). **CLOSED (PR #195), both-direction verified:** to1Hz valid
window INCLUSIVE at the top (SpO₂ 100 % kept; `<=→<` → 95) and bottom (40 % kept; `>=→>` → 55) — the
existing legs used interior 95/96/98; the 1 Hz length FLOORs a partial trailing second (n=5/fs=2 → 2 rows;
`floor→ceil` → 3) — the existing legs used even n/fs; and the ResMed session window is INCLUSIVE at ±60 s
(two EVE/CSL streams 60 s apart → 1 set; `<=60→<60` → 2). Suite 2991.

**REMAINING §AD (3):** these DO need a real EDF buffer (they run inside `analyzeRecord` / the adapter's
frame-build, gated on `CpapEdf.readEDF`): `nsrr-adapter` ODI-4 × **1.1** AHI surrogate, `resmed-edf` BRP
Flow default **fs = 25 Hz**, and the seeded-fallback-baseline branch (partly covered — the 97 % normoxic
default is already pinned by finding #97). A small EDF-buffer fixture would close the first two.

## Done when

§RN is closed by whichever lane (a)/(b) is chosen AND its 7 findings become asserted pins; §EP-rest and
§AD each have their harness + both-direction pins (or are explicitly dispositioned). Each lands as its own
gated PR. When all three classes are closed, flip the parent brief to `DONE`.
