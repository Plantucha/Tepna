---
bump: patch
type: fixed
brief: GENERATED-OUT-OF-PRS-2026-10-20-BRIEF.md
---

The PR walker now requeues a PR that Mergify dequeued. Mergify keeps a PR out of its queue after a batch failure, even after the PR's own checks turn green. The walker reads the title of the `Mergify Merge Queue` check run on each non-draft head. A green PR whose title starts with `Dequeued` or `Checks aborted` gets one `@mergifyio queue` comment per head SHA. A second dequeue of the same head is an alert for a coder.
