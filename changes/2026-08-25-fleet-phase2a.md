---
bump: minor
type: added
brief: MUTATION-FLEET-EXPANSION-2026-08-25-BRIEF.md
---

Phase 2a: add the priority pair to DEFAULT_FLEET — cpapdex-edf.js (the binary EDF parser) and the five
*-cross.js crossnight stats. §2a's survey measured all six as loading on SPINE alone with their own
handle and no typeof guards, so no co-load recipes are needed. Measured load 826 mutants against
Phase 1's 259; the fleet goes 11 to 17 files.
