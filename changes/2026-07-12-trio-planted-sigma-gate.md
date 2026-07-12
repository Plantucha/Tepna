<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [tests, tools]
brief: TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md
---
Pin the trio's planted σ across its three copies — a silent desync had the tool REPORTING one truth while SIMULATING another.

Attempting §181 (the N=10→15 power re-run) surfaced two things worth shipping on their own. **The σ re-fit
itself is NOT landed** — the planted σ and the paper's Tables 1–3 are one atomic unit (those tables *are*
the Monte-Carlo at that σ), and the tables cannot be regenerated at the paper's stated trial count on this
machine. Change both, or neither.

- **The planted σ is TRIPLICATED and was ungated.** It lives in `sensor-trio-power-analysis.js` (page),
  `sensor-trio-worker.js` (CPU) and `sensor-trio-gpu.js` (WebGPU) — the worker's own comment says *"MUST
  match sensor-trio-power-analysis.js DEV"* and **nothing enforced it**. It bit during the attempt: a stale
  cached copy left the page on one hat and the worker on another, and the tool **reported planted σ =
  2.72/1.86/1.94 while simulating at 2.60/1.58/1.85**, producing a plausible-looking, wrong min-N table. It
  even briefly looked like the GPU lane disagreed with the CPU lane — **it does not**; on a clean origin the
  two are bit-for-bit identical. New gate `Trio planted σ is single-valued` pins page ≡ CPU ≡ GPU to the
  value the published tables were computed at; verified to red on a one-file drift.
- **`Storage hygiene` was under-claiming.** Wiring the analysis sources in tripped *"striopwr_lock … no
  un-erasable data"* — a **false positive**: those keys ARE erasable, they live in
  `DexForget.ANALYSIS_KEYS` (the standalone-research-page tier), and `eraseAll()` wipes both tiers. The
  assertion only tested `LOCAL_KEYS`, correct only while `env.sources` held Dex apps exclusively. It now
  tests the **union** — which is what `eraseAll()` actually removes, and therefore what "no un-erasable
  data" actually means.

Measured but NOT landed (see the brief): the 15-night hat is **2.60 / 1.58 / 1.85** (vs the published
2.72 / 1.86 / 1.94), and at 500 trials it moves two cells of the deliverable — H10 ±0.25 goes 1 → 2 windows
(a quieter corner needs MORE windows, because the TCH couples them) and Verity ±0.15 goes 3 → 2. Those are
**indicative only**: the paper's Table 1 says 50,000 trials, its abstract says 720, and the tool defaults to
500. A 50k/100k re-run does not complete here — the WebGPU lane accelerates only the N-sweep, while the
ρ/duration sweeps are CPU-bound (at 100k the ETA advanced 1 minute in 25 minutes of wall clock).

Gates only — no runtime file touched, no `manifestHash` moved, no fixture re-recorded.
