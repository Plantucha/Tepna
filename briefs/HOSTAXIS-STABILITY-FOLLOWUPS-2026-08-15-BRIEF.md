<!--
  HOSTAXIS-STABILITY-FOLLOWUPS-2026-08-15-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-16 (all four boxes: §1 the ppgdex SE fix shipped as #1350 with the re-bundle and corpus re-verification · §2 the KNOWN DEFECT pin converted to three contract assertions and the known-answer gate extended to all three lanes (#1348, #1350) · §3 DECIDED — the SE band stays, on measurements already in the repo · §4 one answered, two parked with what would settle them. ⚠️ DONE does NOT mean 'adopt lag-1 next': §3 states the burden any such proposal carries, and §3.2 blocks a conflation that would otherwise justify it on the wrong evidence) · **Created:** 2026-08-15 · **Follows:** `HOSTAXIS-STABILITY-2026-08-13-BRIEF.md` (DONE — 2026-08-15, executed as #1227) · **Affects:** `ppgdex-dsp.js` (compute-path), `tests/dex-tests.js`

# One noise-type rule, three implementations — and the joint fix reached two of them

`HOSTAXIS-STABILITY` shipped as **#1227**. Its §5 named a KNOWN DEFECT it would *inherit* rather than
fix: `classifyAllan` / `allan.py classify` name a power-law noise type by strict `<` against a **point
estimate**, and round the slope in the returned record — so `−0.7501` and `−0.7500` both print `−0.75`
with **opposite** noise types and opposite `meaning` strings, and the deciding digit is not in the output.

The joint fix (refuse when a boundary lies within 1.96 SE; publish `slopeSE`; stop rounding in the data)
**landed in two lanes.** A third copy was left behind.

## 1 · The third copy

| implementation | table | boundary handling |
|---|---|---|
| `clock.js` `CK_ALLAN_NOISE` | −0.75 / −0.25 / 0.25 / 0.75 | SE-aware refusal ✓ |
| `capture-host/allan.py` `_NOISE` | identical | `classify(sl, se=…)`, 1.96 band ✓ |
| **`ppgdex-dsp.js` `ALLAN_NOISE`** | identical | **`classifyAllan(sl)` — strict `<` on `r2(sl)`** ✗ |

`ppgdex-dsp.js`'s own comment gives it away: *"⚠ When that lands, note the SE is a LOWER BOUND…"*. It
was written expecting the joint fix and never received it.

**Fixing it is a compute-path change** — `ppgdex-dsp.js` is inlined, so per `CLAUDE.md` §🔏 it owes a
re-bundle, a `computeHash` move and a corpus re-verification. That is why it is a separate unit and not
a footnote to the gate below.

## 2 · A parity gate now exists, and what it does NOT do

Added 2026-08-15 (`tests/dex-tests.js`, group *"One noise-type rule, three implementations"*). It is a
**source scan** — the Python cannot execute from that lane — and it wires `capture-host/allan.py` into
`readSources` as the first `.py` there, loaded as text only.

It asserts the three tables are identical (edges, names, order), that `clock.js` and `allan.py` both
carry the SE-aware refusal, and it **pins `ppgdex-dsp.js`'s missing SE-awareness as a KNOWN DEFECT** so
that fixing it must update the group deliberately.

> **They agree TODAY, and the agreement was luck, not a constraint** — `grep ALLAN_NOISE
> tests/dex-tests.js` returned nothing before this group existed, while the Python copy was under edit
> the same day. That is the whole argument for the gate.

**What it does not do:** it compares tables and signatures as *text*. It does not execute either lane, so
it cannot catch two implementations that share a table and diverge in arithmetic. A cross-language
known-answer already exists for `allanFromPhase` (MINSTD, deliberately not the glibc LCG — that overflows
2⁵³ in JS but not in Python's bignums, so the two lanes would build different series and the
"cross-language" pin silently would not be one). Extending that to `classify` is the stronger gate.

### 2a · That extension is BUILT — 2026-08-16, group *"the two executable lanes must AGREE"*

23 rows, each the literal return of `capture-host/allan.py classify(sl, se)` **run** on that input, with
`DexClock.classifyAllan` executed live against it. Inputs sit where the lanes could differ: on an edge,
either side of one, `se == 0` (must NAME a type, not refuse), an interval whose upper end lands exactly
on the top edge, allan.py's own two exact-float fixtures, a band straddling everything including drift,
and four searched pairs putting the interval's **lower** end exactly on each edge.

**Result: the lanes agree on every DECISION** — noise, candidates, refusal, unrounded slope — on all 23
rows. Six mutants confirm the gate sees divergence (band 1.96→1.0 · edge `<`→`<=` · drift edge 0.75→0.8 ·
meaning reworded · straddle `<`→`<=` · re-rounding the slope).

**Two findings it produced, neither visible to table-equality:**

1. **`meaning` differs**: `√N` (clock.js) vs `sqrt(N)` (allan.py). The table gate never compared
   `meaning`, so nothing saw it. Pinned via one exact rewrite, and the **count of rows needing it is
   pinned too (4)** — a normaliser that silently absorbs the next divergence would be this repo's
   favourite defect wearing a fix. That count already earned its place: adding the four edge fixtures
   moved it 3 → 4 and the leg caught it.
2. **KNOWN DEFECT · `clock.js` hardcodes the drift edge.** allan.py derives it from the table
   (`sl + half > noise[-1][0]`); clock.js writes `sl + half > 0.75`. Identical today because the last
   edge *is* 0.75 — so behaviour-identical, no re-bundle owed — but a table edit moves one lane and not
   the other **while table-equality still passes**. `clock.js` is spine, so the one-line fix rides the
   next spine re-bundle rather than forcing one.

⚠️ **The gate had a hole, again, and again only mutation found it.** `sl - half < e` mutated to `<=`
survived all 19 original rows: no input placed the interval's lower end exactly on an edge, so the
comparison was unobservable. Fixed by searching for exact-float pairs (`sl=-0.24999804, se=1e-06` gives
`sl - 1.96·se == -0.25` exactly) — the same search allan.py's own comment recommends. **Second time in
this suite's history that mutating the GATE rather than the code was the only thing that worked.**

⚠️ **A bulk edit while writing this group replaced the WRONG `var PY`** — `tests/dex-tests.js` holds two
other known-answer tables of that name, and a `count=1` regex took the `allanFromPhase` one. Caught by
the new group's own ANTI-VACUITY row-count leg reporting 19 where 23 was expected. The table is now
`PY_CLASSIFY`; a generic name in a 44 k-line file is a collision waiting to happen.

⚠️ **The gate had a hole of exactly the kind it exists to prevent, found by mutating it.** The first draft
tested `/def classify\([^)]*se/`, which matches `se_unused=None` as a **substring** — so renaming the
parameter away left the gate green. Four mutants were applied; that one survived until the assertion was
tightened to `\bse\s*=`. A gate nobody has watched fail is not a gate, and that applies to the gate one
is writing.

## 3 · DECIDED 2026-08-16 — **the SE band STAYS.** The measurement was already in the repo, twice

The §6 box asked for a decision *"with the measurement, not the preference."* Both measurements
existed before this brief was written, in briefs this one did not cross-reference. Neither was found by
grep; both came from **`tools/doc-search.mjs` (#1349)** on the query *"should the Allan noise-type
classifier use lag-1 autocorrelation instead of a slope fit with a 1.96 SE band"*.

**1 · The weighting/EDF route is already REJECTED, with a measurement.**
`CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14` §6 evaluated exactly this. Weighted OLS over the correlated
overlapping points moves the answer by less than the distance to the nearest boundary on our curves —
*"the correction is real and immaterial."* And the one case where weighting **would** matter is a curve
near a boundary, which is precisely where `classifyAllan` already returns `noise: null`. The two
mechanisms cover the same case, and the refusal is cheaper and more honest: it says *undecided* rather
than producing a slightly better-weighted guess. That section closes with the EDF circularity being
**moot when the fix it would enable moves nothing.**

**2 · ⚠️ THE TWO "LAG-1"s ARE DIFFERENT STATISTICS. Do not cite one as evidence about the other.**
`METROLOGY-METHOD-ADOPTION-2026-08-14` §5 records a triumphant *"two-line lag-1 autocorrelation
answered in one measurement what the Allan family could not settle across three sections."* That is a
**plain correlation test** — *is this series correlated at all* — applied to PAT residuals. Riley &
Greenhall 2004 is a **noise-type identifier** — *which power law is this* — analytically, at any
averaging factor, without fitting a slope. Same two words, different statistic, different question.
A future reader citing METROLOGY §5 as evidence that lag-1 retires the SE band would be wrong, and the
two briefs sit close enough in semantic search to invite exactly that. This paragraph exists to block it.

**3 · So what remains genuinely open is narrow**, and it is NOT "the band is unprincipled". Riley &
Greenhall's identifier is slope-free, so it has no edge to sit near and the boundary ambiguity does not
arise — that much is real (`INTERDISCIPLINARY-LITERATURE-2026-08-16` line 69 records it verified, with
DOI `10.1049/cp:20040932`; Zhou/Greenhall/Howe 2011 extends it to the overlapping estimator we actually
use, venue verified, DOI unverified). What is unmeasured is whether it AGREES with the current
classifier on this corpus, and what it does on the mixtures the refusal was built for — §5 of METROLOGY
found MDEV declining to name a type on 4 of 6 nights because *"a mixture of ~9 % white fiducial noise
and ~91 % correlated physiology is not a canonical noise process"*, and an analytic identifier facing
that mixture will still return *something*. **An identifier that cannot refuse is not obviously an
upgrade on one that can.**

**The burden on any future adoption proposal**, stated so it is not re-litigated from scratch:
(a) show it identifies the noise TYPE, not merely the presence of correlation; (b) show what it returns
on the non-canonical mixtures where the band currently refuses; (c) move **all three lanes together** —
`clock.js`, `ppgdex-dsp.js` and `capture-host/allan.py` — since the known-answer gate now pins their
answers to one external reference and a single-lane swap reds it by construction. That gate is the
reason this can be reconsidered safely later.

🔁 **This same question is tracked in a second place**: `INTERDISCIPLINARY-LITERATURE-2026-08-16` line
271, *"Riley & Greenhall 2004 evaluated against the `1.96·SE` refusal band — does analytic noise-ID
retire it?"* Answered here, once. That box was closed by its own brief's author on 2026-08-16,
pointing at this section — an attempted cross-reference from this side was dropped as redundant. `stale-file`
cannot see this class of duplication — the two live in different files, so there is no overlap for it
to detect. That is the GENERATOR-FOLLOWUPS-III failure one level up, and worth knowing it exists.

## 3a · The literature that motivated the question (retained — it is still the right reading)

The `1.96 SE` band is documented in-code as a **deliberate stand-in**, and the parent brief explains why
the textbook treatment looked unavailable: *"a full Riley EDF treatment is circular here, because EDF
depends on the noise type being determined."*

That circle is a solved problem, and the solution is stronger than a wider band:

- **Riley, W. et al. (2004), "Power law noise identification using the lag 1 autocorrelation"** — names
  the dominant noise type *"for all common noise processes, from phase or frequency data, for all
  averaging factors, in a consistent and analytic manner"* — **without fitting a slope.** An estimator
  that never computes a slope has no edge to sit near, so the boundary ambiguity does not arise; and with
  the type identified independently, EDF becomes computable rather than circular.
- **Zhou Chunlei et al. (2011), IEEE ICEMI** — lag-1 identification **by overlapping samples**, which
  *"improves the confidence of the resulting stability estimate at the expense of greater computational
  time"*. Relevant because the overlapping estimator is the one actually in use here.
- **Schlossberger, N. et al. (2019), Joint IEEE IFCS/EFTF** — powers-of-two τ spacing is the
  *"spectrally closest-to-independent set of AVAR values possible, and thus optimally decompose
  frequencies in such a way as to have the least uncertainty in estimating slopes"*. This is the
  principled answer to the caveat the code already apologises for: overlapping ADEV points are
  correlated while OLS assumes independent residuals, so the SE is a **lower bound**.

Further reading for confidence intervals specifically: **Ashby, N. (2015)**, *IEEE T-UFFC*, on probability
distributions and confidence intervals for power-law noise; and **McGee, J. A. et al. (2007)**, *IEEE
T-UFFC*, on ThêoH's narrower chi-square confidence giving better noise-type determination at long τ —
relevant because this curve's ends are its biased part.

⚠️ **None of these are in `audits/CITATION-VERIFICATION-2026-08-05.json`**, whose 86 DOIs are almost
entirely clinical. A brief may cite them as-is (`briefs/` is deliberately outside the `citation-ledger`
scope). **If any reaches a reader-facing surface — a reference guide, `papers/**`, `docs/**.md`, or a
root `*.js` — it needs a ledger entry naming the correct first author and year, or `citation-ledger`
reds.** Do not shortcut that by editing `firstAuthor`; that is the one edit which makes a real defect
disappear.

## 4 · Resolved from the parent's §7 — one ANSWERED, two PARKED with what would settle them

1. **`ppmUncertainty` at the file's own span, or a fixed reference span?** → **ANSWERED: the file's own
   span, which is what already ships** (`clock.js:632`; `ecgdex-dsp.js` documents it as *"σ_y at the
   recording's own span — read the `ppm` above WITH it"*). The comparability the fixed-span option was
   reaching for is **already delivered by the contract**, which requires quoting the span beside the ppm
   (`CLAUDE.md` §7: *"never quote `ppm` without the span beside it"*); two files quoted with their spans
   are interpretable together without renormalising either. And the fixed-span form is not merely
   unnecessary, it is **unsafe on the short files that most need it**: σ_y at a τ the recording never
   reached must be extrapolated, which is fabricating a measurement — the same rule as §2.6's *"a missing
   stamp must be visible (null), never fabricated"* and as `hostAxis` going FLAT rather than extending a
   slope past its last anchor. Not "possibly both": a fixed reference span would be a second number that
   is honest only where it is redundant.
2. **Does the ECGDex `fs` correction want the uncertainty, or only its 2400 s span gate?** → **PARKED.**
   The principled position is clear — a span gate is a *proxy* for "is this rate well-determined" and
   `ppmUncertainty` is the direct measure, so the direct measure should win. What is missing is the
   estimator-specific derivation the parent's §3 already flags: ADEV(τ) and endpoint-estimator
   uncertainty are different quantities, coinciding only for white phase noise and even then off by a
   constant, so a threshold in σ_y units cannot be set from the current number without that derivation.
   **What would settle it:** derive the endpoint-estimator uncertainty for the correction ECGDex
   actually applies, then re-run the corpus and check whether any recording passes the 2400 s gate while
   failing an uncertainty gate, or vice versa. If neither set is non-empty the swap is cosmetic and the
   gate stays; that is the same "does it move anything" test §3.1 above settled the weighting question
   with, and it should be run before writing the derivation, not after.
3. **Is `independent` the right precondition, or should it also require a minimum span?** → **PARKED,
   and the framing in the question is wrong in a way worth recording.** `independent` is not a
   sufficiency test that a span requirement would tighten — it is a **provenance** test: `spreadMs > 2 ms`
   asks whether the host column is a second clock at all, or the device stamp rounded. The corpus is
   bimodal with nothing in between (box captures 101.89 ms – 5124 ms; phone captures 0.13 – 1.00 ms,
   whose maximum is exactly one stamp quantum), so it answers a yes/no question about what the data IS,
   and a short *genuine* two-clock recording is still two clocks. Bolting a span requirement onto it
   would conflate "there is no second clock" with "there is one but I do not trust it yet" — two
   findings a consumer must act on differently. **If a span floor is wanted for `stability`, it belongs
   as its own precondition on the quoted quantity, not inside `independent`.** Parked because nothing
   currently quotes `stability` off a short span in a way that has produced a wrong answer; **what would
   settle it** is a corpus scan for recordings that are `independent` yet short enough that σ_y at their
   own span exceeds the ppm they report — if that set is empty, there is no problem to fix.

## 5 · A process finding, because it cost real time

**The parent brief read `Status: PROPOSED` for two days after it shipped as #1227.** Acting on that
header, this session read the brief, checked the one precondition it names (no bundle work in flight —
true), **announced a fleet-wide spine change to another session**, and only then opened the tree. The
announcement had to be retracted.

Nothing was lost — the peer had no bundle work — but the ordering was wrong and the rule generalises:

> **An announcement is a request for other people to stop, so it comes AFTER the tree check, not before.**

And a stale status is not symmetric: **a stale `DONE` makes someone re-check finished work; a stale
`PROPOSED` invites them to build what already exists.** Weight them accordingly when sweeping.

## 6 · Done when

- [x] **DONE 2026-08-16** — `ppgdex-dsp.js classifyAllan(sl, se, nTau)` refuses at a boundary, publishes
      `slopeSE`/`nTau`/`candidates`, and returns the slope UNROUNDED, matching both siblings. New params
      are optional and LAST, so every pre-existing caller keeps the pre-SE contract by construction.
      It **cannot delegate** to `clock.js` — `PpgDex.html` inlines no `clock.js`, so `DexClock` is
      undefined in that bundle; the duplication is structural, not laziness, which is the argument for
      pinning answers rather than trusting the copies. Landed with the re-bundle (`manifestHash`
      `0a6b1833a7d9` → `d0bd8cbe0add`, 6 fixtures re-stamped) and the corpus re-verification §🔏 owes:
      `verify-fixtures.mjs` ran green over the real corpus and stamped
      `PpgDex_2026-06-27_equiv.node-export.json verifiedUnder → 16583a17082c` (13 already current).
- [x] **DONE 2026-08-16** — the KNOWN DEFECT pin is now three contract assertions in the same PR
      (SE-aware · no `r2(sl)` in the record · drift edge derived from `ALLAN_NOISE`, not hardcoded).
      The known-answer group also gained ppgdex as a **third lane against the same pinned Python
      answers** — all three now agree on all 23 rows, checked against one external reference rather
      than two copies agreeing with each other.
- [x] **DONE 2026-08-16 — the SE band STAYS**, on measurements that already existed in two briefs this
      one did not cross-reference (`CROSS-DOMAIN-METHODS-FOLLOWUPS` §6 rejected the weighting route as
      *"real and immaterial"*; `METROLOGY-METHOD-ADOPTION` §5 is about a DIFFERENT lag-1 statistic — see
      §3.2, which exists to stop that conflation). The adoption burden for any future proposal is stated
      in §3, including that all THREE lanes must move together or the known-answer gate reds.
- [x] **DONE 2026-08-16** — §4 resolved: Q1 **answered** (own span, which already ships; a fixed
      reference span is unsafe on exactly the short files that would want it — it extrapolates σ_y to a τ
      the recording never reached). Q2 and Q3 **parked with what would settle them**, and Q3's framing
      corrected: `independent` is a provenance test, not a sufficiency test, so a span floor belongs on
      the quoted quantity rather than inside it.

## Cross-references

- Parent: `HOSTAXIS-STABILITY-2026-08-13-BRIEF.md` (DONE — 2026-08-15, #1227).
- `ALLAN-DEVIATION-2026-08-12-BRIEF.md` — the capture-host lane this one mirrors.
- `CLAUDE.md` §7 (the Clock Contract's host-disciplined axis) · §🔏 (computeHash / re-verification) ·
  §📚 (literature use, attribution, and the ledger).
