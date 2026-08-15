<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [suite]
brief: none
---
Re-fold the whole capture corpus under current code — 55 nights (was 40), 45 with a σ solution (was 33).

Every night in every reachable capture tree (phone-captured `Ecg nightly`, the box tree, and the
box's own `/srv/tepna/captures`) was re-run through `tools/trio-batch.mjs` on current `main`. 102
nights folded, 54 three-way eligible; the corpus grows by 15 nights and now reports
`all 55 night(s) from one producing code version`.

Three things the re-fold surfaced, none of which any gate could have caught:

- **16 `PpgDexFinger` exports were stale**, produced before #1229 (`the crystal axis ran backward`).
  Refreshed, they expose dropouts the committed copies hid — 2026-07-26 goes from 39 to 41 coverage
  segments.
- **`uploads/trio/2026-06-19/ECGDex` was built from a merge the current code refuses.** Its four
  sessions disagree on measured fs (129.822 vs 129.942 Hz); over the export's 6.3 h span that is
  20.9 s of accumulated timing error. Measured straight from the raw, six other sessions from the
  same device read 129.937–129.959 Hz, so the 4.5 h session is a 0.10 % outlier rather than the rest
  being wrong. The export is removed; the night keeps its PpgDex/OxyDex legs.
- **2026-08-10's raw grew** since it was first folded (OxyDex beats 19259 → 25704), and the new
  coverage block types the night `sparse / sensor-dropout` across 4 segments.

σ medians move accordingly (ρ-on): ECGDex 0.40 → 0.44, PpgDex 0.43 → 0.52, OxyDex 1.24 → 1.31 bpm,
median culprit 1.37 → 1.58. The published figures were low because the corpus was small, not because
the sensors got worse.
