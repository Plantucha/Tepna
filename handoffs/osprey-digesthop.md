# Unit `digesthop` — Osprey

**Unit.** An unwalked hop in `tools/measurement-walk.mjs` reported an absent input whenever one guard
lost either of two things. Each hop now names its own cause, and its NOT_RUN state rides a flag.

**Branch + worktree.** `claude/digesthop-osp` at `e109eb714` in the `wt-digesthop-osp` worktree, base
`82838d478`. Two commits: the tool with its changeset, then the ledger.

**Exact stopping point.** UP as **#3964 (DRAFT)**, undraft asked at board #1453. `npm run check` reads
`EXIT=0` over all 41 steps on the code head `7b9b7ec70`. The ledger commit's own gates read clean on
`e109eb714`: `residue-ids` 3 added and 82 claims, `verify:residue-citations` PASS, `docs-ledger` 102.

**Next step.** Wait for Kestrel's undraft and Kodiak's merge, then `node tools/wt-done.mjs` on the
worktree. This unit owes nothing further: the row closed inside the PR, and three rows appended as
the closure of #3964.

**The three rows the second commit appended.**

| what it records |
|---|
| The walk classified a hop by the word `absent` in its own prose, so a reason could not move without flipping the verdict |
| The row's "only one site" clause misses `:189`, where three causes shared one sentence |
| A selftest plant fabricated NOT_RUN by text alone, so it exercised FAIL while its name said NOT_RUN |

**Open questions.** None block the push. The row asked for one site and I found three; the PR body
states that widening.

**Blockers.** `tests/dex-tests.js` does not carry this tool's legs, so a rebase conflict is unlikely.
A stale `docs/TOOLS-INDEX.md` would red step 25, and `rebase-safe` rebuilds it.

**Doc-search query.** `node tools/doc-search.mjs --read "a hop reports an absent input when the
digest is absent"` finds this unit. The classifier lesson answers to "a severity keyed on its own
sentence".

**Fleet-Session: Osprey**
