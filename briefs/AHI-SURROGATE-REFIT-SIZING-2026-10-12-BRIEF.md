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
before building anything.** This brief is that sizing. **Nothing here runs until §2's conflict is
resolved.**

## 1 · Owner rulings, 2026-10-12

Relayed by Kestrel at 12:14 EDT, and answered directly in-session at ~12:10 EDT. Recorded verbatim
because two of the three channels agree and one does not:

- **R1 · Definition — fit all four, report four.** *"One calibration per definition, each named by its
  definition. No pooled 'AHI'."* The direct answer was *"Fit all four, report all four"*. **Agreed; no
  conflict.**
- **R2 · Visits — CONFLICT, see §2.** The relay: *"SHHS1 is the fit cohort, SHHS2 is the hold-out. No
  subject in both roles."* The direct answer: *"Pool both visits."* These are mutually exclusive.
- **R3 · Open datasets — in scope AFTER validation.** *"You write the derivation brief first; the refit
  does not wait for it, the open sets join when the brief is DONE."* The direct answer was *"In scope,
  derive the AHI first"*. **Agreed; no conflict.**

## 2 · 🔴 The blocking conflict, with the number that makes it matter

**Measured 2026-10-12** from `shhs-harmonized-dataset-0.21.0.csv` and the two EDF trees (roots in
`docs/CORPUS-LOCATIONS.md`; the SHHS1 EDFs and the harmonized table are on **different** mounts):

| | recordings | distinct subjects |
|---|---|---|
| visit 1 EDFs | **5136** | 5136 |
| visit 2 EDFs | **2651** | 2651 |
| **in both EDF sets** | — | **2293** |
| **visit-2-only subjects** | — | **358** |

Every one of the 7787 available EDFs carries all four harmonized AHI labels, so labels are not the
binding constraint — the subject overlap is. The two rulings therefore size differently by an order of
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

**This is the only item that blocks the work**, and it cannot be resolved by assumption: the three
readings give fit cohorts of 7787, 5136 and 2843 and hold-outs of 0, 358 and 2651. It goes to the owner
as one question. Everything else in this brief is independent of the answer.

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

## 4 · Cost, measured

`nsrr-oxydex-odi.mjs --dir` scores **4.15 s/record** serially (`tools/nsrr-score-pool.mjs:11`; the
4 s figure is independently stated at `nsrr-ahiest-validate.mjs:51` and `nsrr-aai-validate.mjs:43`,
which also records that an earlier "146 s/record" was fabricated).

**The scoring run is definition-independent.** One pass produces `odi3`, `odi4`, `desSev`, `t95`,
`ahiODI4` and `ahiKulkas` per record; the four definitions differ only in the *reference column* the fit
is taken against. So four calibrations cost **one** scoring run plus four fits:

| unit | records | serial cost | notes |
|---|---|---|---|
| score visit 1 | 5136 | **≈ 5.9 h** | the figure `nsrr-score-pool.mjs:11` already states |
| score visit 2 | 2651 | **≈ 3.1 h** | `--edfs` / `--xml` are flags, so visit 2 is addressable; the `'shhs1'` shuffle seed at `:459` is hardcoded and must become a parameter or the hold-out order is not reproducible |
| four fits | — | seconds | from one scored table |
| **total, both visits** | 7787 | **≈ 9 h serial** | I/O-bound over NFS, not DSP-bound: the two trees are on two different mounts, one NFSv3 |

Parallelism is available but **unmeasured on this corpus** and is capped by the 8 GB rule, not by cores
— `nsrr-resprate-validate.mjs:49` records that parallelism there was *measured, not assumed*, and the
same discipline applies before any `--jobs` figure is quoted here.

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
warning and it reproduced on 2026-10-12 while this brief was being written: the harmonized CSV was
counted against the Synology root, returned **0**, and read exactly like "the labels are absent" — it
is on the TrueNAS mount. `nsrr-score-pool.mjs:430-431` has the same hazard baked in, defaulting `--edfs`
and `--xml` to **two different stores**.

## 6 · The band must be pre-stated, and this is where

Four refits, four reported correlations, is exactly the shape `HELD-OUT-BAND-CAMPAIGN-2026-09-22-BRIEF.md`
exists to stop going band-less, and `2026-09-22-nsrr-pool-scorers-have-no-prestated-band` already names
`nsrr-ahiest-validate.mjs` as one of the four pending producers. **A threshold written after these runs
is a number, not a test** (`VERDICT-CONTRACT` §1). Draft criterion, to ratify or strike **before** any
record is scored:

> A refit **supersedes** the shipped coefficients for a given definition only if, on records held out of
> its own fit, it improves **rank** correlation with that definition's scored AHI — Spearman ρ, not
> absolute error — by a margin whose 95 % CI excludes 0 under a subject-clustered bootstrap.

Rank, because the residue row's whole finding is that `ahiKulkas` wins on absolute error purely by being
bigger, and a single fitted multiplier matches it out-of-sample. Subject-clustered, because §2 says
subjects repeat whichever reading of R2 wins. **Not ratified** — this is a draft for the owner.

## 7 · Acceptance

1. §2's conflict resolved by the owner, in writing, with the chosen reading named (pool / 358 / 2843).
2. §6's criterion ratified or replaced **before** the first scoring run.
3. A harmonized-column reader exists and every scored row carries `ahiVar` = the exact column name.
4. One scoring run per visit in scope; four fits from it; four `tepna.verdict/1` objects, one per
   definition, each naming its column in `criterion`.
5. Any coefficient change to `computeAHIestimates` re-bundles OxyDex and re-verifies its fixtures —
   `oxydex-dsp.js` is in the trio fold's compute set, so a coefficient edit also stales every folded
   night. **Sequence it against the fold, never beside it.**
6. The published R² 0.27 is cited only as the repo-local-definition control (§3), never as a baseline for
   a harmonized refit.

## 8 · Out of scope

Deriving an AHI for the open datasets (R3's own brief). Any claim about `ahiKulkas` being *wrong* — the
residue row explicitly refuses that, and the split-half folds disagreed in sign. Publishing any rate
outside the repo (`STRATEGIC-PRIORITIES-2026-08-26` §P5 covers publication, not measurement).

**Rule 0:** `node tools/doc-search.mjs "AHI calibration against SHHS harmonized AHI definitions, oximetry-only instrument refit"` → `papers/odi4-ahi-bias.html` (0.031), `odi-bias-analysis.html` (0.031), `docs/ODI-BIAS-README.md` (0.031), `CHANGELOG.md` (0.029), `odi-bias-analysis.js` (0.029) — read 2026-10-12; the apparatus exists and expects exactly this input, no prior brief sizes the four-definition refit.
