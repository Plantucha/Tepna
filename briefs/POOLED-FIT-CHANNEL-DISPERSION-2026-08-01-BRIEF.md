<!--
  POOLED-FIT-CHANNEL-DISPERSION-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (⛔ §1 RETRACTED same day — see the banner) — 2026-08-01 · **Created:** 2026-08-01 · **Follows:** `INTEGRATOR-POOLED-CLOCK-APPLY-2026-08-01-BRIEF.md` §3 · **Affects:** *(measurement only — no code changed)*

# Three channels agree on the CPAP offset to under a minute, and the pool is not weighting them.

> ## ⛔ §1 IS RETRACTED — 2026-08-01, hours after merge
>
> **The ladder in §1 is not a new finding. It is `CROSS-DEVICE-CLOCK-SKEW` §2d, re-derived — and
> `WEARABLE-SYNC-APPLIED` §2 had already WITHDRAWN it.**
>
> | | movement | autonomic surge | desaturation |
> |---|---|---|---|
> | §2d (published 2026-07-30) | 37.5 min | 38.0 min | 39.5 min |
> | §1 below (2026-08-01) | 37.67 min | 38.08 min | 39.17 min |
>
> Same anchor (the CPAP), same channels, same quantity. §1's claim that this *"does NOT re-establish
> the withdrawn ladder — different anchor, different pairing"* was **false**: §2d fed eight channels
> against the CPAP into the same histogram, which is exactly what was measured here.
>
> And the withdrawal's reasoning applies unchanged. `WEARABLE-SYNC-APPLIED` §2 retracted the ladder
> because *"medians span 16 s; the interquartile ranges are ±20 s and overlap completely"* — a point
> estimate with no error bar. **§1's own MADs are 0.25–0.67 min, i.e. 15–40 s: the same dispersion.**
> Three rungs spanning 90 s with 15–40 s MADs do not establish an ordering, and calling that spread
> *"signal, not error"* is precisely the failure both prior briefs retracted. The one thing §1 adds is
> `desat_event` on 22 nights where the withdrawal had it on fewer than 5 — which is worth recording,
> and is **not** on its own enough to reinstate a withdrawn ordering.
>
> **The measurement also duplicated existing tooling.** `tools/trio-batch.mjs` already iterates
> `fit.channels` and prints each channel's z at the chosen offset, per night (`printClockFit`). The
> harness written for §1 re-implemented that.
>
> **What survives, and is why this brief is kept rather than deleted:** §2 (the pooled fit has no
> per-channel stability gate while its deprecated sibling does) and §3's measured refutation of the
> obvious cut (47 % vs a ~7 % chance rate). Those are operational facts about the estimator, not
> claims about physiology. §1's attribution of the 199 s residual to *"a median over channels with
> different latencies"* drops from **measured cause** to **untested hypothesis**, because it rests on
> the ordering that is retracted here.
>
> **The lesson, which is the reusable part:** the corpus question had already been asked and answered
> twice in this repo, and answered more carefully the second time. Measuring before reading the briefs
> produced a confident re-derivation of something already known to be underpowered.


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

## 1 · ⛔ RETRACTED — "the top three are a physiological ladder, not scatter"

*(Kept for the record. This section re-derives `CROSS-DEVICE-CLOCK-SKEW` §2d, which `WEARABLE-SYNC-APPLIED` §2 withdrew. Read the banner above before anything below.)*

**37.67 → 38.08 → 39.17 min.** Movement first, autonomic surge next, desaturation last — spanning
**90 s**, with per-channel MADs of **15–40 s**. That ordering is not noise: a desaturation trails its
apnea by circulation time, and an arousal surge sits between the two. Which means **the 90 s spread
between these channels is signal, not error** — the clock offset is common, and each channel adds its
own latency on top.

This matters for the residual. The pooled fit publishes ONE median across all agreeing channels, so a
coupling later scored on desat↔apnea specifically is handed an offset biased ~1–1.5 min early by the
motion and surge channels. That is most of the 199 s.

> ⛔ **THIS PARAGRAPH WAS WRONG AND IS THE REASON §1 IS RETRACTED.** It claimed the measurement was
> *"a different comparison — every channel against the CPAP anchor"* and so did not re-establish the
> withdrawn ladder. **§2d is also CPAP-anchored** — it fed eight channels across three devices into
> §3.1's histogram against the CPAP. Same anchor, same channels, same quantity. The defence was
> constructed rather than checked, and checking it takes one read of §2d.

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
- [⛔] ~~The 199 s residual attributed to a cause~~ — **retracted**: the attribution rests on the
      ordering in §1, which is a re-derivation of a withdrawn finding. It is a hypothesis, not a cause.
- [x] **Read the prior briefs before measuring.** Not done, and it cost a retraction: the question had
      been asked twice already, and answered more carefully the second time.
- [x] The tempting fix measured and **rejected** on evidence (47 % vs a 7 % chance rate).
- [ ] *(owner's call)* Which of §3's three directions, if any — each needs a null calibration, not a
      one-night check.
