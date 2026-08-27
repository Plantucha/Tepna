<!--
  PAT-RELATIVE-REFRAME-2026-08-17-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-17 · **Follows:** `PAT-COMPENDIUM-2026-08-10-BRIEF.md` (the standing record), `PAT-OFFSET-ESTIMATOR-FOLLOWUPS-2026-08-12-BRIEF.md` (the open §3) · **Affects:** `pat-align.js`, `pat-gate.js`, `ppgdex-dsp.js`, `integrator-dsp.js`'s PAT surface, the CPAP validation corpus

# PAT feasibility, end to end — the suite has been building the hard estimand while the validated one sits unbuilt

**Owner ask (2026-08-17):** check the whole signal path for PAT feasibility, capture host through
Integrator, and find improvements — preferably literature-backed.

**The one-paragraph answer.** The path is in the best state it has ever been — the three rate errors
are fixed, the arrival sidecar certifies two of three devices, and within-5-min-bin σ reaches
10–23 ms on locking nights. But every gate, window and open item is aimed at **absolute** PAT — a
number in ms whose own literature says it cannot deliver what it promises even with an intra-arterial
reference. Meanwhile the estimand that sleep medicine actually validated — **relative PAT dips as an
arousal / respiratory-effort marker** — is immune to all three of this corpus's remaining blockers
*by construction*, sits inside the suite's measured noise budget, and has a 189-night CPAP corpus
plus the `event-coupling.js` null machinery already waiting to validate it. The recommendation is a
reframe, not a rescue.

---

## 1 · The path as it stands (verified against code and the sidecar's first real night)

| stage | state | evidence |
|---|---|---|
| capture host → arrival sidecar | **working**; H10 ecg/acc certified (4.1–4.6 ms agree, −20.4/−20.5 ppm, 0.09 ppm mutual); Verity certified after the pairing fix | `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` §1a |
| O2Ring leg | **not certified** — 22.3 s agree, counter at **3851 ppm**; "the finger leg has no PAT-grade clock" | ibid. |
| per-connection BLE offset | ~2.2 s **between** connections, σ 29–36 ms within; constancy *within* a connection untested | `PAT-PACKET-ARRIVAL` §5, FOLLOWUPS §2 |
| node axes | ppgdex ships counter+`hostAxis` (best of five candidates, Rayleigh 0.90 on the best night); ECGDex `fs` fixed in #1121 | `PAT-COMPENDIUM` §4.3 |
| fiducials | sub-sample feet at 1.3–2.0 ms jitter — **not the limit** (~0.5 % of variance) | ibid. §5.1 |
| pairing/gate | `PHYS = [200,650]` never re-derived (a censoring cut, `450/√12` trap); `pat-gate` bars 60 ms | ibid. §9.3, `pat-gate.js` |
| Integrator | publishes the in-window yield, **applies nothing**; beat-resolution consumers correctly gated off | `integrator-dsp.js:5311` |
| best-case precision | within-5-min-bin σ **10–23 ms** on 3 of 6 box nights; 3 nights do not phase-lock, unexplained | `PAT-COMPENDIUM` §1 |
| the open blocker | 7 of 10 nights **anatomically impossible** (ankle before finger); whether the per-connection offset repairs the sign is unanswered | `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` §3 |

## 2 · What the literature says about the two estimands (all retrieved via PubMed, 2026-08-17)

### 2.1 · Absolute PAT as a BP/vascular number: weak even under laboratory conditions

The canonical measurement is Payne et al. — beat-to-beat rPTT (ECG R-wave → finger PPG) against an
**intra-arterial** radial line, under four vasoactive drugs:

> PEP accounted for **12–35 %** of rPTT and varied; rPTT↔SBP R² = **0.39** with 95 % limits of
> agreement **±17 mmHg**; DBP and MAP correlated at R² = **0.02 / 0.08** uncorrected, improving to
> 0.41 / 0.45 only after PEP subtraction. *"rPTT should not be used as a marker of purely vascular
> function."*
> — Payne RA, Symeonides CN, Webb DJ, Maxwell SRJ, *J Appl Physiol* 100(1):136–41, 2006,
> [10.1152/japplphysiol.00657.2005](https://doi.org/10.1152/japplphysiol.00657.2005)

The definitive engineering review reaches the same posture — PTT-based BP is *promising with
per-subject calibration and PEP handling*, not a free measurement (Mukkamala R, Hahn JO, Inan OT et
al., *IEEE Trans Biomed Eng* 62(8):1879–901, 2015,
[10.1109/TBME.2015.2441951](https://doi.org/10.1109/TBME.2015.2441951)); and the exchange in
*Physiol Meas* concedes the physiological confounds outright while arguing only that ML + more
features might compensate (Lin WH, Samuel OW, Li G, 39(9):098002, 2018,
[10.1088/1361-6579/aadf17](https://doi.org/10.1088/1361-6579/aadf17)).

**Read against §1:** the suite's absolute-PAT programme is chasing a number that, *with a perfect
clock and an arterial line*, explains 39 % of SBP variance at ±17 mmHg. On this hardware it
additionally requires solving the per-connection offset, the anatomical sign, and a finger clock
that certifies at 3851 ppm. The effort/return ratio is poor and the literature says it stays poor
after the engineering is done.

### 2.2 · Relative PAT dips in sleep: validated, sensitive, and exactly this suite's domain

- **Arousal dips are ~15 ms and PTT out-senses the EEG.** Provoked arousals in normal sleepers
  produce PTT falls of **15.1 ± 1.4 ms**, and **9.9 ± 2.6 ms even with no visible EEG change**;
  PTT was more sensitive than heart rate. (Pitson D, Chhina N, Knijn S, van Herwaaden M,
  Stradling J, *Clin Sci* 87(2):269–73, 1994,
  [10.1042/cs0870269](https://doi.org/10.1042/cs0870269).)
- **PTT arousals catch respiratory events EEG misses.** In children with sleep-disordered breathing,
  apnea/hypopnea/RERA events terminated in a PTT arousal **91 % / 83 % / 80 %** of the time, against
  **55 % / 51 % / 43 %** for EEG arousal — and the PTT arousal index separated UARS (6.8/h) from
  primary snoring (2.2/h). (Katz ES, Lutz J, Black C, Marcus CL, *Pediatr Res* 53(4):580–8, 2003,
  [10.1203/01.PDR.0000057206.14698.47](https://doi.org/10.1203/01.PDR.0000057206.14698.47).)
- **The index tracks OSA severity and CPAP response.** PTT arousal index correlates with RDI
  (r = 0.43) and its fall under CPAP tracks the RDI fall (r = 0.54), n = 144 split nights.
  (Schwartz DJ, *Sleep Med* 6(3):199–203, 2005,
  [10.1016/j.sleep.2004.12.009](https://doi.org/10.1016/j.sleep.2004.12.009).)

### 2.3 · Why the relative estimand dissolves this corpus's blockers rather than solving them

| blocker (absolute PAT) | under a within-connection **dip** estimand |
|---|---|
| per-connection BLE offset, 2.2 s | a constant **subtracts out** of any within-connection difference |
| anatomical sign impossible on 7/10 nights | sign of the *level* is irrelevant; only the excursion is read |
| PEP unknown per beat (12–35 % of PAT) | arousal raises sympathetic tone, which shortens **both** PEP and vascular transit — the confound becomes an **amplifier** of the dip. (Direction matters: PEP and PTT move *oppositely* under hypovolemia vs pain — Djupedal H et al., *Physiol Rep* 10(12):e15355, 2022, [10.14814/phy2.15355](https://doi.org/10.14814/phy2.15355) — so this argument is specific to arousal, and the estimand must be labelled autonomic, not vascular.) |
| `PHYS=[200,650]` censoring | a dip detector needs **no absolute window at all** — pair nearest-fiducial, detrend, threshold the excursion |
| offset knowable only mod one RR | irrelevant — the dip never leaves the connection it started in |

**Noise budget, from this corpus's own numbers:** within-bin σ is 10–23 ms per beat on locking
nights; a Pitson-scale dip is ~15 ms sustained over ~8–20 beats at sleep HR, so the event statistic
(median over the dip window) sees σ/√8 ≈ **3.5–8 ms against a 15 ms excursion — a 2–4 σ event**.
The −20 ppm certified drifts contribute ~0.6 ms over a 30 s window: negligible. This is feasible *on
the nights that phase-lock*, and the three that do not (§9.2 of the compendium) remain a
precondition to check per night, not a refutation.

## 3 · The proposal

1. **Ship ΔPAT, not PAT.** New estimand: per-beat lag from nearest-fiducial pairing (no window),
   detrended by a rolling median (~60 s), **segmented by BLE connection** (the sidecar records the
   boundaries); an *event* is a fall ≥ Θ ms sustained ≥ N beats. Publish a **PTT-arousal index**
   (events/h) per night, `experimental` tier, labelled **autonomic** — never as BP and never as
   "vascular" (Payne's closing sentence is the citation for that restraint).
2. **Validate against the CPAP corpus, which is already on disk.** 189+ nights of device-scored
   events (extendable to 2026-08-16 from vigil) overlap the O2Ring nights; `event-coupling.js`'s
   circular-shift null is the right instrument, and the κ/pb-agreement machinery (with its
   degenerate-margin refusal) transfers as-is. Success is Katz/Schwartz-shaped: event-level lift
   above the shifted null, night-level index correlating with the device's AHI.
3. **Requirements that shrink:** the only clock property the dip path needs is **within-connection
   stability** — exactly `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` §2's untested question, which becomes the
   *first* gate rather than one of many. The absolute-offset programme (§3 there) stays open for the
   vascular ambition but stops blocking shipment.
4. **Fiducial fixes that serve both estimands** (known defects, `PAT-COMPENDIUM` §8): stop picking
   the PPG reference channel by **peak count** (rewards over-detection — pick by phase-lock against
   the beat cycle); stop degrading feet through `consensusBeats` (per-LED feet at 118–121 ms beat
   consensus at 133 ms — take the median of per-LED lags instead). Use the ambient channel's
   spread as the don/settle gate (§5.3) so dips are only scored on worn, settled segments.
5. **PEP leg, second phase:** the H10 chest ACC seismocardiogram already yields AO at 92–124 ms
   (compendium §7); sternal-accelerometer PEP tracking in a wearable is established practice
   (Zhang G, Cottrell AC, Henry IC, McCombie DB, *Annu Int Conf IEEE EMBC* 2016:3386–9,
   [10.1109/EMBC.2016.7591454](https://doi.org/10.1109/EMBC.2016.7591454)). That gives pPTT
   (PAT − PEP) for the vascular ambition later *and* makes the N-corner hat identifiable
   (compendium §9.4) — but it is deliberately **not** on the critical path of the dip index.

## 4 · What this does NOT claim

- Not a BP monitor, not a vascular-stiffness metric, and the index must never be badged above
  `experimental` without a reference-grade validation this hardware cannot currently perform.
- The 2.2 s per-connection offset and the anatomical sign remain **unexplained** — the reframe
  removes them from the critical path; it does not answer them. `PAT-OFFSET-ESTIMATOR-FOLLOWUPS` §3
  keeps its priority for anyone pursuing the absolute estimand.
- Pitson/Katz/Schwartz used finger PPG with lab oximeters; the O2Ring's 3851 ppm counter rides the
  host axis here. The within-connection stability test (§3.3) is what decides whether that transfer
  holds, and it has not run yet.

## 5 · Done when

- [x] **ANSWERED 2026-08-27 — 14 nights, 31 connections; see the closing measurement below.** Within-connection offset stability is measured on ≥ 5 sidecar nights (first/second half fit
      comparison per connection) — the dip path's one clock gate.
      **FEASIBILITY CHECKED 2026-08-18 — blocked on the SIDECAR, not on effort or tooling.** The
      assumption under test is stated in code at `pat-align.js:335`: *"the ~2.2 s per-connection BLE
      offset is CONSTANT within a connection — a within-connection difference cancels it exactly,
      which is why `segments` (connection spans) gate runs"*. So the measurement needs real
      **connection boundaries**, which `patDipEvents` already consumes as `opts.segments`.
      The local `uploads/captures` corpus (6 nights, 2026-07-31 → 08-16) **does not carry them**. Its
      only structured file is `QC-SUMMARY.json`, which has `sessions` but zero occurrences of
      `connection`/`segment`/`disconnect`. ⚠️ **`sessions` are NOT connections** — tempting, because on
      2026-08-14 there are exactly 3 sessions and 3 Verity `_PPG.txt` files, so they look
      interchangeable. But the first session spans **43 123 s (12 h)**, and a single BLE link does not
      survive that here (the Verity writer drops it on a ~90 s cadence in SDK mode). A session is a
      capture-host recording span; a connection is finer, and substituting one for the other would
      measure stability across reconnects while reporting it as stability within a connection —
      inverting the result the gate exists to produce.
      **What unblocks it:** sidecar nights from vigil that record connection spans. Everything else is
      already built — `patDipEvents` takes `segments`, and the halving is arithmetic on top.

      🔴 **CORRECTION 2026-08-18, same day — THE ABOVE IS WRONG. The sidecars are here, and they always
      were.** Every one of the 6 local capture nights carries `*_LINK.csv`, whose columns are
      `Phone timestamp;device;connected;rssi_dbm;…;link_epoch;address` — i.e. exactly the
      connection boundaries the paragraph above says are missing. Connection counts per night:

      | night | LINK files | Verity connections | H10 connections |
      |---|---|---|---|
      | 2026-07-31 | 2 | 243 | 23 |
      | 2026-08-11 | 12 | 17 | 2 |
      | 2026-08-13 | 9 | 327 | 4 |
      | 2026-08-14 | 12 | 16 | 2 |
      | 2026-08-15 | 8 | 20 | 5 |
      | 2026-08-16 | 5 | 17 | 1 |

      **6 nights of 6, against a done-when that asks for ≥ 5.** So this item is NOT data-blocked; it is
      unstarted.
      **How I got it wrong, because the mechanism matters more than the fact:** I searched for the
      *word* — `-iname "*sidecar*"`, `-iname "*.jsonl"` — and read `QC-SUMMARY.json`, then concluded
      absence. I never listed the directory's file extensions. The sidecar is real, local, and named
      something I did not guess. Identical in shape to the `ppg_expected`/`ppg_offset` trap recorded in
      `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §1 the same hour: **a grep for the vocabulary you expect
      returns empty against data that is present under another name, and empty reads as absent.**
      The `sessions`-are-not-connections warning above still stands and is now *more* useful, not less:
      `link_epoch` is the right key, and a session still is not one.
      ⚠️ **One real caveat for whoever runs it:** the Verity reconnects hard — 243 and 327 connections
      on two nights — so most connections will be far too short to halve and fit. The measurement needs
      a minimum-duration filter per connection, and the honest denominator is *connections long enough
      to halve*, not connections observed.

      🔬 **MEASURED 2026-08-18 — the tool now exists (`tools/pat-connection-stability.mjs`), and the
      answer is that THIS CORPUS CANNOT ANSWER IT YET. n = 2.**

      | night | Verity spans ≥300 s | scored | med \|Δ\| | max \|Δ\| |
      |---|---|---|---|---|
      | 2026-07-31 | 5 | **2** | 76.5 ms | 111.8 ms |
      | 2026-08-11 / 13 / 14 | 1 each | 0 | — | span too short of beats on BOTH signals |
      | 2026-08-15 | 0 | 0 | — | no Verity span inside one H10 connection |
      | 2026-08-16 | — | — | — | no ECG captured |

      **The first run said median \|Δ\| 110.3 ms over 9 connections, and that number is invalid.** It
      gated on the **Verity's** connection spans while pooling H10 beats across the **H10's own**
      reconnects — so it measured an ACROSS-reconnect offset and would have reported it as
      within-connection drift. A PAT lag is ECG-to-PPG and inherits **both** links; the span must be
      inside one connection on **both** devices. That is the same error as substituting `sessions`,
      one device over, and I made it while holding the note warning against it.
      **With the guard: only 8 of 113 Verity spans ≥ 300 s sit inside a single H10 connection**, and
      only 2 of those carry ≥ 60 beats of both signals. So the constraint is not "≥ 5 nights of
      capture" — it is **≥ 5 nights with a long SIMULTANEOUS connection on both devices**, which is a
      much scarcer thing given the Verity reconnects 16–327 times a night.
      **Do not quote the 76.5 ms.** At n = 2 it is a number, not a result; the tool now withholds its
      own p90 below n = 10 and prints the shortfall instead, because at n = 2 the p90 printed *below*
      the median and read as reassurance.
      **What would actually close this:** nights with fewer Verity reconnects (a stable link), or a
      lower `--min-span-sec` paired with a beats-based rather than duration-based span filter. The
      machinery is built either way — this is now a data question with a known shape, not an unknown.

      ### ✅ CLOSED 2026-08-27 — the nights existed, in a corpus this brief never looked at

      *"A data question with a known shape"* — and the data was already on disk. Every measurement above
      ran against **`uploads/captures` (6 nights)**. The capture-host corpus at
      `/home/michal/tepna-smoketest/captures` carries **440 `*_LINK.csv` sidecars across 40 nights**.
      Same tool, same flags, no new machinery:

      ```sh
      node tools/pat-connection-stability.mjs /home/michal/tepna-smoketest/captures \
           --min-span-sec 300 --min-beats 60
      ```

      **14 scored nights · 31 scored connections** — against a done-when asking for ≥ 5 nights, and past
      the tool's own n ≥ 10 threshold, so its p90 is published rather than withheld.

      | night | spans | scored | med \|Δ\| | max \|Δ\| |
      |---|---|---|---|---|
      | 2026-07-21 | 2 | 2 | 31.3 | 36.9 |
      | 2026-07-22 | 6 | 3 | 53.1 | 126.0 |
      | 2026-07-23 | 3 | 3 | 49.3 | 142.9 |
      | 2026-07-24 | 5 | 1 | 26.4 | 26.4 |
      | 2026-07-26 | 5 | 1 | 1.7 | 1.7 |
      | 2026-07-28 | 1 | 1 | 14.6 | 14.6 |
      | 2026-07-31 | 5 | 2 | 27.3 | 51.1 |
      | 2026-08-06 | 3 | 3 | **155.0** | **815.6** |
      | 2026-08-12 | 3 | 1 | 121.5 | 121.5 |
      | 2026-08-18 | 1 | 1 | 21.1 | 21.1 |
      | 2026-08-19 | 8 | 2 | 23.6 | 46.6 |
      | 2026-08-21 | 6 | 5 | **133.2** | **433.9** |
      | 2026-08-24 | 4 | 4 | 32.0 | 63.7 |
      | 2026-08-25 | 2 | 2 | 18.9 | 23.9 |

      **POOLED n=31 · median |Δ| 43.8 ms · p90 142.9 ms · max 815.6 ms.**

      ### 🔴 The answer: the constancy assumption holds at the median and FAILS for ~1 connection in 4

      `pat-align.js:335` states it: *"the ~2.2 s per-connection BLE offset is CONSTANT within a
      connection — a within-connection difference cancels it exactly."* Against the ±90 ms PAT
      tolerance the tool prints as its own yardstick:

      - the **median** connection drifts **43.8 ms** — comfortably inside, so the assumption is sound
        for a typical connection;
      - but **8 of 31 connections (26 %) exceed ±90 ms**, the p90 is **142.9 ms**, and the worst is
        **815.6 ms** — most of an entire RR.

      **So the difference does not cancel exactly, and "exactly" is the word doing the work.** For about
      a quarter of connections the residual is comparable to or larger than the tolerance the dip path
      is trying to respect. The gate cannot treat within-connection constancy as free; it needs either a
      per-connection drift check or a bound quoted with its failure rate.

      ⚠️ **How this stayed closed for nine days, and it is not the vocabulary trap recorded above.** That
      one was *"a grep for the word you expect returns empty against data present under another name"*.
      This was the sibling: **the right name, searched in the wrong corpus.** `*_LINK.csv` was found
      correctly in `uploads/captures`; nobody asked whether a larger corpus carried the same sidecars.
      Six nights gave n = 2 and an honest "cannot answer yet"; forty nights give n = 31 and an answer.
      **A negative that is really a sampling limit should name the corpus it sampled** — this one did,
      which is why re-reading it was enough to spot the gap.
- [x] **BUILT same day** — `PATAlign.patDipEvents` (+ `tools/pat-dip-index.mjs`), gated by TEN twins
      in `pat-align · dip-detector`: planted Pitson-scale dips found 20/20; white-noise and ±40 ms
      red-wander nulls quiet; the 1-RR slip twin caught a real fabrication mode (a slipped foot pairs
      the next R at ≈RR−1000 ms, a perfect fake dip) now closed by foot-gap shadowing; a sign twin
      (rises ignored); a segment twin (a dip straddling a connection boundary dies at the cut);
      refusal twins for too-few-pairs, unreadable noise floors, and QUANTIZED fiducials. Hysteresis
      (enter −Θ, extend −Θ/2, event = ≥N core beats) fixed a real fragility where one −0.9 Θ noise
      draw split a genuine dip.

### 📊 FIRST FIVE REAL NIGHTS (2026-08-13 → 17, pulled from vigil same day) — measured, and the answer is refusals with names

| night | ring (finger) leg | ankle (Verity) leg — after the two fixes below |
|---|---|---|
| 08-13 | ⊘ floor 128.8 ms | floor 17.1 ms · **76.8 dips/h vs 20.3 chance — lift 3.8** |
| 08-14 | ⊘ floor 90.0 ms | floor **4.9 ms** · **33.2 dips/h vs 2.1 chance — lift 15.6**, median depth 36.6 ms |
| 08-15 | ⊘ floor 142.4 ms | ⊘ floor 1184 ms (no well-overlapping session pair found) |
| 08-16 | ⊘ floor 84.0 ms | floor 9.8 ms · **64.0 dips/h vs 12.3 chance — lift 5.2** |
| 08-17 | ⊘ no pair | ⊘ no overlapping pair |

### 🔧 The first ankle diagnosis was WRONG, and correcting it is what made the leg readable

The first run reported the ankle "quantized (floor 0.0 ms — integer-sample feet)". **Both halves of
that were false**: the feet are 100 % fractional (`detectBeats` already routes through the sub-sample
`refineFeet`; 499/500 distinct intervals measured). The exact zeros were **self-inclusion
degeneracy** — a centered rolling median over a locally *monotone* lag stretch IS the centre element,
so a baseline containing the value it judges made dev ≡ 0. Same family as the compendium §8's "a
statistic whose reference comes from the data it tests cannot fail". Two fixes:

1. **Leave-self-out baseline** — the beat's own lag is excluded from its median window. This also
   un-hid a second bug the zeros were masking: the crude probe paired biggest-file-with-biggest-file,
   which on multi-session nights pairs non-overlapping recordings (floor ≈ one RR, ~1150 ms).
2. **Overlap-aware ankle pairing** in `pat-dip-index.mjs --leg ankle` (the coupler's `pairsIn` is
   deliberately ring-locked, so the ankle gets its own selector with the same overlap-max rule).

Plus a **chance line beside every index**: expected ≥N-core-run rate from noise alone, with
`p = P(dev ≤ −Θ)` *measured*, not assumed Gaussian — deliberately optimistic (independence), so an
index *near* it is certainly noise while an index above it is only candidate signal. On 08-13 that
line is what converts "76.8 dips/h" from a headline into "3.8× a 20.3/h chance floor".

**Where this leaves the estimand:** the ankle leg produces PTT-arousal-shaped numbers on its first
readable nights — 33 dips/h at 36.6 ms median depth over a 4.9 ms floor is Pitson/Katz-scale — but
the lift is against an optimistic analytic null; the §5 shuffle null and the CPAP-event coupling
remain owed before any published claim. The finger leg refuses every night, floors 84–143 ms,
matching §5.2's 91.8 ms display-waveform foot sd: its path is `_PPG2W` optics or nothing.

**The finger leg refuses every night for the reason already in the compendium** — floors of
84–143 ms match §5.2's measured 91.8 ms foot-to-foot sd of the `_PPG.txt` DISPLAY waveform; the good
optics (18.9 ms) are in the unread `_PPG2W.txt`, which needs a timing story first (§9.5). The ankle
story is above: one wrong diagnosis, two real fixes, and then readable nights.

**The fold itself (same five nights, all three Dexes + Integrator):** 4/5 nights are full trios
(7.5–8.1 h three-way overlap; 08-17 has no O2Ring anchor). The new PB detector emits on **0/4**
nights (36 % base rate corpus-wide), the three-observer fusion corroborates 0/4, and κ vs the CPAP
**correctly REFUSES** — "the device scored PB on NO night (n=4) — one rater never varied" — the
degenerate-margin guard's first firing on live data.
- [x] **WIRED and RUN 2026-08-17 — and the first result is an honest NEGATIVE, stated as the box
      demands.** `tools/pat-dip-validate.mjs`: per-night CPAP clock anchoring (δ swept ±70 min,
      scored as the share of OxyDex desats explained by a preceding CPAP event — an INDEPENDENT
      pair, so the Katz fraction never anchors on itself), coverable-events denominator (the
      `coupleRtoFoot` §2 lesson re-applied), and a null of 10 circular shifts of the dip onsets.

      On the newest five nights exactly ONE anchors: 08-14 at δ = −23.5 min (75 % of desats
      explained; kin to the corpus's known ~38–42 min CPAP slowness). There:

      | events (coverable) | dips | Katz % | chance % |
      |---|---|---|---|
      | 23 (14) | 139 | **7** | **36** |

      **Sub-chance.** 1 of 14 coverable events was followed by a dip, against ~5 expected from the
      onset-shift null. n = 1 night / 14 events — far too small to conclude, but the direction is
      recorded rather than softened: on this night the dips did NOT point at the device's events.

      **The suspect list was then worked through by measurement, same day, and each elimination is a
      wired capability rather than a note:**
      | suspect | test | verdict |
      |---|---|---|
      | dips live in motion periods CPAP-scored sleep excludes | **motion gate wired** (Verity's own ACC, per-second envelope, mean+2σ; dips quiet only if no moving second touches them) | ❌ eliminated — 100 % quiet time, 136/139 dips quiet, Katz unchanged 7/36 |
      | window anchored on event START while Katz's arousal follows TERMINATION | rescored at `tMs + meta.durSec` (all 23 events carry it) | ❌ eliminated — durations 10–22 s inside a 55 s window; Katz unchanged |
      | δ locked a harmonic | full peak-structure sweep at 0.5-min steps | thin but unique — one 75 % plateau (−23.5 ± 0.5 min) on 3-of-4 desats; competitors all at 2-of-4 |
      | dips couple at a different latency | **latency sweep**, 55 s window stepped ±180 s around event end | ❌ **flat at 7–14 % everywhere** — no coupling at any lag within ±3 min |

      So on the one anchorable night the negative is real, not artifactual: the ankle dips are
      internally coherent (analytic lift 15.6 over their own chance line) but do not align with the
      device's scored events at any tested lag. What would move this forward is nights with real
      event density — the treated subject's 14 coverable events with one device-positive class is
      the same n-starvation as §3.3's κ — or an OSA-style night. The machinery is now in place to
      consume them the moment they exist.

      Three tool-design defects were found and fixed by their OWN first runs, each the repo's
      recurring shape: an anchor criterion that could not succeed on a treated night (3–4 desats
      cannot explain ≥50 % of 23 events — the mirror of a gate that cannot fail); a Katz denominator
      counting events outside the dip-covered span (measuring recording overlap, not coupling); and
      a foot-shift null so destructive the readability gate refused all 10 surrogates (a null that
      cannot execute is not a null — onsets are shifted instead, count-preserving).
- [x] **CLOSED 2026-08-18 — both fixed, and export-inert STRUCTURALLY rather than by assertion.**
      ⚠️ The reference was dangling: **this brief has no §3.4** (§3 "The proposal" carries no
      subsections). The two defects meant are the ones the *"🔧 The first ankle diagnosis was WRONG"*
      section above describes — **self-inclusion degeneracy** in the rolling-median baseline, and
      **biggest-file-with-biggest-file pairing** that matched non-overlapping sessions. Verified
      present on `main` by identifier rather than by memory: `leave-self-out` in `pat-align.js`,
      `anklePair`/`overlapMin` in `tools/pat-dip-index.mjs`.
      **Export-inert is a property of the build graph here, not a claim:** `pat-align.js` is inlined
      into **0** bundles and `pat-dip-index.mjs` is not in `build-analysis.mjs`'s `TOOLS`, so neither
      file can reach any bundle's compute closure and no fixture can move. Nothing to regenerate —
      and per §🔒 that is the *computed* form of export-inertness, not the prose form the repo
      abolished.
      **The box was stale against its own brief:** the prose two screens up already described both
      fixes as applied. A later reader ranking work by unchecked boxes would have redone them.
- [ ] `patArousalIdx` gets a registry row (`experimental`, autonomic wording) before any surface
      shows it.
      **NOT YET ACTIONABLE, and deliberately so (checked 2026-08-18): `patArousalIdx` appears in NO
      source file** — zero hits across `*.js`/`*.mjs`. This is a *guard on future work*, not a
      backlog item: it fires the moment someone names the metric, and adding a registry row now
      would grade a metric that does not exist. Leave unchecked until a surface exists.
