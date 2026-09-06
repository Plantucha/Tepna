<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-08-17 (**§2 and §6 CLOSED by measurement the same day**: ρ measured at median 0.9804 with the CV threshold re-validated across the corpus's real redness including the reddest night, and the gap-spanning hazard shown to be fully caught by the existing guard. §1 CLOSED (mitigated at the declaration; NOT on a reclassification — see the note there). §3 CLOSED 2026-08-17 — the third observer is MEASURED (17/18 nights) and does not raise corroboration; the blocker was a wrong belief about the corpus, and vigil holds a CPAP tree running to 2026-08-16. §4b ADDED — extending the corpus did not help κ, which identifies the real constraint. §3b ADDED — OxyDex publishing axis provenance would silently upgrade an Integrator guard. §5 TARGET CORRECTED — it named the demo generator, not the one on the compute path. **§5 CLOSED 2026-08-18** — a committed 110 s input now reaches the upper band through the real parser, wired into BOTH runners; only §4 remains open, and it is blocked on data rather than effort. **§4's blocker RE-VERIFIED 2026-09-02 and it HOLDS, exactly**: the brief claims 61 pairing O2Ring nights; measured on the merged corpus root, 106 O2Ring nights >50 kB × 183 CPAP nights → intersection **61**, its own number reproduced. κ stays fragile; do not re-report it as validation. **PARKED 2026-09-05 — drain stamp, Magpie:** §1·§2·§3·§5·§6 closed and gated, §3b/§4b recorded; §4 is the sole open item and it is DATA-blocked. ⚠️ **Read §4b before acting on §4's Done-when** — §4's *"extending the O2Ring side widens the intersection without any new code"* is work that HAS been done and was refuted by measurement: §4b folded 26 more CPAP nights, gained 12 paired nights and **essentially no device-positives**, and named the binding constraint as the CPAP scoring PB on ~5 % of nights (4/56, 1/17), not the count of paired nights. So folding more nights is a measured null, not an available lever. (An earlier draft of this stamp said the nights are *one subject* and reasoned from non-independence — I never measured that, and §4b does not claim it; the base rate is the measured reason and it is the one that decides the item. Recorded because Brief runner and Kestrel were both about to conform to the unmeasured version.) 🔴 **§3b's TRIGGER HAS FIRED — verified by me on `origin/main` 91d30644, 2026-09-05** (raised by Brief runner; residue `2026-09-05-timingsource-one-name-two-meanings`). §3b.1 concluded the self-upgrading condition was unreachable from the CSV path, and that is no longer the state: OxyDex now DECLARES into that field — `oxydex-dsp.js:340` sets `night.timingSource = 'device+host-verified'` and `:7399` writes it to `_out.recording.timingSource`, which `integrator-dsp.js:741-743` resolves in the TCH guard's chain. The verdict is still correct — `pseudo` stays true — but ONLY BY STRING INEQUALITY at `:2915-2917` (`!== 'device' && !== 'device+host'`), and the code's own comment there says *"This upgrades itself the day OxyDex publishes axis provenance"*. The two values answer DIFFERENT questions: OxyDex's is an RTC-anchor verdict, the guard asks Clock Contract §7's per-sample question (`device+host` · `host` · `none`, computed from delta concentration), a vocabulary `'device+host-verified'` is not in. **So normalising the string, or relaxing the check to a prefix match, silently spends a drawn axis as a timed TCH corner.** §3b.1's *"the CSV path cannot declare it"* still stands — what changed is that OxyDex declares something ELSE into the same field. **Why nobody caught it: ONE commit moved both sides** — `git log -1 -S"night.timingSource = 'device+host-verified'" -- oxydex-dsp.js` and `git log -1 -S"json.recording && json.recording.timingSource" -- integrator-dsp.js` both return **0398a2ad (#1643, 2026-08-23, *ring-RTC verification against `_rtclog.csv` sidecar*)**, so the producer of the field and the consumer that resolves it landed together, with no third party in between to notice that a new vocabulary had entered an existing one's slot. ✅ **PINNED on `main` 2026-09-05** — `tests/dex-tests.js:4707`, *"a VERIFIED ANCHOR ('device+host-verified') does NOT make the corner timed — hat stays pseudo"* (#2254). This header previously read *"not yet pinned"*, which was true when written and is the safe direction to be wrong in; struck once the assertion landed rather than left understating the protection. Re-check with `git grep 'VERIFIED ANCHOR' origin/main -- tests/dex-tests.js` rather than trusting this line. **Owner:** whoever brings a subject-period with a higher device-scored PB rate, or a PSG-scored reference (NSRR, gated on the drain); **next step:** none schedulable — flips to DONE in the PR that re-measures κ on such data. Not PROPOSED: five of six sections are executed work) · **Created:** 2026-08-17 · **Follows:** `OXYDEX-PB-DETECTOR-2026-08-09-BRIEF.md` (DONE — 2026-08-17) · **Affects:** `oxydex-dsp.js computePatternScores`, `briefs/SYNTHETIC-CORPUS-BRIEF.md`, the CPAP/ECGDex corpora

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

## 3 · ✅ CLOSED — the ECGDex third observer is measured, and does not change the picture

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

### ✅ CLOSED 2026-08-17 — the third observer is MEASURED, and it does not change the picture

**The blocker was a wrong belief about the corpus, not a real limit.** I had concluded the overlap was
capped because the local CPAP corpus ends 2026-07-21 while box captures start 07-16 (smoketest) / 07-25
(vigil). **`vigil` holds its own CPAP SD-card tree** — `/srv/tepna/captures/cpap/DATALOG/`, 217 nights,
**2026-01-11 → 2026-08-16**, plus the `STR.edf` a local search had looked for and not found. It extends
the local corpus by nearly a month. 26 nights after 07-21 (75 MB) were pulled and merged, giving a
combined **215-night** export set.

That turns the ECGDex overlap from **5 nights to 17 of 18**, with the third observer in scope on
**all 18**:

| | two-observer (56 nights) | **three-observer (17 nights)** |
|---|---|---|
| OxyDex emits `periodic_breathing` | 20/56 (36 %) | 4/17 (24 %) |
| `fusePeriodicBreathing` corroborates | 3/56 (5.4 %) | **1/17 (5.9 %)** |
| …with the OxyDex leg stripped | 0/56 | **0/17** |

**The answer: bringing the third observer into scope does NOT raise corroboration.** The rates are
5.4 % and 5.9 % — indistinguishable at these counts — and stripping the OxyDex leg still takes it to
zero. So the parent's 3/56 was a floor that turns out to be very close to the ceiling, and the ECGDex
cardiac-CVHR leg **corroborated nothing on its own** across 18 nights carrying `apnea.cvhrIndex`.

⚠️ That is a *measured null*, not a dead leg: 18 nights with one device-positive between them cannot
demonstrate a leg's value either way. It says the third observer does not rescue the fusion count on
this corpus, not that it never would.

## 4b · ⚠️ THE EXTENDED CORPUS DID NOT HELP κ — and that identifies the real constraint

Re-running §3.3's κ against the 215-night set:

| set | nights paired | device PB | κ |
|---|---|---|---|
| `oxy-new` (61 O2Ring nights, 05-03 → 07-02) | 56 | 4 | **+0.149** — unchanged |
| `trio-new` (18 box nights, 07-16 → 08-12) | 17 | **1** | +0.338 |

**κ = 0.338 must not be read as an improvement: it rests on ONE device-positive night.** One night
moving cells would swing it across the whole Landis–Koch scale. It is reported because the box asks for
κ beside −0.039, not because it strengthens the claim.

**What the extension proves is where the limit actually is.** Adding 26 CPAP nights added 12 paired
nights and **essentially no device-positives**. The binding constraint on κ was never the number of
*paired* nights — it is that **the CPAP scores PB on ~5 % of nights** (4/56, 1/17). Widening either
corpus does not fix that; only a subject-period with more device-scored PB would.

⚠️ Note the κ refusal guard shipped in `pb-agreement.mjs` (zero margin ⇒ refuse) does **not** fire at
one positive — a margin of 1 is not a margin of 0. It is right not to fire (κ is defined), and this is
the reminder that *defined* and *informative* are different properties. Read the counts, which the tool
prints beside it.

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

### 3b.1 · MEASURED 2026-08-20 — the axis is DRAWN, so the guard cannot upgrade for this input at all

§3b says *"re-measure, do not assume either way"*. Measured, on the input OxyDex actually parses — the
ring's own CSV export — using the discriminator the Clock Contract §7 already defines: *"a stream whose
inter-sample deltas concentrate on one value (≥99 %) was constructed as `sample_index × an assumed rate`
and carries no independent timing."*

| night | samples | distinct deltas | modal delta | share |
|---|---|---|---|---|
| `…_20260503210952` | 27 006 | **1** | 1 s | **100.000 %** |
| `…_20260504202108` | 28 483 | **1** | 1 s | **100.000 %** |
| `…_20260505202850` | 28 255 | **1** | 1 s | **100.000 %** |
| `…_20260506200404` | 28 928 | **1** | 1 s | **100.000 %** |
| `…_20260508202715` | 27 901 | **1** | 1 s | **100.000 %** |
| `…_20260509205816` | 35 479 | **1** | 1 s | **100.000 %** |

**Six nights, ~176 000 samples, `distinct = 1` on every one.** Not "≥ 99 %" — exactly one value, no
exceptions anywhere. The row count equals the span in seconds on every file, so there is not one
missing second across the corpus either.

**So OxyDex's honest declaration is `'host'` — never `device` or `device+host`.** Which means the
condition §3b is waiting for **cannot be satisfied from this input format**, and the "self-upgrading
guard whose trigger nobody watches" is, for OxyDex-from-CSV, **unreachable**. That materially reduces
the hazard: the danger was a silent behaviour change, and the declaration that would cause it is one
the data does not support anyone making.

⚠️ **What this does and does not prove.** A uniform 1 s delta cannot separate *"the vendor drew the
column"* from *"the device samples at a true 1 Hz and the stamp is quantised to whole seconds"* —
1 s quantisation would hide real jitter either way. The operative property is the one §7 names and it
holds under both readings: **no independent per-sample timing is observable, so the axis may be placed
on the host timeline but must never be spent as a second clock.** Do not upgrade this to "the vendor
synthesises it" without a second instrument; [[o2ring-timestamp-is-drawn]] reaches the same conclusion
by a different route.

⚠️ **This is the CSV path only.** The live BLE path is a different question and is moving — the ring's
RTC was shown readable on 2026-08-19 (`GET_INFO [24:31]`, #1543). A future capture route that stamps
samples from that clock could legitimately declare `device+host`, and **that** is when §3b's obligation
becomes live. It is the BLE work, not the CSV parser, that should be watching this trigger.

**Recommended, and NOT taken here:** have OxyDex emit `quality.timingSource: 'host'` explicitly. It
changes no Integrator behaviour — `'host'` and absent both fail the positive check identically — but it
converts an absence into a declaration, which is the difference between a guard that is inert because
the premise is false and one that is inert because nobody said. It is an additive export field, so it
moves OxyDex's fixture outputs and needs `tools/regen-oxydex-goldens.mjs` plus the Integrator TCH re-run
§3b mandates; that is a work-unit, not a footnote.

## 4 · 🟡 κ rests on 4 device-positive nights

§3.3's κ = +0.149 (from −0.036) is real and paired, and it is **fragile**: the CPAP scored PB on 4 of 56
nights, so a single night changing cells moves it materially. It is the bottom Landis–Koch band.

**Done when:** more CPAP-positive nights are in scope. The CPAP corpus holds **189** nights against the
61 O2Ring nights that pair; extending the O2Ring side (vigil, or older archives) widens the intersection
without any new code. **Do not** re-report κ as validation until the positive class is larger — the
honest claim remains *below chance → above chance*.

## 5 · ✅ CLOSED 2026-08-18 (target CORRECTED en route) — the committed synthetic inputs never exercised the 90–130 s band

`briefs/SYNTHETIC-CORPUS-BRIEF.md` line 77 specifies *"~40–90 s cycle length, runs of 4–10 cycles"*.
§2.1 settled the window at **40–130 s** (AASM's floor is 40 s; 45–90 s is a typicality, not a bound), so
the synthetic corpus **cannot express a long-cycle night at all** — the exact population a 90 s ceiling
discards, which is where the pathology is worst.

**Done when:** the generator's cycle-length range widens to 40–130 s and a long-cycle night (≥ 100 s) is
present in the synthetic corpus. Cheap, and it makes the detector's upper band testable from committed
bytes rather than only from personal recordings.

### 🔧 CORRECTION 2026-08-17 — this named the WRONG generator. There are two, and only one is gated

Investigated before editing anything, and the item as written would have sent the next person to a file
that cannot affect the gate:

| generator | what it feeds | on the compute path? |
|---|---|---|
| **`synth-gen.js`** (what §5 named, via `SYNTHETIC-CORPUS-BRIEF` line 77) | the **demo synthetic cohort**; inlined into ECGDex / GlucoDex / Integrator bundles | **NO** — `provenance/OxyDex.json` records it verbatim as *"the demo synthetic-cohort generator, NOT on the compute()/emit path"*, which is why a 2.0→2.1 re-texture moved `manifestHash` while `outputHash` and `inputHashes` stayed identical |
| **`tools/make-synthetic-inputs.mjs`** | the **committed equivalence inputs** (`synthetic_oxydex_o2ring*.csv`) that the GATE-C legs actually run | **YES** |

**So the fix belongs in `tools/make-synthetic-inputs.mjs`.** Its §9 long-night case builds a 7 h night with
`per = i < 3600 ? 20 : 50` — a 20 s oscillation for the first hour and 50 s thereafter. **Neither
exercises the 90–130 s upper band**: 20 s is below the 40 s floor and 50 s sits mid-window, so the
detector's ceiling has never been tested from committed bytes. (That file's §9 exists for a different
reason — catching a metric that analyses only the head of a night — and is correct for that purpose.)

**Revised done-when:** add a **new** committed input (e.g. `synthetic_oxydex_o2ring_longcycle.csv`) with a
≥ 4-cycle run at ~110 s, plus its ledger entry and equivalence leg. **Add rather than widen an existing
file** — the existing CSVs have recorded `inputHashes`, so changing one moves a fixture input and drags
regeneration behind it, whereas a new file changes no existing hash.

⚠️ **The trap worth naming: "the synthetic corpus" means two different things in this repo**, and both are
reachable from the phrase. One is a demo the gates ignore; the other is what the gates run on. Check
`provenance/*.json` for whether a generator is on the compute path before assuming a change there is
testable — or, in the other direction, harmless.

### ✅ THE TESTING GAP IS CLOSED 2026-08-17 — and closing it found an independent argument for the window

The committed-fixture route above is still worth doing, but the *risk* §5 named — that the detector's
**90–130 s ceiling had never been exercised** — is now covered from committed bytes by four assertions in
the `oxydex · pb-detector` group: a 110 s cycle fires and reports its length **above 90**, a 128 s cycle
fires just inside the ceiling, and a **150 s cycle does not** (without that last one the first three
would pass against a detector with no upper bound at all).

**Verified non-vacuous by mutation, not by passing.** Dropping `PB_CYCLE_MAX_SEC` 130 → 90 kills all
three upper-band assertions. Every twin previously in the group sits at 60 s and the committed synthetic
inputs run at 20 s and 50 s, so that regression would have gone green before this.

**And the mutant surfaced something nobody had looked for: the red-noise false-positive rate is MONOTONE
IN THE CEILING, and narrowing it makes the detector WORSE.** Measured at ρ = 0.98, 200 seeds each:

| ceiling | red-noise false positives |
|---|---|
| **90 s** (this brief's original proposal) | **28/200 — 14.0 %** |
| 100 s | 17/200 — 8.5 % |
| 110 s | 9/200 — 4.5 % |
| **130 s** (settled) | **1/200 — 0.5 %** |
| 150 s | 0/200 |
| 200 s | 0/200 |

The mechanism is that a narrower window **truncates qualifying runs**, so CV is computed over fewer
cycles — and a short run is regular by chance far more often than a long one. The regularity criterion
is therefore *weakened* by narrowing the cycle window, which is the opposite of the intuition that a
tighter window is a stricter test.

**So §2.1's 40–130 s has a second, independent justification.** The first was clinical — a 90 s ceiling
discards roughly half the worst-LVEF group (Wedewardt 2010). This one is purely statistical and would
hold even if the physiology were different: **the window chosen for physiological reasons is also the one
that rejects red noise.** Two unrelated arguments landing on the same number is the strongest evidence
this brief has produced for any constant.

⚠️ **CORRECTION to §2's table above.** It reports `0/40` red-noise firings at ρ = 0.98 with the shipped
ceiling. At 200 seeds the rate is **1/200 (0.5 %)**, not zero — `0/40` was a small-sample reading of a
small-but-nonzero rate, and 40 seeds cannot distinguish 0 % from 0.5 %. The conclusion is unchanged
(0.5 % is comfortably acceptable and 28× better than the alternative), but the number should not be
quoted as zero.

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

---

## ✅ §5 EXECUTED 2026-08-18 — the upper band is now reachable from committed bytes

`uploads/synthetic_oxydex_o2ring_longcycle.csv` — 2 h @1 Hz, **8 cycles at 110 s** flanked by flat
stretches, amplitude 2 %SpO2 about the baseline. Generated by `tools/make-synthetic-inputs.mjs` §10, i.e.
the generator **on the compute path**, which is the correction this section already carried.

**Measured through the real parser, not a synthesised array:**

    parseCSV -> 7200 samples
    detectSpO2Periodicity -> periodic true · cycleLen 110 · cycleCV 0 · longestRun 7 · one episode [1860, 2630]

**Six assertions in `oxydex · pb-detector`**, and they are the first in that group to run on bytes rather
than on arrays the test file builds: the night parses to a full 2 h · fires as periodic · at 110 s · which
is **above 90** · clears the CV criterion · on a run of **7** cycles rather than the bare 4-cycle minimum.

**Mutation-verified, not merely green.** `PB_CYCLE_MAX_SEC` 130 → 90 kills **five of the six** (the
seventh, the parse-length check, correctly survives — it does not depend on the ceiling). That is the
regression this input exists to catch, and before it the same mutant passed every committed leg.

**Design decisions worth recording, because each was a fork:**

- **`pairCommitted`, not `pair`** — an input-only twin, no golden. The claim here is an *invariant* (a
  110 s oscillation is detected at 110 s), not a byte-pin, and the twin siblings `_dmy`/`_mdy`/`_lossy`/
  `_longnight`/`_gap` all use this shape. A golden would drag `outputHash` regeneration behind every
  unrelated OxyDex output change for no extra coverage of the band. **This is a deliberate narrowing of
  the "ledger entry and equivalence leg" wording above:** input-only twins carry no `provenance/` fixture
  entry — none of the five siblings does — so there is no ledger row to add.
- **A NEW file, not a widened one**, exactly as this section specified: the existing CSVs have recorded
  `inputHashes`, so editing one would move a fixture input and drag regeneration behind it. Confirmed
  after generation — `git status` showed one untracked file and **no modified tracked input**.
- **Flat flanks rather than dither.** A sub-1 % wobble sits exactly on the `PB_MIN_AMP / 2` per-half-cycle
  guard, so dither would make the fixture's own verdict depend on rounding — testing the rounding, not
  the band.
- **8 cycles, not 6.** The first draft planted 6 and the detector reported 5 against a `PB_MIN_CYCLES` of
  4 — one cycle of margin. 8 plants 7, so the leg fails on a real regression rather than on a
  boundary nudge.

⚠️ **Wired into BOTH runners** — `tests/run-tests.mjs` *and* `Dex-Test-Suite.html`. Adding it to only the
Node list is precisely what reddened #1453's browser lane a day earlier: `env.sources`/`env.equiv` are
built from a per-runner list, and a one-runner entry makes the leg fail (or worse, silently skip) in the
lane the other runner gates.

**§4 remains open and is blocked on data, not effort** — the CPAP scored PB on 4 of 56 paired nights, and
§4b already records that extending the corpus did not move κ. It should not be re-reported as validation
until the positive class is larger.

