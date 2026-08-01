<!--
  SYNTH-GEN-DESAT-KINETICS-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Spawned-by:** `PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md` §2

# `synth-gen` plants desaturations that fall faster than physiology allows, so the detector correctly throws them away

## 1 · The measurement

`tools/synth-desat-kinetics.mjs` (committed with this brief) reads raw CSVs only — no DSP, no bundle — and
reports every positive one-second SpO₂ step. On the five-night SubjectA corpus:

| night | reference AHI | falls | max | p99 | **> 1.5 %/s** |
|---|---|---|---|---|---|
| 1 | 22 | 778 | 3 %/s | 3 | **16.3 %** |
| 2 | 38 | 1588 | **4 %/s** | 4 | **32.0 %** |
| 3 | 7 | 197 | 2 %/s | 2 | 4.1 % |
| 4 | 4 | 105 | 2 %/s | 2 | 2.9 % |
| 5 | 3 | 77 | 1 %/s | 1 | 0.0 % |

`SELFGATE.FALL_RATE_MAX` is **1.5 %/s** because a real systemic desaturation is rate-limited by
circulation and lung oxygen stores — it falls over *tens* of seconds. A 4 %/s edge is what a probe squeeze
or a finger-off looks like, and `selfGateDesat` is **right** to reject it.

So it does. On night 2 the detector finds **242** desaturations and excludes **232** as artifact, keeping
10 → ODI-4 **1.4/h** on a night with a planted AHI of 38 and 24.7 % of its duration below 90 % SpO₂.
Night 1: 135 found, 92 excluded, 43 kept.

## 2 · Why this matters more than a bad fixture

**The rejection scales with severity, because the generator plants more events on severe nights.** That
alone reproduces a severity-dependent ODI-4 deficit — which is precisely the central finding of
`papers/odi4-ahi-bias.html` ("the deficit grew with severity; the under-count is a deterministic detector
artifact, not noise"). On the corpus that exists today, that pattern is fully explained by the artifact
gate correctly rejecting an unphysiological fixture, with no detector bias needed.

This does **not** show the paper is wrong. Its corpus is gitignored and gone (see the parent brief), so
whether the original had the same defect is unknowable. What it shows is that **a synthetic oracle that
cannot pass the detector's own validity checks cannot be used to characterize that detector** — the
measurement returns the gate's behaviour instead of the metric's. `REM-STAGING-REDESIGN` §8 makes the
general form of this point about circular oracles; this is a concrete instance with a number on it.

## 3 · The fix

Give planted desaturations a physiological morphology. A real event ramps down over ~10–30 s, holds a
nadir, and resaturates over ~10–30 s — the shape used in the `nsrr-adapter · ingest · known-answer` gate,
where a 97 → 90 % ramp over 10 s (0.7 %/s) is detected and its square-edged twin is correctly rejected.

- **Ramp, don't step.** Fall rate must stay under ~1 %/s to leave headroom below the 1.5 %/s ceiling.
- **Depth is independent of slope.** A 7 % desaturation is still 7 % deep when it takes 10 s instead of 2.
- **Calibrate the ramp against REAL data, not against this brief.** The ~10–30 s above is an estimate
  taken from the `nsrr-adapter` gate's hand-built fixture, which is exactly the kind of number that should
  not be inherited (see the parent wave's lesson on deferrals). Two things landed 2026-07-31/08-01 that
  make it measurable instead:
  - **`desat_event.meta.onsetTMs` / `endTMs`** (PR #608, `DESAT-ONSET-FIDUCIAL-2026-07-31`). The onset and
    end were already computed in `_stampEvent` and discarded at the export; they are now published, over
    496/496 events across 36 nights. `tMs` remains the nadir — contract unchanged. So **onset → nadir is
    directly readable** on the real corpus, and the generator's ramp should be set from that distribution
    rather than from a guess. Note the companion measurement: transit from the nadir runs **19 s longer**
    than from the onset, and that 19 s *is* the desaturation's own duration — which is the same quantity
    this brief is asking the generator to get right.
  - **`timeseries.spo2`** (PR #606, `OXYDEX-SPO2-SERIES-2026-07-31`) — full 1 Hz SpO₂ on a uniform grid
    from `recording.startEpochMs` (~26.5 k samples/night, 98.7 % non-null; holes are `null`, never 0 and
    never carried forward). This gives the actual desaturation **shape** rather than event summaries, so
    the real fall-rate distribution can be measured directly and the generator matched to it. Re-folded
    corpus carrying both: `/run/media/michal/647A504F7A50205A/trio-onset` (36 nights).

  **The tool must keep reading raw CSV, though.** Measuring the generator's output through the export
  would route it via the very DSP whose gate is under discussion, and the whole point of
  `synth-desat-kinetics.mjs` is that it cannot drift with the code it judges (§5). Use `timeseries.spo2`
  to learn what a real desaturation looks like; keep judging the generator on its own bytes.
- **Do NOT loosen `FALL_RATE_MAX` to make the fixture pass.** That is tuning the detector to the oracle —
  the inverted version of the guardrail `OXYDEX-ODI-CEILING-FIX` §2c already set. The gate is correct; the
  generator is not.
- Check the PPG/ECG generators for the same class of defect while there — nothing has measured their
  event morphology against the gates that consume them either.

## 6 · Executed 2026-08-01

### The measurement the brief refused to inherit

§3 asked for the ramp to be set from the REAL distribution rather than from its own ~10–30 s estimate.
Measured over the 36-night `trio-onset` corpus — 1 Hz `timeseries.spo2` plus 342 events carrying
`onsetTMs`:

```
1 s fall rate            p50 1.00 %/s · p90 1.00 · p99 1.00 · max 14.00
  exceeding 1.5 %/s      43 of 21 609  =  0.20 %        (synthetic nights 1-2: 16.3 %, 32.0 %)
onset → nadir            p50 7 s · p90 25 s · p99 71 s
nadir → end              p50 14 s · p90 38 s
event depth              p50 5 % · p90 8 %
implied mean fall rate   0.714 %/s
```

The brief's "~10–30 s" is the p90 of the real distribution, not its centre — the median event ramps in
**7 s**. Real data passes the judge comfortably at 0.20 %, which also validates the tool's 5 % threshold
in the one direction that mattered.

### The defect was a model choice, not a constant

`renderOxy` glided SpO₂ toward its target with `spo2f += (target − spo2f) × k`, `k = 0.28`. A first-order
lag's *initial* rate is `k × depth`, so a 10 % event opened at 2.8 %/s and a 15 % one at 4.2 %/s — which
is exactly the 3 and 4 %/s maxima on nights 1 and 2.

Shrinking `k` was the wrong fix: it would also flatten the shallow events that were never the problem,
and it keeps a model that is wrong in kind. Saturation is **rate-limited** by circulation and lung oxygen
stores, not exponentially relaxing, so the limit is now imposed directly — `±1.0 %/s` falling, `1.5 %/s`
rising (resaturation is the slower limb, 14 s vs 7 s, and clamping it hard would merge events that should
separate). Depth is untouched: a 7 % desaturation is still 7 % deep, it just takes 7 s.

### The result, with the detector unchanged

```
planted AHI              3     4     7    22    38     slope    R²
ODI-4 before           0.8   0.5   1.5   5.6   1.4     0.051   0.137
ODI-4 after            0.8   0.9   2.4  17.7  33.1     0.946   0.997
deficit before         2.2   3.5   5.5  16.4  36.6     ← the paper's severity gradient
deficit after          2.2   3.1   4.6   4.3   4.9     ← flat
```

OxyDex finds **242** desaturations on night 2 in *both* cases. The entire difference is that
`selfGateDesat` rejected **232** of them from the old fixture and **none** from the repaired one.

**The severity-dependent ODI-4 deficit does not survive a physiological fixture.** §4's sixth item
anticipated this outcome explicitly, and it is the outcome. The residual ~3–5 events/h carries no
severity gradient and is the ordinary consequence of not every apnea desaturating ≥4 %.

### On pinning — the brief asked for bytes; it gets something stronger

§4 wanted the corpus committed or seed-pinned. The five nights are **3.7 MB** and gitignored, so pinning
bytes means pinning something CI never re-derives. Instead the **generator** is gated: the new
`tests/dex-tests.js` group renders the two severest nights through `SYNTH.renderOxy` **in-realm on every
run** and asserts the ceiling, the artifact-exclusion ratio (<10 %), and that ODI-4 lands within 25 % of
the planted AHI. Restoring the old glide reds all eight assertions with exactly the brief's Table 1
numbers (32.0 %, 16.3 %, 232/242, 92/135). A re-derived fixture cannot drift the way frozen bytes can.

The ceiling is written out in both the tool and the gate rather than imported from `oxydex-dsp`, per §5 —
a fixture that tracks the gate it is judged by passes by construction.

### Not done here

The PPG/ECG generators were **not** checked for the same class of defect (§3, last bullet). That needs its
own measurement against the gates that consume them, and asserting it in passing would be the kind of
unverified claim this brief exists to correct. Carried to the follow-up.

## 4 · Done when

- [x] `synth-gen` emits ramped desaturations; the judge exits **0** on the regenerated corpus (all five
      nights max 1 %/s, 0.0 % over ceiling). The pre-fix corpus is preserved at
      `/tmp/synthetic-backup-preramp` for anyone re-checking the before/after.
- [x] Pinned — **as a re-derived fixture rather than frozen bytes**, see §6. 3.7 MB of gitignored CSV
      that CI never re-derives is a weaker guarantee than rendering in-realm every run.
- [x] `artifactExcluded` asserted: <10 % of events found, on both severe nights. It was 96 % (232/242).
- [x] Parent brief's Table 1 re-run — slope 0.051 → 0.946, R² 0.137 → 0.997.
- [x] Ramp set from the real distribution (36 nights, 342 `onsetTMs` events) and the numbers recorded
      in §6 and in the `synth-gen.js` comment, not carried over from this brief's estimate.
- [x] Paper banner updated — and the outcome is the one §4 anticipated: the severity-dependent
      under-count does **not** survive.
- [x] Gates green; changeset dropped.

## 5 · Guardrail

The acceptance test is `tools/synth-desat-kinetics.mjs`, which deliberately hard-codes the 1.5 %/s ceiling
rather than importing it from `oxydex-dsp`. A judge that moves with the thing it judges is not a judge; if
the DSP constant is ever loosened, the tool's `--selftest` fails on the divergence, which is the intended
alarm.
