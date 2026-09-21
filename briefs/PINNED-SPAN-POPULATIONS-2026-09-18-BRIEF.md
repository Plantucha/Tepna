<!-- Copyright 2026 Michal Planicka -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

**Status:** IN-PROGRESS (§5.2 REFUTED 2026-09-18 — corrected in place; the cause and the rule it produced are in §5.2a) · **Created:** 2026-09-18 · **Residue:** 2026-09-20-census-file-list-not-retained, 2026-09-18-ecg-saturation-unflagged

# A "pinned span" is three phenomena, and our detector sees one and a half

**Measurement only. No detector is proposed here and none should be built from this brief until the
owner answers the semantics question in §6.** What follows bounds a threshold; it does not choose one.

## 0 · What this measures, and on what

`pinnedSpans` (`ppgdex-dsp.js`) is **rail-keyed**: it detects a constant run at an observed extreme.
`_PPGRUNS.txt`'s writer is `rule=stuck`: a constant run at **any** value. #2636 established that these
are two populations and not two opinions. This brief measures the populations.

**Denominators, stated once and carried everywhere.** Every file list here was deduplicated by
basename with identity confirmed by **bytes** — the corpus trees under `/srv/data/tepna-corpus/`
carry synced copies of each other, and a `find` across them double-counts:

| list | paths found | distinct captures | extra copies |
|---|---|---|---|
| PPG (sidecar-paired) | 88 | **45** | 43 |
| ECG | 1,193 | **597** | 596 |
| ACC | 4,258 | **1,925** | 2,333 |

Identity: equal `size` for every duplicated basename, plus `sha256` of the first 8 MB on all 43 PPG
duplicates — **43 of 43 identical on both**. ⚠️ **Two ACC same-name captures had DIFFERING bytes and
were KEPT SEPARATE.** Collapsing those would be the opposite error to the one being fixed, and a
duplication fix that silently merges two different captures looks exactly like diligence.

🔴 **AND THE PPG SET IS A 45-OF-3013 SUBSET.** Joined against the box's per-file scan on
(date, filename), identity confirmed by size:

    BOTH  44   (44 of 44 size-identical)     rig-only  1     box-only  2,968

**44 of 45 rig captures are box captures** — the rig trees are synced copies. So every PPG figure
below describes **~1.5 %** of the available population. The structural claims in §2 survive that; the
quantitative case in §4 does not, and §7 names what would close it.

## 1 · Which statistics duplication can and cannot move — measured, not argued

Duplicates are byte-identical, so the inflated set is the distinct set with repeats. That makes some
statistics invariant and others not, and the re-run confirms the partition **to the digit**:

| statistic | duplicated | deduplicated | |
|---|---|---|---|
| rail max (lo / hi) | 148 / 179 | **148 / 179** | INVARIANT |
| mid-range max | 27,478 | **27,478** | INVARIANT |
| files | 87 | 44 | moved |
| samples | 131.8 M | 67.4 M | moved |
| mid-range share | 26.846 % | **27.719 %** | moved |
| mid-range p99 | 18 | **19** | moved |
| mid-range runs ≥200 | 51 | **26** | moved |

`max(multiset with repeats) == max(distinct set)`, and duplicating a file cannot create a run that
was not there — so **maxima and existence/zero results are duplication-proof**. Counts, shares and
**percentiles** are not, and because the duplication **clusters by date** the reweighting is not
uniform: a percentile from the inflated set is drawn from a distribution that does not exist, rather
than being approximately right.

## 2 · THE STRUCTURAL FINDING — rail runs stop at 179; mid-range runs reach 27,478

44 distinct PPG captures, 67,368,074 samples:

| population | samples | share | runs | p50 | p99 | **max** |
|---|---|---|---|---|---|---|
| zero rail (absence) | 32,636 | 0.048 % | 1,214 | 21 | 93 | **148** |
| top rail (saturation) | 33,725 | 0.050 % | 1,043 | 25 | 116 | **179** |
| mid-range (freeze) | 18,673,807 | 27.719 % | 5,075,121 | 2 | 19 | **27,478** |

**The rail-keyed detector structurally cannot see the longest pins in the corpus.** 27,478 samples is
~3.7 minutes of frozen signal at 125 Hz; the longest run the current detector can see is 179. This is
a statement about maxima, so §1 makes it immune to the denominator problem.

⚠️ **BUT IT IS A RING CLAIM ABOUT ONE VALUE — see §5.2b.** The box census states it per device, and
the **H10 is a counter-example**: its rail max is 1,665 against a mid max of 1,514. "Rails are short,
freezes are long" is true of the O2Ring at value 100 and does NOT generalise. The DETECTOR-GAP half
still stands everywhere — a rail-keyed rule cannot see a non-rail run of any length — but the
magnitude argument is device-specific and was written here as though it were not.

## 3 · The bulk is QUANTISATION, not freeze — which is why a low threshold is unusable

Mid-range p50 = **2**, p99 = **19**. A quantised pleth holds a value for a couple of samples
constantly. So:

| threshold | runs | share of signal |
|---|---|---|
| ≥5 | 956,078 | **12.599 %** — unusable |
| ≥79 | 112 | — |
| ≥200 | 26 | 0.297 % |

A value-agnostic rule at ≥5 would convict an eighth of the signal. **An invariant that flags
deliberate working behaviour is the wrong invariant, not a finding** — which is why this was measured
before anything was built.

## 4 · The controls do NOT convict — and ACC is a census, not a sample

| control | files | samples | p99 | max | runs ≥200 |
|---|---|---|---|---|---|
| **ACC X/Y/Z mG** (rests at 0) | 1,925 | **849,897,015** | 6 | **172** | **0** |
| **ECG µV** (crosses zero every beat) | 597 | 315,020,756 | 5 | 1,721 | 112 (0.0222 %) |

**Across 850 million samples of resting accelerometer the longest constant run is 172** — below any
threshold that catches the PPG tail. ⚠️ An earlier 25-file *sample* also showed zero; that was not
carried forward as a corpus fact. "We looked at 25 files and saw none" and "there are none" are
different claims and only the census supports the second.

## 5 · 🔴 A PRE-REGISTERED BRANCH, CALLED AND THEN REFUTED

Before looking, this was registered: *an ECG run ≥200 that is NOT at a rail would be the same
mid-range freeze class in a second stream, taking the finding from "a PPG detector has a gap" to "the
freeze phenomenon is not device-specific" — a materially bigger claim.*

Tested against **each file's own extreme**, not a global constant:

| ECG runs ≥200 | n |
|---|---|
| at the file's own extreme | **108** |
| within 2 % of it | 4 |
| genuine mid-range | **0** |

**Refuted.** All 112 are saturation. The freeze phenomenon is **not** shown to be device-generic; it
remains PPG/O2Ring-specific on this evidence.

### 5.1 · Re-tested under the PRODUCTION rail definition, and the classifier was missing a category

The test above uses the file's own extreme. That is the rule `nightqc.rail_value` exists to replace —
**the rail is the histogram spike nearest the edge, not the edge** (the ring's own top of range:
`195:34 · 196:39 · 197:41 · 198:75 · 199:2596 · 200:304`, so the rail is 199 and 200 is an overshoot).
Re-run over the same 112 recorded runs with `rail_value`:

| classification | file-extreme rule | `rail_value` |
|---|---|---|
| at rail | 108 | **108** |
| within 2 % | 4 | **2** |
| mid-range | 0 | **2** |

⚠️ **Those 2 are NOT mid-range freezes — they are a category the classifier did not have.** Both
files return `railHi = None`: no top rail qualified at all. The values sit **466 and 134 counts below
their own file maximum** (1.3 % and 0.36 % of span), i.e. at the top of the range with no qualifying
spike to match against. A classifier that offers only {at rail · near rail · mid-range} must put them
somewhere, and "mid-range" is the wrong bucket — **an absent rail read as a positive classification**,
which is §∅ at the classifier instead of at the value.

Correct reading: **0 genuine mid-range ECG runs under either definition**, with 2 cases of
"top rail did not qualify" that belong on the saturation side. The refutation in §5 stands, and it has
now been tested under two independent rail definitions rather than one.

🔴 **`railAbsent` BELONGS IN THE VOCABULARY PERMANENTLY, not as a patch for these two files.** When
the instrument cannot qualify a rail, "mid-range" is a claim it has not earned — a fabricated CATEGORY
ASSIGNMENT, which is a form of §∅ this suite had not previously recorded (it has fabricated values and
fabricated tiers; this is a fabricated classification). Any consumer of this classification must be
able to tell *"the run was not at a rail"* from *"there was no rail to be at"*, exactly as #2636 must
tell `disagreed` from `sidecarBlind`, and as the citation sweep must tell *unverifiable* from *passed*.
Three instances of one shape at three different layers.

⚠️ **A sub-finding that changes how peer figures should be read:** `0 of 112` sat at the H10 rails
`+18197 / −18200`, which had been relayed as global. There are **29 distinct values across 62 files**,
each at its own per-file rail. Testing against a global constant would have reported 112 mid-range
freezes — the exact opposite of the truth. `ppgdex-dsp.js` already documents this
(*"THE RAIL IS NOT ALWAYS THE OBSERVED EXTREME"*); the lesson is that a rail figure is a per-file
quantity and must not be relayed as a corpus constant.

## 5.2 · 🔴 REFUTED — "episodic" was a DETECTOR BLIND SPOT reported as a device property

**This section originally claimed** that the two rails are endemic (54/54 nights) while the mid-range
value 100 is episodic (3/54 nights, 4 files of 1,220), and drew from it that a detector tuned on
pooled statistics would be tuned on a population "96 % device behaviour and 4 % the thing it is
hunting". **All of that is wrong. The corrected figures invert it.**

**THE CAUSE.** The joined histogram counted values *inside* `class_b_quality` regions — i.e. through
the production detector. `class_b_runs` has **no mid-range rule**, and `rail_value` returns `None` on a
single-valued file. So a run at 100 in a file with normal 0/199 rails produced **no region and was
invisible to the scan**. The "3 nights" were the 3 files with min 99 / max 100, where 100 was picked as
the hi rail by accident of range.

Corrected, from a census counting every constant run regardless of rail:

| population | samples | nights | max run |
|---|---|---|---|
| value 100 | **≥ 1,050,674** (a FLOOR) | **50 / 54** | 27,712 |
| rail 0 | 282,092 | 54 / 54 | 185 |
| rail 199 | 216,049 | 54 / 54 | 258 |

**Three ENDEMIC populations, and the hunted one is the LARGEST** — roughly 2× either rail. The 96/4
line is deleted, not softened: it was directionally backwards.

### 5.2a · 🔴 THE PART WORTH MORE THAN THE CORRECTION — my "independent confirmation" was not independent

This brief stated that §5.2 was *"confirmed independently on this side rather than relayed"*, and the
join **did** reproduce the producing session's O2Ring totals exactly, blind, before any figure was
read — 1,220 files, 560,651 samples, `0: 285,117` · `199: 252,313` · `100: 22,659`.

**That control was worthless, and worse than worthless, because it felt like corroboration.** The
numbers were reproduced **from that session's export**, which was region-scoped — so the blind spot
came with them. **Two sessions agreeing THROUGH A SHARED INSTRUMENT is one measurement, not two.**

> **Reproducing someone's numbers confirms the JOIN. It never confirms the INSTRUMENT.**

That is a distinct failure from the six in §8, and it is the most dangerous of the set: the others
produced answers that contradicted something; this one produced an answer that *agreed*, exactly, to
six significant figures, and the agreement is what made it credible. §8's rule — hold one
hand-verified case outside the pipeline — does not cover it, because the held case was inside the
same pipeline one hop upstream. **The control must be independent of the INSTRUMENT, not merely of
the arithmetic.**

### 5.2b · And the structural claim is a RING claim about ONE VALUE, not a general one

§2's "rail runs are short, mid-range runs are long" must be stated per device. The census:

| device | rail max | mid max | holds? |
|---|---|---|---|
| O2Ring | 185 / 258 | 27,712 | yes — but it is **one value (100)**, not "mid-range" |
| **H10** | **1,665 / 367** | 1,514 | **NO** — its 6 "mid" runs sit within ~1 K of that file's rail (rail-at-a-second-gain) |
| Verity | — | — | no mid population at all |

So §2 as written **overclaims**. Corrected: *on the O2Ring, constant runs at the value 100 reach
27,712 samples while runs at either rail stop at 258* — and the H10 is a counter-example to the
general form, not a confirmation of it.

## 6 · The 112 ECG saturations are their own finding, not a false-positive figure

They are **true positives of the other class**: real saturation, at per-file rails, across 597 files,
**flagged by nothing today** — in the stream whose purpose is beat morphology. A clipped QRS is not a
neutral event for a detector measuring amplitude and slope.

So a value-agnostic ≥200 rule would flag **26 PPG mid-range freezes** (invisible today), **112 ECG
saturations** (arguably should be flagged, as saturation), and **0 ACC**. That is the case for the
rule — and simultaneously the case that **one state cannot carry it**: the rule fires correctly on two
different things that warrant different treatment, so it must report *which*.

🔴 **THE OWNER'S QUESTION, OUTSTANDING, AND IT DETERMINES THE SHAPE OF ANY DETECTOR.** P5 ruled that a
pinned span is an ABSENCE excluded like a gap. That is right for the zero rail and questionable for
saturation: **a saturated sample is a LOWER BOUND on the true value, not a missing one.** Excluding it
as absence discards information; keeping it as data fabricates precision. Until that is answered, a
detector built from this brief would encode "pinned = absent" into a rule that has just been shown to
see three different things.

## 7 · Done when

- [x] Denominators deduplicated with identity established by bytes, and the method reported
- [x] Invariant vs non-invariant statistics partitioned and the partition verified by re-measurement
- [x] Controls run as a census, not a sample
- [x] The pre-registered ECG branch tested and its refutation recorded at full weight
- [x] The rig/box overlap quantified — 45-of-3013, three buckets published
- [ ] Box-side PPG run over the remaining 2,968 captures — **commissioned to the box lane**, read-only
- [x] Owner's saturation-vs-absence semantics (§6) — **RULED 2026-09-21: saturation IS absence, matched by MAGNITUDE.** A run at |railLo| or |railHi| is an absence, excluded like a pinned span (P5, 2026-09-13) and like a gap. The matcher keys on magnitude so the third state Magpie found (`2026-09-20-positive-saturation-at-negated-low-rail`: positive saturation at −railLo, invisible to exact equality) joins the first two. The detector change is a `computeHash` mover — one compute-path PR, JS lane. **Matcher BUILT #PRNUM (Magpie, 2026-09-21):** each qualified rail is mirrored — the histogram spike within the scan's own adjacency width (`RAIL_GAP_MAX`) of its negated value, under the same spike qualification — and the SQI rail leg keys on the set; `quality.ecgRail` publishes the rails and the whole-record sample count at them (null when none qualified). Measured over all 602 `_ECG.txt` (546 with samples; 53 header-only + 3 zero-byte): 82 files carry a qualified rail, **exactly 3 gain a mirror value** — the three this row named (09-12 `18131`, 09-15 `18597`, 09-16 `18031`; 4 runs ≥200, 4052 samples) — and on the 67 files where the edge search already found `railHi`, the mirror lands on the same value on 66 (the 67th is 09-16, whose `railHi` is an 18-sample startup spike). Two instruments (production `parseECG` and a column parser) agree line-for-line. ⚠️ **What this does NOT do:** the interval-level exclusion — an inter-beat interval spanning a saturated stretch marked like `spansGap` rather than median-filled — needs the run-length cut the item below leaves unchosen, and is not built. Today a matched run inside a beat window still routes through `flatBad` → low SQI → `rangeBad` → median fill; the count now makes the population visible for choosing that cut
- [ ] The threshold itself — bounded here (unusable below ~50, viable somewhere 79–200), chosen nowhere

## 8 · Method — hold one hand-verified case outside the pipeline

Four instrument bugs were found across three sessions in one day. **Every one was a self-consistent
wrong answer, and none was caught by an internal check.** Each died against a fact held outside the
pipeline:

| bug | the fact that killed it |
|---|---|
| a per-file ratio returning exactly 1.000 | a ratio cannot be 1.000 for every file |
| a 200 k cap on a run-length sample, reporting `0 runs ≥200` | a 5,919-sample run verified BY HAND in that same set |
| a census printing one file three times with identical run/value/position | a file cannot have the same run three times |
| a global-constant rail test | the DSP's own documented "the rail is not always the observed extreme" |
| a path index keyed before `strip()`, resolving nothing | an all-zero result that could not be right |

⚠️ **The last row is worth the entry for the OPPOSITE reason to the others: all-zero is the BENIGN
failure.** It is obviously wrong rather than plausibly wrong and cannot survive a glance. Every
dangerous bug above produced a *plausible* number — 26.846 %, exactly 1.000 per file, 0 of 112. The
guard is general: **an instrument must prove it saw its input before its output means anything** —
here, asserting all 62 hit-files resolve to a path before any verdict is read. That is the
anti-vacuity leg applied to an analysis script rather than to a test.

🔴 **A SEVENTH BUG, AND THE ONLY ONE THAT PRODUCED AGREEMENT — see §5.2a.** Every bug above was
caught because a number contradicted something. This one reproduced a peer's totals **exactly, blind,
to six significant figures**, and was wrong, because both sides read the same region-scoped export and
inherited the same detector blind spot. **Two sessions agreeing through a shared instrument is one
measurement.** The rule below does not cover it: the hand-verified case was held inside the same
pipeline one hop upstream. **A control must be independent of the INSTRUMENT, not merely of the
arithmetic** — and "I reproduced their numbers" establishes the join, never the instrument.

**A FIFTH RULE, and it catches a different class: when handed a DEFINITION, check it against the one
the code already uses.** §5.1's file-extreme rule came down as an instruction and was applied by two
sessions independently; it would have produced a *self-consistent, plausible, wrong* classification
agreeing across both, because the same wrong rule was in both. No externally-held FACT catches that —
only re-deriving the definition from the code does. It was caught by a peer re-deriving `rail_value`
from the data instead of applying the rule they were sent.

**A pipeline cannot audit its own truncation.** The rule: hold one hand-verified case outside it and
assert against that — **and the fact does not have to be yours.** Two of the four above were caught by
a figure a peer supplied.

### 8.1 · These are DETECTION rules, and §5.2a is a CONSTRUCTION rule — do not collapse them

Every rule above fires when something is **already wrong and visible**: a ratio that cannot be 1.000,
a run that must exist, a file that cannot repeat, an all-zero result. They are detection rules, and
they all key on **a contradiction surfacing**.

§5.2a's failure surfaced no contradiction. It reproduced a peer's totals **exactly, blind, to six
significant figures**, and was wrong — because both sides read the same region-scoped export. No
detection rule here could have fired, because nothing disagreed with anything.

| kind | fires when | example |
|---|---|---|
| **detection** (§8) | a contradiction is visible | a file printed three times |
| **construction** (§5.2a) | — it changes how the check is BUILT so the error cannot be invisible | the control must use a different INSTRUMENT, not merely different arithmetic |

**So the strongest method written down here would not have caught the most credible error made here.**
That is not a reason to distrust §8; it is the reason §5.2a has to sit beside it. A day's worth of
instances produced six detection rules and exactly one construction rule, and the construction rule is
the one that covers the case the others structurally cannot.

⚠️ **AND IT SCALES THE WRONG WAY.** Agreement through a shared instrument is the failure mode that
**grows with parallelism**: a fleet running one instrument fast is more exposed than a slower one
running two. Every additional session reading the same export multiplies apparent corroboration
without adding a single independent observation. That is a consequence for how the fleet is RUN, not
for how one measurement is taken.

**Fleet-Session:** Magpie
