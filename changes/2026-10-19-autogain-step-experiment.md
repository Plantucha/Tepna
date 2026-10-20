---
bump: patch
type: added
brief: PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md
---

Measure whether repairing the sensor's autogain level steps before filtering would move the exported
HRV at all, and answer no. `tools/ppg-autogain-e2.mjs` detects level steps on the raw chosen channel,
widens each one by the brief's own settling closed form, and scores the rMSSD the intervals inside
those windows carry against the rest of the night, over the 37 wrist recordings a stated size rule
finds in the capture tree. A positive control reproduces the shipped statistic on 37 of 37 nights and
40 seeded re-centred draws supply a null, because dropping any 1 % of adjacent pairs moves rMSSD by
itself. Counting only the steps that leave the pulse AC alone — the ones autogain can explain — 78 %
of what the detector finds drops out as motion and the median effect falls to 0.147 ms, under the
0.35 ms bar the brief's own published bias figure sets. The detector reads the stream's validity
sidecar where a capture wrote one and counts a block with too few finite samples as absent rather than
as a level, so the edge of a blanking run cannot read as the largest gain change in a record. No
runtime code moves.
