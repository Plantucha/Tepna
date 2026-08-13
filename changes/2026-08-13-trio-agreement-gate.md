---
bump: minor
type: added
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---

The fold had all the data to catch two shipped PpgDex defects and never looked. A wrong optical
polarity on 10 of 20 real nights, and a `correctRR` reference lock-in emitting a constant HR for 25
minutes, both passed FIVE green PpgDex fixtures — neither is visible inside the node, because a
polarity flip is COMMON-MODE across the three LEDs and a locked reference is SELF-CONSISTENT. Both are
obvious the moment PpgDex is placed beside the simultaneous ECG and ring.

Adds `IntegratorDSP.hrAgreement(sources)`: cross-node epoch HR adjudication, aligned on the ABSOLUTE
instant (the nodes' startEpochMs differ by up to 24 min on this corpus, so comparing epoch indices
compares different moments). It follows the GNSS integrity-monitoring boundary — redundancy DETECTS a
fault, but ISOLATING it needs one more source than detecting it:

  2 sources  -> detected on the SPREAD; `adjudicated:false`, `outlier:null`
  3+ sources -> the outlier is the source furthest from the median, and it is named

A pair is judged on spread rather than distance-from-median because with two sources the median is
their midpoint, so a 26 bpm disagreement reads as 13 and the check silently loses half its sensitivity.

`trio-batch` now runs it over the exports it just wrote and PERSISTS the verdict as
`agreement_<night>.json`. Writing it is half the point: every clock fit this tool computes is printed
and then lost with the scrollback, so nothing downstream can read, diff or gate on any of it.

Validated against the live defect: run on 2026-07-19 from a checkout WITHOUT the lock-in fix, it flags
7 of 88 epochs, names PpgDex in all 7, and its first flagged epoch is 03:33:49 — the exact epoch the
manual investigation reached after five wrong attributions.

Also fixes a coordinator HANG: `runOne` resolved only on `close`, which needs the child to have exited
AND every stdio pipe to have reached EOF. Measured: 17 nights computed, every stamp written, then 32
minutes at 0 % CPU with a DEFUNCT child. `exit` now decides, `close` still wins when it arrives first,
and `error` is handled rather than thrown.
