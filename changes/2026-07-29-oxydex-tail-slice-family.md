<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [OxyDex]
brief: DEEP-AUDIT-FOLLOWUPS-2026-07-12-BRIEF.md
---
Executes `DEEP-AUDIT-FOLLOWUPS` **§C1**, parked 17 days on "needs the gitignored real corpus". Four surfaced OxyDex metrics reported on the **last 30–60 minutes** of a 6–10 h night. The section listed them as "**not** proven to move a surfaced number" — which is why they sat in the follow-up rather than the parent audit. Measured, they move a great deal.

**The measurement.** Over **76 real O2Ring nights** (the corpus has grown from the 39 the brief assumed), sliding the window end across each night and reading back what the export publishes. The shipped function is its own probe — `f(rows.slice(0, k))` reports on the window ending at *k* — so nothing under test was modified to obtain this:

| metric | median swing | relative | nights whose published **label** flips |
|---|---|---|---|
| `spo2Ac1` | 0.061 | 6 % | **70 / 76** |
| `hrLfHf` | 99 | **308 %** | 64 / 76 |
| `respRateBpm` | 10.1 bpm | 87 % | **76 / 76** |
| `crossCorrLag` | 120 s | 187 % | 75 / 76 |

`crossCorrLag`'s swing is the **entire** 0–120 s search range — a reported "lag" that can be anything the search permits is not a measurement of coupling. `respRateBpm` changed its published label (`Slow (<10)` / `Normal (10-20)` / `Fast (>20)`) on **every single night in the corpus**. The published number was an artifact of where the recording happened to stop.

**Two fixes, because these are two kinds of quantity.** `spo2Ac1` is GLOBAL — lag-1 autocorrelation is defined over the whole series and costs O(n), so the 3600-sample cap bought nothing; it is now whole-record. The other three are LOCAL: an LF/HF ratio, a respiratory rate and a coupling lag are only meaningful where the signal is stationary, which a whole night is not (the Task-Force HRV convention is 5-min windows for exactly this reason). Computing them whole-record would have traded an arbitrary window for a meaningless one, so each keeps its **original kernel unchanged**, now scoped to one 30-min window, and is reduced across the night by **median** — the robust-median shape PpgDex already uses for `sdnnRobust` and ECGDex for `epochMedian5min`. Keeping the kernels intact means the per-window physics is exactly what it always was; only the choice of which window to publish changed, which was the defect.

All four now **disclose** their basis (`basis`, plus `windowsUsed` on the three windowed ones) — the other half of what §C1 asked for: a consumer must be able to tell a whole-record number from a windowed one without reading the source.

**Verified by jackknife, which is the right test for the fixed design.** On the OLD code a jackknife is degenerate — dropping any window but the last changed nothing at all, which is the defect restated — so the sliding probe measures the defect and the jackknife measures the repair. Over the full night, dropping each 30-min window in turn:

| metric | label changes when one window is dropped |
|---|---|
| `spo2Ac1` | **0 / 76** |
| `hrLfHf` | **0 / 76** |
| `respRateBpm` | 6 / 76 |
| `crossCorrLag` | 12 / 76 |

**Coverage.** New group (12 assertions) pins the **invariant** — a disturbed final 30 min cannot capture the published value — rather than the numbers, which the equivalence legs already pin, plus the disclosure fields and the sub-window fallback. It carries its own **mutation check**: the disturbed tail alone must read differently (17.9 vs 12.2 br/min) or every assertion in the group would be passing for the wrong reason. That check **failed on the first draft** — the synthetic disturbance was broadband noise, and a peak-picker does not reliably move on noise — and was rebuilt as a clean 0.3 Hz oscillation. A second assertion was also wrong as first written: it demanded `spo2Ac1`'s label be invariant to a changed final 30 min, but a whole-record statistic *should* reflect 1/12 of its input; it now asserts the bound instead (the whole-record value moves strictly less than the tail-only value does).

**Fixtures.** Three OxyDex goldens moved and were regenerated with `tools/regen-oxydex-goldens.mjs`, never hand-edited — `OxyDex_2026-06-13_1056` (`outputHash 4884763b2dac10a6`), `OxyDex_2026-06-25_0439`, and `synthetic_oxydex_golden` (12 fields). One flaw surfaced while regenerating: a median of already-rounded values re-widens precision (`hrLfPow: 0.15000000000000002`), so every reduced value is re-rounded to the per-window kernel's own precision — the reduction must not widen the contract.

**§C2 and §C3 are deliberately not in this change**, and the brief now records why in place. §C2 is located exactly (`integrator-dsp.js:351` sleep-time vs `:955` recording-time, compared at `:3107`) but must ride with the REM re-derivation a parallel session is mid-way through — this brief's own instruction is that C2 precede that work, and it is already under way; and "one denominator" cannot be chosen without fabricating a TST OxyDex does not have. §C3 is routed to `REM-STAGING-REDESIGN-2026-07-28-BRIEF.md`, which now owns it.

OxyDex re-bundled (`manifestHash 5c6ef1923bb9 → d463b2ed5c1f`) plus `docs/`, both orchestrators and the 5 analysis pages inlining `oxydex-dsp.js`. `computeHash` moved `6c96368f7d8a → 66f80a6774f3`; `DEX_UPLOADS=<corpus> tools/verify-fixtures.mjs` re-ran the app and re-stamped both real summaries → `verifiedUnder: 66f80a6774f3`. `run-tests.mjs` **4271 green, 0 skipped** against the real corpus, `verify-manifest` GATE A 9/9 + GATE B 13 reproducible, `build --check` clean (11 owned), `tsc` clean.
