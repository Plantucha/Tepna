---
bump: patch
type: fixed
brief: O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md
---

`tools/buzz-fiducial-correlate.mjs` refuses a daemon capture instead of reporting its uninformative null: the ring's motion byte is a buzz detector in the PROBE's at-rest capture (peak ~22), not in the daemon's `PPG2W` stream (6 of 39 commanded fires visible at amplitude 1-9, the other 33 at exactly 0). The header's premise is scoped to the probe capture and the open question — whether the 125 Hz pleth path carries the buzz on a worn finger — is named rather than assumed away.
