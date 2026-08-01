<!--
  SYNTH-GEN-FIXTURE-REALISM-FOLLOWUPS-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Follows:** `SYNTH-GEN-DESAT-KINETICS-2026-08-01-BRIEF.md` (§3, last bullet) · **Also closes:** the follow-up owed by `IBI-ALIGNMENT-LIMIT-2026-08-01-BRIEF.md`

# The SpO₂ generator's defect is not present in the PPG or RR generators — and the RR generator has the opposite one

## 1 · The question this answers

`SYNTH-GEN-DESAT-KINETICS` fixed a generator that planted desaturations OxyDex correctly threw away as
probe artifact, and closed with one line of unfinished business:

> *Check the PPG/ECG generators for the same class of defect while there — nothing has measured their
> event morphology against the gates that consume them either.*

That was deliberately **not** asserted in passing when the parent landed. Asserting it untested would
have been the same error the parent brief exists to correct. This is the measurement.

## 2 · PPG — no defect

Five synthetic nights through `PPGDSP.parsePPG → analyze`, the same code that reads the real armband,
against the 36-night `trio-onset` corpus:

| metric | synthetic (5 nights) | real (36 nights) |
|---|---|---|
| `correctionRate` | 1.5 – 3.5 | median **4.25** · p10 0.8 · p90 11.2 |
| `analyzablePct` | 98 – 99 | median **97** · p10 94 |
| `cleanBeatPct` | 98 – 99 | median **98** · p10 96 |
| `ppiCorrFootPct` | 1.5 – 3.5 | median **5.55** · p90 47.4 |

The synthetic waveform sits **inside** the real envelope on every metric — slightly toward the clean
end, nowhere near rejection. The SpO₂ failure mode (a fixture the DSP mostly discards, so the
measurement returns the gate's behaviour) is **not present**.

Gated: *synth-gen PPG passes PPGDSP's validity checks*, bounding each metric by the real p10/p90 above.
It gates the **rejection** direction only — the one that actually broke.

## 3 · RR — the opposite defect, recorded and deliberately not "fixed"

Synthetic RR through the same Malik `correctRR` that runs on real data:

```
                       beats   corrected      %
synthetic night 1      25780           0    0.00
synthetic night 2      24389           0    0.00
synthetic night 3      26498           0    0.00
synthetic night 4      25917           0    0.00
synthetic night 5      25259           0    0.00

real 2026-07-25        30993         205    0.66
real 2026-07-26        22460         458    2.04
real 2026-07-27        21872        1035    4.73
real 2026-07-28        23449        3669   15.65
real 2026-07-29         7172          78    1.09
real 2026-07-30        20155        1044    5.18
```

**Zero corrections on every synthetic night, against a real median of 4.73 %.** The generator emits no
ectopy, no missed beats, no extra detections — nothing `correctRR` was written to repair.

This is a **different failure mode from the parent's, in the opposite direction, with a different
consequence.** The SpO₂ fixture was *rejected*, so every ODI-4 measured on it reported the gate's
behaviour instead of the metric's — a wrong number. These intervals are *accepted*; nothing is
discarded and no number comes out wrong. What is missing is realism: any HRV metric characterised on
these nights is characterised in the absence of the correction path that fires on ~5 % of real beats.

**Not fixed, on purpose.** Three reasons, in order:

1. `correctRR` keeps its own known-answer gate with an injected ectopic and an out-of-range interval
   (`tests/dex-tests.js`), so the correction code is covered; only the *end-to-end* nights skip it.
2. Injecting ectopy would move every HRV fixture in the repository — rMSSD and pNN50 are precisely the
   metrics most sensitive to it — for a realism gain nobody has asked for.
3. It would be speculative fixture-tuning, which is the habit this whole wave exists to correct. If a
   future result depends on artifact handling, *that* result's brief should plant the ectopy it needs
   and say why.

## 4 · Why the two directions are worth naming separately

Both are "the fixture cannot stand in for reality", and they look alike in a summary. They are not:

- **Rejected fixture** (SpO₂, fixed in the parent) — the consuming gate discards the planted events, so
  the measurement silently becomes a measurement *of the gate*. This produces confidently wrong numbers
  and it produced one: a severity-dependent ODI-4 deficit that was the artifact filter working
  correctly.
- **Over-clean fixture** (RR, recorded here) — the planted events sail through, so a code path that
  matters on real data is never exercised end-to-end. This produces no wrong number; it produces
  unwarranted confidence.

A fixture audit that only looks for one of these will call the other one healthy. The gate added in §2
looks for the first, and this brief records the second with a number so a later reader can tell the
difference rather than re-deriving it.

## 5 · The `IBI-ALIGNMENT-LIMIT` follow-up, folded in

That brief executed without spawning the follow-up §📌 requires. What surfaced during it:

- **Beat-derived alignment is closed, not deferred.** The comb result means no fiducial improvement can
  make beat times yield a sub-beat offset. `IBI-ALIGNMENT-LIMIT` §Done-when was updated in place to say
  so, replacing the "improve the fiducial first" item that pointed at work now known to be futile.
- **`tools/beat-comb-analysis.mjs` gained `--pair`** so the brief's ECG→PPG table is reproducible, and
  that pairing turned out to show the same comb — closing the brief's *first* table as well as its
  control.
- **Nothing further is owed.** The remaining question (what the ~40 ms same-tooth wrist↔finger offset on
  2026-07-27 means) needs an aperiodic fiducial to be answerable at all, which is the ACC/desat-onset
  work already tracked in `WEARABLE-SYNC-APPLIED`.

## 6 · Done when

- [x] The PPG generator is measured against the DSP that consumes it, and the result gated.
- [x] The RR generator is measured against `correctRR`, and the result recorded with the real
      comparison rather than asserted.
- [x] The decision **not** to inject ectopy is recorded with its reasons, so a later reader does not
      read the 0.00 % as an oversight.
- [x] The `IBI-ALIGNMENT-LIMIT` follow-up obligation is discharged (§5).
- [x] Gates green; changeset dropped.
