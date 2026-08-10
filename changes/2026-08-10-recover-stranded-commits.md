<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Recover work stranded by a squash merge — and name the failure mode, because it happened twice in one session and neither time was visible.

`tools/mutate-equivalence.json` read 37 pulsedex entries on main against the 42 that had been emitted
and committed. The five missing ones — plus the battery changes that produced them — were in a commit
pushed to a branch AFTER its PR had already squash-merged.

THE FAILURE MODE, stated once so it is not rediscovered a third time:

  A squash merge takes the branch AS IT WAS AT MERGE TIME. A commit pushed to that same branch
  afterwards is simply not in the merge, and NOTHING SAYS SO. `git log` on the branch still shows it,
  sitting above the merge commit. `git status` is clean. The PR reads MERGED. The push succeeded. The
  only signal is that main does not contain the content — and nobody looks for content they believe
  they landed.

Two instances this session, both after `land-pr` merged a PR while more work was still arriving on
the same branch:

  · the zero-kill census (re-added in #1133, with the same note)
  · the fragmentation battery widening + its 5 classifications (recovered here)

The tell that found both was the same: a NUMBER that should have moved and had not — 241 on main
against 246 emitted. Counting the ledger after every merge is cheap and is now the habit; the
alternative is discovering it when someone re-probes and the entries are silently absent.

Recovered content: `altTail()` (the mirror shape that reaches `fragmentation`'s SECOND
`if (altRun >= 4)`, the one after the loop rather than inside it), the `blocker`-column parseRRInput
cases, and the 5 resulting entries. Ledger 241 → 246.

⚠️ Practical rule: after `land-pr` reports merged, stop pushing to that branch. Open a new one.
