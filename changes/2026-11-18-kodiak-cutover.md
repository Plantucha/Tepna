---
bump: patch
type: changed
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---
Remove `.kodiak.toml` from main, step 1 of the Mergify cutover. From the next walker pass, the walker reads `queueBot: 'none'` and plans no merge, so Kodiak and Mergify never race each other on one queue.
