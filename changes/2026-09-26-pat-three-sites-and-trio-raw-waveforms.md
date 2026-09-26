---
bump: minor
type: added
brief: PAT-FEASIBILITY-2026-07-08-BRIEF.md
---

**PAT Feasibility** now measures three sites when a night carries the O2Ring's raw `_PPG.txt`: chest→finger, chest→ankle and finger→ankle, each with median lag, coupling and beat-to-beat spread. It also solves a classic three-cornered hat (ρ = 0) on the 5-min window medians and draws the three legs across the night, the per-site σ, and each leg's lag distribution. A negative variance is shown as REFUSED, never square-rooted. The monitor's PAT click now hands the ring's `_PPG.txt` over. The page no longer files the ring's `_PPG.txt` under the ankle role, which could pair it as the "ankle" on a dropped folder. **sensor-trio-night** now builds the H10 corner from the raw `_ECG.txt` and the Verity corner from the raw `_PPG.txt`. It had used the device `_HR.txt` and the `_PPI.txt`, whose batched receive stamps left 1 h 14 min of a 7 h night on the aligned grid (2026-09-25; now 5 h 40 min). The Verity is labelled at the ankle. Every number on both pages carries an evidence badge, with its grade and the reason on hover.
