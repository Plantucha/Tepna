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
