---
bump: minor
type: added
brief: MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md
---

OxyDex emits per-instance measurement blocks (meanSpo2, t90, odi4, hypoxicBurden) with window, channel, code identity and input lineage — schema 2.1; bundles carry their own manifestHash/computeHash on the html tag; the backward walk-through is checkable via tools/measurement-walk.mjs.
