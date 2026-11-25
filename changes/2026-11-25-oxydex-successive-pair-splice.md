---
bump: patch
type: fixed
brief: LOCAL-QWEN-SWEEPS-2026-11-22-BRIEF.md
nodes: [OxyDex]
---

OxyDex counted a pair of heart-rate readings across a removed stretch as one second of beat-to-beat
change. The three successive-difference sites (`computeHRV`, `computeHRAdvanced`, `computeRMSSDarc`)
filtered motion rows, device-artifact rows and rows with no heart rate, and then read every
neighbouring pair of the FILTERED array. Minutes of removed signal could sit between two such
neighbours, and a gap in the stamps did the same thing with no filter at all. A pair now qualifies on
the row stream: the two rows must be neighbours in `rows`, and they must sit within 1.5 cadences of the
stream's own median cadence. The qualifying-pair count is the population of the value, so the nights
publish it as `hrPairs`, and a night with no qualifying pair answers null instead of 0. The window arc
also asks for a finite heart rate, which it did not: `null - 58` entered the sum as a 58 bpm jump.

Measured over the 42 distinct O2Ring nights of the corpus: the shipped RMSSD proxy was 1.001 to 1.459
times the adjacent-pair value, median 1.010, p90 1.105. pNN3 moved from 0.386 % to 0.370 % at the
median. Two consumers that read the former 0 are repaired with it: the night-row chip, which graded an
unmeasured proxy RED with the word "null" as its value, and the HR-ADVANCED line of the CSV export.
