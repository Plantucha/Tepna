---
bump: patch
type: fixed
brief: SAMPLE-VALIDITY-ENVELOPE-2026-09-17-BRIEF.md
---

Eight PAT tools hand the box validity sidecar to their sample parsers through one shared reader. The reader names which of four things happened per stream, and each tool prints that tally beside its own numbers.
