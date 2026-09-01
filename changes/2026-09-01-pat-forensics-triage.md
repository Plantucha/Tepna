<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md
---
The PAT forensics wave triaged and stamped — it is tooled and unexecuted, and the corpus is local after all.

Five briefs carried `IN-PROGRESS` with no verified state recorded. Per the roster contract ("a triage
that leaves the header untouched has thrown away its own work"), each now carries what was checked.

**The wave is FIVE briefs, not three** — `WINDOW-ORACLE`, `WINDOW-REGIMES`, `FIDUCIAL-JITTER`,
`AXIS-LEG-ASYMMETRY`, plus the `ROOT-CAUSE-FORENSICS` charter head.

**The tooling largely exists.** `tools/pat-*.mjs` numbers **20**, covering most of what the charter's §0
calls "genuinely NEW": §6 `pat-fiducial-jitter`, §7 `pat-fiducial-compare`, §11–13 `pat-window-oracle`.
What is missing is not tools but **execution against the corpus**.

**And the corpus is LOCAL — my first pass got this wrong and the correction is the useful part.** I
searched the repo's `uploads/` tree, found node-export JSON and no `_ECG.txt`, and recorded "blocked on
data locality". The canonical root is **`/srv/data/tepna-corpus/` — 125 GB, 1131 raw `_ECG.txt`** — with
per-night raw dirs under `smoketest-captures/` (box), `uploads/vigil-archive/captures/` (daily mirror)
and `uploads/Ecg nightly/` (phone). The raw never lives in the repo, which is exactly why looking there
produced a confident absence.

Pointed at `uploads/trio` the oracle exits **0** with an empty table and `TALLY: {}` — a **wrong-root
failure**, not a negative result, and reading it as evidence of absence is what made the wrong verdict
feel supported.

So the `--dir` tools (`pat-window-oracle`, `pat-residual-structure`) **can** run here, and the wave is
execution-bound rather than access-bound. `<ppg-file>` tools already produce real output — fiducial-family
pairwise within-SD **6.55–9.84 ms**, IQR 8.75–12.92, every pair `NOT-DOMINANT`, TCH decomposition REFUSING
on negative variance for three triplets.

⚠️ **Landmine recorded for anyone walking the corpus: `smoketest-captures/2026-08-23` makes trio-batch
consume >50 GB from 285 MB of raw input** (unbounded-growth defect, under probe). Exclude that night;
43 of 44 box nights remain usable.

`pat-window-oracle` is selftest-clean (**8/8**) and its results are referenced in no brief, audit or doc:
built, verified, never run.

Headers stamped rather than flipped: the tools have not yet produced corpus results, and flipping a
status on unrun tooling is the false claim the lifecycle forbids. The blocker is execution time, not
access.


**FIRST CORPUS RUN — `pat-window-oracle` executed 2026-09-01.** 43 box nights, ±100 ms:
**2 SIGNAL RECOVERED · 14 PARTIAL · 6 NO RECOVERY · 6 UNDEFINED (n=0) · 15 ⊘ too few beats.**

The arithmetic is the finding. `nullSD` is **56.2–59.5 ms** on 18 of 22 scored nights, and a uniform draw
across the ±100 ms search window has SD `200/√12 = 57.7`. `fullSD` lands on 130.1/130.4/130.5/136.9, and
the 450 ms PHYS window gives `450/√12 = 129.9`. **The null is reproducing its own window width** — so
this run independently confirms, at corpus scale from a never-executed tool, what the
`pat-sd-is-the-window` memory records from a different direction: a PAT SD quoted without its window is
a measurement of the window.

Only **2 nights** beat their own null (`2026-07-24` 15.3 vs 59.5; `2026-08-17` 17.9 vs 57.8). **5 nights
recover a mode outside the physiological window** (25 ms, 165, 185, 815, 1245) — alignment artifacts,
not transit times. **6 nights score UNDEFINED with zero matched beats** despite having beats, which is a
pairing failure distinct from "too few beats" and is the most concrete follow-up this run produces.
**HALF-WIDTH SWEEP — run against bands registered beforehand.** `w = 50/200/300` added to the ±100 pass.

*Prediction 1 (`nullSD` = `2w/√12`)* holds exactly at 50 (**28.9** vs 28.9) and in band at 200 (**111.6**
vs 115.5), and **misses at 300 (153.8 vs 173.2, −11.2 %)**. Reported as a miss: past ±200 ms the window
stops being the binding constraint, since a uniform draw can only fill a window candidate matches span.
"The null is the window" is true *while the window is the narrower constraint* — which the ±100 ms
operating point satisfies.

*Prediction 2 (the two signal nights must hold their mode within their own SD)* passes decisively: both
are **invariant**, not merely in tolerance — `2026-07-24` recovers **405 ms** and `2026-08-17` **215 ms**
at every one of w = 50/200/300, across a 6× change in search width. Neither reclassifies; the corpus has
two genuine signal nights on a basis stronger than one operating point.

⚠️ Their verdict LABELS degrade while their modes do not (`08-17` reads NO RECOVERY at w=300 while
recovering the identical 215 ms). Both SDs grow with `w`, so the ratio erodes though the location is
fixed. **The label is a function of the window; the mode is not** — a consumer quoting the verdict at one
half-width would draw the opposite conclusion from the physics.
