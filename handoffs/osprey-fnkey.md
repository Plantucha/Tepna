# Osprey · unit `fnkey` — the equivalence qualifier

**Unit.** Carry the enclosing function in a mutation equivalence entry's key, so an edit above a
recorded mutant no longer detaches its excuse. Row
`2026-10-26-a-line-keyed-equivalence-entry-that-drifts-ambiguously-cannot-be-placed`, claimed as
board #1571.

**Branch + worktree.** `claude/fnkey-osp` @ `4e48d8320` in `wt-fnkey-osp`, base `d8c5786a2`.
**PR #3991, DRAFT** — my one open PR. Undraft asked as board #1574.

**Stopping point.** The branch holds every change, and the push went through. `npm run check` reads
`✓ check — all 41 steps passed` with EXIT=0 over 14458 assertions in 830 groups. `mutate.mjs
--selftest` 179 green (20 new), `reanchor-equivalence.mjs --selftest` 47 green (18 new),
`capture-host/tests/test_equivalence_ledger.py` 11 green (3 new). `pr-compliance.mjs` passes 9 checks
against the real body; `residue-ids.mjs` reads `2 row(s) added, none colliding, none mutated`
post-commit.

**What shipped.** An entry may carry `fn`, the enclosing named function, and the matcher then reads
`(fn, op, before, after)` and ignores the line. The field is OPTIONAL, as in the Python lane.
`mutate.mjs --dry-run --json` stamps it, so no sibling tool re-derives the brace matcher.
`reanchor-equivalence.mjs --qualify` writes one only where the entry already sits at its exact
address and its identity is unique in the file; a code control snapshots every line and refuses on
any move. 261 of 434 entries qualified, 4 refused for collision in `oxydex-dsp.js`, 6 record no
`after`.

No probe was spent, and no address moved.

**Also corrected.** `planEntry` filtered on `(op, before)` while the matcher carries `after`, so
#3989 published 106 ambiguous where the matcher's own key says 37, and 33 movable where 102 move. The
anchored count holds at 266 under either key, which is the control.

**Next step.** Wait for Kestrel to undraft #3991, then merge and run `node tools/wt-done.mjs` on the
worktree. The two new rows are already in the ledger.

**Open questions.** The 29 stale entries stay untouched: deleting them makes the gate stricter on
five DSP nodes, which is the owner's call — the same call the 33 refuted entries wait on.

**Blockers.** None. The ledger had not moved on the ref since the base, so no rebase waits here yet.

**Doc-search query.** `enclosing function in a mutation equivalence key` → `tools/mutation-suite.mjs:1136`,
`tools/mutate-ledger-merge.mjs:41`, `capture-host/tests/test_mutation_diff.py:4135`.
