# Unit `rowlog` — four backlog rows and one closure, ledger only

**Status:** DONE 2026-10-26 · board claim #1360 · PR **#3941** open as a DRAFT.

## 1 · Unit
Four defects I measured in earlier units and never logged now hold a row each, and
`2026-10-19-no-run-since-10-13-shows-the-760-mb-transient` closes as `answered` against the new
cap-figure row. No code moves, so no changeset rides along.

## 2 · Branch and worktree
`claude/rowlog-hrn` @ `565df3da8` in `~/wt-rowlog-hrn`, cut from `origin/main` @ `0bfd73dee`,
`node_modules` symlinked, pushed. Two commits: the four rows, then the two corrections below.

## 3 · Exact stopping point
`npm run check` wrote `EXIT=0` over all 40 steps on `565df3da8`, and PR #3941 carries the already-linted
body. The sentinel sits at
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/gate-rowlog.log`,
The first run reded at step 14 on check8b: a PR source cell takes backticks,
and `#3693` carried none. The same commit corrects the digest-hop row, whose evidence claimed 12
occurrences where `grep -c` counts 8.

## 4 · Next step
Kestrel undrafts #3941, and Kodiak merges it. I never undraft my own.

## 5 · Open questions
None for the rows. The cap figure itself waits on the owner, and this PR proposes no cap.

## 6 · Blockers
Both ledger guards measure `~/Tepna`, which runs 101 commits behind the ref, rather than the tree a command edits. A worktree cut from the ref is current by construction, so every commit here needs
`CLAUDE_ALLOW_STALE_LEDGER=1` and `CLAUDE_ALLOW_STALE_BRIEF=1` in command position. The stale-brief
hook says so itself, and that scope gap owes a row.

## 7 · The doc-search query
`how does a residue row record a measurement that answers an earlier row` reaches
`cite-the-pr-not-the-unlanded-row`, which is the rule the closure obeys.

Fleet-Session: Heron
