<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-07-22 (**2026-07-22 close-out — §1 residual + corpus confirmation EXECUTED, all remaining §2 items recorded; see the two "§ … 2026-07-22" blocks below.** (i) The corpus-machine confirmation that was "still owed" is CLOSED on real hardware: the 4 all-LED-double nights re-run OLD-vs-NEW DSP on the raw Verity+H10 corpus give OLD Verity/ECG ratios **1.90–2.20** — all inside the `harmonic-double` band [1.5, 3.0] — and NEW recovers each to **~1.00**, so the band is now re-measured, not asserted. (ii) pickChannel gained a `harmonicOutlierRefIdx` guard (defense-in-depth; **inert on every real night** because the §1 refractory already de-doubles each channel — verified byte-identical, 0 fixtures moved). (iii) The three remaining §2 doc items are closed as RECORDED conclusions, NOT paper edits — none of the other papers move: the SENSOR-TRIO-NIGHTS CI curve is SIMULATED (independent of real nights-solved; its real anecdote already uses 26 nights), VERITY-SIGMA-CORNER §7's ≥1-non-resting requirement is a dynamic-σ need orthogonal to this resting-regime fix and STANDS, and SIGMA-PAPER-REWRITE's Verity 1.94 is confirmed unchanged. — Original 2026-07-12 record follows. **§1 EXECUTED** — root cause found and fixed: TERMA's bare `maPeak > maBeat` has no amplitude discrimination, so a prominent DIASTOLIC (reflected) wave raised its own block and was counted as a second beat ~half a cycle after systole; at the corpus' sleeping 48 bpm that is ~625 ms, **twice** the fixed 0.30 s refractory, so the optical HR read exactly 2× true. On 3 of the 4 nights ALL THREE LEDs doubled together, so the 2-of-3 consensus ratified the harmonic. Fixed by sizing the refractory from a **windowed-autocorrelation cadence** (a notch is a HARMONIC, so the ACF fundamental is immune) — cadence sizes the refractory only, it does NOT gate detection (that was the retired global-period detector's missed-beat bug). Validated against paired chest-ECG on all 17 trio nights: **17/17 HR-clean, 4 recovered, 0 regressions**; `uploads/trio/` re-derived. Note the brief's own three hypotheses (a)/(b)/(c) were all WRONG — see §1 EXECUTED below. **§2 PARTIALLY EXECUTED — and its PREMISE WAS REFUTED by its own first test:** the like-for-like run of the REAL `sensor-trio-worker.js` per-second path (old vs new DSP) shows the worker's Verity gate was ALREADY dropping every doubled night as "poor PPG contact", so the contamination never reached the published median — old per-second Verity σ is **1.94 bpm, exactly the `SIGMA-PAPER-REWRITE` figure, which is CONFIRMED and stands**. The earlier claim that "the published 6.2 measured the bug" is **WRONG — do not repeat it**; the 6.2 planted in `sensor-trio-power-analysis.html` remains UNEXPLAINED. The fix's real value: the gate was MISDIAGNOSING harmonic doubling as sensor contact failure, silently costing **41% of the corpus** — nights solved **10 → 15**, σ unchanged (1.94 → 1.85).) · **Created:** 2026-07-11 · **Follows:** the PPI-spine arbiter fix (changeset `2026-07-11-ppgdex-ppi-spine-crosscheck.md`) · **Feeds:** `INTEGRATOR-THREE-CORNERED-HAT-FOLLOWUPS-III-2026-07-06-BRIEF.md` §1 · `PAPERS-ROADMAP-2026-06-24-BRIEF.md` §3.3 · `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`

# PpgDex optical detector — the residual all-LED failure, and re-deriving the published Verity σ

> **One-line:** the PPI-spine arbiter (shipped 2026-07-11) fixed the *reference-channel* half of the optical-HR
> failure and took the real trio corpus from 11 → 13 HR-clean nights out of 17. **Two things it did NOT fix
> remain owed:** (§1) four nights where **all three LEDs mis-detect**, which no spine choice can rescue — they
> are now *flagged*, not repaired; and (§2) the **published Verity σ of 6.2 bpm**, which appears to have been
> measured on a corpus containing exactly those broken nights, i.e. it may be measuring the bug rather than
> the device.

## Background — what was already fixed (do not redo)

`consensusBeats` builds a **reference-independent** peak spine (a beat survives only where ≥2 of 3 LEDs agree
within ±50 ms), but `refineFeet` then re-derived the systolic feet on the **single** reference channel picked by
`pickChannel`, and `buildPPI` measures foot-to-foot — so the vote's robustness was discarded exactly where it
counted. `pickChannel` ranks channels by pulse-band SNR (0.7–3.0 Hz) over one 90 s mid-record window, and a
channel counting **harmonics still lands inside that band** (a doubled 48 bpm = 96 bpm = 1.6 Hz), so a corrupted
LED could be selected as the reference. Result: optical HR read 2–3× true.

Shipped fix: build both spines off the same consensus beats, Malik-correct each, and let the **correction rate**
arbitrate (a coherent series needs few repairs; a doubled one needs many — measured separation on the real corpus:
good half 1–29%, corrupted half 43–98%). Feet stay the default, displaced only by a 10 pp margin, so clean records
are byte-identical. New rich-export quality fields: `ppiSpine`, `ppiAgreementPct`, `ppiCorrFootPct`, `ppiCorrPeakPct`.

⚠️ **An agreement threshold was tried FIRST and REJECTED — do not reintroduce it.** It detects only *that* the two
halves disagree, never *which* is right, and both directions occur in the real corpus (2026-06-30 needs peaks,
2026-06-15 needs feet). A 0.90 cutoff duly regressed 06-15 from a correct 49.1 bpm to a wrong 57.5.

## §1 — The residual: four nights where ALL THREE LEDs mis-detect

On four of the 17 concurrent trio nights the optical HR is still ~2× chest-ECG truth, and **neither** spine is
correct — the beat detector is failing on every channel, so the ≥2-of-3 vote happily ratifies spurious beats
(2/3 agreement on a harmonic is still 2/3). Ground truth is the paired Polar H10 raw-ECG corner.

| night | ECG (truth) | PpgDex HR | ratio | spine | footCorr | peakCorr |
|---|---|---|---|---|---|---|
| 2026-06-29 | 49.7 | 100 | 2.01 | peak | 43.8% | 30.5% |
| 2026-07-01 | 48.0 | 94 | 1.96 | peak | 92.7% | 61.7% |
| 2026-07-02 | 48.4 | 106 | 2.19 | foot | 42.3% | 34.1% |
| 2026-07-05 | 57.8 | 110 | 1.90 | foot | 60.4% | 76.4% |

Diagnostic already established (2026-07-01, `detectChannel` per LED): LED0 39 403 beats → 91.2 bpm while LED1/LED2
give 23 569 / 23 512 → 54.6 / 54.4 bpm. So the failure is **not** uniform noise — individual channels double-count
while others are near-truth, and on these four nights enough channels fail together to carry the vote.

### §1 EXECUTED — 2026-07-12 (all three hypotheses below were WRONG; the real cause was a fourth)

**Root cause.** TERMA calls a beat wherever the short upstroke-energy average exceeds the long one — a bare
`maPeak > maBeat`, with **no amplitude discrimination**. A prominent **diastolic (reflected) wave** is a
genuine positive-slope event, so it raises its own block and is counted as a second "beat" about half a cycle
after systole. At the corpus' sleeping ~48 bpm that lands ~625 ms out — **twice** the fixed 0.30 s refractory —
so nothing suppressed it and the HR read exactly 2× true. Evidence: the bad channel's peak-to-peak intervals are
not noisy, they are cleanly **unimodal at 600–700 ms** against a true 1250 ms beat.

**The three hypotheses in the original "Done when" were all wrong, and the disproofs are worth keeping:**
- **(a) threshold collapse / notch-firing on low perfusion** — half right (it IS the notch) but the mechanism is
  not perfusion-dependent collapse; it is the *absence of amplitude discrimination*, which bites on any record
  with a strong reflected wave.
- **(b) refractory too permissive** — right that 0.30 s cannot reject the intruder, but a *fixed* larger value is
  not the fix: it would reject genuine tachycardia. The refractory has to scale with the **local** beat.
- **(c) `orient()` inverting** — no evidence; orientation is stable on the failing records.
- Also tried and REJECTED: **adapting TERMA's `W2`** to the true cadence (re-running the doubled channel with
  W2 = the real 1230 ms beat still returned 94.5 bpm — the threshold has no amplitude offset, so widening the
  long average changes nothing), and a **cross-channel cadence prior** (it collapses exactly where needed: on
  06-29 / 07-02 / 07-05 *all three* LEDs double together, so the median cadence is doubled too and nothing looks
  deviant — this was never a bad-channel problem).

**The fix.** A dicrotic notch is a **harmonic** (it sits at T/2) while the autocorrelation still peaks at the true
beat T. A **windowed** ACF of the pulse band (0.5–3.0 Hz, decimated to ~25 Hz) recovers the true cadence on every
night — worst error 1.2 bpm vs chest-ECG, *including* the four where peak-counting doubles. That cadence sizes an
**adaptive refractory** (`REFR_CADENCE_FRAC = 0.60` × the local beat, floored at the old 0.30 s); TERMA still finds
every peak and the existing amplitude arbitration (keep the taller peak on a conflict) discards the smaller
diastolic one. The cadence **sizes the refractory only — it does not gate detection**, which is the distinction
from the retired whole-record global-period detector that caused missed beats.

**Result:** 17/17 HR-clean across the trio corpus, 4 nights recovered (06-29 100→50 vs ECG 49.7 · 07-01 94→48 vs
48.0 · 07-02 106→48 vs 48.4 · 07-05 110→58 vs 57.8), **0 regressions**. `ppiAgreementPct` rises to 99–100% on the
recovered nights — the foot and peak spines now agree, independently corroborating the beat spine. The
`PpgDex_2026-06-27_equiv` fixture was regenerated (`contentId` 7e887548f693→2c3b67527577) and `uploads/trio/`
re-derived.

**Residual (not blocking):** `pickChannel` still ranks on one 90 s mid-record window with an SNR metric blind to
harmonic counting. The adaptive refractory made this non-fatal — it is no longer load-bearing — so the hardening
below stays optional.

### §1 residual EXECUTED — 2026-07-22 (`harmonicOutlierRefIdx` guard, defense-in-depth)

`pickChannel` now carries a **harmonic-outlier reference guard** (`harmonicOutlierRefIdx`, exported + unit-tested).
After the per-channel detection is in hand, if the SNR-picked reference reads a near-integer multiple (**≥1.5×**)
of a **coherent clean majority** of the other channels (spread < 15 %), the reference is moved onto the best-SNR
channel in that majority. It can only ever move the reference ONTO the agreeing channels, never off them, so it
cannot regress a night whose channels concur — and it needs ≥2 coherent OTHER channels, so it no-ops on the
finger/single-channel path.

**Measured inert, not assumed:** on the real corpus every channel already reads the true cadence under the §1
refractory, so the guard **never fires** — 06-29 NEW+guard reproduces the pre-guard result byte-identical
(16 309 beats, HR 50), the committed Verity golden did **not** move (`regen-ppgdex-goldens --check`: 0 fixtures),
and on the four all-LED-double nights it correctly does nothing (all three channels double together → no clean
majority to fall back to — the refractory, not this guard, is what saves them; the guard is for a *lone* future
channel that doubles beside a clean pair). Gate-backed: 7 assertions (`§1 residual` group) covering re-pick,
all-double no-op, clean no-op, reference-already-clean, too-few-channels, half-rate, and incoherent-majority.
Suite 3681 green; PpgDex + orchestrators + 8 analysis tools + served docs re-bundled; GATE A/B PASS.

**The per-window-scoring half of the hardening is DEFERRED** as genuinely unneeded: scoring the SNR across
several windows guards the same failure the refractory already removed, and no corpus night exercises it. It
stays an optional future item, recorded here rather than in an empty follow-up.

---

**Done when** *(original — retained for the record; ✅ = met by the §1 EXECUTED work above)*
- [x] Root-cause the detector failure itself (`detectChannel` — O(N) TERMA, Elgendi 2013: positive-slope upstroke
      energy + dual moving-average local threshold). Hypotheses to test, in order: (a) the beat-adaptive threshold
      collapses on low-perfusion/high-DC-drift segments and starts firing on the **dicrotic notch**; (b) the
      refractory (0.30 s ⇒ a 200 bpm ceiling) is too permissive to suppress a notch at a sleeping 48 bpm
      (notch lands ~0.3–0.4 s after systole — *right at the edge*); (c) channel **orientation** (`orient()`
      derivative-skew) inverts on these records so the "peak" tracked is the wrong deflection.
- [x] Fix at the detector, not with another downstream filter. A physiological plausibility guard on the
      *detected rate* (a sleeping adult is not at 100–160 bpm) is acceptable ONLY as a flag, never as a silent clamp
      — CLAUDE.md: `null` = unknown, never fabricated.
- [x] Recover ALL 4 of the 4 nights against chest-ECG truth (ratio 0.9–1.15), with **no regression** on the 13 currently-clean
      nights and the committed `PpgDex_2026-06-27_equiv` fixture still reproducing (byte-identical, or regenerated
      per §🔏 with the output re-derived, never hand-edited).
- [x] `pickChannel` hardening (secondary): **EXECUTED 2026-07-22** — the "reject a channel whose detected rate is
      a near-integer multiple of the other channels'" half shipped as `harmonicOutlierRefIdx` (see §1 residual
      EXECUTED above); inert on the real corpus, gate-backed, 0 fixtures moved. The "score across several windows"
      half is DEFERRED as unneeded (the refractory already removed the failure it guards).

## §2 — Re-derive the published Verity σ

### §2 EXECUTED — 2026-07-12 · ⚠️ THE PREMISE OF THIS SECTION WAS **REFUTED** BY ITS OWN FIRST TEST

**The claim this section was written on — that the published σ "measured the bug" — is WRONG. Do not repeat it.**

The like-for-like run (Done-when #1) settles it. `tools/` harness drives the REAL committed `sensor-trio-worker.js`
(its channel pick, its consensus, its foot-to-foot `ppgHrMapReal` per-SECOND grid, its TCH kernel, **and its Verity
gate**), changing exactly one thing — `ppgdex-dsp.js`, `origin/main` vs the ACF-refractory fix:

| worker per-second path | nights solved | median σ: O2Ring / H10 / **Verity** |
|---|---|---|
| **OLD DSP** (the code behind the published numbers) | **10 / 17** (7 gate-dropped) | 2.95 / 1.84 / **1.94 bpm** |
| **NEW DSP** (ACF adaptive refractory) | **15 / 17** (2 gate-dropped) | 2.60 / 1.58 / **1.85 bpm** |

**Why the original premise was wrong:** the worker's Verity gate **was already excluding every doubled night** — it
dropped all 7 as *"Verity unreliable — poor PPG contact"* (σ 15–35 bpm, r < 0.4). The harmonic contamination therefore
**never reached the published median**. The old per-second median is **1.94 bpm — which is EXACTLY the figure
`SIGMA-PAPER-REWRITE-2026-07-06` reports.** That paper's number is **correct, reproducible, and stands.**

The mistake was comparing a **5-min-epoch** σ (6.83 on the *unfiltered* corpus) against a published number produced by
a **different estimator with a gate that had not been run**. `tools/tch-multinight.mjs` has **no Verity gate at all** —
that, not the published pipeline, is why 6.83 was contaminated.

⚠️ **The 6.2 bpm planted in `sensor-trio-power-analysis.html:74` is STILL UNEXPLAINED.** It is not harmonic doubling and
it is not the per-second path (which gives 1.94 with the same old code). Its provenance is a genuinely open question —
see the remaining Done-when below. **Do not "correct" it to 1.85 on the strength of this work.**

### What the fix DOES buy (the real, verified result)

The gate was **misdiagnosing the failure**: 5 of the 7 nights it discarded as *"poor PPG contact"* had perfectly good
optical signal — the detector was counting the dicrotic notch. They are now recovered:

| night | OLD (worker gate) | NEW |
|---|---|---|
| 2026-06-25 | 234 s overlap < 1000 | **solved** · σV 1.40 |
| 2026-06-29 | dropped — "poor PPG contact" (σ 15, rHV 0.32) | **solved** · σV 5.48 |
| 2026-07-01 | dropped — "poor PPG contact" (σ 28, rHV 0.21) | **solved** · σV 2.43 |
| 2026-07-02 | dropped — "poor PPG contact" (σ 20, rHV 0.08) | **solved** · σV 6.19 |
| 2026-07-05 | dropped — "poor PPG contact" (σ 33, rHV −0.18) | **solved** · σV 5.00 |
| 2026-06-30 | dropped — (σ 35, rHV 0.10) | still dropped (genuinely bad) |

**Nights solved 10 → 15 (+50% usable corpus), σ essentially unchanged (1.94 → 1.85, within noise).** The headline is
NOT "the published σ was wrong" — it is: **the detector bug was silently costing 41% of the corpus, disguised as sensor
contact failure.** That lands directly on `SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md`, whose whole subject is how many
co-recorded nights are needed to pin σ — more surviving nights tighten the CI at no capture cost.

**Done when**
- [x] Re-run `sensor-trio-worker.js`'s own per-second Verity path over the trio corpus, old vs new DSP, like-for-like.
      → **Done; it REFUTED the section's premise (above).**
- [x] **Trace the actual provenance of the planted 6.2 bpm.** → **DONE 2026-07-12. It is DEAD PROSE — it does not exist
      in any live code path, and there was never a 6.2-based result to overturn.**
      - **Origin:** `Science.html:190` says it outright — *"1.7 / 2.2 / 6.2 … from a real ~2-hour co-recording"*. An
        **N=1, single ~2-hour window** estimate from the original Verity-corner work. Never a corpus number.
      - **Superseded twice, knowingly:** `SIGMA-PAPER-REWRITE-2026-07-06` §Do 2 records the chain — *"its planted Verity
        σ was re-fit **6.2 → 3.0** from the device-HR run; the raw-ECG run gives **1.94**. Decide the planted value once
        … **re-run `sensor-trio-power-analysis.html` after**."* Do 1–3 (the papers) were EXECUTED; the trailing
        "re-run the tool" was not — so the tool's PROSE kept the dead number.
      - **The code was already right.** `sensor-trio-power-analysis.js:72-74` plants **O2Ring 2.72 / H10 1.86 /
        Verity 1.94** (the raw-ECG 10-night hat). The simulation has been running on 1.94 all along. `6.2` occurs
        **0 times** in `sensor-trio-power-analysis.js`, `sensor-trio-worker.js` and `sigma-no-reference-analysis.js`;
        it survived ONLY in two captions (`sensor-trio-power-analysis.html:74`, `Science.html:190`), both now fixed.
      - **Consequence for this brief:** the retraction above is doubly justified — the "published 6.2" was never
        published in any executing sense. And the corrected per-second run (**1.85**) confirms the LIVE planted value
        (**1.94**) to within 0.09 bpm. **Nothing in the science moves.**
      - **Also fixed:** the tool still called Verity *"the noisy corner"*. On the raw-ECG hat the noisiest corner is the
        **O2Ring** (2.72) and Verity is the **quietest** (1.94) — the "noisy-corner reorder (Verity→O2Ring)" that
        `SIGMA-PAPER-REWRITE` applied to the papers but never to this tool.
- [x] **Fix the Verity gate's misdiagnosis, not just its threshold** → **DONE 2026-07-12.**
      `sensor-trio-worker.js` now **classifies** the failure instead of blaming the sensor. A pure
      `verityFailureClass(hrRatio)` splits it three ways from the median HR ratio against the paired ECG corner:
      `harmonic-double` (1.5–3.0 — *"OUR DETECTOR is counting the dicrotic notch; the sensor is fine"*),
      `harmonic-half` (0.33–0.67 — missed beats, also ours), else `poor-contact` (near no multiple = genuinely
      the strap). The skip result now carries `failure` + `hrRatio` as machine-readable fields.
      **The skip DECISION is byte-identical** (same σ>12 / r<0.4 condition — only a `{` moved), so the published
      σ, the nights-solved count and every aggregate are **unchanged**. What changed is the *verdict*: a
      recurrence now says "look at the detector", not "blame the strap" — which is the mistake that cost 41% of
      the corpus for weeks.
      **Separation measured on the real corpus, not assumed:** across all 17 committed trio nights
      (`ECGDex` vs `PpgDex` `hrv.time.hr`) the CLEAN band is **0.974–1.012, median 1.000** — reproducing the
      0.99–1.01 cited above from committed data, and leaving a **0.49 margin** below the 1.5 doubling threshold,
      so no healthy night is reachable by a "detector" verdict. Gate-backed (`Verity gate classifies the
      FAILURE`, 15 assertions; verified to red against the pre-fix worker). **No re-bundle** — the worker is not
      inlined into any bundle.
      ✅ **CLOSED on real hardware — 2026-07-22.** The *doubling* band (1.5–3.0) is now RE-MEASURED, not asserted.
      The 4 all-LED-double nights were run OLD (`c090061`, pre-§1) vs NEW (current) DSP directly on the raw
      Verity `_PPG.txt` + paired Polar H10 `_ECG.txt` (whole-night `PPGDSP.analyze` `dispHr` vs `ECGDSP`
      Pan–Tompkins), reproducing the brief's §1 table exactly:

      | night | ECG | OLD Verity | ratio (OLD) → class | NEW Verity | ratio (NEW) |
      |---|---|---|---|---|---|
      | 2026-06-29 | 49.4 | 100 | **2.02** → `harmonic-double` | 50 | 1.01 |
      | 2026-07-01 | 48.1 | 94  | **1.95** → `harmonic-double` | 48 | 1.00 |
      | 2026-07-02 | 48.1 | 106 | **2.20** → `harmonic-double` | 48 | 1.00 |
      | 2026-07-05 | 57.8 | 110 | **1.90** → `harmonic-double` | 58 | 1.00 |

      Every OLD ratio lands inside [1.5, 3.0], so `verityFailureClass` labels all four `harmonic-double`; NEW
      recovers each to ~1.00. (The gitignored-corpus limit that blocked this in-repo, `EFFICIENCY-AUDIT-FINDINGS-2026-07-12`
      §G1, is unchanged — this run used the raw capture corpus off-repo; it re-measures the classification, it
      does not commit any raw file.) One diagnostic worth recording: the doubling only appears on the WHOLE-night
      `analyze` — a short mid-night window can sit on a clean segment and read the true rate under OLD code too,
      so the confirmation must run the full night, not a slice.
      <details><summary>the superseded item, for the record</summary>

      Fix the Verity gate's **misdiagnosis**, not just its threshold: it labels harmonic doubling as *"poor PPG contact"*.
      The signals are distinguishable — doubling is a *scaled copy* of truth (still correlated, HR ratio ≈ 2 against a
      paired ECG corner), whereas lost contact decorrelates. A cross-node HR-ratio test separates them cleanly
      (0.99–1.01 vs 1.6–2.9, bimodal). Note the node-local `ppiCorr*Pct` rates are NOT sufficient alone (2026-06-25 is
      *correct* at 28.8% while 2026-06-29 is *wrong* at 30.5% — they overlap).
- [x] Re-run `SENSOR-TRIO-NIGHTS-PAPER` power analysis for the extra nights: **RECORDED 2026-07-22 — no paper edit.**
      The premise ("N=10→15 changes the CI, the paper's entire deliverable") does not hold: that paper's CI-vs-N curve
      is SIMULATED over N_windows ∈ {1,2,3,5,8,12,20} with planted σ (2.7/1.9/1.9), so it is independent of how many
      real nights survive — more usable nights just read the SAME curve further along (tighter *achieved* CI, ≈×√(10/15)),
      they don't move the curve. The paper's real-corpus anecdote already stands at **26 nights** (σ 2.41/1.28/1.42),
      well past 15, so nothing in `sensor-trio-nights.html` changes. The 10→15 gain is the *worker per-second path's*
      usable-night count (§2 above), which is where it belongs.
- [x] `SIGMA-PAPER-REWRITE-2026-07-06`'s Verity 1.94 is CONFIRMED — **RECORDED 2026-07-22.** Reproduced exactly by the
      §2 like-for-like run (old per-second Verity σ = 1.94, identical to the paper); the corrected run gives 1.85, within
      0.09 bpm. No change to that paper — the confirmation is the deliverable, and it is recorded here.
- [x] Re-check `VERITY-SIGMA-CORNER-BRIEF.md` §7's non-resting item against the corrected detector: **RECORDED 2026-07-22
      — it STANDS.** The ≥1-non-resting-session requirement exists because the TCH under-states σ in the *resting* regime
      (it strips shared beat-to-beat HRV — `sensor-trio-nights.html`: "resting nights buy precision while quietly biasing
      the answer"). That is a dynamic-σ regime property, ORTHOGONAL to the resting-doubling *detector* bug this brief
      fixed. The detector fix adds usable nights; it does not remove the need for a moving session, so §7's item is
      unchanged.

## Inputs (already committed — no new capture needed)

`uploads/trio/` — 17 concurrent trio nights × 3 `ganglior.node-export` JSONs (ECGDex · PpgDex · OxyDex), derived by
`tools/trio-batch.mjs` from the raw Polar Sensor Logger + O2Ring capture folder, every export run through the shared
`dexScrubExport` (no device/serial/model, 5-min summary epochs, **no raw signal**). Corners are paired by **temporal
overlap** against the O2Ring anchor — filename date ≠ night, and a size-based pick silently mated a 12:14 daytime ECG
with an overnight PPG on 2026-06-13 before this was fixed. The raw capture folder itself stays gitignored.
