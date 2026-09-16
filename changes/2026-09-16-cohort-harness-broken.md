---
bump: patch
type: added
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

`cohort-harness.html` has been throwing on every node it supports for two months, and the pages that
use it report success.

Chasing why `rmssd-equivalence` produced one of three Bland–Altman pairs led here. The harness loads
node DSPs as **classic** scripts via `createElement('script')`:

```js
pulsedex: ['kernel-constants.js', 'clock.js', 'pulsedex-dsp.js']
```

The ESM migration appended bare module re-exports to all three DSPs — `pulsedex-dsp.js:1737`,
`oxydex-dsp.js:8119`, `glucodex-dsp.js:2236-2237` — which a classic script cannot parse.
`build-analysis.mjs` strips these with `DexBuild.classicify` when it *inlines* a source; the harness
loads the file **raw** and gets no such treatment.

**The dates are the proof, not an inference.** The export lines landed in `7d8d3b6d` (2026-07-16,
*"refactor(pulsedex): migrate to ES modules"*); the harness was last touched in `7f9998c2`
(2026-07-13) — **three days earlier**.

## The failure is silent, and the page reports 100 %

Measured on `qrs-equiv-analysis.html` at `nSubj: 6`: the realm boots, status reaches *"rendering … 4
realms"*, every `callPdx` returns without a score, and the page proceeds to *"analyzing 9 windows —
100 %"* and publishes a result object. Two of three pairs are simply **absent** from it, and
`patJitterSdMs` reports its fallback `0`.

Nothing in the status, the result, or the exit code says a realm died. That is what let me report this
paper as reproducing last tick.

## What is NOT established

Consumers are `qrs-equiv`, `cgm-hrv-coupling`, `treatment-response`, `cohort-regression` and
`cohort-runner` — three of the six paper tools. **Whether each is affected is not established
per-tool.** `cgm-hrv-coupling` reproduced its published values *exactly*, which admits two readings
this row deliberately does not choose between: it does not depend on the broken path, or **its
published numbers were themselves produced after 2026-07-16 and embed the same defect**. Which one it
is gates any re-cut of those papers.

**No remedy applied.** The load path needs classicified sources — either give `build-analysis.mjs`
ownership of `cohort-harness.html`, or strip on load — and that is a shared-surface change owed a
deliberate unit. A tripwire is owed with it: **the harness should refuse rather than serve nulls** when
a node fails to initialise.

Filed as `2026-09-16-cohort-harness-broken-since-esm`.
