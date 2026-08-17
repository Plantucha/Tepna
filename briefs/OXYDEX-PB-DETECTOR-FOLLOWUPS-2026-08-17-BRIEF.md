<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-17 (**§2 and §6 CLOSED by measurement the same day**: ρ measured at median 0.9804 with the CV threshold re-validated across the corpus's real redness including the reddest night, and the gap-spanning hazard shown to be fully caught by the existing guard. §1 CLOSED (mitigated at the declaration; NOT on a reclassification — see the note there). §3 HALF-CLOSED — the observer is in scope, the three-observer result is not. §3b ADDED — OxyDex publishing axis provenance would silently upgrade an Integrator guard. §4, §5 remain open) · **Created:** 2026-08-17 · **Follows:** `OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md` (DONE — 2026-08-17) · **Affects:** `oxydex-dsp.js computePatternScores`, `briefs/SYNTHETIC-CORPUS-BRIEF.md`, the CPAP/ECGDex corpora

# What the PB detector's execution turned up and did not close

The parent is DONE: all boxes met, gates green. Six things surfaced while executing it that it did not
own — **two of which (§2, §6) were closed by measurement on the day this brief was written**. Each is stated with **how strongly it is established**, because three of them are hazards rather
than defects and treating them as bugs would be its own error.

---

## 1 · ✅ CLOSED — `cycleIntervals` is a sliding view, and its length is not a cycle count

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

### ✅ CLOSED 2026-08-17 — mitigated at the declaration, and the construction left alone

A comment now sits at the `cycleIntervals` declaration stating plainly that **`.length` is not the
number of cycles**, giving the `2k − 1` mapping, recording that the mean and SD it feeds are unaffected
(SD 1.43 sliding vs 1.41 disjoint), and pointing at `detectSpO2Periodicity`'s disjoint pairing as the
thing to copy if a cycle **count** is ever needed. The sliding construction is unchanged, deliberately.

**Why a comment rather than the rename:** `pbCycleLen` is not an internal — it is exported to CSV as
*"PB Cycle Length (s)"* (`oxydex-app.js:432`) and it gates two decisions, the CS criterion
(`oxydex-dsp.js:1544`, the 40–130 s window) and UARS (`:1562`). Renaming the array is a wider edit
across live consumers for no behavioural gain, and the trap is one of *reading*, which is what a comment
at the point of declaration addresses.

⚠️ **Closed on this mitigation, NOT on a reclassification.** The owner suggested it could be closed
because "trio was reclassified to experiment". Checked with Vigil box, who owns that work: #1418 adds a
**new** entry `tch_error_pseudo` at `heuristic`, `tch_error` itself is untouched and remains
`experimental`, and **no existing tier moved and nothing about trio was reclassified**. That change is in
the Integrator and has no bearing on this item. Recorded because closing on it would have been a
wrong-premise closure of exactly the kind this brief keeps flagging.

## 2 · ✅ CLOSED 2026-08-17 — ρ measured: **median 0.9804**, and the threshold holds at the reddest night

The parent's §2.3 chose `PB_MAX_CYCLE_CV = 0.13` from two measured distributions: red noise never below
CV 0.147, PB never above 0.111 out to ±10 s jitter. The red-noise arm was generated at **ρ = 0.98**,
which came from `OXYDEX-FFT-CYCLE-NULL-2026-08-16` — a different estimator's null, not a measurement of
this corpus.

**MEASURED on 61 real O2Ring nights** (`<647A>/Ecg nightly`, 1 Hz, median night 24 959 samples), lag-1
autocorrelation of SpO₂ through the shipped `parseCSV`:

| min | p25 | median | p75 | max | mean |
|---|---|---|---|---|---|
| 0.9552 | 0.9768 | **0.9804** | 0.9845 | **0.9968** | 0.9800 |

**The inherited 0.98 was right** — median 0.9804, mean 0.9800. 34 of 61 nights sit at or above it.

**And the tail is what mattered, so it was tested rather than waved through.** The reddest real night is
ρ = 0.9968, so the §2.3 red-noise sweep was re-run across the measured range against the **shipped**
detector (`PB_MIN_CYCLES = 4`, `PB_MAX_CYCLE_CV = 0.13`), 40 seeds each:

| ρ | fired | red-noise CV (runs ≥ 4): min · median · max |
|---|---|---|
| 0.98 | **0/40** | 0.210 · 0.270 · 0.391 |
| 0.985 | **0/40** | 0.179 · 0.268 · 0.374 |
| 0.99 | **0/40** | 0.156 · 0.277 · 0.362 |
| 0.995 | **0/40** | 0.195 · 0.294 · 0.401 |
| 0.9968 | **0/40** | 0.157 · 0.274 · 0.433 |

Zero false positives at every ρ in the measured range, and the tightest margin is **0.156 vs the 0.13
gate** — 0.026 of headroom at ρ = 0.99. The threshold is validated at the corpus's real redness, not
merely at the inherited figure.

⚠️ **The margin is real but not generous.** If `PB_MAX_CYCLE_CV` is ever raised toward 0.15 this table is
what forbids it; regenerate it before touching that constant, and note the relationship is not monotone
in ρ (0.99 is tighter than 0.995), so testing only the extremes would have missed the worst case.

## 3 · ⚙ HALF-CLOSED — the ECGDex third observer is now in scope; the three-observer result is not

`_pbObserver` admits three nodes. Every fusion measurement to date pairs **OxyDex with CPAPDex only**,
because the available ECGDex exports carry no `apnea.cvhrIndex` — that block landed 2026-07-23
(`11091ef`), after the committed trio corpus was generated. `pb-fusion-blast.mjs` reports this as
`0 of 0` and explicitly calls it *unexercised, not inert*.

**So "3/56 corroborated" is a two-observer floor, not a ceiling**, and the parent's §4 conclusion is
scoped accordingly. **Done when:** `tools/trio-batch.mjs` is re-run so ECGDex exports carry the `apnea`
block, and `pb-fusion-blast` is re-run with all three observers in scope.

### ⚙ HALF-CLOSED 2026-08-17 — the observer is now IN SCOPE; the three-observer *result* is not yet obtainable

**Capability: resolved.** A `trio-batch` re-run against current code produces ECGDex exports that carry
the block — **18 of 18** (`cvhrIndex` 4.3, 3.3, 6.2 on the first three nights). The leg is no longer
unexercisable; nothing in the code was blocking it, only corpus staleness, exactly as the parent said.

**Measurement: still blocked, and by a date gap rather than by the leg.** Those 18 nights come from
`tepna-smoketest/captures`, which starts **2026-07-16**; the CPAP corpus ends **2026-07-21**. So the
nights carrying *both* an ECGDex `apnea` block and a CPAP export number **5**, and on them
`fusePeriodicBreathing` corroborates **0/5** — nothing to attribute to a third observer either way.

**So the parent's 3/56 remains a two-observer figure**, and the three-observer question is open. **Done
when:** ECGDex-carrying nights overlap the CPAP corpus in useful numbers — box captures from before
2026-07-21, which exist on `vigil` but not in the local `smoketest` tree. No code needed.

### 🐞 …and the tool was reporting its own scope wrongly — fixed here

`pb-fusion-blast.mjs` printed the caveat *"(0 of N means UNEXERCISED, not inert …)"* **unconditionally**.
Once the corpus was regenerated the output read **"18 of 18 carry apnea.cvhrIndex"** immediately followed
by an explanation of what "0 of N" means — a stale note contradicting the line directly above it.

That is worse than no note. A reader skimming for the scope caveat *finds one*, and concludes the third
observer is still unexercised — so the tool would have kept asserting a limitation it had already
outgrown, on every future run. Now it prints the state that actually holds: the unexercised text only
when the count is 0, a PARTIAL line when some nights carry it, and an explicit *"the third observer IS in
scope"* when all do. All three branches verified against real runs; `--selftest` green.

## 3b · 🔴 NEW — OxyDex publishing axis provenance would silently upgrade an Integrator guard

Found 2026-08-17 by **asking Vigil box rather than inferring**, while checking whether their TCH work
bore on §1. It did not — but this does, and it runs the other way.

`integrator-dsp.js`'s drawn-axis TCH guard (#1418) carries the comment *"this upgrades itself the day
OxyDex publishes axis provenance"*. The positive declaration it waits for is
**`quality.timingSource === 'device' | 'device+host'`**; `'host'` (a drawn axis) and absent both fail.

**Measured on `origin/main` and against a real export, by Vigil box:** OxyDex emits **no `quality`
block, no `timingSource`, no `hostAxis`** — the only match in `oxydex-dsp.js` is a *comment* at :3220.
So the condition is **not** met today, and #1398's `cycles` / `cycleLen` / `cycleCV` do **not** satisfy
it: those describe the SpO₂ waveform's *rhythm*, while axis provenance describes the *time axis itself*
— whether it was read from a device clock or drawn as `index × nominal_rate`. A periodicity metric can
be computed perfectly well on a drawn axis, which is rather the point.

⚠️ **The hazard is that the trigger is unwatched. A self-upgrading condition is a guard whose trigger
nobody is watching** — Vigil box's phrasing, and their guard had already sat inert for nine days because
nobody re-checked its premise against a real export. The day OxyDex declares `device` or `device+host`,
Integrator behaviour changes with **nothing in the OxyDex change to indicate it**.

**This is therefore an obligation on the OxyDex side, recorded here because that is where it will be
triggered:** anyone adding a `quality.timingSource` emission to OxyDex must re-run the Integrator's TCH
path and confirm the upgraded guard is correct — not merely that OxyDex's own gates are green.
**Re-measure, do not assume either way**, and check an **export**, not the source (the source contains
the string in a comment and would read as a false positive).

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

## 6 · ✅ CLOSED 2026-08-17 — the mechanism is real, and the existing guard catches **all** of it

The hazard, as carried from the parent's §2.2: `crossingTimes` is concatenated across windows while
non-oscillating windows are `continue`d, so two consecutive entries can sit either side of a gap. The
only guard is `iv > 5 && iv < 300`, and `WIN` is **also** 300.

**MEASURED on the same 61 nights**, replicating `computePatternScores`' construction
(`oxydex-dsp.js:991–1031`) against the shipped parser:

| | count |
|---|---|
| intervals examined | 2438 |
| intervals that straddle a **skipped** window | **184** |
| …of those, kept by the `5 < iv < 300` guard | **0** |

**The mechanism is real — 184 of 2438 intervals do straddle a non-oscillating window — and not one
survives.** So this is not a latent bug that happens not to have fired; it cannot fire, and the reason
is structural rather than lucky: **to straddle a whole skipped window an interval must exceed the window
width, and the guard is set at exactly the window width.** `iv < 300` with `WIN = 300` is the correct
bound, not a coincidence.

⚠️ **That coupling is now load-bearing and undocumented in the code.** If `OSC_WINDOW_SEC` is ever
changed without changing the interval guard to match, gap-spanning pairs start being recorded as cycles.
The cheap protection is a comment at `oxydex-dsp.js:1026` tying the two constants together — worth doing
on the next touch of that function (see §1, which wants a comment in the same place).

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
