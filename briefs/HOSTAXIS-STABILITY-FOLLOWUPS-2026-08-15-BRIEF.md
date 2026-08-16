<!--
  HOSTAXIS-STABILITY-FOLLOWUPS-2026-08-15-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-15 · **Follows:** `HOSTAXIS-STABILITY-2026-08-13-BRIEF.md` (DONE — 2026-08-15, executed as #1227) · **Affects:** `ppgdex-dsp.js` (compute-path), `tests/dex-tests.js`

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

## 3 · The literature removes the boundary problem at the root — it does not merely bound it

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

## 4 · Still open from the parent's §7

1. **Should `ppmUncertainty` be reported at the file's own span, or at a fixed reference span?** The
   former answers *"how far do I trust THIS file's ppm"*; the latter makes files comparable. Possibly both.
2. **Does the ECGDex `fs` correction want the uncertainty at all**, or only the 2400 s span gate it
   already has? Answering this needs the estimator-specific derivation the parent's §3 says is missing —
   ADEV(τ) and endpoint-estimator uncertainty are different quantities and coincide only for white phase
   noise, and even then differ by a constant.
3. **Is `independent` the right precondition, or should it also require a minimum span?** `hostAxis`
   deliberately has no span gate because it *interpolates* rather than quoting a rate — but `stability`
   **is** a quoted quantity, so that argument may not transfer to it.

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

- [ ] `ppgdex-dsp.js classifyAllan` takes an SE and refuses at a boundary, matching its two siblings —
      landed as its own unit with the re-bundle, `computeHash` move and corpus re-verification §🔏 owes.
- [ ] The KNOWN DEFECT pin in the parity group is converted to a contract assertion **in that same PR**.
      A pin outliving its defect is worse than no pin.
- [ ] A decision on §3: adopt lag-1 identification, or record why the SE band stays — **with the
      measurement**, not the preference. If adopted, both lanes move together or the parity gate reds.
- [ ] §4's three questions answered, or explicitly parked with reasons.

## Cross-references

- Parent: `HOSTAXIS-STABILITY-2026-08-13-BRIEF.md` (DONE — 2026-08-15, #1227).
- `ALLAN-DEVIATION-2026-08-12-BRIEF.md` — the capture-host lane this one mirrors.
- `CLAUDE.md` §7 (the Clock Contract's host-disciplined axis) · §🔏 (computeHash / re-verification) ·
  §📚 (literature use, attribution, and the ledger).
