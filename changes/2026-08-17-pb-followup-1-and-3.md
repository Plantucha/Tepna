---
bump: patch
type: fixed
brief: OXYDEX-PB-DETECTOR-FOLLOWUPS-2026-08-17-BRIEF.md
---

Two comments in `computePatternScores`, closing follow-up §1 and mitigating §6, plus the tool fix that
stopped `pb-fusion-blast` asserting a limitation it had outgrown.

`cycleIntervals` is a sliding view — `k` true cycles produce `2k − 1` entries — and its `.length` is not
a cycle count. That is harmless for the mean and SD it feeds today, and a trap for any future
"≥ N consecutive cycles" test, which is exactly the criterion AASM states. The comment says so at the
declaration and points at `detectSpO2Periodicity`'s disjoint pairing. The construction is unchanged.

The `iv < 300` interval guard is coupled to `OSC_WINDOW_SEC` and must track it: straddling a whole
skipped window forces the interval past the window width, which is why that bound catches every
gap-spanning pair — 184 of 2438 on 61 real nights, 0 surviving. Structural, not luck, and previously
undocumented.

Behaviour is unchanged and that was computed rather than claimed: `manifestHash` af9c9c894bf1 →
6a1929379538, `computeHash` moved (comments live inside the compute closure), so re-verification was
owed and run — the app re-ran on the committed inputs and reproduced the bytes, two fixtures re-stamped.
