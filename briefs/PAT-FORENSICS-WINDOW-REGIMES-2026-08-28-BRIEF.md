<!--
  PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-28 · **Parent:** `PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md` (§12 oracle · §16 gate self-selection · §17 corpus table) · **Interlocks:** `PAT-FORENSICS-FIDUCIAL-JITTER-2026-08-28-BRIEF.md`, `PAT-FORENSICS-AXIS-LEG-ASYMMETRY-2026-08-28-BRIEF.md`

# PAT clears its own bar on 1 night in 42 — and the failure is the acceptance window, not the sensors

> **In one line:** across the full 42-night capture-host corpus, the accepted-PAT distribution falls
> into four regimes. **37 % is window-dominated** — its SD is a constant of the estimator carrying no
> signal — **11 % is edge-loaded worse than uniform**, 48 % is intermediate, and **3.7 % (one night)
> resolves below the 60 ms bar**. Every sensor-side term measured in this campaign is ≤ 11 ms.

## 1 · ⚠️ How this brief was corrected, and why that is recorded first

An earlier form of this result claimed the distribution was **universally** window-dominated and that
PAT *"cannot clear a 60 ms bar on any hardware."* **Both were wrong**, and the error was not in the
measurement but in reading it: the run was piped through `tail -40`, so the rows that survived were
the last few, and they happened to be the ~129 ms cluster. CLAUDE.md §4b names exactly this — *a
verdict read off a truncation* — and it was committed three flags deep into a campaign whose other
findings include three separate proxy-field versions of the same family.

**The re-run without the pipe falsified the claim in both directions**, which is why the tail is
dangerous rather than merely lossy: the hidden rows contained **nights below the bar** (the most
informative rows in the corpus) and **nights above uniform** (a distinct mechanism). A truncation
does not degrade a result uniformly; it removes the tails, and the tails are where the discriminating
cases live.

## 2 · The measurement

`tools/pat-per-led.mjs` over `/home/michal/tepna-smoketest/captures`, **all 42 night directories, no
filter, no pipe**. Each Verity LED is scored standalone against the ECG R-peaks — no consensus, no
channel ranking — so a night contributes up to three independent channel-rows.

```
nights seen 42 · channel-rows WITH PAT 81 · zero-yield rows 36 · too-few-feet 4 · missing-stream nights 2
PAT SD:  min 36.4   median 121.4   max 156.6 ms
```

⚠️ **36 zero-yield rows against 81 yielding ones.** Roughly **30 % of attempted channel-rows produce
no PAT at all**, and every statistic below is conditioned on the survivors. That is a §16 selection
effect of the first order and no reading of this table is valid without it.

## 3 · The four regimes

Bands, and their provenance — **both endpoints are principled, not fitted**: 60 ms is the gate's own
`DRIFT_MAX_MS`; 129.9 is `450/√12`, the SD of a *uniform* distribution on the acceptance window
`[PHYS_LO, PHYS_HI] = [200, 650]`, with a ±5 % tolerance. *(Honest caveat: the band set was written
after glimpsing a 17-night partial, so it is pre-stated relative to the full run but not to the first
17 nights.)*

| regime | band | channel-rows | share |
|---|---|---|---|
| **SUB-BAR** | SD < 60 ms | **3** | **3.7 %** |
| INTERMEDIATE | 60 – 123.4 | 39 | 48.1 % |
| **WINDOW-DOMINATED** | 123.4 – 136.4 (129.9 ±5 %) | **30** | **37.0 %** |
| **EDGE-LOADED** | > 136.4 | **9** | **11.1 %** |

- **WINDOW-DOMINATED** — SD indistinguishable from `450/√12`, median on the window midpoint (425.0).
  The pairer is accepting whichever foot lands in the window; the distribution *is* the window and the
  reported SD is a constant of the estimator.
- **EDGE-LOADED** — SD **above** 129.9, which no uniform distribution on a 450 ms interval can
  produce. It requires mass at both edges: the **bimodal signature of a censoring cut**, and therefore
  positive evidence for the mechanism §8/§16 predicts rather than noise.
- **SUB-BAR** — one night (2026-07-31), all three channels, **SD 37.2 ms at a median lag of 275 ms**.
  Tight, off-centre, and physiologically plausible. **PAT is measurable here.**

## 4 · What sets the regime — three explanations eliminated

| candidate | verdict | evidence |
|---|---|---|
| channel/signal quality | **ELIMINATED** | foot-to-foot SD median is **95–109 ms across all four regimes** — flat |
| a per-channel property | **ELIMINATED** | all 3 LEDs agree on the regime on **every** night, without exception |
| median-lag position in the window | **ELIMINATED** | 2026-08-01 sits **7 ms** off centre and is EDGE-LOADED (156.6); 2026-08-03 sits **exactly** on centre at 125.1 |
| yield | **ELIMINATED** | 12 % – 54 % spans every regime |

**The regime is a NIGHT-level property that is not explained by the PPG signal.** That is a positive
structural result: whatever selects the regime acts on the whole night and upstream of the optics.

**The leading untested candidate is the inter-device clock offset.** It is night-level by
construction, and #1879/#1880 measured per-connection BLE offset drift at median **43.8 ms**, p90
142.9, max **815.6 ms** — large enough to move the true R→foot lag across, or entirely out of, a
450 ms window. **Untested here**, and named as the next experiment rather than asserted.

## 5 · Labels (charter §19)

- **Window-domination: STATISTICAL / GATING DESIGN (mechanism 11), FUNDAMENTAL for this estimator,
  NOT for the devices.** §19 forbids fixing a fundamental limit with aggressive gating — and here the
  gating *is* the limit. Every sensor-side term measured: ECG axis 11.15 ms, PPG fractional-subscript
  bug ~10 ms, fiducial jitter ≤ 6.3 ms by two independent routes.
- **Edge-loading: the censoring cut, ENGINEERING.** Same window, seen from the other side.
- **The 3.7 %: existence proof.** PAT is not impossible on this hardware — it is achieved.

## 6 · What this does NOT establish

- **Why a night lands in a regime.** Four candidates eliminated, the clock-offset hypothesis untested.
- **That a better window recovers the other 96 %.** The sub-bar night's lag is 275 ms — far from the
  window centre — which *suggests* a mis-centred window, but one night is an anecdote, not a result.
- **Any recommendation.** §20 forbids optimising pass rate and §21G forbids a pre-written conclusion.
  The oracle asks whether a physiologically-anchored pairing recovers signal above the ~11 ms sensor
  floor; that experiment, not this table, decides.

## 7 · Done when

- [x] Full-corpus run, untruncated, all 42 nights, zero-yield rows counted.
- [x] Regimes classified against principled bands; shares reported.
- [x] Four candidate explanations for regime membership eliminated by measurement.
- [ ] Clock-offset hypothesis tested against regime membership.
- [ ] Oracle: does a physiologically-anchored window recover signal above the sensor floor?
