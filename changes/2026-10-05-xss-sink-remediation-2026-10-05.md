---
bump: patch
type: security
brief: none
---

Escape untrusted filenames, file bytes, and envelope strings at innerHTML sinks in OxyDex, PulseDex, and Integrator; delete the oxydex-fusion content-sniffed HTML bypass; route pulsedex-render to the canonical dex-escape.js; rename safeSet to setIfPresent.
