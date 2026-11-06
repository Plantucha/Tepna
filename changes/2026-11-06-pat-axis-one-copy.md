---
bump: patch
type: changed
brief: none
---

Single-source the PAT ECG axis arithmetic as `rPeakTimesOnAxis`. `pat-hrv-windows.mjs` and `pat-window-scaling.mjs` drop their private `t0 + i/fs` copies and take `--ecg-axis`. Both tools refuse an unknown axis name at the front door. The default stays `linear`, so no published number moves.
