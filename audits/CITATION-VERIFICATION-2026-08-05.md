<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** REFERENCE (living — re-run when citations change) · **last-verified:** 2026-08-05 · **Closes:** the §1/§2 blocker in `briefs/DEX-CITATION-FORMULA-AUDIT-BRIEF.md`

# Every DOI in the repo, resolved — three were wrong, and all three resolved

`DEX-CITATION-FORMULA-AUDIT` completed its offline half on 2026-08-04 and stopped, recording one
blocker: *"§1/§2 citation verification needs NETWORK, which this suite forbids by construction."*

**That reading was too broad.** What the suite forbids is a **bundle** reaching the network — gate-backed
by `no-network.html`, and about shipped code. `LITERATURE-USE-POLICY` describes the opposite motion as
the normal one: a literature value is *"inlined into source at author time as a cited constant"*, which
presumes the author checked it. Verifying a citation at author time and committing the result is that
rule, not an exception to it. Nothing here is fetched at runtime; this is the offline record of a check
that happened once.

## Method

All 86 distinct DOIs appearing in any `*.js` / `*.html` / `*.md` were extracted and resolved against
`api.crossref.org/works/{doi}`, then each citation's visible author + year were compared against the
resolved metadata. Results are committed in `CITATION-VERIFICATION-2026-08-05.json`.

**86 of 86 DOIs resolve.** Zero fabricated, zero dead, zero typo'd-into-nonexistence.

That is the weaker half of the result, and on its own it would have been misleading — because **the
three real errors all resolve too.**

## The three errors — each a valid DOI pointing at the wrong paper

A dead link announces itself. A DOI that is merely *wrong* resolves, renders as a working link, and
survives every offline check the repo can perform. All three below would have passed a link-checker.

| # | where | cited as | the DOI actually is | fix |
|---|---|---|---|---|
| 1 | `OxyDex Reference.html` | Garg N, Rolle AJ, Lee TA, Prasad B. *Home-based diagnosis of OSA in an urban population.* J Clin Sleep Med. 2014;10(8):879–885 | `10.5664/jcsm.3966` → **Katz et al., *Drug Testing in Children with Excessive Daytime Sleepiness During MSLT*** | `10.5664/jcsm.3960` |
| 2 | `OxyDex Reference.html` | Pépin J-L, Bailly S, Tamisier R. *Big data in sleep apnea: opportunities and challenges.* Sleep Med Rev. 2020;54:101358 | `10.1016/j.smrv.2020.101358` → **Folmer et al., *Prevalence and management of sleep disorders in the Veterans Health Administration*** | `10.1111/resp.13669` — Respirology 2020;25(5):486–494 |
| 3 | `papers/effort-typing-null.html` | Pillar G, Berall M, Berry R, et al. *Detecting central sleep apnea in adult patients using WatchPAT.* Sleep Breath, 2020 | `10.1007/s11325-019-01922-3` → **Lu et al., *Validation of a portable monitoring device for the diagnosis of OSA*** | `10.1007/s11325-019-01904-5` — Sleep Breath 2020;24(1):387–398 |

**#1 and #3 are single-character slips** (`3966`/`3960`, `01922-3`/`01904-5`) that happen to land on
another real paper in the same journal. **#2 is a conflation**: the authors and title are Pépin's, the
journal, volume, article number and DOI are Folmer's — two papers fused into one entry.

All three are corrected in this pass, with the replacement DOIs resolved and their volume/pages taken
from Crossref rather than retyped.

## Still open — attribution, not correctness (routed, not fixed here)

These are real but need a `*-dsp.js` edit, so they carry a re-bundle and fixture re-verification and
belong to their own work-unit. See `briefs/CITATION-ATTRIBUTION-FOLLOWUPS-2026-08-05-BRIEF.md`.

| where | issue |
|---|---|
| `integrator-dsp.js` → `Integrator.html`, `OverDex.html` | `10.3390/s21144777` is credited to *"Straczkiewicz M, Huang EJ, Onnela J-P (2021)"*. The title is right; the authors are **Brønd JC, Pedersen NH, Larsen KT, Grøntved A**. |
| `integrator-dsp.js` → `Integrator.html`, `OverDex.html` | `10.3390/jimaging8050120` is credited to *"Bent B et al. (2022)"*. The title is right; the authors are **Xiao R, Ding C, Hu X**. |
| `ecgdex-dsp.js`, `ppgdex-dsp.js` → 4 bundles + 9 analysis pages | `10.1088/1361-6501/ae6a09` (Abdessalem 2026, *Meas Sci Technol*) is cited **DOI-only**, with no author, year or journal. CLAUDE.md §📚 requires author·year·journal·DOI. |

## What was NOT a finding

`10.1161/01.CIR.93.5.1043` reads as an author mismatch against Crossref in every guide that cites it,
because Crossref stores its author as the corporate *"Task Force of the European Society of Cardiology
and the North American Society of Pacing and Electrophysiology"*. The guides' *"Task Force of the ESC
and NASPE"* is correct. Recorded so the next pass does not re-open it.

Likewise, **zero** year mismatches survived once online-first was accounted for: Crossref's `issued`
year is up to a year before the print/issue year a citation quotes (`s19010088` 2018/2019,
`s11325-019-01922-3` 2019/2020, `eurheartj/ehy624` 2018/2019, `s00421-003-0988-y` 2003/2004). A ±1-year
gap is agreement, not an error, and a checker that flags it produces noise that hides results like the
three above.
