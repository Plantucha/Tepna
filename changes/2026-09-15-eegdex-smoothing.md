---
bump: patch
type: changed
brief: EEGDEX-BUILD-BRIEF.md
---

`eegdex-dsp.js`: temporal smoothing of the hypnogram — an isolated epoch flanked by two of another
stage is corrected, since sleep stages persist and a one-epoch flip at 30 s is far more likely noise
than a real bout. Opt-out via `{ smooth: false }`, which recovers the raw series exactly.

Measured on records NOT used for threshold fitting: kappa 0.3382 → 0.3622 (+0.024), with Wake
37.2→39.1 %, Light 76.0→78.8 %, Deep 78.5→79.2 %.

⚠️ `ecgdex-dsp.js` warns that an unconditional despiker "is not a denoiser, it is an eraser" — it
measured two valid REM epochs deleted, reporting REM = 0 min. Its remedy (exempt minority stages) does
NOT transfer, because it runs a FIVE-MINUTE grid where one epoch is a legitimate bout; at 30 s a
singleton is genuinely noise. That inversion is an argument, so the effect on REM was measured, not
assumed: REM recall 27.0 % → 26.8 %, preserved.
