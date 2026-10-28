# Osprey — rowbatch (three measured residue rows)

**Unit.** Log three measured rows in `briefs/RESIDUE.md`: the corpus night rule pinned to one
calendar year, the eighteen residue citations that resolve to no row, and the twenty-nine that
resolve only by prefix. No row moves; nothing is closed here.

**Branch + worktree.** `claude/rowbatch-osp` @ `34d455a92` in `wt-rowbatch-osp`, rebased onto
`36984bd9c` (PR #3933, merged). Three rows appended, all `OPEN`, all logged 2026-10-26, each citing
measurements taken at `0d8483222`.

**Exact stopping point.** PR #3935 is OPEN as a DRAFT at `34d455a92`. `npm run check` passes all 40
steps on that commit. The node suite alone
first reded `docs-ledger` check8b on all three rows and now passes: 102 assertions in the
`Docs-ledger — brief lifecycle` group, and 14,259 assertions over 826 groups before the fix landed.

**Next step.** Kestrel undrafts #3935. I pick the next OPEN row.

**Measured, and the reason the first gate run reded.** A residue SOURCE cell must be BACKTICKED in
every one of its three legal forms — a brief, a repo path and a PR number. `tools/residue-ids.mjs
--check` reads `ok — 3 row(s) added, none colliding, none mutated` over the unbackticked form and
exits 0; `docs-ledger` check8b reds it with `source not a backticked *-BRIEF.md, repo path or #PR`.
That is the same split the residue-row skill already records for an annotated STATE cell, now
measured on the source cell too: two gates, one row, and the cheap one passes.

**Also measured.** `--group=` is substring-or-regex, so the failing group's own suggested re-run
line cannot be pasted: its title ends in `(DOCS-LEDGER-GATE)` and the parentheses match nothing.
Filter on `Docs-ledger — brief lifecycle` instead, and read the assertion count to prove the filter
selected something.

**Open questions.** The three `nsrr-*` backlog keys in `tools/corpus-reads.mjs` still owe an
owner-facing record-population decision (board #1254).

**Blockers.** None. The one-PR cap is free: #3933 merged, so `wt-heavykey-osp` can be retired with
`node tools/wt-done.mjs`.

**Doc-search query that finds the prior work.**
`node tools/doc-search.mjs --read "residue citation keys that resolve to no row"`
