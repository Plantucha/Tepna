<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [tooling]
brief: AGENT-NEUTRAL-GUARDS-2026-08-15-BRIEF.md
---
`check-stranded.mjs` answers "did the merge carry everything", and every path through it addressed the
branch by NAME. `delete_branch_on_merge` is true repo-wide, so the branch is reaped at merge — which
means the check was unavailable for exactly the merges it exists to audit. Asked about four merged PRs
it returned `PR state UNKNOWN — nothing to check` for all four, correctly on its own terms.

⚠️ **The cause is none of the three things it looks like.** Not a closed window (nothing expires), not
an unfetchable commit (the head SHA is retrievable long after the branch is gone), and not a
permissions problem. It is **a lookup keyed on a name that no longer exists** — established in the
wrong order across two sessions, each of us confidently wrong in a different direction before anyone
tested the whole path rather than the mechanism.

`--pr <N>` asks by number and resolves by OID. `gh pr view` already accepts a PR number, so the same
call that answers `state`/`mergedAt` also yields `headRefOid`: one invocation, not a new integration.
A failure to fetch that SHA is a named refusal, never a fallback to the branch name — falling back
would reinstate the exact lookup this replaces.

`prRefChoice()` is extracted pure and asserted, because the decision that matters is the CHOICE: the
ref must be the OID, never the name. A later "simplification" back to `headRefName` would restore the
bug with every test green, so the assertion is on the choice rather than the output. Selftest 24 → 31,
covering the reaped-branch case the previous tests structurally could not reach — they all addressed a
branch by name. Anti-vacuous by construction: `origin/main` exports no `prRefChoice`, and its tool
ignores `--pr` outright.

**Run as its own evidence over four merges that had been unverifiable:** #2096, #2105 and #2106 carry
every touched path. #2102 resolves 18 of 20 and declines on 2 — "main holds a THIRD version, not a
verdict; look" — which is the tool correctly refusing rather than failing: both files were edited
again by later PRs of mine (#2111, #2114). Checked by hand, both hold #2102's content on main. So all
four merges carried everything, and the two inconclusive rows are the tool's honesty, not a gap.
