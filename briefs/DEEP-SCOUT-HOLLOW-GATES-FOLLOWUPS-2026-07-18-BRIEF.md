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

## §EP-rest — ecg-ppg call-site tolerances + narrow-band (7 hollow gates)

From the parent §EP (2 of 9 closed in PR #177). The other 7 are not reachable by a pure-function pin
because the constant is applied **inside `analyze`**, not passed to the exported function, or the band is
leakage-limited:

- SampEn tolerance `0.2·SD` (ecg + ppg) — `sampEn(seg, m, r)` takes `r` as an arg; the `0.2` is chosen at
  the call site in `analyze`. Needs an `analyze`-level known-answer (a fuller, non-"light" equiv fixture).
- PRSA DC/AC normalization `/4` (Bauer) — computed in the analyze path; same remedy.
- EDR respiration autocorr window `[2.5,10] s` — internal to the EDR extractor in `analyze`.
- PPG DFA box range `4..16` — `ppgdex-dsp.dfaAlpha1` is reachable (mirror the ecg PR #177 pin — this one
  IS a quick close, do it first).
- PPG VLF/LF band edge `0.04 Hz` — the VLF band (0.003–0.04) is too narrow for a clean single-tone RR
  probe (leakage swamps it); needs a longer synthetic record or a direct band-integral unit test.
- composite per-beat SQI weights (`0.30·kSQI + …`) — `beatConfidence` is exported; a weight-sensitive
  known-answer is feasible but needs a hand-built peaks/sqi vector that isolates one weight.

**Action:** close the PPG-DFA one now (quick, mirrors PR #177); build one `analyze`-level ECG fixture that
exercises SampEn/PRSA/EDR for the rest.

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
