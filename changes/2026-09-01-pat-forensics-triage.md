<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md
---
The PAT forensics wave triaged and stamped — it is tooled, unexecuted, and blocked on data locality.

Five briefs carried `IN-PROGRESS` with no verified state recorded. Per the roster contract ("a triage
that leaves the header untouched has thrown away its own work"), each now carries what was checked.

**The wave is FIVE briefs, not three** — `WINDOW-ORACLE`, `WINDOW-REGIMES`, `FIDUCIAL-JITTER`,
`AXIS-LEG-ASYMMETRY`, plus the `ROOT-CAUSE-FORENSICS` charter head.

**The tooling largely exists.** `tools/pat-*.mjs` numbers **20**, covering most of what the charter's §0
calls "genuinely NEW": §6 `pat-fiducial-jitter`, §7 `pat-fiducial-compare`, §11–13 `pat-window-oracle`.
What is missing is not tools but **execution against the corpus**.

**And the corpus is on Heron.** The split matters:

- `--dir <captures root>` tools (`pat-window-oracle`, `pat-residual-structure`) **cannot run here at all**:
  they need per-night dirs of raw `_ECG.txt`/`_PPG.txt`, and this machine has **zero** `_ECG.txt`.
  `uploads/trio/<date>/` holds node-export JSON, not raw captures — pointed at it the oracle exits **0**
  with an empty table and `TALLY: {}`, which is an empty result rather than a negative.
- `<ppg-file>` tools (`pat-fiducial-jitter`, `pat-axis-leg-audit`) **do** run: fiducial-family pairwise
  within-SD **6.55–9.84 ms**, IQR 8.75–12.92, every pair `NOT-DOMINANT`, TCH decomposition REFUSING on
  negative variance for three triplets. But only **2** `_PPG.txt` exist locally and `between-file SD` is
  empty, so those numbers show the method works — they are not the deliverable.

`pat-window-oracle` is selftest-clean (**8/8**) and its results are referenced in no brief, audit or doc:
built, verified, never run.

No Done-when item is closable from this machine. Headers stamped rather than flipped, because the
blocker is data access and flipping a status on unrun tooling is the false claim the lifecycle forbids.
