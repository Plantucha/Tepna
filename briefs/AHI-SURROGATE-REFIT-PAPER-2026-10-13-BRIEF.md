<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED — 2026-10-13 · **Created:** 2026-10-13 · **Follows:** `AHI-SURROGATE-REFIT-SIZING-2026-10-12-BRIEF.md` · **Relates:** `PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md`, `HELD-OUT-BAND-CAMPAIGN-2026-09-22-BRIEF.md`, `OPEN-DATASET-AHI-DERIVATION-2026-10-12-BRIEF.md` · **Touches:** a new `papers/` page, `papers/papers.html`, `papers/RERUN-RESULTS.md` (docs only — no bundle, no provenance)

# BRIEF — Paper: one oximetry AHI surrogate, four harmonized references, one subject-disjoint split

> **One-line:** the owner ordered a paper outline on 2026-10-12 at 21:55 EDT, before the refit runs.
> This brief holds that outline and the whole methods section. It holds no result, by order.
> The sizing brief next door says what the work costs; this one says what the paper will claim and how
> a reader checks it.

## 0 · What this brief is, and what it withholds on purpose

Kestrel relayed the owner's order and four constraints. I record them here so a later session cannot
read the gap as an oversight.

- The brief comes first, and it carries the outline and the methods.
- It states **no result**, no lab agreement statistic, and no pooled agreement statistic.
- It does **not** edit `papers/odi4-ahi-bias.html`. The owner ruled on 2026-10-13 that this paper is a
  **new page** with its own DOI.
- The paper takes **its own DOI**, never the software DOI.
- Pooled numbers over the Sleep Heart Health Study follow the data-use agreement, section 16 (§5).
- Lab results stay private until publication.

So every number below describes the **corpus or the apparatus**, and the sizing brief measured each one
on 2026-10-12. Nothing below describes an outcome, because no refit has run.

## 1 · The question, and why it is not the ODI-4 bias paper

`computeAHIestimates` in `oxydex-dsp.js` ships two oximetry-only estimates of the apnea–hypopnea index.
One scales ODI-4 by 1.1. The other mixes ODI-3, desaturation severity and the time under 95 % with four
fitted coefficients. Residue `2026-09-15-ahikulkas-buys-scale-not-skill` measured on 300 records that
the elaborate one does not rank nights better, and wins on absolute error only by running bigger.

The published ODI-4 bias paper asks a different question. It asks **how far** a rolling-baseline ODI-4
falls below a scored index, and why. This paper asks which **reference definition** an oximetry-only
surrogate should calibrate against, and what one honest refit per definition produces out of sample.

Three things separate the two papers, and each one would force a reader of a single merged page to hold
two methods in mind at once.

1. The reference differs. The bias paper reads one repo-local index; this paper reads four harmonized
   columns.
2. The split differs. The bias paper pools records; this paper holds out whole subjects.
3. The claim differs. The bias paper reports a bias and a correction; this paper reports whether a
   refit earns its place.

⚠️ The bias paper's published R² of 0.27 at n = 5136 is **not a baseline for any refit here**. It scores
a fifth definition: every scored apnea and hypopnea over staged sleep time, with no desaturation rule
and no arousal rule (`nsrr-adapter.js:356`). It stays a control that the instrument reads the same kind
of quantity, and the paper must say so wherever it appears.

## 2 · The four references, named from the dictionary

The harmonized table carries exactly four index columns, and the data dictionary version 0.21.0 defines
each one. The paper names the literal column, not a nickname.

| column | hypopnea rule, per the 0.21.0 dictionary | native equivalent |
|---|---|---|
| `nsrr_ahi_hp3u` | ≥ 3 % desaturation | `ahi_a0h3` |
| `nsrr_ahi_hp3r_aasm15` | ≥ 3 % desaturation **or** an arousal, under the 2015 flow rule | — |
| `nsrr_ahi_hp4u_aasm15` | ≥ 4 % desaturation, under the 2015 flow rule | — |
| `nsrr_ahi_hp4r` | ≥ 4 % desaturation **or** an arousal | `ahi_a0h4a` |

Two readings follow, and both shape the methods.

Two of the four are the cohort's own variables under harmonized names, and two recompute the hypopnea
rule to the 2015 guideline. A refit therefore cannot treat the four as four independent studies.

None of the four appears in `NSRR_AHI_VARS` at `odi-bias-analysis.js:446`, whose list names the native
variables instead. That confirms the sizing brief's §3 reading: no tool in the tree reads a harmonized
column today, and the reader is the first thing to build.

## 3 · Outline — the paper, section by section

House style follows the other pilot pages: a `papers/` page, byline **Michal Planicka · corresponding
author — Tepna Project**, the SPDX header from `licensing/SPDX-HEADERS.txt`, the intended-use
disclaimer, the `dxl-` stamp from `licensing/dex-license.css`, and `paper.css`. Copy a recent shell such
as `papers/nights-icc.html`.

| § | section | what it holds | status today |
|---|---|---|---|
| 0 | Layman overview (cut before submission) | a finger oximeter counts dips; a sleep lab counts breathing events against four different rule books | writable now |
| — | Abstract | background, methods, results, conclusion | methods only |
| 1 | Introduction | the two shipped estimates, the residue finding, the four rule books | writable now |
| 2 | Methods | §4 of this brief, transcribed | writable now |
| 3 | Results | four fits, one table per definition, hold-out columns beside fit columns | **pending the run** |
| 4 | How the four definitions disagree | rank agreement between the references themselves | **pending the run** |
| 5 | Discussion | what an oximetry-only index can and cannot inherit from a scored one | after §3 |
| 6 | Limitations | the split's cost, the single cohort, the absent arousal channel | writable now |
| 7 | Reproducibility | §4.7 of this brief | writable now |
| — | References | the two cohort citations plus the method sources | writable now |

Figures, each one generated from the live tool in its native dark theme, at a readable scale:

1. surrogate against reference, one panel per definition, fit cohort only;
2. shipped coefficients against refitted coefficients, residual by severity decile;
3. hold-out rank correlation, refit beside shipped, with the interval the band names.

Each figure stays a declared placeholder until the run lands. The paper carries no figure whose numbers
no committed record backs.

Add a row to `papers/papers.html` reading **outline only, no results**, and log the page in
`papers/RERUN-RESULTS.md` when the first run produces one.

## 4 · Methods, written out

### 4.1 Corpus and split

The owner ruled the split at 12:50 EDT on 2026-10-12, and the sizing brief §2 records it verbatim: a
subject-disjoint split, 2843 visit-1 subjects fitting and 2651 visit-2 subjects holding out, with no
subject in both roles.

The sizing brief measured the trees the same day: 5136 visit-1 recordings, 2651 visit-2 recordings, 2293
subjects in both, and 358 subjects only in visit 2. The fit cohort therefore drops the 2293 overlapping
subjects' visit-1 rows, which costs 45 % of the visit-1 records and buys a hold-out seven times the
size of the alternative reading.

The paper reports both the fit and the hold-out count beside every statistic. It also reports the
subject count, because 7787 recordings cover 5494 subjects and a reader who sees only recordings reads
an interval that is too narrow.

### 4.2 The scoring run

One scoring pass serves all four definitions. `nsrr-oxydex-odi.mjs --dir` scores 4.15 s per record
serially, and three separate tools in the tree state that same figure. The pass yields `odi3`, `odi4`,
`desSev`, `t95`, `ahiODI4` and `ahiKulkas` per record, none of which depends on the reference column.

So the cost is one pass plus four fits: about 5.9 h for visit 1, about 3.1 h for visit 2, and seconds
for the fits. The run is bound by reading over the network mounts rather than by signal processing, and
the two trees sit on two different mounts.

The paper quotes no parallel speed-up. Nobody has measured one on this corpus, and the 8 GB ceiling
caps the worker count ahead of the core count.

### 4.3 The reference reader and the four fits

Three pieces of work precede the first fit, and each one is small.

1. A harmonized-column reader. The sink already exists: `nsrr-adapter.js:448-450` accepts
   `opts.scoredAHI` with `opts.ahiVar` and stamps `ahiSource` from it.
2. Every scored row carries `ahiVar` set to the literal column name. A row without it never reaches a
   fit.
3. The shuffle seed at `nsrr-score-pool.mjs:459` hardcodes `'shhs1'`. It becomes a parameter, or the
   hold-out order never reproduces.

Each fit is ordinary least squares over the same predictor set the shipped estimate uses, refitted
against one reference column. The paper reports the four coefficient sets side by side with the shipped
ones, and names the column in every caption, table header and verdict.

### 4.4 The decision band, pre-stated and not yet ratified

Four refits with four reported correlations is exactly the shape that
`HELD-OUT-BAND-CAMPAIGN-2026-09-22-BRIEF.md` exists to stop. A threshold written after the runs is a
number rather than a test. The sizing brief §6 drafted this criterion:

> A refit supersedes the shipped coefficients for one definition only if, on records held out of its own
> fit, it improves rank correlation with that definition's scored index — Spearman ρ, not absolute error
> — by a margin whose 95 % CI excludes 0 under a subject-clustered bootstrap.

Rank, because the residue row's whole finding is that the bigger estimate wins on absolute error alone.
Subject-clustered, because the harmonized table repeats 2293 subjects and a bootstrap over rows would
understate the interval.

🔴 The owner has not ratified it. The paper prints no result until the owner ratifies this criterion or
replaces it, and the acceptance list in §7 carries that as a blocking item.

### 4.5 Absence, exclusions and clocks

A record with no staged sleep yields no index, so the run reports it as absent and never scores it as
zero. A record whose reference column holds no value leaves that definition's fit and stays in the
others, and the paper reports the four population counts separately rather than one shared n.

Every exclusion lands in a named class with a count, and the four counts satisfy `checked + excluded =
eligible` per definition. A reader can therefore reconstruct each population from the paper alone.

Stamps follow the Clock Contract. The scoring path reads annotation times by regex and stores floating
wall-clock milliseconds, so no viewer timezone moves a reported duration.

### 4.6 Verdicts

Each definition emits one `tepna.verdict/1` object whose `criterion` names its column and the band from
§4.4. A fit whose hold-out population falls under the pre-stated floor emits `UNDERPOWERED` with a
reason, never a quiet pass.

The producing tool joins `tools/verdict-adoption.json` with an `emits.cmd`, and carries a
`--verdict-sample` flag that prints the object alone. The adoption check parses that stdout as JSON.

### 4.7 Reproducibility

The paper's reproducibility section names, for each number: the tool and its commit, the corpus root,
the column, the population counts, and the verdict object that judged it. A reader with the agreement in
hand reruns one command per definition.

The repository ships no record from the cohort, and the paper quotes none. The committed artefacts are
the scored summary table, the coefficient sets and the verdict objects.

⚠️ A coefficient change to `computeAHIestimates` re-bundles OxyDex, re-verifies its fixtures, and
stalens every folded night, because `oxydex-dsp.js` sits in the trio fold's compute set. Sequence that
change against the fold, never beside it.

## 5 · Attribution, licence and DOI

The data acknowledgement is mandatory, and nobody may rephrase it. Every surface publishing a number from
this cohort carries the line `NSRR R24 HL114473: NHLBI National Sleep Research Resource`, as
`docs/SHHS-COHORT-REFERENCE.md` records it, plus both cohort citations.

- Quan SF, Howard BV, Iber C, et al. The Sleep Heart Health Study: design, rationale, and methods.
  *Sleep.* 1997;20(12):1077–85. doi:10.1093/sleep/20.12.1077
- Zhang GQ, Cui L, Mueller R, et al. The National Sleep Research Resource: towards a sleep data commons.
  *J Am Med Inform Assoc.* 2018;25(10):1351–1358. doi:10.1093/jamia/ocy064

Three further clauses bind this paper.

1. The agreement permits publishing results and forbids any excerpt of the data. The paper reports
   aggregates only.
2. Nothing in the paper supports re-identification, and the repository redistributes no record.
3. The approved scope covers this cohort alone. A second request covering other cohorts sits under
   review, and nothing in it may appear here.

**The DOI.** The paper mints its own, and the software DOIs stay what they are: `CITATION.cff` holds the
concept DOI `10.5281/zenodo.22068939` for the software across versions, plus a version DOI per release.
The paper cites the software DOI as the apparatus it ran on, and never as its own identifier. A reader
who follows the paper's DOI must land on the paper.

Lab results stay private until publication, so no fleet session posts a number from this refit outside
the repository.

## 6 · Out of scope

- Deriving an index for the open datasets. That is `OPEN-DATASET-AHI-DERIVATION-2026-10-12-BRIEF.md`.
- Any claim that the elaborate shipped estimate is *wrong*. The residue row refuses that, and the
  split-half folds disagreed in sign.
- Any edit to `papers/odi4-ahi-bias.html`. The 2026-10-13 ruling leaves that page as it stands.
- The other cohorts. The second data request covers them and sits under review.
- Any agreement statistic between a lab index and an oximetry index, by the owner's order.

## 7 · Acceptance

1. This brief carries the outline and the full methods, and states no result. ✅ **met 2026-10-13.**
2. The paper is a new page carrying its own DOI. ✅ **met 2026-10-13** — the owner ruled it.
3. The owner ratifies or replaces §4.4's criterion **before** the first scoring run.
4. A harmonized-column reader exists, and every scored row carries `ahiVar` as a literal column name.
5. One scoring pass per visit in scope, four fits from it, and four verdict objects naming their
   columns.
6. The page carries the section 16 line, both cohort citations, the disclaimer and the `dxl-` stamp.
7. The page carries its own DOI, and cites the software DOI only as the apparatus.
8. Every citation of the published R² 0.27 names it as the fifth-definition control.
9. Any coefficient change to `computeAHIestimates` lands in its own unit, sequenced against the fold.

## 8 · Open decisions

1. **New page or extension? ANSWERED 2026-10-13 — a new page with its own DOI.** The owner ruled by
   AskUserQuestion, relayed by Kestrel, and `papers/odi4-ahi-bias.html` stays as it is. The outline
   above already suited a new page, and §1 gives the three reasons.
2. **The §4.4 criterion.** Blocking, per acceptance item 3.
3. **The target venue.** It decides the abstract's shape and the figure count, and no session should
   guess it.
4. **Who mints the DOI, and where.** A preprint server and a Zenodo deposition answer differently, and
   the choice belongs to the owner.

## 9 · Pointers

- Sizing, costs and the split ruling: `AHI-SURROGATE-REFIT-SIZING-2026-10-12-BRIEF.md`.
- The fifth definition and the existing bias paper: `papers/odi4-ahi-bias.html`,
  `docs/ODI-BIAS-ANALYSIS-README.md`, `PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md`.
- Cohort facts and the exact acknowledgement line: `docs/SHHS-COHORT-REFERENCE.md`.
- The band discipline: `HELD-OUT-BAND-CAMPAIGN-2026-09-22-BRIEF.md`.
- The verdict contract: `VERDICT-CONTRACT-2026-09-21-BRIEF.md`.

**Rule 0:** `node tools/doc-search.mjs --read "AHI refit paper outline methods section SHHS subject-disjoint split"` → `AHI-SURROGATE-REFIT-SIZING-2026-10-12-BRIEF.md:29-51` · `RESIDUE.md:230-231` · `papers/cgm-hrv-coupling.html:112-118` · `docs/ODI-BIAS-ANALYSIS-README.md` · `tools/odi4-shhs-recut.mjs`. Read 2026-10-13. No prior brief outlines this paper, and the sizing brief next door costs the work without writing the paper.
