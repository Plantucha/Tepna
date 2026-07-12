<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-12 · **Created:** 2026-07-12

# `Uncaught ReferenceError: cadenceSamples is not defined` — the PPG worker pool has been dead

Reported from the live demo console. It is a real regression, and the failure mode is why nothing caught it.

## What broke

The PPG detection worker is a `blob:` URL minted from an **inlined source string**: the deps are
re-declared from their own `Function.toString()` (one source of truth — no algorithm duplicated as a
string literal). But that `deps` array is **hand-maintained**, and **the worker realm starts empty**.

`PPGDEX-OPTICAL-DETECTOR-AND-SIGMA-REDERIVE` §1 gave `detectBeats` an adaptive refractory, sourced from
a new `cadenceSamples()` function and a new `REFR_CADENCE_FRAC` constant. **Neither was added to the
worker source.** So on every PPG detection the worker threw
`ReferenceError: cadenceSamples is not defined`.

## Why it went unnoticed — the numbers never moved

`w.onerror = serialFallback`. The worker died, detection fell back to the **serial path**, and the
results stayed **exactly right**. So:

- **no gate failed** — the equiv/headless legs run `analyze()`/`compute()`, which are synchronous and
  serial by design (*"analyze()/compute() stay SYNCHRONOUS + serial (the gated numeric truth); only the
  live APP awaits this"*). **The gates never touch the worker at all.**
- the only symptom was an **uncaught error in the browser console**, plus a silent performance
  regression: **all three LED channels detected on the main thread**, which is the exact thing the
  worker pool exists to prevent.

A correctness-preserving failure that only degrades performance and only in the live app is close to the
worst case for detection — it is invisible to every gate the repo has.

## The fix

`cadenceSamples` added to `deps`, and a **`consts` map** added to the worker source builder. That second
half matters: a module-level `const` **does not travel with `Function.toString()`** — so even once every
*function* was shipped, the worker still threw `REFR_CADENCE_FRAC is not defined`. **A static call-graph
check alone did not see that; only actually running the worker realm did.** The const's *value* is read
from the live module, never retyped, so it stays single-sourced.

**Verified worker ≡ serial** on 3 real captures × 3 LED channels (9/9): peaks, feet and sign all
byte-identical. The contract — *"workers change WHEN the work runs, never WHAT it computes"* — now
actually holds, where before it held only because the worker never ran.

## The gate

New group **`PpgDex worker source is CLOSED — every function + const it references is shipped to the
blob`** (`ppgdex-dsp · worker · regression`). It re-derives the closure from the DSP's **own source
text**: every module-level function *or const* that worker-shipped code references must itself be
shipped. Verified against `origin/main` — it reds and names **both** missing symbols:

```
✕ worker source is CLOSED: nothing it references is left undefined in the blob realm
  — got ["cadenceSamples (function, referenced by detectBeats)",
         "REFR_CADENCE_FRAC (const, referenced by detectBeats)"] · want []
```

It is the fleet's only hand-maintained worker deps list (`grep "var deps=\["` → one hit), so the gate
covers the whole exposure.

## Gate impact

`ppgdex-dsp.js` → rebuild **PpgDex · OverDex · Data Unifier**. Only `PpgDex.html`'s `manifestHash` moved
(`6db91cdf4e81` → `905afc5afca8`); **no fixture OUTPUT moved** — the gated path was always the serial one,
and worker ≡ serial, so `FIXTURE-PROVENANCE.json`'s diff is `manifestHash` lines only.

## Follow-up

The deeper lesson is that **the worker path has no gate at all**. This one is now closed *statically*, but
nothing yet asserts that the worker and serial paths agree *dynamically* — that check exists only as the
throwaway script used here. A browser-lane rig that runs `detectChannelsAsync` and diffs it against
`_detectSerial` would close the class, not just this instance. Filed in the follow-up brief.

## Gates
Suite **2159/2159 (138 groups)** · GATE A **8/8** · GATE B **23/23** · `build --check` clean ·
shard-union sound · biome clean.
