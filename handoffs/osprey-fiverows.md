# Osprey — fiverows (five measured residue rows, RESIDUE-only PR)

1. **Unit** — convert the citescope and hazyield measurement units' ledger debt into one
   RESIDUE-only PR: five new OPEN rows, no code.
2. **Branch + worktree** — `claude/fiverows-osp` @ `d3f38c1f0`, cut from `e0126973e`,
   in the worktree `wt-fiverows-osp` beside the primary checkout.
3. **Exact stopping point** — five rows appended to `briefs/RESIDUE.md` and committed.
   `node tools/residue-ids.mjs --check --base origin/main` reads
   `ok — 5 row(s) added, none colliding, none mutated`; the `Docs-ledger — brief lifecycle`
   group passes 102 assertions. The PR body is linted clean (ste-lint 0 findings over 9 prose
   lines) at the scratchpad path for this session, file `body-fiverows.md`.
   `npm run check` is still running detached into `check-fiverows.log` beside it.
4. **Next step** — read the `EXIT=` sentinel in that log, push with `--force-with-lease`,
   open the PR as a DRAFT with that body. Kestrel undrafts. **Done: #3936, DRAFT.**
5. **Open questions** — the three `nsrr-*` backlog keys still owe the owner a
   record-population decision (board #1254, no ack). My decision #1310 has no ack either.
6. **Blockers** — the one-PR cap is free only while #3935 stays merged and no other
   Osprey PR is open. A second session appending to the ledger before I push makes this a
   rebase, not a conflict-free push: re-run `residue-ids --check` after any rebase.
7. **Doc-search query** — `node tools/doc-search.mjs --read "a probe refuses a tool whose import closure can write or exec"`
   finds the hazard instrument; `"census of residue key citations across the committed tree, counts by scope"`
   finds the citation census.

## The five rows, all logged 2026-10-26, all measured at `e0126973e`

| key | what it says |
|---|---|
| `2026-10-26-a-code-pointer-names-a-row-one-day-off` | a code comment cites the flat-root slug dated the 26th; the row carries the 25th |
| `2026-10-26-five-residue-citations-name-a-defect-with-no-row` | five prose citations resolve to nothing |
| `2026-10-26-an-audit-numbers-its-work-items-in-the-ledger-key-shape` | 82 ids in a second namespace that reads identical |
| `2026-10-26-the-hazard-bar-reads-a-regex-method-as-a-process-spawn` | a word boundary sits after a dot, so `/re/.exec(s)` reads as a spawn |
| `2026-10-26-a-dynamic-require-hides-an-exec-capability-from-an-import-scan` | `createRequire(import.meta.url)` carries a real exec capability past an import scan |

## Carried forward

A source cell must be backticked in all three legal forms. `residue-ids --check` exits 0 over an
unbackticked cell and `docs-ledger` check8b convicts, so the 4-second pre-check is
`node tests/run-tests.mjs --group="Docs-ledger — brief lifecycle"` before any ledger PR.
