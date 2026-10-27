# Unit 79 — the runtime floors get a reader

**Unit.** Close residue row `2026-10-26-four-runtime-floors-have-no-reader-against-the-interpreter`: the
floors leg of `capture-host/check.sh` surveyed `requirements-dev.txt` alone, so the four floors the
capture daemon itself declares reached no comparison against the gate's interpreter.

**Branch and worktree.** `claude/runfloors-hrn` @ `bf01b20e5` in `~/wt-runfloors-hrn`, base
`0eaf42d52`. PR **#3975**, DRAFT. Two commits: `e7bdfe0ee` carries the module, the tests, the leg and
the changeset; `bf01b20e5` carries the row's state cell and the closing claim.

**Exact stopping point.** The push is complete and the PR body now holds the
`Closes residue 2026-10-26-four-runtime-floors-have-no-reader-against-the-interpreter` line.
`npm run check` runs detached over the final state, writing
`/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/check79.log` with an
`EXIT=` sentinel. Before the launch: 36 of 36 devfloors tests pass, `devfloors.py` reads 100 percent of
its 119 statements and 42 branches, and the whole `capture-host/check.sh` exited 0 with verdict PASS and
`advisory-state: mypy=AT_BASELINE devfloors=BELOW_FLOOR`. The row gates read `87 close claim(s), every
row closed` after the commit.

**Next step.** Read the sentinel in `check79.log`, then post the undraft ask to board thread 8. I never
undraft my own PR.

**Open questions.** The leg's own first run reports `cryptography 50.0.0 < 50.0.1` on this interpreter,
which is a real shortfall in the runtime half and not a defect in the reader. That reading is advisory
today. Whether the owner wants the runtime half to gate, rather than report, is his call, and row
`2026-10-18-the-cryptography-floor-is-met-by-neither-venv` already holds the drift itself.

**Blockers.** Nothing blocks this PR. The gate needs roughly twenty five minutes, and a death with no exit
code is the harness watchdog rather than my diff.

**The doc-search query.** `compare a declared dependency floor against the interpreter that runs the
capture daemon` scores 0.928 and returns `capture-host/devfloors.py`, board #1183,
`memory/a-dependency-bots-floor-is-not-a-judgement.md` and the leg at `capture-host/check.sh:370-389`.

## 2026-10-26 14:15Z — the CI mutation gate red, and its remedy

**Unit.** Close the mutation gate's red on #3975.

**Branch plus worktree.** `claude/runfloors-hrn` at `e8831690b` in `~/wt-runfloors-hrn`.

**Exact stopping point.** `mutation (diff-scoped)` red on `bf01b20e5` with `survived: 2` over
`generated: 101`. Both survivors sit in `capture-host/devfloors.py main`, at line 210
(`rows += file_rows`) and line 211 (`unreadable += file_unreadable`). The per-file render reads
`file_rows` from the survey, so the token line and the note were the only readers of either
accumulator, and no leg read a sum.

Two legs in `capture-host/tests/test_devfloors.py` now read them,
and each plant reds alone against the shipped file. The gate here reads `PASS`, `killed: 98`,
`survived: 0`; `capture-host/check.sh` exits 0 at 100 per cent coverage. Board finding #1503.

**Next step.** Read the CI buckets on `e8831690b` once the 18 pending contexts settle, then ask Kestrel
again for the undraft if every required context reads green.

**Open questions.** None for this unit.

**Blockers.** Nothing blocks this PR.

**The doc-search query.** `a mutation survivor hides behind a per-file render that bypasses the
accumulator`.
