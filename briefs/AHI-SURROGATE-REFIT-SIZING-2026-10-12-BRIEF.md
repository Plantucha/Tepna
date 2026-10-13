<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-10-12 · **Promoted from:** residue `2026-09-15-ahikulkas-buys-scale-not-skill` (owner ruling 2026-10-12, relayed) · **Relates:** `SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md` (DONE), `HELD-OUT-BAND-CAMPAIGN-2026-09-22-BRIEF.md` (PROPOSED), `PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md`, `docs/CORPUS-LOCATIONS.md`

# Refitting the AHI surrogate — what is on disk, what one calibration costs, and the one ruling that conflicts

`computeAHIestimates` (`oxydex-dsp.js`) ships two estimates of the same quantity: `ahiODI4 = ODI-4 ×
1.1` and `ahiKulkas = 0.8×ODI3 + 0.6×DesSev + 0.15×T95 − 1.2`. Residue
`2026-09-15-ahikulkas-buys-scale-not-skill` measured, on 300 SHHS1 records, that the elaborate one does
not *rank* nights better (r 0.4993 vs 0.5141) and looks better only on absolute error because its output
is bigger.

The owner's instruction on 2026-10-12 was to **size a calibration on every corpus worth using
before building anything.** This brief is that sizing. **§2 carries the owner's split ruling of
12:50 EDT, and the sizing below rests on it.**

## 1 · Owner rulings, 2026-10-12

Kestrel relayed three rulings at 12:14 EDT; the owner answered the same three directly in-session at
~12:10 EDT. Two channels agreed on two items and disagreed on the third, so this section records all of
them verbatim. The owner then settled the disagreement at 12:50 EDT (§2).

- **R1 · Definition — fit all four, report four.** *"One calibration per definition, each named by its
  definition. No pooled 'AHI'."* The direct answer was *"Fit all four, report all four"*. **Agreed; no
  conflict.**
- **R2 · Visits — SETTLED 12:50 EDT, see §2.** The two earlier channels excluded each other.
  - 12:14 relay: *"SHHS1 is the fit cohort, SHHS2 is the hold-out. No subject in both roles."*
  - ~12:10 direct: *"Pool both visits."*
  - **12:50 EDT ruling, relayed by Kestrel:** *"Split: subject-disjoint. 2843 SHHS1 subjects fit. 2651
    SHHS2 subjects hold out. No subject in both roles."* That names reading *(b)* of §2.
- **R3 · Open datasets — in scope AFTER validation.** *"You write the derivation brief first; the refit
  does not wait for it, the open sets join when the brief is DONE."* The direct answer was *"In scope,
  derive the AHI first"*. **Agreed; no conflict.**

## 2 · The split, ruled — and the number that made the choice matter

**Measured 2026-10-12** from `shhs-harmonized-dataset-0.21.0.csv` and the two EDF trees (roots in
`docs/CORPUS-LOCATIONS.md`; the SHHS1 EDFs and the harmonized table are on **different** mounts):

| | recordings | distinct subjects |
|---|---|---|
| visit 1 EDFs | **5136** | 5136 |
| visit 2 EDFs | **2651** | 2651 |
| **in both EDF sets** | — | **2293** |
| **visit-2-only subjects** | — | **358** |

Every one of the 7787 available EDFs carries all four harmonized AHI labels, so the labels do not bind
— the subject overlap does. The two earlier rulings therefore sized the work differently by an order of
magnitude:

- **"Pool both visits"** ⇒ n = 7787 recordings over **5494 subjects**; 2293 subjects contribute twice.
  Honest only with a subject-level random effect or cluster-robust intervals: a naive CI over 7787 is
  too narrow, and the double-counted subjects are 42 % of the second visit.
- **"SHHS1 fit, SHHS2 hold-out, no subject in both roles"** ⇒ two implementable readings, and they are
  not close:
  - *(a)* hold-out = the **358** visit-2-only recordings; fit keeps all 5136. A clean hold-out, but 358
    records at four definitions is a thin out-of-sample check.
  - *(b)* drop the 2293 overlapping subjects' visit-1 rows from the fit; fit = **2843**, hold-out =
    **2651**. Both sets usable, at the cost of 45 % of the fit cohort.

🔴 **The owner ruled at 12:50 EDT, relayed by Kestrel: reading *(b)*.** Fit = the **2843** SHHS1
subjects who never return for visit 2. Hold-out = all **2651** SHHS2 subjects.

The ruling costs 45 % of the available visit-1 records. It buys a hold-out seven times the size of
reading *(a)*'s. The three readings gave fit cohorts of 7787, 5136 and 2843 and hold-outs of 0, 358 and
2651, so no assumption could have stood in for the answer.

**Every count below now reads against fit = 2843, hold-out = 2651.**

## 3 · The reference AHI on record is a FIFTH definition, not one of the four

`nsrr-adapter.js:356` computes the reference as

    scoredAHI = (nApnea + nHypop) / tstHours

— every scored apnea and hypopnea over staged sleep time, **with no desaturation or arousal rule at
all**, stamped `ahiSource: 'xml(events/TST)'`. None of the four harmonized columns is that quantity.

So the numbers already published — `papers/odi4-ahi-bias.html` §3.2, R² 0.27 at n = 5136, and the
residue row's R² 0.264 at n = 300 — are against the repo-local definition and are **not comparable to
any of the four**. They remain a valid control that the instrument reads the same *kind* of quantity
(the two agree across a 17× difference in n), and they are not a baseline any of the four refits may be
scored against.

`git grep -n 'nsrr_ahi' -- nsrr-adapter.js tools/` returns nothing on `origin/main` at 2026-10-12: **no
tool in the tree can read a harmonized column today.** The sink already exists, though —
`nsrr-adapter.js:448-450` takes `opts.scoredAHI` with `opts.ahiVar`, and stamps `ahiSource` from it. R1's
*"each calibration named by its definition"* therefore needs a reader plus a loop, not a redesign.

### 3b · The reader exists, and the four definitions were always reachable (2026-10-13)

`NSRR.parseAhiCsv` and `NSRR.lookupAhi` now live in `nsrr-adapter.js`. They read an NSRR dataset CSV and stamp each row with its exact column name. Acceptance item 3 is met. The reader also corrects two silent defects, both measured on the real files.

§3's claim that no tool can read a harmonized column was right about the SPELLING. It was wrong about the four definitions. `ahi_a0h3a`, `ahi_a0h4a`, `ahi_a0h3` and `ahi_a0h4` were already in the preference list. Each per-visit CSV carries all four, at columns 1229-1232. So the refit could have run from the two per-visit files with no reader change.

Each harmonized column agrees with exactly one native over 5804 SHHS1 subjects. Agreement is within 0.005 events/h on 100.00 % of them. The pairs are `nsrr_ahi_hp3u` with `ahi_a0h3`, `nsrr_ahi_hp3r_aasm15` with `ahi_a0h3a`, `nsrr_ahi_hp4u_aasm15` with `ahi_a0h4`, and `nsrr_ahi_hp4r` with `ahi_a0h4a`. Every other pairing agrees on at most 3 % of subjects and differs by up to 43.6 events/h.

The data dictionary names the native source for two of the four, and the join supplies the other two. So the harmonized spelling is a portability convenience, not the thing that unblocks the refit.

What DID block the refit is that either file would have been read wrongly:

- **The visit**: `shhs-harmonized-dataset-0.21.0.csv` pools both visits into one file, keyed by `nsrrid` plus `visitnumber`. 4311 of its 5804 subjects carry two rows, with the visit-2 row last. A visit-blind map hands the visit-2 AHI to a visit-1 night for 2651 subjects. Mean |Δ| is 9.10 events/h and max 92.58, which corrupts the hold-out. The reader keys by visit and refuses rather than borrowing the other visit's night.
- **Quoted fields**: `shhs2-dataset-0.21.0.csv` carries a free-text `comm` column at position 856, ahead of the AHI columns. That column holds a comma on 701 of its 4311 rows. A naive split then reads a neighbouring variable on 685 of the 2651 rows that carry a value. Median |Δ| is 4.50 events/h and max 102.23, and every one of those values parses as a number. The hold-out is exactly that file.

Against the three real files the reader selects `nsrr_ahi_hp3r_aasm15` from the harmonized CSV. That file reads as 8455 rows over 5804 subjects, visits 1:5804 and 2:2651, with 2651 ambiguous. Each per-visit CSV resolves to `ahi_a0h3a`. So §6's arousal-inclusive-first rule holds for all three.

## 4 · Cost, measured

`nsrr-oxydex-odi.mjs --dir` scores **4.15 s/record** serially (`tools/nsrr-score-pool.mjs:11`; the
`nsrr-ahiest-validate.mjs:51` and `nsrr-aai-validate.mjs:43` state the same 4 s figure
independently, and the second one also records that someone fabricated an earlier "146 s/record").

**The scoring run is definition-independent.** One pass produces `odi3`, `odi4`, `desSev`, `t95`,
`ahiODI4` and `ahiKulkas` per record; the four definitions differ only in the *reference column* each
fit reads. So four calibrations cost **one** scoring run plus four fits:

| unit | records | serial cost | notes |
|---|---|---|---|
| score visit 1 | 5136 | **≈ 5.9 h** | the figure `nsrr-score-pool.mjs:11` already states |
| score visit 2 | 2651 | **≈ 3.1 h** | `--edfs` / `--xml` are flags, so visit 2 is addressable; the `'shhs1'` shuffle seed at `:459` is hardcoded and must become a parameter or the hold-out order is not reproducible |
| four fits | — | seconds | from one scored table |
| **total, both visits** | 7787 | **≈ 9 h serial** | I/O-bound over NFS, not DSP-bound: the two trees are on two different mounts, one NFSv3 |

Parallelism exists here but stays **unmeasured on this corpus**, and the 8 GB rule caps it rather than
the core count. `nsrr-resprate-validate.mjs:49` records that someone *measured* the parallel speed-up
there rather than assuming it, and the same discipline binds before anyone quotes a `--jobs` figure.

## 5 · The other corpora, measured 2026-10-12

- **MESA is empty.** `nsrr/mesa/polysomnography/` holds only `annotations-events-nsrr` with **0 files**,
  beside a `fetch-mesa-shhs2.log`. A directory that looks like a corpus and is not — §∅ one layer up
  from the data. It contributes nothing and must not appear in a cohort count.
- **Open datasets, 842 EDFs** (`hmc-sleep-staging` 302 · `boas` 256 · `isruc` 111 · `capslpdb` 108 ·
  `isleeps` 40 · `ucddb` 25). **None carries a published AHI column** — `boas/participants.tsv` is
  `participant_id/age/sex/bmi/pid`. An AHI from these must be DERIVED from event annotations, which is
  R3's derivation brief: a second instrument, owed its own control before it calibrates anything.
- **Zipped and nothing else:** `aauwss`, `apsaa`, `hugcdn2014-oxi`, and `dreem-dod` /
  `newcastle-psg-accel` partially. A directory walk under-reports those by the whole archive — count
  them from the archive index, never from the tree.
- **Not PSG:** `mitdb`, `nsrdb`, `slpdb` (WFDB ECG; `slpdb` has apnea annotations), `sleep-accel` and
  `bidsleep-dataset` (accelerometry + instantaneous HR), `respiratory-oximetry-apnoea` (code + CSV),
  `osasud` (a Python pickle), `challenge-2018`. `nsrr/open-models/` and `nsrr/lab-cache-archive/` are
  not corpus.

⚠️ **Print the root with every count.** `SHHS-EXTERNAL-VALIDATION-2026-09-04-BRIEF.md` opens with this
warning, and it reproduced on 2026-10-12 during this brief's own measurement.

I counted the harmonized CSV against the Synology root, got **0**, and read it exactly like "the labels
are absent". The table sits on the TrueNAS mount. `nsrr-score-pool.mjs:430-431` carries the same hazard,
defaulting `--edfs` and `--xml` to **two different stores**.

## 6 · The band must be pre-stated, and this is where

Four refits, four reported correlations, is exactly the shape `HELD-OUT-BAND-CAMPAIGN-2026-09-22-BRIEF.md`
exists to stop going band-less, and `2026-09-22-nsrr-pool-scorers-have-no-prestated-band` already names
`nsrr-ahiest-validate.mjs` as one of the four pending producers. **A threshold written after these runs
is a number, not a test** (`VERDICT-CONTRACT` §1). Draft criterion, to ratify or strike **before** the
first scoring run:

> A refit **supersedes** the shipped coefficients for a given definition only if, on records held out of
> its own fit, it improves **rank** correlation with that definition's scored AHI — Spearman ρ, not
> absolute error — by a margin whose 95 % CI excludes 0 under a subject-clustered bootstrap.

Rank, because the residue row's whole finding is that `ahiKulkas` wins on absolute error purely by being
bigger, and a single fitted multiplier matches it out-of-sample. Subject-clustered, because the
harmonized table repeats 2293 subjects and a bootstrap over rows would understate the interval.
**Not ratified** — this is a draft for the owner.

## 7 · Acceptance

1. §2's split follows the owner's 12:50 EDT ruling: fit 2843, hold-out 2651, no subject in both roles.
   ✅ **met 2026-10-12.**
2. §6's criterion ratified or replaced **before** the first scoring run.
3. A harmonized-column reader exists and every scored row carries `ahiVar` = the exact column name.
   ✅ **met 2026-10-13** — `NSRR.parseAhiCsv` / `NSRR.lookupAhi`, §3b.
4. One scoring run per visit in scope; four fits from it; four `tepna.verdict/1` objects, one per
   definition, each naming its column in `criterion`.
5. Any coefficient change to `computeAHIestimates` re-bundles OxyDex and re-verifies its fixtures —
   `oxydex-dsp.js` is in the trio fold's compute set, so a coefficient edit also stales every folded
   night. **Sequence it against the fold, never beside it.**
6. Every citation of the published R² 0.27 names it as the repo-local-definition control (§3), and none
   treats it as a baseline for a harmonized refit.

## 8 · Out of scope

Deriving an AHI for the open datasets (R3's own brief). Any claim about `ahiKulkas` being *wrong* — the
residue row explicitly refuses that, and the split-half folds disagreed in sign. Publishing any rate
outside the repo (`STRATEGIC-PRIORITIES-2026-08-26` §P5 covers publication, not measurement).

**Rule 0:** `node tools/doc-search.mjs "AHI calibration against SHHS harmonized AHI definitions, oximetry-only instrument refit"` → `papers/odi4-ahi-bias.html` · `odi-bias-analysis.html` · `docs/ODI-BIAS-README.md` · `CHANGELOG.md` · `odi-bias-analysis.js`. Read 2026-10-12. The apparatus exists and expects exactly this input. No prior brief sizes the four-definition refit.
