<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---
The half-width sweep resolved against its pre-registered bands, and the six `n=0` nights localised to the matcher.

**Sweep, run against bands committed beforehand.** `nullSD` tracks `2w/√12` exactly at w=50 (**28.9** vs
28.9) and in band at w=200 (**111.6** vs 115.5), and **misses at w=300 (153.8 vs 173.2, −11.2 %)**.
Reported as a miss: past ~±200 ms the window stops being the binding constraint, since a uniform draw can
only fill a window candidate matches span. "The null is the window" is therefore true *while the window is
the narrower constraint* — a narrower claim than the first corpus run supported, and the sweep is what
narrowed it.

**Both signal nights are INVARIANT, not merely in tolerance.** `2026-07-24` recovers **405 ms** and
`2026-08-17` **215 ms** at every one of w = 50/200/300 — across a 6× change in search width. Neither
reclassifies; the corpus has two genuine signal nights.

⚠️ **Consumer hazard: the verdict LABEL is a function of `w`, the MODE is not.** `2026-08-17` reads
NO RECOVERY at w=300 while recovering the identical 215 ms. Quote the mode, or quote the verdict with its
half-width.

**The six `n=0` nights are not a detection failure.** Counts at each stage: every night carries
6 000–26 000 beats on both streams. The discriminator is the **span ratio** — nights that pair have
near-identical ECG/PPG spans (1.00, 0.99), every `n=0` night has a PPG fragment covering 0.25–0.45 of the
ECG span. But partial coverage should give *fewer* matches, not *zero*, so the defect sits in the
**matching stage under partial overlap**.

Two hypotheses died on the way, each a proxy for the thing: fragmentation (falsified — a 3/328-fragment
night pairs fine) and fragment non-overlap (falsified twice — once comparing file-name start times as a
proxy for temporal overlap, once comparing the *first* files when `pick()` returns the *largest*).
