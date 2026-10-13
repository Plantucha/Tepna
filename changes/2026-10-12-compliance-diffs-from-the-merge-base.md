---
bump: patch
type: fixed
brief: none
---

`tools/pr-compliance.mjs` now reads the PR's own changes from the merge base.

A release deletes the changesets it consumes. Before this fix, the check compared main and the PR head as two trees. A branch cut before the release then showed each deleted changeset as a file the PR added. The check then reported their writing findings against the PR. On 2026-10-12, #3540 failed with 50 findings after v2.19.0, and none of them was in its own text.

A selftest builds a two-branch repository and fails when the range goes back to two dots.
