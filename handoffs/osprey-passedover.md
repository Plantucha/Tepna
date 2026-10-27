# Unit `passedover` — the corpus walk names what no rule counted

**Unit.** Close residue `2026-10-26-a-non-night-root-and-an-empty-root-publish-the-same-population`:
`tools/corpus-scope.mjs` published a record-keyed root as an emptied corpus.

**Branch and worktree.** `claude/passedover-osp` @ `16f602e85` in `wt-passedover-osp`, base
`716cb33cb` after one `rebase-safe`. PR **#3955**, DRAFT. Board claim #1417.

**Stopping point.** Three commits pushed. The first full gate read `EXIT=1` at step 15 of 41,
`test:par`, on my own literal: `capture-filename suffix parity` refuses a reader comparing against a
lowercase `_<tag>.<ext>`, and my leg typed `ucddb002_stage.txt` into a comparison. The plant's list
is now hoisted and the leg sorts it. That group reads 16 of 16, and the gate reruns detached on the
final state; its log is the unit scratchpad `check2.log`. `node tools/residue-ids.mjs --full-tree` reads `ok — 79 close claim(s), every row
closed`. The tool selftest reads all 76 pass. `npm run typecheck` and `npm run lint` are clean, over
the same 92 inherited warnings main carries.

**Next step.** Read `EXIT=` off the gate log, post the unit report, and ask Kestrel for the undraft.
I never undraft my own PR.

**The remedy.** `snapshotNights` keeps its whole listing and returns a third name list, `passedOver`,
defined as the remainder: every name `readdirSync` returned that was neither counted as a night nor
recorded as refused by the caller's own rule. The three lists partition the listing under every rule.
The walk's own directory filter sits inside the remainder, so the list names a record root of files
as well. A failed walk and a record population both return `null`. `populationVerdict` gains a third
arm in its NOT_RUN branch.

**The measurement.** Against a stripped control, the record-keyed root and the empty root publish one
byte-identical reason. With the list, they differ, while the digest `e3b0c44298fc` still cannot tell
them apart. That is why the bin holds names and not a count.

**Open questions.** Three rows of mine still want a slot and a re-measurement at the ref: the
`snapshotEntries` rule hole, the tautological denominator, and the refusal-account trade. The
year-pinned night rule inside `2026-10-26-the-corpus-night-rule-is-pinned-to-one-calendar-year`
wants an owner ruling, not an implementer, and this unit left it alone.

**Blockers.** None for the next step. A red step would most likely be the ledger, since every landing
PR appends to it; the remedy is `rebase-safe`, never a better probe.

**Doc-search query.** `a root holding no night-shaped directory publishes the same population as an
empty root`.
