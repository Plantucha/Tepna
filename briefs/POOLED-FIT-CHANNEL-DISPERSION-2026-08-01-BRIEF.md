<!--
  POOLED-FIT-CHANNEL-DISPERSION-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED — 2026-08-01 · **Created:** 2026-08-01 · **Follows:** `INTEGRATOR-POOLED-CLOCK-APPLY-2026-08-01-BRIEF.md` §3 · **Affects:** *(measurement only — no code changed)*

# Three channels agree on the CPAP offset to under a minute, and the pool is not weighting them.

`INTEGRATOR-POOLED-CLOCK-APPLY` shipped the pooled fit as the applied correction (1/24 → 19/24) and
closed with a residual: on 2026-07-26 the fit landed **199 s** from what the desat↔apnea pairing needs,
so `DESAT MATCH RATE` stayed 0 %. This brief measures **why**, and stops deliberately short of acting.

Each channel's own preferred offset against the CPAP's apneas, across the 24 trio nights that carry
both (`ownOffsetSec` from `fitClockOffsetPooled`; MAD = cross-night median absolute deviation):

| channel | nights | median offset | **MAD** | joins winning cluster |
|---|---|---|---|---|
| `PpgDex/motion_artifact_segment` | 24 | **37.67 min** | **0.67 min** | 21 / 24 |
| `ECGDex/autonomic_surge` | 24 | **38.08 min** | **0.25 min** | 23 / 24 |
| `OxyDex/desat_event` | 22 | **39.17 min** | **0.50 min** | 21 / 22 |
| `OxyDex/periodic_breathing` | 21 | 36.08 min | 3.75 min | 13 / 21 |
| `ECGDex/stage_light` | 19 | 24.92 min | **35.75 min** | **9 / 19** |
| `PpgDex/hrv_drop` | 5 | 27.67 min | **62.08 min** | 0 / 5 |

## 1 · The top three are a physiological ladder, not scatter

**37.67 → 38.08 → 39.17 min.** Movement first, autonomic surge next, desaturation last — spanning
**90 s**, with per-channel MADs of **15–40 s**. That ordering is not noise: a desaturation trails its
apnea by circulation time, and an arousal surge sits between the two. Which means **the 90 s spread
between these channels is signal, not error** — the clock offset is common, and each channel adds its
own latency on top.

This matters for the residual. The pooled fit publishes ONE median across all agreeing channels, so a
coupling later scored on desat↔apnea specifically is handed an offset biased ~1–1.5 min early by the
motion and surge channels. That is most of the 199 s.

> **Relationship to `WEARABLE-SYNC-APPLIED` §2, which WITHDREW a latency ladder.** That retraction was
> correct and is not reversed here. It concerned wearable↔wearable latencies measured on ≤ 3 channels
> reaching 5 confident nights, with IQRs of ±20 s that overlapped completely. This is a different
> comparison — every channel against the **CPAP** anchor, on 22–24 nights, with MADs of 0.25–0.67 min.
> Better resourced and a different pairing; it does **not** re-establish the withdrawn ladder, and
> should not be cited as if it did.

## 2 · The pooled fit has NO per-channel stability gate — unlike its deprecated sibling

The deprecated per-channel `fitClockOffset` gates each channel on bootstrap-CI width
(`maxCiSec`, default 300 s), with a deliberate note that this is *"a DATA-DRIVEN quality gate,
deliberately not an allow-list of impulse names"* precisely because sleep-STAGE impulses *"clear a
peak-over-floor test at essentially arbitrary lags"*.

`fitClockOffsetPooled` admits a channel on `E.length >= minEvents` **and nothing else**. So
`stage_light` — whose own answer scatters by **±35.75 min** — enters the pool untested and joins the
winning cluster on **9 of 19** nights.

## 3 · Why this brief does NOT change the estimator

The obvious move is to exclude the loose channels. **The measurement says don't.** A channel scattering
uniformly over the ±45 min search would land inside the 180 s agreement window by chance about **7 %**
of the time. `stage_light` lands there **47 %** of the time (9/19). So it is **not** noise — it carries
real signal on many nights and produces wild answers on others, and the pooled design exists precisely
because *"the channels are individually weak and jointly decisive"*. Cutting it would discard
information on the majority of nights to fix a minority, and `POOLED-CLOCK-FIT` §8.5 already refused
one estimator change fitted to a single corpus.

Three candidate directions, none taken here, each needing its own null calibration:

1. **Per-coupling offset.** When a coupling will be scored on one channel pair, use that channel's own
   `ownOffsetSec` rather than the pooled median. Closes most of the 199 s. **Circularity warning:**
   aligning on the pairing you then score makes the coincidence count meaningless — the same trap
   `POOLED-CLOCK-FIT-FOLLOWUPS` flagged for the CPAP latency rows. Only safe if the coupling's *count*
   is not simultaneously used as evidence for the alignment.
2. **Latency-aware pooling.** Model each channel's offset as `clock + channelLatency` and solve for the
   common term, instead of taking a median over quantities that legitimately differ.
3. **Import the CI gate.** Give the pooled fit the stability test its deprecated sibling has. Cheapest,
   but must be shown not to lose the 4 nights pooling rescued.

## 4 · Done when

- [x] Per-channel dispersion measured across the corpus and published as numbers.
- [x] The 199 s residual attributed to a cause (a median over channels with genuinely different
      latencies) rather than left as "the fit is imprecise".
- [x] The tempting fix measured and **rejected** on evidence (47 % vs a 7 % chance rate).
- [ ] *(owner's call)* Which of §3's three directions, if any — each needs a null calibration, not a
      one-night check.
