---
bump: minor
type: added
brief: MUTATION-FLEET-EXPANSION-2026-08-25-BRIEF.md
---

Phase 1 of the fleet expansion: add clock.js and manifest-gate.js to DEFAULT_FLEET. Both were verified
to mutate EFFECTIVELY in the crawl realm before being added — clock.js despite also being in SPINE
(the target loads after the spine and overwrites it, measured through parseTimestamp), and
manifest-gate.js despite the deliberate NUL that makes it read as binary to file/grep.
