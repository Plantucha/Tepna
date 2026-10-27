# Unit `citeclass` — every non-anchored citation class names its rows

**Unit.** `tools/residue-cite-drift.mjs` counted `unanchored` as an integer and gave `beyond-eof`
no field at all, so the two verdicts a reader must act on were the two the report could not locate.
Row `2026-10-26-the-unanchored-class-is-counted-and-never-named`.

**Branch + worktree.** `claude/citeclass-osp` at `c4cd45f5d` in `wt-citeclass-osp`, base `716cb33cb`.

**Exact stopping point.** One commit carries the code, the selftest and the changeset. The selftest reads
`all 19 selftests passed`; `npm run typecheck` exits 0 and Biome is clean on the one changed file.
The full `npm run check` runs detached to `scratchpad/citeclass/check.log` with an `EXIT=` sentinel.
No PR, no row closure: #3955 held the one slot per bird when this unit finished.

**Next step.** Read `EXIT=` off that log. Once #3955 merges, run `node tools/rebase-safe.mjs`, verify
survival with `git show HEAD:tools/residue-cite-drift.mjs | grep -c beyondEof`, push, open the PR,
then move that row's state cell to `fixed #NNNN` with the number read back from `gh pr view`, and
re-run the ledger steps the edit touches.

**Open questions.** None for this unit.

**Blockers.** The one-PR cap. Nothing else: the tool is advisory, carries its own plants, and reaches
all five verdicts in one selftest run.

**Doc-search query.** `node tools/doc-search.mjs --read "residue citation drift unanchored class"`.

## Measured beside the remedy, not yet logged as rows

- `--strict` exits 1 on `moved` alone, so a `beyond-eof` and a `missing-file` both pass strict.
- One row cites `CLAUDE.md:636` twice, so that pointer prints twice. The row's own text carries the
  duplicate; the reader counts 3 beyond-eof citations over 2 distinct pointers.
- WITHDRAWN 2026-10-26, re-measured at the ref: there is no `tools/residue-citations-baseline.json`
  in the tree, no tracked JSON anywhere carries a `sites` key, and `tools/residue-cite-drift.mjs`
  reads only the residue ledger. The bullet named a file that does not exist, so no row may be
  written from it.
- Both surviving bullets stand re-measured at the ref on 2026-10-26. The strict exit sits at
  `tools/residue-cite-drift.mjs:308` and tests `r.moved.length` alone. Row
  `2026-09-05-sync-main-skips-while-root-dirty` carries `CLAUDE.md:636` twice in one cell.
