<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [suite]
brief: none
---

Two gaps found in an end-of-day audit, both in the safety net rather than in the code it guards.

**1 · CLAUDE.md §👥.2's own rescue recipe was blocked by the guard that enforces §👥.2.** The
documented way to preserve another session's uncommitted work is a **temp-index snapshot** — set
`GIT_INDEX_FILE` to a throwaway path, stage everything into *that*, and write a tree. It touches
**no working-tree file and not the repo's index**. `guard-shared-tree.sh` denied it on the command
text regardless, so *the procedure for rescuing work was itself unexecutable*, and the documented
escape hatch is for "when the tree is genuinely yours alone" — precisely when no rescue is needed.

Measured 2026-08-16: a peer session could snapshot one file by explicit path and **could not snapshot
the 188-file shared tree at all**. That mattered the same day — a rescue of that tree turned out to
hold the **only copy** of a real `land-pr` fix, better-reasoned than the reconstruction that would
have replaced it.

The exemption is deliberately narrow: it requires `GIT_INDEX_FILE` to name something that is **not**
the repo's own index, so pointing the recipe's shape at the real index stays denied — that is ordinary
blanket staging wearing the recipe's clothes. Committing with the all-tracked flag is not exempted at
all, however the index is spelled.

⚠️ **The test harness needed a new assertion kind, and the reason is the point.** Its regression
check — fail any case this version ALLOWS that main DENIED — is exactly right by default, and a
deliberate relaxation trips it. Rather than exempt these cases, `chk_relax` **inverts** it: a
relaxation must be `allow` here **and** `DENY` on main. So it fails both if the fix is reverted *and*
if it was never needed — a "relaxation" main already allowed proves nothing and would otherwise pass
silently. Verified no cases were lost: main's harness executes 133, this one 139.

**2 · `CLAUDE.md` §👥.5 did not say ARMED IS NOT LANDING**, which is what cost the day. `strict: true`
requires an up-to-date branch and **auto-merge never updates one**, so arming auto-merge and leaving
it is a deadlock rather than a wait. 14 PRs sat green, armed and permanently unmergeable while four
sessions read the queue as healthy — the only symptom being that nothing moved, which no view reports.
Clearing `strict` did not drain it either, because auto-merge does not re-evaluate on a ruleset change.
Both halves are now stated, alongside `queue-doctor` and the *availability* (not cost) reason a merge
queue is impossible here.

Gate: `npm run test:hooks` EXIT=0 · `docs-ledger` 38/38.
