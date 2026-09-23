---
bump: minor
type: added
brief: PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md
---

`tools/pat-window-oracle.mjs` accepts a flat captures root as SESSIONS — one unit per loose `_ECG.txt`, keyed on that recording's own full `YYYYMMDD_HHMMSS` token and paired by `pickPair`'s measured temporal overlap — and refuses to call one a night. Decided by census, not argument: the filename stamp is faithful on the phone tree (max 2 s from the first data row over 50 files) but no date-derived key is a night key there (a raw date fuses two different nights twice; a noon-shift fixes those and fuses six evening recordings with daytime ones). The MIXED layout still refuses.
