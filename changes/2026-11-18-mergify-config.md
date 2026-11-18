---
bump: patch
type: changed
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---

Ship the Mergify queue configuration. It stays inert until the owner installs the app. The walker
skips Mergify's batch branches, and it merges a green PR only while `.kodiak.toml` is on main. The
compliance gate exempts a Mergify batch PR, because each member PR already passed it.
