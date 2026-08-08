<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-08 · **Created:** 2026-08-08

# The shipped three-cornered hat spent a drawn-axis leg — and the guard was dead

`ppgdex-dsp.js:442` warns, in code, that a consumer spending a node export as a clock leg —
"closure, three-cornered hat and PAT — must read `timingSource` first", and that all three "silently
accept such a leg today and measure a constant." This closes the parts of that warning that were still
true in the shipped runtime.

## 1 · What was actually broken (proven, not inferred)

A runtime repro against the real modules (`adaptEnvelopeNode` → `fuseHRVConsensus`, 3 nodes, one with
top-level `timingSource:'none'`) showed the drawn leg **included as a full TCH corner**, with
`rec.timingSource === undefined`. Two independent defects:

1. **`fitClockClosure` is tool-only.** It has the §F3 drawn-axis filter, but it is *exported and never
   called inside the app* — its callers are `tools/tch-*.{mjs,js}` and tests. The shipped app path is
   `fuseHRVConsensus → _tchHat`, and `_tchHat` filtered only on series length. So the one function with
   the guard isn't in the app; the app's function had none.
2. **`timingSource` was never plumbed onto the fusion rec.** ppgdex exports it at the export top level
   (`ppgdex-dsp.js:3333`), but `adaptEnvelopeNode` extracted it nowhere. So even closure's §F3 filter —
   `s.timingSource === 'none'` — read `undefined` on every real source and kept every leg. **The guard
   was dead in production**, not merely missing from `_tchHat`. This is the sharper half of the finding:
   the code *looked* guarded and wasn't.

This is the exact `CLOCK-CLOSURE-THREE-SOURCE` failure ("six nights, all legs confident") and the one
`O2RING-SYNTHESISED-AXIS` retracted two of three pairs over: a drawn axis contributes a constant, both
its pairs faithfully measure a fiction, and the estimator returns a confident number about nothing.

## 2 · The fix

- **Plumb it:** `adaptEnvelopeNode` now carries `timingSource` onto the rec (export top-level, falling
  back to `hostAxis.timingSource` for a raw export). Without this, any downstream guard is theatre.
- **Guard the shipped hat:** `_tchHat` excludes `timingSource:'none'` legs before forming the triple,
  mirroring §F3, and surfaces an `excluded` list on both the degraded and the ok return.
- `null`/omitted stays usable, so every existing fixture is byte-unchanged — GATE B confirms
  `integrator_tch_golden` still reproducible; no fixture output moved.

Verified by a test that **bites**: with the filter neutralised, the drawn leg is spent (`status=ok`);
with the fix, TCH degrades to `<3 timed corners` naming the excluded node. A control (the same triple
fully timed) still forms the hat, so the guard is specific to drawn axes.

## 3 · PAT — vulnerable, but deliberately NOT patched here (untestable as-is)

- **`pat-gate.js`** needs no change: it verdicts on already-computed overlap/coupling/shared-clock
  summaries and already has a `NOT SIMULTANEOUS` leg.
- **`pat-feasibility-worker.js` IS vulnerable.** `ppgFootTimes` builds absolute foot times from
  `rec.relSec`; on a drawn axis that is `index/fs`, a fabricated timebase. It reads **no**
  `timingSource`, and its `sharedClock` test only checks `dT0 ≤ 5 s` and beat-count agreement — a drawn
  axis passes both (it keeps the phone `t0` and the right beat count). `parsePPG` *does* expose
  `rec.hostAxis.timingSource`, so the guard would be a clean two lines.

  **Why not now:** the worker's functions (`ppgFootTimes`, `coupledPAT`, `sharedClock`) are loaded in
  **no test lane** — `dex-tests.js:12549` records that this math "was NEVER run by tests" and was
  progressively *extracted* into testable modules (`pat-align.js`, `pat-gate.js`). Adding a guard to the
  worker would be untested — the "a passing gate that exercises nothing" failure this project rejects.
  The correct sequencing is to guard at the extraction point when `ppgFootTimes`/`coupledPAT` are pulled
  into a testable module, or extract them for this purpose. Recorded here with the evidence so it is a
  visible decision, not an omission.

## 4 · Scope / verification

`integrator-dsp.js` is inlined into `Integrator.html` (provenance-gated) and `OverDex.html`
(orchestrator); both re-bundled, plus `docs/Integrator.html`. Full node suite **6021 assertions green**;
GATE A (9 bundles) + GATE B pass; `build:check` / `verify:docs` / `typecheck` / pinned `biome ci` clean;
`release-ledger` check 7 satisfied.
