---
bump: patch
type: fixed
brief: PAT-FORENSICS-AXIS-LEG-ASYMMETRY-2026-08-28-BRIEF.md
---
Corrected the attribution in the PAT axis-leg finding, and pulled §17's provenance labelling
forward to do it. `hostAxis.independent` is false on 8/8 fragments (spreadMs 0.98-1.00 ms) and
ppm is ~0, so the host correction can explain <1 ms of a 37-62 ms observed error: what
`idx/fs` discards is the device's own MEASURED per-sample timestamp column, not a host
correction. Confirms `raw-corpus-is-all-phone-captured` (scope not narrower) and refutes the
feared second bug (correctionAt is not shaping a drawn column). `pat-axis-leg-audit.mjs` now
prints the provenance fields beside the error so `ok` and `independent` cannot be conflated.
