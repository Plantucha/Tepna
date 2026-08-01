<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [MotionDex]
brief: MOTIONDEX-RESPIRATORY-RATE-FOLLOWUPS-2026-07-22-BRIEF.md
---
§2 of that brief opens: *"Sample-rate precision is this codebase's recurring failure mode — it bit three times in one work-unit, in three different places, each time silently."* All three were fixed in `resp-acc-analysis.js`. **The module was loaded by neither test lane**, so `nativeHz`, `toGrid` and the channel constructors had zero coverage and every one of those fixes rested on the comment written above it — the same shape as the defect: plausible, unexercised, silent.

Wired into `tests/run-tests.mjs` and `Dex-Test-Suite.html`, with the three modes pinned as known answers:

| § | the failure | measured |
|---|---|---|
| §2.3 | rate read off the ms-quantised phone stamp instead of the `relNs` sensor counter | 25.3400 Hz vs **25.6410 Hz (+1.19 %)** |
| §2 | rate as count ÷ duration (absorbs every dropout) | a 20 % dropout moves it 0.00 Hz |
| §3 | integer decimation left a 25.35 Hz stream at 5.07 Hz | last peak keeps its absolute time, 297.00 s → 297.00 s |
| §4 | double band-pass, effective 16th order | **−36.69 dB** at 0.8 Hz for one pass vs −64.66 dB for two; passband −0.07 dB |

Two of those were published in the brief before any gate existed — §2's *"39 ms → 25.64 Hz, a 1.2 % error"* and §8's *"already attenuates −36.6 dB at 0.8 Hz"*. The gate reproduces both against the shipped module, which is why they are pinned as known answers rather than as guessed tolerances.

Mutation-verified by reintroducing each original bug: deleting `nativeHz`'s `relNs` branch reds the exactness and dropout asserts; making `toGrid` decimate by `round(fs/FSC)` reds absolute-time preservation; filtering twice in `flowChannel` reds the single-pass figure at −64.66 dB. Restore is green and `resp-acc-analysis.js` is byte-clean.

**One assertion was itself broken and only mutation found it.** The §3 check first snapped the output peak to the nearest crest of a known 4 s-period sine and tested the residual — it *passed under the decimation mutation*, because decimation slides the peak onto a different crest. It now compares absolute times measured independently on both series. Recorded because a test that survives the bug it was written for is the silent version of the very failure §2 is about.

**Not built:** §2's proposed shared `nativeHz` spine helper (inlined into every bundle → re-stamps all 8 `manifestHash` values for a single caller) and its proposed "no DSP computes a rate as `n / durSec`" lint — scanned, and it has **no subjects**: the only count-over-duration expressions in the DSPs are genuine *event* rates (`oxydex-dsp.js:3079`, `oxydex-fusion.js:326`), which a source scan cannot separate from sample rates without the grandfather list `CPAP-REAL-CORPUS-FOLLOWUPS-II` §4 removed. Both left as proposals with the scan result recorded.

Tests + runner wiring only — no shipped source touched, so no `manifestHash` moves and no fixture is re-recorded.
