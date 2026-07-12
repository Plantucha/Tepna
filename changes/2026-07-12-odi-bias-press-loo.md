<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---
Replace odi-bias's O(n²) leave-one-out refit with the O(n) PRESS closed form — same numbers, and the 2,500-night `SYNTH_CAP` is gone.

`looRMSE` refit the model once per held-out point: **O(n²)**, plus two fresh (n−1)-length arrays per
iteration. For ordinary least squares that refit is unnecessary — the leave-one-out residual has a
closed form, the PRESS statistic:

```
e_(k) = e_k / (1 − h_k),      h_k = 1/n + (x_k − x̄)² / Sxx
```

where `e_k` is the residual of the SINGLE full fit and `h_k` is that point's leverage. `powerFit` is
just OLS on log-log, so the identity applies there too — with the wrinkle that its `{x>0.5 && y>0.5}`
subset means points OUTSIDE the subset appear in NO training set, so dropping them changes nothing and
their LOO fit IS the full-subset fit; subset members get an exact O(1) downdate.

**Identical output, verified against the old refit** across `naive`/`linear`/`power` at n = 4…2500:
worst relative difference **3.4e-14** (float round-off). Measured **157× at n=2,500** and **2,387× at
n=20,000**.

**`SYNTH_CAP` lifted 2,500 → 200,000.** The old cap existed *only* because of the O(n²) recalibration —
its own comment deferred the full 20k-subject cohort (~115k nights) to "the robustness paper". That
cost is gone (~115k nights is now ~18 ms of fitting), so the full cohort is in reach here. The
remaining ceiling is a memory/draw guard, not a compute one.

Two things had to be fixed for the lifted cap to be survivable, both found by actually running it:

- **`Math.max.apply(null, bigArray)` was a latent crash, not a slowdown.** It spreads every element as
  a function ARGUMENT and blows the call stack — confirmed to throw `RangeError` at 150k elements. Five
  call sites replaced with a looping `maxOf()`.
- **Three scatter plots did `beginPath`+`arc`+`fill` PER POINT** — one full path submission per dot.
  Fine at 2.5k, seconds at 1e5 across three canvases. Now grouped by draw state (colour × alpha ×
  radius) and submitted as ONE path per group — same pixels, ~2 orders of magnitude fewer submissions.
  The `SRC_COLOR` ring on real (non-synthetic) points is preserved, batched the same way.

Also fixes a **pre-existing load-order break in `odi-bias-analysis.html`**: it loaded `oxydex-dsp.js`
without `clock.js`, so the page threw `DexClock is not defined` at `oxydex-dsp.js:171` on every load and
the OxyDex path never came up (CLAUDE.md §Clock Contract A5 requires `clock.js` before any delegating
`*-dsp.js`). Page now loads with zero console errors.

No GPU here, deliberately: this was an O(n²) that should have been O(n), and a shader would only have
papered over it. The fix works on every machine, needs no WebGPU, and stays in f64.
