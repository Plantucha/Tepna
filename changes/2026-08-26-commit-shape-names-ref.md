<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
brief: AGENT-NEUTRAL-GUARDS-2026-08-15-BRIEF.md
---
commit-shape's FLAGGED line now names the ref(s) containing the flagged commit. The scan is
`--all`, so one session's bad branch reds EVERY session's CI — and it presents as "your PR failed
static" with the culprit in nobody's diff (measured 2026-08-26: one flagged commit on a doc branch
redded two unrelated PRs, and each owner's first instinct was to hunt their own changes). One
printed ref name converts the whole misdiagnosis into routing: delete the named branch, not your
diff. A flagged commit reachable from no live ref prints "reflog only".
