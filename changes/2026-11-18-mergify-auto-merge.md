---
bump: patch
type: fixed
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---
The Mergify queue now starts by itself. Mergify ignored the `pull_request_rules` queue action and waited for a command on every PR, so `.mergify.yml` now sets `merge_protections_settings.auto_merge_conditions: true`.
