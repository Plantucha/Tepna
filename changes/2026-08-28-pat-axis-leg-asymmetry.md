---
bump: patch
type: fixed
brief: PAT-FORENSICS-AXIS-LEG-ASYMMETRY-2026-08-28-BRIEF.md
---
PAT forensics phase (a): traced the ECG and PPG timing legs end to end and found they ride
different axes. Both fiducials are sub-sample, but `ecgdex-dsp.js tMsAt(i)` converts index→time
arithmetically (fractional-safe, host correction applied) while `pat-feasibility-worker.js
ppgFootTimes` uses `rel[idx]` — an array subscript on a fractional foot index, `undefined` every
time, silently falling back to `idx/fs`. Measured 0 of 8948 feet across 8 real fragments took the
disciplined branch. New reproducible tool `tools/pat-axis-leg-audit.mjs` (--selftest 7/7 with a
positive control). No production detector was changed: this is diagnosis, per the charter.
