<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: TRIO-POWER-N15-FINDINGS-2026-07-12-BRIEF.md
---

Fold 25 trio nights and record the result. `TRIO-POWER-N15-FINDINGS` blocks `SENSOR-TRIO-NIGHTS-PAPER` on
an N = 10 → 15 re-fit whose CI is that paper's entire deliverable. N is now 25.

The data was reachable all along, just not known to be: 19 GB of Polar Sensor Logger output at
`Ecg nightly/` on the working volume. Run with the sanctioned tools rather than a hand-rolled harness —
`tools/trio-batch.mjs` produced 25 nights (2026-06-10 … 07-13) and 75 node-exports in 190 s, then
`tools/tch-multinight.mjs` fitted the hat: 23 estimated of 25, all from one producing-code version, median
σ ECGDex 0.56 / PpgDex 2.71 / OxyDex 1.11 bpm classic (0.81 / 2.99 / 1.14 with ρ on).

These are deliberately NOT presented as a correction to the paper's published 2.41 / 1.28 / 1.42. It is a
different estimator — classic/ρ-on against the paper's fused-weight artifact-robust hat — and the ordering
differs, which is the question the re-fit exists to answer rather than something to silently apply. Also
not established: whether these nights overlap the σ-paper's existing 26-night corpus, which decides
whether this is new N or a second estimator over the same data.

The tool's own honesty is preserved in the record: 2 nights excluded because negative classic variance
puts the fit on the non-negativity boundary where σ is ~0 by construction, 7 nights ρ-REJECTED, and every
per-night drift line reading "UNCLOSED (no third source): not a measurement".

One trap recorded for the next run: the first attempt used a `/tmp` output directory that already held 16
nights from earlier runs, producing a 41-night hat. `tch-multinight` caught it unaided — "MIXED — corpus
mixes producing-code versions … a median over this corpus is a statement about the MIX, not about the
sensors" — and the medians moved once the set was cleaned. Fold into a fresh directory, and read the
corpus line before reading the numbers.
