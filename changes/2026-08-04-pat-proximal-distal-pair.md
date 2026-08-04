---
bump: minor
type: added
brief: PAT-PROXIMAL-DISTAL-PAIR-2026-08-04-BRIEF.md
---

`PAT-VERDICT-CONSOLIDATED` §4.2 lists a proximal→distal site pair as one of two things that could
reopen PAT, unchecked because everything measured was "arm/wrist and finger". **The corpus already
contains one**: the ring is on the right index finger and the Verity on the **left ankle** — four prior
briefs assumed arm/wrist and never checked.

Adds `tools/pat-ppg-ppg-control.mjs`, the PPG↔PPG **positive control** the family lacked (no ECG leg,
so a negative can distinguish "physiology" from "machinery"), and `tools/pat-finger-coupler.mjs` for the
finger leg `pat-matchrate-strict.mjs` cannot run — the ring has no ACC, so that tool silently falls back
to the Verity and measures the wrist while appearing to answer the finger question.

8/14 nights couple at 7-11× a 7% floor with +23…+81 ms lags, the only anatomically possible sign —
**but the result is withdrawn as physiological** because coupling groups perfectly by the ring's axis
provenance rather than by anatomy. Also retracts this author's `residIQR`-vs-60 ms comparison (§5: that
statistic reads 31-44 ms regardless of signal), and records that 8 of 16 ring nights fail a basic
detector-plausibility gate.
