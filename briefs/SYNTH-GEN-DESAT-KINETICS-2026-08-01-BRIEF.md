<!--
  SYNTH-GEN-DESAT-KINETICS-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-01 · **Spawned-by:** `PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md` §2

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

## 4 · Done when

- [ ] `synth-gen` emits ramped desaturations; `node tools/synth-desat-kinetics.mjs uploads/synthetic/`
      exits **0** on a freshly generated corpus (it exits 1 today).
- [ ] The regenerated corpus is **pinned** — committed, or generated from a recorded seed + generator
      version with input hashes in the ledger. Pinning must come AFTER the fix; pinning the current
      corpus would enshrine the defect.
- [ ] `artifactExcluded` is a small fraction of events found on every night, and that ratio is asserted —
      a fixture the detector mostly rejects should red a gate, not sit quietly in `uploads/`.
- [ ] The parent brief's Table 1 question is re-run on the fixed corpus.
- [ ] The generator's onset→nadir ramp is set from the REAL distribution (`onsetTMs`/`endTMs`, or
      `timeseries.spo2`), and the source of that number is recorded — not carried over from this brief.
- [ ] The paper's status banner is updated with whatever the re-run shows — including, if that is the
      outcome, that the severity-dependent under-count does **not** survive a physiological fixture.
- [ ] Gates green; changeset dropped.

## 5 · Guardrail

The acceptance test is `tools/synth-desat-kinetics.mjs`, which deliberately hard-codes the 1.5 %/s ceiling
rather than importing it from `oxydex-dsp`. A judge that moves with the thing it judges is not a judge; if
the DSP constant is ever loosened, the tool's `--selftest` fails on the divergence, which is the intended
alarm.
