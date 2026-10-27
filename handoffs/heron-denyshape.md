# Heron — unit 86 `denyshape`, and unit 87 `readallow` behind it

**1. Unit.** The stale-brief denial now names the arm that fired, the source of its candidate set, and each path's position in the command.

**2. Branch and worktree.** `claude/denyshape-hrn` @ `b573b718d` in `~/wt-denyshape-hrn`, 0 behind. Three files, tree clean, pushed as **#3986 DRAFT**. Unit 85 merged as #3982, and `wt-done.mjs` retired its worktree.

**3. Exact stopping point.** `npm run check` in `wt-denyshape-hrn` exits 0 with `✓ check — all 41 steps passed` over 14446 assertions in 830 groups. The hook self-test reports 92 legs and no failure, and 9 of the 12 new legs red against the planted baseline hook. The changeset is `changes/2026-10-26-deny-shape-names-its-arm.md`, and `--group=release-ledger` passes it in four seconds.

**4. Next step.** Ask Kestrel for the undraft of #3986 once the rebased gate and GitHub both read green. Run `PR_BODY=… PR_BASE_SHA=… PR_HEAD_SHA=HEAD node tools/pr-compliance.mjs` before `gh pr create`. The body needs the Rule 0 line, the `Fleet-Session:` trailer and the changeset. It must also say that the owner still holds the narrowing itself.

**5. Open questions.** Kestrel holds the undraft of #3982 as board #1550. Row `2026-10-26-a-guarded-path-written-as-data-reads-as-a-write-of-that-path` stays OPEN, because the owner holds the narrowing and this unit only improves what the denial says. Ruling 1 on board #1549 asks me to invert the verb list, and I claimed row `2026-10-26-four-write-forms-reach-a-guarded-doc-under-both-stale-guards` as #1551 with the design in #1552.

**6. Blockers.** One slot per bird blocks both PRs behind #3982. Unit 87 edits the same two guards as unit 86, so building it before unit 86 lands buys a conflict in my own files.

The parity self-test pins one span byte-identical across both guards. It runs from `cmd_nohere=` to the closing `fi`. A comment or an accumulator inside it reds the parity leg, and every verdict stays correct.

**7. The doc-search query.** `node tools/doc-search.mjs --read "invert the write verb list to a read allowlist that fails closed"` → board #1437, `capture-host/tests/test_vigil_sh.py:248`, `capture-host/nights_index.py:97`. For this unit: `node tools/doc-search.mjs --read "the denial names the arm that fired and where the candidate path came from"`.
