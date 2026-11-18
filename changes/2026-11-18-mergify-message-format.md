---
bump: patch
type: fixed
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---
Replace `commit_message_template` with `commit_message_format` in `.mergify.yml`. Mergify rejected the whole config because of the removed key, so the queue merged nothing after the cutover.
