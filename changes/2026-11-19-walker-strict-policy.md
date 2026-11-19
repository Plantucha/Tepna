---
bump: patch
type: fixed
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---

The PR walker now reads the `protect-main` ruleset's strict flag. It updates a held PR that is BEHIND main only while the ruleset is strict, and the ruleset stopped being strict at the Mergify cutover. Its fallback list of required contexts now names `local-steps`. The `land-through-the-queue` and `residue-row` skills now describe Mergify instead of Kodiak.
