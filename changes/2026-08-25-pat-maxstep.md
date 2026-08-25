---
bump: patch
type: added
brief: PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md
---

Emit hostAxis's maxStepMs per pair from pat-host-offset.mjs and test the stalled-link candidate
(§3f.6). Steps are large enough to cross the ~450 ms band (5 of 22 windows, max 53 s) where drift was
not — but both ppm and maxStepMs are per-PAIR constants while the intermittency is within-night, so
neither can attribute it. A 53 s step coexists with p=0.0196 and p=1.0 on the same night.
