<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [ci, tests]
brief: GATE-INTEGRITY-AND-DEVLOOP-2026-07-12-BRIEF.md
---
Stop the gate shrinking in silence, parallelize the local suite, and make the two ledger files union-mergeable.

**§G1 — a ⊘ SKIP is neither pass nor fail, so the gate could shrink without reddening.** The raw recordings
are gitignored, so a fresh clone (CI, and the worktree CLAUDE.md §👥 mandates) degrades every leg that needs
one to a skip — **all eight real-recording equivalence legs, the entire GATE-C surface, have never run on the
merge path** (CI: 2093 assertions / 11 skipped, GATE B 10 of 23; local: 2113 / 2, GATE B 23/23). And nothing
pinned the skip count, so a *new* skip was invisible. Now every skip must be **declared** in
`tests/expected-skips.json`; an undeclared one is a **failure**, so shrinking the gate is a deliberate,
reviewable act. Fail-closed (a lost allow-list reds everything). The shared checker `auditSkips()` is
shard-safe. A run that skipped corpus legs now says so out loud (`▸ COVERAGE — N leg(s) NOT verified`), and
`DEX_UPLOADS=<path>` points the runner at a real corpus — which is also how CI's exact coverage becomes
reproducible locally, and how the allow-list was derived rather than guessed.

**§D1 — the local gate was single-threaded while CI was sharded**, so your laptop was slower than CI at the
same work: `npm test` **100.7 s** (one core of six) vs CI's 78 s. `--jobs=N` forks the same partition CI uses
and merges the verdicts — **100.7 s → 28.4 s (`--jobs=4`) → 24.9 s (`--jobs=auto`)**, identical verdict every
time (2113 assertions, 2 skipped, 135 groups). Correctness rides on the existing partition proof; a child
that dies without parseable JSON is a hard failure, never a silent gap. New `npm run test:par`, and
`npm run check` now uses it.

**§D2 — two generated files were a conflict engine, and a conflicted PR gets NO CI AT ALL.**
`docs-ledger-list` + `changes-list` are touched by **62 of 139 commits (45%)**, with **10 merge commits in
48 h** existing purely to re-resolve them. The conflict was structural: scalar `count` + `generated:<date>`
fields changed on *both* sides of any concurrent add, so the hunks conflicted **even when the arrays were
disjoint**. And GitHub builds `pull_request` runs against the merge commit — when it can't merge, it
dispatches **nothing**, so the PR sits at zero checks with no error. That hit **PR #43 and again #46 in one
session**. Both files are now line-oriented text with no volatile scalars + `.gitattributes merge=union`,
single-sourced through `tests/list-format.js` (dual-export, the `manifest-gate.js` precedent, so the Node and
browser lanes cannot drift). **Proved in a scratch repo:** two disjoint concurrent adds **auto-merge** in the
new format and **conflict** in the old. A bad union (duplicate/resurrected lines) is absorbed by
sort+dedupe and caught by the existing `list == fs` staleness assertion — worst case is a RED you fix with
one command, never a silent no-CI PR.

CI + tests only. No runtime file touched, no `manifestHash` moved, no fixture re-recorded.
