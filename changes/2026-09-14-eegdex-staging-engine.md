---
bump: minor
type: added
brief: EEGDEX-BUILD-BRIEF.md
---

`eegdex-dsp.js` — EEGDex's staging engine: band powers, a 30 s hypnogram, sleep architecture.
`window.EEGDSP`.

Scope is narrower than the brief deliberately. That brief is PARKED by owner decision on the stated
precondition "no EEG corpus exists to build against", and that precondition is now only PARTLY false:
SHHS1 carries EEG on 100 % of 5136 records with expert 30 s staging, so the ENGINE has a corpus — but
there are still zero Muse files, so `parseMindMonitor`, the TP9/AF7/AF8/TP10 montage and the HSI
contact metric are NOT built and the park stands for them. The module takes samples, not a vendor
file.

Measured against expert PSG with a train/test split: **held-out kappa 0.3144** (baseline 0.1739
before fitting), Wake 24.3 % · Light 81.0 % · Deep 64.0 % · REM 31.4 %. Thresholds fitted by grid
search on the TRAIN half; the held-out half was consulted exactly once.

23 assertions on planted signals, including the control that the same spectrum with high EMG tone is
not REM.
