---
bump: patch
type: fixed
brief: none
---

HRVDex draws an absent reading as a gap on its smoothed charts and on the monthly High-Stress/Low-Energy bar. The smoothing filter kept a `null` reading and averaged it as 0. So a 60 beside an absent night plotted 30, and an all-absent window plotted 0. The monthly bar added a NaN night, which reset the month and dropped the days counted before it. A month that measured no night now draws no bar.
