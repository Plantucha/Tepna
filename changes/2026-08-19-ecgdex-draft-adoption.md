<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [ECGDex]
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
22 of the 23 banked ecgdex draft targets adopted (nothing here was stale — the drafts' whole
survivor set was still alive). The guard floor is pinned from BOTH sides: every validation guard
refuses absent input with null-never-throw, and a fully-valid 2-minute ECG-vs-device comparison
RETURNS its report — the case no clause-negation can fake. Poincaré's 3-beat floor, the Baevsky
bins, the DFA 4..16 box ladder inclusive, buildNN's declared-vs-computed coverage, classifyMode's
/60, and accAnalyze's defaults-with-respConfident-false ride along.

Three probe inputs needed sharpening after first kill-verify: parseDeviceRR now pins the Clock
Contract on a garbage stamp (tsMs null on that row, never a throw or a fabricated time);
epochMotion pins that the HOST-CLOCK OFFSET is honored and that offset-starved coverage reads
NULL, not "still" (an ACC 270 s late drops epoch 0 from the map — `||` would fabricate the offset
from a lone ACC clock, zeroing /1000 would blow it past the clamp and silently un-shift the night).

Not adopted, honestly: the six identical `for (k < n)` loop-header survivors (a text-degenerate
class the drafts never targeted — sweep backlog), and stampEpochPositions' inner fs*30 pair,
which is double-gated by an interior threshold on the same constant and is output-equivalent on
every input tried — left for an equivalence-harvest proof, not silently claimed killed.
