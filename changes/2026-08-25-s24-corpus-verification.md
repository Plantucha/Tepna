---
bump: patch
type: changed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Run §24's offline half against the real 42-session O2Ring corpus (§12): session identity 42/42 unique,
zero duplicate stamps, format_a 42/42, declared_size == bytes 42/42, and the Format A sample
arithmetic exact on every file. The finalisation predicate 48 12 5a da is present in 42/42 at a FIXED
byte offset 4, so the trailer check should read trailer[4:8] rather than scan. Three sessions sit at
the 108058 B 10 h hard cap. §12a consolidates the remaining live-ring checklist.
