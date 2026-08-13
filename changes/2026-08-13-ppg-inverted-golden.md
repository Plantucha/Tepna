---
bump: patch
type: added
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

Every committed PpgDex Verity input resolved to sign +1, while all 20 REAL Verity nights resolve to -1
(more blood absorbs more light, so the raw optical signal DIPS on systole). The committed corpus
therefore exercised a polarity the hardware never produces, and the path the device actually takes had
no fixture at all — which is how `orient` was wrong on 10 of 20 real nights with all five PpgDex
goldens green.

Mints `synthetic_ppgdex_verity_inverted.txt` + its rich golden: byte-identical to the clean twin with
the pulsatile term negated and the DC untouched, so the pair isolates polarity alone.

Adds a group that asserts an INVARIANT rather than a recorded answer, because a golden reds when a
value MOVES and never when a value was wrong from the start (the rich golden recorded
analyzablePct = 56 on a mis-polarised record for months). Whatever polarity `detectChannel` resolves
must be the one with the SHORTER systolic rise, checked end-to-end through the shipped entry point so a
correct rule that stops being WIRED still reds. Deliberately not a `< 0.5` threshold: on the synthetic
the wrong polarity scores 0.402, so a bound tuned on real data (0.63-0.76 wrong) would pass it
silently. The clean twin is retained as the control that must resolve +1, or a hard-coded -1 would
satisfy everything else.
