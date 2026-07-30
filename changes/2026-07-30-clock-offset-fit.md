<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator, suite]
brief: CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md
---
The Integrator now **fits** a wrong device clock to seconds and **names which sensor found it**, instead of quoting a 30 s scan grid as if it were a measurement.

**Why.** `detectClockSkew` scans a 30 s grid with a ±60 s match window, so its lag cannot honestly be quoted finer — reporting its peak as "the offset" states the INSTRUMENT's resolution as the DATA's. On the reference corpus the deltas locate far tighter: four sensors agreed within **12 s**, and the value moved from 39.5 to **38.28 min** once the oximeter's own ~1.5 min detection lag stopped being counted as clock error.

**Added** (`integrator-dsp.js`, pure, exported): `deltaModeSec` · `refineLagByDeltaMode` · `fitClockOffset`. `runFusion` publishes `clockSkew.fits[node]`; `integrator-app.js` renders it; `tools/trio-batch.mjs --cpap <DATALOG>` prints it per night.

**Every device, every channel.** Each partner node is split BY IMPULSE, so a contribution is attributable to a sensor AND a mechanism. On one real night: `ECGDex/autonomic_surge` 38.00, `PpgDex/motion_artifact_segment` 38.17 → **38.08 min, agree within 10 s**, while `OxyDex/desat_event` was consulted and *rejected* for instability — shown with its reason, not dropped.

**Three design decisions that were wrong first and are now measured:**

- **Agreement, not an average.** A median over every channel that clears the floor gave per-night answers from **−45 to +60 min** with 7000 s "spreads": sleep-STATE impulses (`stage_light`, …) are night-long segments that clear a peak-over-floor test at arbitrary lags. Estimates are now **clustered**, and the cluster supported by the most **distinct nodes** wins — five channels of one device share that device's faults, two unrelated devices do not.
- **A data-driven stability gate, not an impulse allow-list.** What separates a real arousal marker from a chance alignment is not its NAME but whether its mode survives resampling. Channels whose bootstrap CI exceeds `maxCiSec` (300 s) are rejected — which generalises to sensors this code has never seen, the whole point if the offset is to be measurable on someone else's hardware.
- **`minPairs` 25 → 10.** Tuned on the pooled corpus, 25 can never be met by a single night's ~15–50 apneas, so every channel reported "too few pairs" — a gate that silently rejected the use case it was built for.

**Degrades by design.** Any subset of sensors works; a channel that cannot contribute is **retained with its reason**, because an absent contributor is information — the silent-zero class this suite keeps finding. No partner at all reports `null`, never a fabricated number. `confident` requires ≥2 distinct devices, so an uncorroborated fit is visibly marked and nothing applies it.

**Determinism.** The bootstrap uses a PRNG seeded from the sample, not `Math.random` — a CI that moves on re-run would make every fixture carrying one non-deterministic.

**Tests** — 24 assertions: the tie rule (a smoothed maximum is a PLATEAU, and a bare argmax returns whichever edge the iterator reached first — the exact move that once promoted a tied −72.5 min to a "finding"); a planted offset recovered within 15 s; the degradation ladder (two channels → confident; one → not, with reason; none → null); an unusable channel kept and not poisoning the answer; a wildly-wrong channel outvoted **and named** as a dissenter; and CI reproducibility on both bounds.

Re-bundled Integrator (`34cc8dec37a5` → `54fdf771e1b4`) + OverDex, which inlines `integrator-dsp.js`. Gates: suite **4420 passed** / 12 skipped · `build --check` clean (11 owned) · GATE A 9/9 · GATE B 13 reproducible · docs current.
