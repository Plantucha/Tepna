---
bump: patch
type: fixed
brief: none
---

**The PAT tool paired sessions by file size and reported NO OVERLAP for a night that overlapped.**
`resolvePair` took the largest file per role — a phone-app assumption, one session per device per
night. The capture host writes one file per BLE session: the 2026-09-19 box night holds two H10 ECG
sessions and five Verity PPG sessions, and "largest" paired the 67-minute ECG (19:20–20:28) with the
seven-hour PPG that began at 22:41, two hours after the ECG ended. The Verity session that ran
19:16–20:27, overlapping the ECG almost exactly, was never examined. Run headlessly as the Ledger's
click: **NO OVERLAP, 0 coupled beats.**

The ECG stays the anchor (largest — most R-peaks); the PPG and both ACCs are now the sessions whose
start is nearest to it, the rule `sensor-trio-power-analysis.js` already uses. Same night, same
files: **coupled, 90 % match, 3,771 beats, median lag 449 ms, IQR 12 ms, 41 ppm linear drift,
PROMISING on raw drift.** Nearest-start is a heuristic, not an overlap computation, and the comment
says so; a pair that still does not overlap is still reported as such.

The Ledger's PAT click also now sends both devices' ACC (they sit under MotionDex in the index, not
PPGDex), so the tool's ACC-corrected leg runs. On this window it **refuses — WINDOW-CENSORED**, the
correction pushing most lags outside the physiological window (drift range 162 → 341 ms); the two
legs differ and the tool flags that. Reported, not resolved: which leg to trust is
`PAT-NO-VALID-ANCHOR`'s open question.

`PAT Feasibility.html` loads its script unbundled; no rebuild, no `docs/` twin.

Fleet-Session: Magpie
