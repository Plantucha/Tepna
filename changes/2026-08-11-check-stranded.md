<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---
`tools/check-stranded.mjs` — did your work actually reach `main`?

A squash merge collapses a PR's diff AS OF MERGE TIME. Anything pushed to the branch afterwards stays
on the branch ref and never reaches `main`, and nothing goes red: `git log origin/main..HEAD` still
lists the commits, the branch pushes, `gh pr view` says MERGED. #1163 squash-merged carrying NINE
files while its branch was FIFTEEN commits ahead — twelve commits gone, surfaced only because an
unrelated cherry-pick reported `DU` on files just written.

BOTH OBVIOUS CHECKS FAIL, in opposite directions. `git cherry` compares PATCH-IDs, and a squash
collapses N commits into one so no patch-id survives — 100 % false positives on this repo's workflow.
Comparing the branch-head date to `mergedAt` is a proxy, and a sibling session's version compared
local EDT against UTC: a uniform 4 h offset, all six PRs "ok". The right answer from a broken
comparison, which is the variant that never gets found.

So it compares CONTENT, three ways, squash-safe and clock-free. For each path the branch touched:
`main ≡ branch` LANDED · `main ≡ base ≠ branch` STRANDED · all three differ DIVERGED. Diverged is
reported as "I cannot tell", not resolved by guessing.

The merge state is a PRECONDITION: an unmerged branch legitimately holds content main lacks, so it
reports not-applicable rather than red. A gate that fires on every healthy PR gets switched off.

KNOWN-ANSWER VALIDATED against the real failure — run on `claude/js-coverage` it exits 1 and names 17
stranded paths including `tools/extreme-mutate.mjs`, `tools/killcheck.mjs`, `tools/mutate.mjs` and the
follow-up brief. A gate whose failure has been observed, not merely written.

14 selftests, including the timezone bug pinned so it cannot return: a push 2 h after a merge must
read positive, not be absorbed by a 4 h slip.
