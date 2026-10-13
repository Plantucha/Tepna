---
bump: patch
type: fixed
brief: EXPORT-SCRUB-ALLOWLIST-2026-10-07-BRIEF.md
---

The headless fold loads `export-schema.js` before `dex-export.js`. Since #3543 the scrub refuses without the allow-list. The fold timer's first run on that code threw on every ECGDex, PpgDex and OxyDex export. The trio verdict still read PASS, because its criterion is overlap hours. The closure test now pins the pair and the nine-module list.
