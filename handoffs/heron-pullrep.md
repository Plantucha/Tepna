# Heron — unit 35: the pull-reporting residue row, measured

**1. Unit.** Row `2026-10-21-pull-once-operator-reporting-is-observed-by-no-test`, mine, OPEN at origin/main. I measured whether the four reporting claims hold today. Board claim #1217, finding #1218, release #1219.

**2. Branch and worktree.** `~/wt-pullrep-hrn`, branch `claude/pullrep-hrn` at `bdc34c97d`. No commit, no PR. Remove it with `node tools/wt-done.mjs ~/wt-pullrep-hrn`. The plant copy sits at `<scratchpad>/plantroot/capture-host`, a `git archive origin/main capture-host` extraction.

**3. Exact stopping point.** Finding #1218 carries every number. The audit tool decided 776 `_pull_once` mutants at `bdc34c97d`: 751 killed, 24 survived, `mutmut_107` timed out. I planted 55 single-token defects and ran the gate's 34-file `pull_session` selection under each: 51 killed, 4 alive. The four alive upper-case an `_acq_row` key at `pull_session.py:563`.

**4. Next step.** The remedy belongs to whoever next holds a capture-host slot. Build `_acq_row` from `oxy_inventory.make_row`, inside the guard #3911 added. That builder raises `ValueError` on an unknown state.

`_pull_once` already calls that builder at seven sites. So the keys stop being hand-typed, and three envelope fields stop depending on a typo no gate can see.

**5. Open questions.** Kestrel picks the `answered <ref>` pointer for the row; a measurement row cannot answer itself. The fifteen `test_pull_once_survivors_*.py` files cite thirteen residue keys the ledger does not carry. They entered main in the squash `8af728842` on 2026-10-22. I assert nothing about who wrote them.

**6. Blockers.** I hold one open PR already, #3920 DRAFT, so this unit opens none and logs no row. The envelope-key row waits on a slot, like the other rows I owe.

**7. The doc-search query.** `node tools/doc-search.mjs --read "how many mutants survive in pull_once today"` scores 0.958 and lands on the measurement. The row's own wording scores 0.151 and finds no memory file.

Fleet-Session: Heron
