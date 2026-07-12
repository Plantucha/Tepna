<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [suite]
brief: none
---
Add `sensor-trio-gpu.js` — a WebGPU fast lane for the sensor-trio Monte-Carlo power sweep, with the existing Web-Worker CPU pool as the automatic fallback.

The sweep is Monte-Carlo over INDEPENDENT window-draws, so the whole grid is one compute dispatch:
**one GPU thread per window**. Each thread carries its own RNG and AR(1) states, walks the window's
samples, and Welford-accumulates the variance of the three pairwise difference series on the fly — so
nothing of length `winSec` is ever materialised. A thread emits three f32 σ (or a −1 sentinel on a
non-positive variance); the across-window median and the negative-variance tally stay on the CPU,
where they are O(N) over a handful of windows.

**Measured on a 6-core box + RX 7900 XT (RDNA-3), in the real page:**

| trials | window-draws | CPU worker pool | WebGPU | speedup |
|---|---|---|---|---|
| 500 (page default) | 62,000 | 13.6 s | **0.50 s** | 27× |
| 2,000 | 242,000 | 38.8 s | **0.50 s** | 77× |
| 50,000 (the UI's own ceiling) | 6,050,000 | ~16 min | **2.7 s** | **365×** |

At 2.28M window-draws/s the 50,000-trial ceiling stops being a "leave it running" job.

**The CPU pool is the automatic fallback and is otherwise untouched.** `TrioGPU.init()` resolves
false when `navigator.gpu` is missing, no adapter is granted, the WGSL fails to compile, or a smoke
test does not recover the planted σ — and the page then behaves exactly as before (verified: plain
headless Chrome reports "no WebGPU adapter granted", boots 6 worker realms, and reproduces the
reference σ). A RESUMED checkpoint always continues on the CPU pool that produced it, because the two
lanes seed differently and their trials must not be mixed inside one sweep. The GPU lane fills the
SAME accumulators the pool fills, so finalize/render/CSV export are shared verbatim.

**Chosen over a native/Python+ROCm tool deliberately.** The suite is HTML/JS and zero-install; WebGPU
ships in Chrome/Edge (including Windows) with no driver toolkit, no Python and no native module,
whereas an AMD-GPU torch stack barely exists on Windows. `sensor-trio-power-analysis.html` is not a
bundle, so this adds no signal processing to any bundle, moves no `manifestHash`, and touches no fixture.

**FIDELITY — what is identical, and what deliberately is not.** Identical: the planted device truth
(`DEV` / `SD_H_*`), the generative model, and the TCH estimator. NOT identical: the RNG. The worker
seeds ONCE PER TRIAL and draws its N windows sequentially from one xorshift32 stream — inherently
serial, since window *w*'s draws depend on every draw window *w−1* consumed, so a GPU thread cannot
know where in the stream it starts. The GPU seeds PER WINDOW from a hash of
(stream, N, trial, windowIndex). The model is Gaussian → the SAME statistical model, not the same
bytes. Validated by two-sample KS against the shipped worker: the JS-vs-GPU KS distance lands INSIDE
the JS-vs-JS null band (verity median D 0.085 vs a JS-vs-JS band of 0.075–0.140), i.e. within the
reference's own sampling noise. **Treat a GPU run and a CPU run as two independent Monte-Carlo
samples, never as byte-for-byte reproductions of each other** — the CPU pool remains bit-reproducible
on its own terms. End-to-end in-page agreement: worst |GPU−CPU| σ̂ = 0.009 bpm across all six
regime×device cells at N=8, well inside MC noise. WGSL has no f64, so the shader is f32 against the
JS f64; that 0.009 bpm bound is the empirical answer to the precision question (the TCH combination is
not catastrophically cancelling, and f32 error ~1e-6 relative sits far under MC noise ~1e-2).

**The trend term is OMITTED from the shader, and that is exact — not an approximation.** `genWindow`
adds the SAME `trend[i]` to all three devices and TCH consumes only pairwise DIFFERENCES, so the trend
cancels algebraically in full. Verified: adding an arbitrary large common trend to all three series
moves σ̂ by **2.2e-16 bpm**. Omitting it also keeps the f32 arithmetic away from the ~100-bpm-magnitude
cancellation the trend would otherwise force. ⚠️ Valid ONLY while all three devices share one common
trend — if the model ever gives devices different trends, the shader must generate it again.

Two findings surfaced while porting, both left AS-IS (this change alters no science) and worth a
follow-up in the analysis page itself:

- **The regime distinction is thinner than it looks.** Because the trend cancels, the ONLY thing
  separating "dynamic" from "resting" in the estimator is `sdH` (the shared-HRV amplitude). The
  exercise ramp/decay shape contributes nothing to σ̂ — it should not be read as "exercise vs rest".
- **`exportCsv` asks `minN` for a target of 1.0, which is not in `TARGETS` ([0.5, 0.25, 0.15]).** The
  `dyn_to_1.0` / `rest_to_1.0` columns therefore come out EMPTY in every shipped export, while the
  0.25 and 0.15 targets that ARE computed are never exported.

Also adds `window.__trioResult()` / `window.__trioLane()` — headless read-back hooks (siblings of the
existing `__trioRunSync` / `__fig*`) so an automated run can verify EITHER lane without scraping the DOM.
