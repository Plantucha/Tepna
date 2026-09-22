<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED (an OWNER QUESTION with its cost measured — not a plan; nothing here runs until the owner answers, and the bands in §4 are drafts to ratify or strike BEFORE any run) · **Created:** 2026-09-22 · **Relates:** `VERDICT-CONTRACT-2026-09-21-BRIEF.md` §1 (a threshold derived from the data it judges is UNKNOWN, not PASS) · residues `2026-09-22-nsrr-pool-scorers-have-no-prestated-band`, `2026-09-22-bandless-analysis-tools-emit-unknown`

# The held-out band campaign — the question, with its cost measured

## 1 · The question

Twelve tools emit `tepna.verdict/1` with status **UNKNOWN by design** (#2811, #2817): each publishes a
statistic, none pre-stated a band, and every one of their numbers is already on record. Under
VERDICT-CONTRACT §1 a band written now against those numbers would be a number, not a test. The only
route to a decided status is **a band pre-stated in a brief before a run on records the tool has not
seen** — this brief is where such bands would be written. The owner's question is whether that campaign
is worth its hours, and for which tools. Kestrel put the question 2026-09-22; it is unanswered.

## 2 · What "pre-stated" means for a re-run (the rule this brief would be held to)

1. The band is written in **this brief**, with the statistic it applies to, its unit, its direction and the
   minimum n, **before** the run's first record is scored; the commit that writes it is named in the run's
   record (`preStated: <sha>`), so the order is checkable from git.
2. The run scores **only records the tool has never scored** (§3 says which, per tool). A record the tool
   has seen — under any earlier version — is excluded, because the band was written by someone who has
   seen its number.
3. The number is compared to the band **as written**. A band moved after the number is a number.
   If the band was wrong (unit, direction, an impossible minimum), the run is reported UNKNOWN with the
   reason, the band is corrected in a dated amendment here, and the corrected band waits for the NEXT
   unseen set. It never re-judges the run that exposed it.
4. Each tool's verdict is then emitted by the tool's existing `tepna.verdict/1` path (the pool for the
   scorers; the shared UNKNOWN builder replaced by a declared `CRITERION` + `verdict()` for the JS tools),
   and the manifest row stays adopted.

## 3 · Which records are unseen, per tool — measured, not assumed

**NSRR pool scorers** (SHHS1, 5136 EDF↔annotation pairs). The pool scores in a **hash-shuffled order with
salt `'shhs1'`** (`tools/nsrr-score-pool.mjs` `shuffledOrder(ids, 'shhs1')`), so a `--limit N` run is the
first N of a deterministic permutation — the seen set is reproducible from the id list alone, and the
held-out set is every record after position N in that same order.

| scorer | seen (the recorded run) | unseen | s/record (measured) | 8 workers, hours |
|---|---|---|---|---|
| `nsrr-aai-validate` | 60 (#2523, n = 57 usable) | 5076 | 4.1 (its header, `processNight` 4040 ms) | ≈ 0.7 h for all; ≈ 4 min per 500 |
| `nsrr-ahiest-validate` | 300 (#2530-era run, residue row) | 4836 | ≈ 4 (same path) | ≈ 0.7 h |
| `nsrr-oxstat-validate` | 300 (278 with `OX stat`) | 4836 | ≈ 8 (two `processNight` calls) | ≈ 1.3 h |
| `nsrr-resprate-validate` | 300 (#2526) | 4836 | ≈ 5 (belts decimated + proxy) | ≈ 0.8 h |

A **500-record held-out slice** (positions 301–800 of the shuffled order; 61–560 for aai) costs **≈ 4–8 min
per scorer** and gives each statistic a between-record 95 % half-width the pool already computes. The
full held-out set costs ≈ 3.5 h for all four. Both are cheap; the cost is not the hours, it is that
**a band must exist first** — §4.

**Band-less JS analysis tools** (capture nights, not NSRR). Their populations are nights; "unseen" means
nights captured after the recorded run. Measured on the local trees 2026-09-22:

| tool | seen | unseen since | hours |
|---|---|---|---|
| `tch-per-epoch-rho`, `tch-multinight`, `tch-third-corner`, `tch-estimator-bakeoff` | the trio fold nights ≤ 2026-09-15 | 37 box dates after 2026-09-15 in `vigil-archive/captures` (2 in `vigil-captures`), of which the paired-and-non-stub count must be measured per tool (the GAP_S sweep found 23 paired ECG+PPG nights over the whole archive) | a fold of ~40 nights ≈ 10 min (`trio-batch` 8 jobs) |
| `acc-acc-control`, `pat-ppg-ppg-control`, `pulse-agreement` | the captures root at their run dates | the same post-2026-09-15 box nights | minutes each |
| `cpap-oxy-couple` | CPAP nights ≤ its run | CPAP SD tree runs to 2026-08-16 on the box (`corpora-live-on-the-box`), so **no unseen CPAP nights exist locally** — the box tree is the only source | an `ssh`/rsync first |

The synthetic bake-off (`tch-estimator-bakeoff`) has no unseen records in the sense above: its corpus is
generated. A band for it is a design choice on planted truth, not a held-out measurement; listed so its
absence from the campaign is stated.

## 4 · Draft bands — to ratify or strike BEFORE any run; frozen the moment a run starts

Written knowing the seen numbers (that is unavoidable — the seen numbers are on record); honest because
the run is on records nobody has scored. Each names the statistic the tool ALREADY publishes.

| tool | statistic (as published) | draft band | min n |
|---|---|---|---|
| `nsrr-aai-validate` | median AAI / expert arousal index | PASS 0.8–1.25 · else FAIL | 100 |
| `nsrr-ahiest-validate` | median paired gain \|err(ODI4)\| − \|err(Kulkas)\| (events/h) | PASS > +0.5 (Kulkas better by half an event) · FAIL < −0.5 · SHORTFALL between | 100 |
| `nsrr-oxstat-validate` | median ODI-4 change when flagged samples are nulled (events/h) | PASS \|Δ\| ≤ 0.5 · FAIL beyond | 100 |
| `nsrr-resprate-validate` | median proxy − belt (brpm), control-clean records | PASS \|bias\| ≤ 2 · FAIL beyond | 100 control-clean |
| `tch-per-epoch-rho` | pooled ρ(ECG,PPG) residual correlation | PASS ρ < rhoCrit − 0.05 on ≥ 70 % of solved nights | 10 solved |
| `tch-multinight` | median culprit σ (ρ-on), bpm | a REFERENCE band the owner sets from the corpus reference; none drafted here | 10 solved |
| `pulse-agreement` | Bland–Altman bias, bpm | PASS \|bias\| ≤ 1.0 AND SD ≤ 3.0 | 300 paired epochs |
| `acc-acc-control` | recovered offset vs injected, min | PASS ≥ 80 % of nights within ±5 min of the injected value | 8 nights |
| `pat-ppg-ppg-control` | best-pair ratio, p | PASS ≥ 50 % of nights p < 0.05 and ratio > 1 (the in-code rule, now pre-stated) | 8 nights |
| `cpap-oxy-couple` | lift (observed/chance) per class × window | PASS lift ≥ 1.5 with expHits ≥ 3 in the central ≥ 25 s stratum · else UNDERPOWERED/FAIL by the tool's own flags | 3 expected hits |
| `tch-third-corner` | σ per corner, one night | none — one night is not a population; stays UNKNOWN | — |
| `tch-estimator-bakeoff` | quiet-corner MAE vs BASE, planted truth | the in-code rule (beat BASE by > 0.10 bpm) restated here as the band | 3 quiet-order nights |

## 5 · What the owner decides

1. **Whether to run at all** — the alternative is that these twelve stay UNKNOWN by design, which is
   truthful and costs nothing.
2. **Which slice** — the 500-record slice (≈ 4–8 min per scorer) or the full held-out set (≈ 3.5 h).
3. **The bands** — ratify, edit or strike each row of §4 before anything runs. A struck row keeps its tool
   UNKNOWN.
4. **`cpap-oxy-couple`** — whether the box CPAP tree is synced to the rig first (an `ssh` job, owner-only
   by CLAUDE.md §👥.0), since no unseen CPAP night exists locally.

## Done when

- [ ] the owner has answered §5.1–5.3 (recorded here as a dated amendment, with the frozen bands)
- [ ] each run's record names this brief's band commit as `preStated`, scores only unseen records, and the
      tool's manifest row moves from UNKNOWN-by-design to a declared criterion — or the tool stays UNKNOWN
      and its row says why
