---
bump: patch
type: fixed
brief: none
---

A drain stamp merged this morning cited a span-kind vocabulary that was falsified the same evening.

`PPG-FOOT-PLACEMENT-FOLLOWUPS`'s drain stamp (#2680) recorded a finger-off capture as distinguishing
`absence` (value 100) from `in-wear-rail` (0/199). Per `capture-host/writers.py` and owner ruling D5
(#2685), the evening's pre-registered capture on a WORN finger refuted both in one consistent way:
worn plus disturbed AC — occlusion, strong light, handling — gives flat 100 for up to 672 samples, so
100 does not mean no-finger; and 0/199 never held as a steady rail under any stimulus, arriving
together as short full-scale excursions in the same episodes. The sidecar now emits the measurement
and names nothing. The two names are not renamed — they are refuted.

WHAT SURVIVES IS THE CONCLUSION, and it survives because of how it was reached: the stamp checked
whether the brief makes a zero-is-a-gap claim by reading the brief's own text, not by reasoning from
the vocabulary. It does not. What does not survive is the framing, so the correction points any future
check at `writers.py` rather than at the stamp's sentence.

⚠️ THE CORRECTION IS SMALL BECAUSE THE ORIGINAL WAS CAUTIOUS. The hazard was recorded as WATCHED, not
cleared, because #2675 was still OPEN when checked — twice, after being described as landed. Had it
been CLEARED, this brief would now assert a cleared hazard on a vocabulary that lasted one afternoon,
and a cleared hazard is not re-checked.

A CLAIM'S HALF-LIFE IS A PROPERTY OF ITS SUBJECT, NOT OF THE WRITER'S CARE. A toolchain claim about an
external project went stale over eleven weeks; this stamp about an actively-moving internal decision
went stale in about six hours. Same class, three orders of magnitude apart in tempo — so a stamp on a
live decision needs its date MORE than a claim about a third party's release, which is the opposite of
the instinct.

Scope checked rather than assumed: `in-wear-rail` appears on main in the parent brief (already
corrected by #2685), this stamp, and three changesets. The changesets are records of what was done and
were true when written — they are release history, not live claims, and are left alone.
