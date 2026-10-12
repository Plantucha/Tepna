---
bump: patch
type: fixed
brief: none
---

The `oxy` cohort-worker realm lists the files that call `escapeHTML` but not `dex-escape.js`, which defines it, so the blob worker threw `ReferenceError: escapeHTML is not defined` at module evaluation and every paper-scale rerun of an OxyDex analysis page died at `worker boot failed`. Adding the one entry and rebuilding the analysis tools restores the boot.
