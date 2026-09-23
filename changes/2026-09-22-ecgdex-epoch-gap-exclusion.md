---
bump: patch
type: fixed
brief: none
---

ECGDex's 5-min epoch engine, representative segment and Poincaré now exclude gap-straddling intervals like the whole-record statistics already did, refuse an epoch containing a clock seam (`epochsRefused`, reason `clock-seam` / `too-few-beats`), and the HRV readiness score refuses rMSSD outside 0–250 ms instead of reading 10,608 ms as Primed.
