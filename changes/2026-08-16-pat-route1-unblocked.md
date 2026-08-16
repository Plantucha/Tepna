---
bump: patch
type: changed
brief: PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md
---

`PAT-NO-VALID-ANCHOR` §6 route 1 was recorded as blocked on the BLE adapter fault that fragments the
Verity, making a fresh capture a prerequisite. Measured on the box 2026-08-16: it is not blocked, and
has not been for some time.

Over the last 12 capture days, 10 carry a ≥4 h single-segment Verity PPG and a ≥4 h single-segment H10
ECG covering the same session; only 2026-08-08 and 2026-08-12 do not. The strongest is 2026-08-07 —
both streams single-segment and starting within two seconds of each other, 9.0 h of overlap, clock
disciplined at stratum 1 throughout, ACC present on both devices, and the Verity ACC covering the full
span at 51.7 Hz against a 52 Hz nominal, starting two seconds before the PPG. 2026-08-11 and 2026-08-16
are viable alternates at 6.6 h and 6.1 h.

The adapter fault is real but intermittent rather than persistent: it fragmented 2026-08-16 into
roughly three-minute pieces from 11:06 onward while leaving most overnight runs whole. The brief's
premise was true when written and had quietly stopped being true, with nothing re-checking it.

Records two measurement traps, because both produced confident wrong answers on the way to that table.
A capture directory is keyed by session start, so a night spans two directories — last night's H10
began at 22:15 on the 15th and files under 2026-08-15 while its Verity began at 00:15 and files under
2026-08-16, so listing one directory returned "zero H10 files", which was true of the directory and
false of the night. And `ls …_PPG.txt | head -1` takes one segment of many, which on a fragmented day
reads a three-minute piece as though it were the night, and on a clean day happens to read the right
file — wrong in a way that usually looks right.

Scope: this establishes that the data satisfies route 1. The analysis — deriving the non-beat anchor on
2026-08-07 and testing whether PAT resolves — has not been run. Route 1 is unblocked, not executed.

Docs only.
