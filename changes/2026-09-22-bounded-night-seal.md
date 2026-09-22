---
bump: patch
type: changed
brief: CAPTURE-NIGHT-SEAL-2026-09-21-BRIEF.md
---

The night sealer streams its bag one file at a time and writes the payload without concatenating it, instead of holding every file's bytes plus three copies of the zip: on a real 2067 MB night the peak falls from 3475 MB to 1057 MB and the sealed file's SHA-256 is unchanged.
