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

## §RN — the render layer is never EXECUTED in the node lane (7 hollow gates) — the big one

`tests/run-tests.mjs` loads every `*-render.js` **only as raw text into `env.sources`** (verified in the
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

## §AD — adapters (7 hollow gates) — needs an off-suite adapter harness

From the parent §AD. The `nsrr-adapter` / `resmed-edf` window-edge and unit findings live at the
raw→SignalFrame boundary, which the current suite does not drive with a synthetic frame. **Action:** add a
small adapter-level rig (feed a hand-built NSRR/ResMed record → assert the SignalFrame + the ODI-surrogate
/ session-cluster / fs-default at the edges). Table in the parent §AD.

## Done when

§RN is closed by whichever lane (a)/(b) is chosen AND its 7 findings become asserted pins; §EP-rest and
§AD each have their harness + both-direction pins (or are explicitly dispositioned). Each lands as its own
gated PR. When all three classes are closed, flip the parent brief to `DONE`.
