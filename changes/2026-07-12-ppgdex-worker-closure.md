<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [ppgdex]
brief: PPGDEX-WORKER-CLOSURE-2026-07-12-BRIEF.md
---
Fix `Uncaught ReferenceError: cadenceSamples is not defined` — the PPG worker pool has been dead, and no gate could see it.

The PPG detection worker is a `blob:` URL built from an inlined source string, with its deps re-declared
from their own `Function.toString()`. That deps array is **hand-maintained**, and the worker realm starts
**empty**. The optical-detector fix gave `detectBeats` an adaptive refractory sourced from a new
`cadenceSamples()` and a new `REFR_CADENCE_FRAC` constant — **neither was shipped to the worker**. Every PPG
detection threw inside the worker.

**Why nothing caught it:** `w.onerror` falls back to the serial path, so the numbers stayed exactly right.
The equiv/headless gates run `analyze()`/`compute()`, which are synchronous and serial *by design* — **they
never touch the worker at all**. The only symptoms were an uncaught console error and a silent perf
regression: all three LED channels detected on the main thread, which is precisely what the worker pool
exists to prevent.

**The fix** ships `cadenceSamples`, plus a new `consts` map — because a module-level `const` **does not
travel with `Function.toString()`**, so even after every *function* was shipped the worker still threw
`REFR_CADENCE_FRAC is not defined`. A static call-graph check alone did not find that; only running the
worker realm did. Verified **worker ≡ serial on 3 real captures × 3 LED channels (9/9)** — peaks, feet and
sign byte-identical. The contract ("workers change WHEN the work runs, never WHAT it computes") now actually
holds, where before it held only because the worker never ran.

**New gate:** `PpgDex worker source is CLOSED` re-derives the closure from the DSP's own source text — every
module-level function *or const* that worker-shipped code references must itself be shipped. Verified to red
against `origin/main`, naming both missing symbols. It is the fleet's only hand-maintained worker deps list.

Only `PpgDex.html`'s `manifestHash` moved (`6db91cdf4e81` → `905afc5afca8`); **no fixture output moved** (the
gated path was always serial, and worker ≡ serial).
