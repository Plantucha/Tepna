<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** REFERENCE (living findings record) · **last-verified:** 2026-09-03 · **Scope:** every brief table a committed tool can regenerate

# Published-number decay sweep — what can be checked, and what has already drifted

Osprey · 2026-09-03 · **5 tables attributable to a producing tool, 4 re-run and diffed**

> **The headline moved 8 → 7 → 6 → 5, monotonically downward under every check**, each step costing
> the sweep evidence rather than gaining it. That trajectory is part of the result: a number that only
> ever shrank under scrutiny is a different kind of claim from one that was right first time.

## The denominator is the finding

    brief files containing a table                          303
    tables total                                           1009
    tables with >=4 columns and >=3 numeric rows            259
    ATTRIBUTABLE to a producing tool, after manual audit       5

**At most 5 of 259 substantial published tables can be attributed to a tool and re-run.** So ~98 % of
the numbers in this repo's briefs are unfalsifiable in practice — not wrong, *uncheckable*. That
reframes every divergence below: the diverging tables are not unlucky, they are **the ones we were
able to look at**.

### The criterion, stated so it can be attacked

A table with ≥4 columns and ≥3 numeric rows, sharing ≥3 column names with a tool's printed header,
**AND** whose brief names that tool by filename.

⚠️ **The conjunction is load-bearing, and still not sufficient** — see the two false positives below.

⚠️ **Two different quantities, not one.** The count is a **lower bound** on tables regenerable *in
principle* (a table can be regenerable while never naming its tool) and simultaneously the **exact**
count this rule can *detect*. The true regenerable count lies between 5 and 259. Do not round that away.

## Per-table results

| # | table | tool | verdict |
|---|---|---|---|
| 1 | WINDOW-ORACLE §6 | `pat-residual-structure` | ⚠️ **WITHDRAWN — CIRCULAR.** Its real result is the original divergence: 7 of 9 cells (**R10**) |
| 2 | WINDOW-ORACLE drift | `pat-drift-attribution` | **DIVERGES — 5 of 8 rows**, 3 reproduce, **every verdict holds** |
| 3 | PAT-UNDER-PERBLOCK §3a | `pat-matchrate-strict` | **DIVERGES — 6 of 6 rows**, and the qualitative verdict FLIPS on 3 |
| 4 | SENSOR-TRIO-NIGHTS-PAPER | `tch-pooled-hat` | **DIVERGES — 3 of 3 rows**, but the IDENTITY still holds |
| 5 | SYNTH-GEN-DESAT-KINETICS | `synth-desat-kinetics` | ⚠️ **HYBRID** — part tool, part hand-joined |
| 6 | TCH-FUSED-ROBUST-HAT-FOLLOWUPS (CGM daypart) | `cgm-variability-check` | **REPRODUCES EXACTLY — 4 of 4 rows, every cell** |

### Table 2 detail, and the distinction that must survive into every row

    2026-07-18  DIVERGES  censored -2.0->3.5 · RAW +1.4->7.3 · ratio 33.74->7.25
    2026-07-20  DIVERGES  censored 6.1->5.9 · RAW 11.9->11.3 · ratio 3.51->3.65
    2026-07-24  reproduces      2026-07-28  reproduces      2026-08-02  reproduces
    2026-08-13  DIVERGES  censored -14.7->-14.6 · RAW -6.4->-6.3
    2026-08-17  DIVERGES  RAW -3.1->-3.2 · ratio 7.35->6.90
    2026-08-24  DIVERGES  censored 13.1->12.7 · RAW 24.2->23.9

🔴 **These divergences are attributable to MY OWN #2114 picker fix**, which changed which fragments
these tools read. So the honest finding is **"predates a correctness fix"**, not "was wrong" — a table
that moved because we fixed the tool is a different finding from one that never reproduced, and
conflating them would overstate the rot. The largest movement (07-18, ratio 33.74 → 7.25) is on the
most-fragmented night in the corpus (110 ECG / 555 PPG), exactly where a size-sort and an overlap-sort
disagree most. The published table also has 8 curated rows against the re-run's 43.

## What the sweep is really measuring

Not a divergence rate. **A checkability rate.** A divergence rate computed over 5 tables says nothing
about the other 254, and quoting one would be the same error as a count without its denominator.

### Table 3 detail — the strongest divergence, and still not "was wrong"

    night        published ratio     re-run ratio    published beats -> re-run
    2026-07-20        1.22               2.42            18155 -> 18153
    2026-07-22       *0.85*              1.41            13328 -> 13329
    2026-07-23       *0.74*              1.85             1798 -> 1799
    2026-07-25        1.35               1.99             7542 -> 7537
    2026-07-26       *0.80*              1.88            12919 -> 12924
    2026-07-28       *0.93*              0.96             8837 -> 8837

Beat counts drift by at most 5 — the same nights, the same data. **The ratios move by up to 2.5× and
three of the four sub-1 ratios (starred) cross above 1**, which inverts the row's qualitative reading.

⚠️ **Attributable to TOOL CHANGES, not to rot and not to me.** The table was measured **2026-08-03**;
`tools/pat-matchrate-strict.mjs` has had at least six commits since, three of them named as fixes:

    a91a3b83  fractional foot index refused every beat
    d3b6b3c8  consensus polarity ships in the node and never reached the tool
    ac6e0e2d  drop the ACC fragment shortlist - it was manufacturing an alignment

`pat-matchrate-strict` is NOT one of the four tools the #2114 picker change touched, so this is a
second, independent instance of the same phenomenon in another hand.

## What the sweep is actually finding

Not that published numbers are wrong. **That they decay silently as their tools are corrected, and
nothing anywhere notices.** The table is a photograph of a computation that no longer exists, and there
is no mechanism that ages it, flags it, or even records which code produced it (see **R10** — no
commit, no corpus root, no invocation).

Combined with the denominator: **at most 5 of 259 tables can be checked at all, and of those checked,
most have already drifted.** The uncheckable 254 are not better — they are merely unmeasured.

### Table 4 — a THIRD attribution: the data moved, not the tool

    corner   published        re-run
    h10      0.001169268  ->  0.007960055
    verity   0.001762890  ->  0.002227479
    o2       0.016817029  ->  0.017220474

⚠️ **The identity `σ²_pooled − σ²_weighted == ½(B_AB + B_AC − B_BC)` holds in BOTH runs**, to 1e-15.
The mathematics is intact; only the inputs moved. Cause: the paper brief was last written
**2026-08-27** and `uploads/trio` was regenerated **2026-09-01** (the #2036 full-corpus refold — the
exports carry `generated: 2026-09-01T09:32:49Z`).

## Three tables, three distinct causes, and NONE of them "wrong when published"

| table | diverges | cause |
|---|---|---|
| 2 · WINDOW-ORACLE drift | 5 of 8, verdicts hold | **tool** — my own #2114 picker fix |
| 3 · PAT-UNDER-PERBLOCK | 6 of 6, 3 verdicts flip | **tool** — 6 commits since, 3 named fixes, another hand |
| 4 · SENSOR-TRIO-PAPER | 3 of 3, identity holds | **data** — the corpus was refolded under it |

A published table is invalidated by a tool fix, by a corpus refold, or by both — and **the repo has no
mechanism for any of the three**. Not one of these tables records the commit or the corpus that
produced it, so none of these divergences could have been detected without re-running by hand. The
numbers were right when written and nothing kept them right.

### Table 5 (CGM daypart) — REPRODUCES EXACTLY, and it is the sweep's POSITIVE CONTROL

    window            published                   re-run
    overnight 00-06   2015 · 71.6 · 10 · 40.1 %   identical
    morning   06-12   2006 · 84.0 ·  9 ·  1.1 %   identical
    afternoon 12-18   2041 · 83.7 · 15 ·  8.7 %   identical
    evening   18-24   2032 · 75.6 · 13 · 22.7 %   identical

**This is the leg the sweep needed.** Three tables in a row diverging is also what a broken re-run
harness looks like — wrong corpus root, wrong invocation, wrong column mapping. A table that reproduces
to the last decimal proves the method can return "unchanged", so the divergences elsewhere are findings
rather than instrument error.

⚠️ **And it discriminates the cause.** This brief is dated **2026-07-14** — OLDER than tables 3 and 4,
which both diverged. So divergence does not track age. It tracks **churn**: `cgm-variability-check` has
not changed and the Lingo export has not been re-exported, so the table still holds. The rot is not
entropy; it is specifically *a tool or a corpus moving underneath a number that recorded neither*.

⚠️ Its input is gitignored and lives only at `/srv/data/tepna-corpus/uploads/` — the tool's default path
is wrong for this machine, so a naive re-run reports "no CGM csv" and exits **0**. A sweep that trusted
exit codes would have scored this table as passing without reading a byte.

## ⚠️ SELF-CORRECTION — table 1's "REPRODUCES" is withdrawn as circular

Prompted by Kestrel asking me to apply my own exit-0 finding backwards. The defect is worse than a
vacuous green:

**In `40474646` (my #2111) I REWROTE §6's table values from my own re-run.** The published numbers on
`main` *are* that run's output. A later re-run reproducing them is trivially true — it tests whether
`pat-residual-structure` is deterministic across two invocations, which is a real but much weaker claim
than "a published number survived".

So the sweep has **ONE genuine control, not two**:

| | provenance | is it a control? |
|---|---|---|
| table 1 (§6) | values written BY ME from a re-run, 2026-09-02 | **no — circular** |
| table 5 (CGM) | values written by another hand 2026-08-20, never from my runs, verified by `git log -p` | **yes** |

Table 1's genuine contribution is unchanged and is the one already logged as **R10**: against the values
that stood *before* I touched it, 7 of 9 cells had moved — including a sign-flipped shuffled control —
with the qualitative verdict intact.

**The method sentence this forces:** *every REPRODUCES verdict here is backed by quoted per-row cell
values from a run that could have said otherwise, AND by a provenance check that the published values
were not themselves written from one of my runs.* Without both, a reproduces-verdict is
indistinguishable from an absent diff or a closed loop.

## SECTION 2 — a churn screen needs no re-run, and reaches ~4–17× more tables

Re-running is bounded by corpus, invocation and ~15 minutes each. **Comparing a table's publication
date against its tool's commits since needs only a date and a tool name.**

Bounded probe, 20 sampled from 261 candidate tables:

    names ZERO tools               4/20  (20 %)   undecidable - the R10 shape
    names >=1 tool  (UPPER bound) 16/20  (80 %)   ambiguous wherever >1 - NOT reportable
    names EXACTLY ONE              5/20  (25 %)   a single candidate producer

⚠️ **80 % is the trap.** A brief naming 13 tools identifies nothing; "names ≥1" would be the headline in
most write-ups and is worthless. Exactly-one is the defensible figure, and even that is a CANDIDATE, not
an attribution.

**With an interval, because n=20 cannot carry a point estimate.** Wilson 95 % on 5/20 = 11.2–46.9 %:

    lower   11.2 %  ->   28 tables  =  4.0x the re-runnable set
    point   25.0 %  ->   63 tables  =  9.0x
    upper   46.9 %  ->  118 tables  = 16.9x

So the claim is **"at least 4× more, plausibly an order of magnitude"** — defensible at every point in
the interval, where "~63" and "an order of magnitude" alone are not. **And the DECISION is invariant
across the whole interval**: even 28 is several times the re-runnable set, so the section is worth
writing wherever in the CI the truth sits. The width is not a weakness once that is said.

### ⚠️ The screen can FLAG but probably cannot CLEAR — and table 4 is the proof

Tool churn and corpus churn are **independent axes**, and the sweep has one case of each:

    to FLAG at-risk   EITHER axis suffices  - a tool commit OR a corpus refold since publication
    to CLEAR          BOTH are required     - and corpus dating is the harder half

**Table 4 is the counterexample that settles it**: its tool did not change, its corpus was refolded, and
it diverged 3 of 3 with the identity intact. **A screen reading tool history alone would have cleared it
wrongly.** The 2026-09-01 refold is knowable; general per-table corpus provenance is not (R10 again). So
the honest limit is that this screen may only ever flag, never clear — stated up front rather than
discovered later.

### Two limits that are findings, not caveats

1. **"At risk" is never a verdict.** It says a number's ground moved, not that the number is wrong — the
   same discipline as the per-row *"predates a correctness fix"*.
2. **20 % name no tool at all**, where the screen is **undecidable rather than unavailable**. That is R10
   generalised from one instance to a fifth of the corpus, and it is a stronger finding than R10.

## ⚠️ CORRECTION — the automatable rule over-counts, twice

Checking the second `PAT-UNDER-PERBLOCK` match before re-running it: `pat-matchrate-strict` prints
exactly one table, `night beats | legacy chance ratio p | strict chance ratio p`. That legitimately
matches the §3a table already diffed. The **second** match has a **`rule`** column the tool never emits
— its only two occurrences of "rule" in the whole file are prose comments. **The tool cannot produce
that table.**

    PAT-PROXIMAL-DISTAL   matched on column names, never named the tool  -> caught by the conjunction
    PAT-UNDER-PERBLOCK #2 named the tool AND shared >=3 columns          -> caught only by reading the tool

**The conjunction is necessary and not sufficient.** A brief that names a tool and shares column names
with it can still hold a table that tool cannot emit — a second, hand-built or differently-invoked view
over the same data. Only opening the tool separates them, which means the automatable rule over-counts
and its output is a **CANDIDATE SET requiring one manual read each**.

## THE AUDIT, COMPLETED — every candidate opened, not just the ones re-run

Kestrel's objection was right: both false positives were found *while preparing to re-run that table*,
which is scrutiny on contact, not across the set. So the remaining candidates were opened.

| # | table | tool | status after opening the tool |
|---|---|---|---|
| 1 | WINDOW-ORACLE §6 | `pat-residual-structure` | tool match REAL; **verdict withdrawn as circular** |
| 2 | WINDOW-ORACLE drift | `pat-drift-attribution` | **confirmed** — re-run, diverged 5/8 (tool churn) |
| 3 | PAT-UNDER-PERBLOCK §3a | `pat-matchrate-strict` | **confirmed** — re-run, diverged 6/6 (tool churn) |
| 4 | SENSOR-TRIO-PAPER | `tch-pooled-hat` | **confirmed** — re-run, diverged 3/3 (data churn) |
| 5 | SYNTH-GEN-DESAT | `synth-desat-kinetics` | ⚠️ **HYBRID — a third category** |
| 6 | CGM daypart | `cgm-variability-check` | **confirmed** — re-run, reproduced exactly (control) |
| — | PAT-UNDER-PERBLOCK #2 | `pat-matchrate-strict` | **SPURIOUS** — `rule` column the tool never emits |
| — | PAT-PROXIMAL-DISTAL | `pat-matchrate-strict` | **SPURIOUS** — never names the tool |

### Table 5 is a THIRD category, and it is the most common shape in the wild

    brief:  night | reference AHI | falls | max | p99 | > 1.5 %/s
    tool:   file  | samples       | falls | max | p99 | p95 | > ceiling

Three columns come from the tool, `night` is derivable from `file` — and **`reference AHI` is
hand-joined from elsewhere; the tool cannot produce it.** The rows are also five GENERATED nights, so
reproducing them needs `synth-gen` to rebuild the corpus first and then the judge over it.

So a table is not simply regenerable-or-not. **It can be regenerable in part**, with tool columns that
diff and hand-joined columns that cannot — and a criterion matching on column overlap scores a hybrid
identically to a clean match.

## Final count

**5 candidates attributable to a producing tool, 4 of them re-run and diffed, 1 hybrid, 2 spurious.**
The headline moved 8 → 7 → 6 → **5 clean**, monotonically downward under every check.

⚠️ **And "at most N of 259 checkable" is the wrong claim in a direction not yet tested.** Everything
found here is OVER-counting. A table produced by a tool its brief never names is checkable in principle
and invisible to this criterion — and that population was measured directly at **20 %**. So the honest
statement is:

> Five tables can be **attributed** to a producing tool and re-run. Whether more are reproducible in
> principle is unknown and unknowable from the briefs — and **operationally the distinction does not
> matter, because nobody can re-run what they cannot attribute.**

**Unidentifiable is indistinguishable from uncheckable.** That is R10 as a consequence rather than a
complaint, and it makes the 20 % naming no tool the second half of the argument rather than a caveat.

## What this does not establish

- **No divergence RATE is claimed.** 3 of 4 re-run tables diverged; over a set of 4 selected by
  attributability, that is an anecdote with a denominator, not a rate over the corpus.
- **No table here is shown to have been WRONG when published.** Every divergence is traced to a tool
  fix or a corpus refold after publication. The distinction is the report's main discipline and should
  survive any quotation of it.
- **The churn screen is unbuilt.** Section 2 is a sized proposal with a measured sample and a stated
  limit (flag-only), not a delivered instrument.
