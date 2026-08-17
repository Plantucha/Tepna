<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-17 · **Follows:** `OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md` (DONE — 2026-08-17) · **Affects:** `oxydex-dsp.js computePatternScores`, `briefs/SYNTHETIC-CORPUS-BRIEF.md`, the CPAP/ECGDex corpora

# What the PB detector's execution turned up and did not close

The parent is DONE: all boxes met, gates green. Six things surfaced while executing it that it did not
own. Each is stated with **how strongly it is established**, because three of them are hazards rather
than defects and treating them as bugs would be its own error.

---

## 1 · 🟡 LATENT — `cycleIntervals` is a sliding view, and its length is not a cycle count

`computePatternScores` builds `cycleIntervals` by sliding one half-cycle at a time
(`oxydex-dsp.js:1030`), so for `k` true cycles it holds `2k − 1` entries. The parent's §2.2 measured
this: 2 real cycles → 3 entries.

**Checked before writing this, and it is NOT currently a defect.** `cycleIntervals.length` appears only
as a **divisor** (mean, SD) and as a `> 1` guard — never as a "≥ N cycles" criterion. And the parent
measured that the overlap does **not** bias the SD (1.43 vs 1.41 disjoint), so `pbCycleLen` /
`pbCycleLenSD` are honest.

**The hazard is the next reader.** An array named `cycleIntervals` whose `.length` is not the number of
cycles is a trap laid for exactly the criterion AASM states (`≥ 3 consecutive`), and the new detector
had to avoid it deliberately. Options: rename to `cycleIntervalsSliding`, or add the disjoint count
beside it, or a comment at the declaration. **Do not "fix" the sliding construction** — the mean and SD
that consume it are correct as they are.

## 2 · 🔴 OPEN — ρ = 0.98 is inherited, not measured on this corpus

The parent's §2.3 chose `PB_MAX_CYCLE_CV = 0.13` from two measured distributions: red noise never below
CV 0.147, PB never above 0.111 out to ±10 s jitter. The red-noise arm was generated at **ρ = 0.98**,
which came from `OXYDEX-FFT-CYCLE-NULL-2026-08-16` — a different estimator's null, not a measurement of
this corpus.

**Done when:** lag-1 autocorrelation is measured on the real O2Ring SpO₂ nights (61 available in
`<647A>/Ecg nightly`), stated with its sampling rate, and §2.3's table regenerated at that ρ if it
differs materially. If the corpus is *less* red than 0.98 the threshold is conservative and nothing
moves; if it is *more* red, 0.13 may not separate and the detector needs re-tuning against the
regenerated table — **not** against the corpus episode count, which is the tuning §5 forbids.

## 3 · 🔴 OPEN — the ECGDex third observer has never been exercised

`_pbObserver` admits three nodes. Every fusion measurement to date pairs **OxyDex with CPAPDex only**,
because the available ECGDex exports carry no `apnea.cvhrIndex` — that block landed 2026-07-23
(`11091ef`), after the committed trio corpus was generated. `pb-fusion-blast.mjs` reports this as
`0 of 0` and explicitly calls it *unexercised, not inert*.

**So "3/56 corroborated" is a two-observer floor, not a ceiling**, and the parent's §4 conclusion is
scoped accordingly. **Done when:** `tools/trio-batch.mjs` is re-run so ECGDex exports carry the `apnea`
block, and `pb-fusion-blast` is re-run with all three observers in scope.

## 4 · 🟡 κ rests on 4 device-positive nights

§3.3's κ = +0.149 (from −0.036) is real and paired, and it is **fragile**: the CPAP scored PB on 4 of 56
nights, so a single night changing cells moves it materially. It is the bottom Landis–Koch band.

**Done when:** more CPAP-positive nights are in scope. The CPAP corpus holds **189** nights against the
61 O2Ring nights that pair; extending the O2Ring side (vigil, or older archives) widens the intersection
without any new code. **Do not** re-report κ as validation until the positive class is larger — the
honest claim remains *below chance → above chance*.

## 5 · 🟢 SYNTHETIC-CORPUS's PB generator still emits the retired 40–90 s window

`briefs/SYNTHETIC-CORPUS-BRIEF.md` line 77 specifies *"~40–90 s cycle length, runs of 4–10 cycles"*.
§2.1 settled the window at **40–130 s** (AASM's floor is 40 s; 45–90 s is a typicality, not a bound), so
the synthetic corpus **cannot express a long-cycle night at all** — the exact population a 90 s ceiling
discards, which is where the pathology is worst.

**Done when:** the generator's cycle-length range widens to 40–130 s and a long-cycle night (≥ 100 s) is
present in the synthetic corpus. Cheap, and it makes the detector's upper band testable from committed
bytes rather than only from personal recordings.

## 6 · 🟡 PLAUSIBLE, still unverified — intervals may span skipped windows

Carried forward from the parent's §2.2 unchanged, because it was never checked: `crossingTimes` is
concatenated across windows while non-oscillating windows are `continue`d, so two consecutive entries
can sit either side of a gap. The only guard is `iv > 5 && iv < 300`, and `WIN` is **also** 300 — so a
gap-spanning pair landing under 300 s would be recorded as a cycle across a stretch explicitly judged
non-oscillating. **Whether real data produces such a pair is not established.** Check before relying on
interval continuity.

---

## What is NOT here

The detector itself is done and gated: four criteria, three adversarial twins (7/7), burden correlation
0.910 → 0.370, κ −0.036 → +0.149, fixtures regenerated and re-verified, full suite green with the
corpus. None of that is reopened here.

## Cross-references

- `OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md` — the parent (DONE 2026-08-17).
- `OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md` §3.4 — the fusion-inflation hypothesis §4 refuted.
- `OXYDEX-FFT-CYCLE-NULL-2026-08-16-BRIEF.md` — where ρ = 0.98 comes from, and the red-noise null.
- `docs/CORPUS-LOCATIONS.md` — where the CPAP and O2Ring corpora actually are.
