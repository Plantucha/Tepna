# Heron — mutation stager reads the traced manifest (unit 35)

**1. UNIT.** Carry the mutation-stager fix inside #3920, log its row there, and undraft when `mutation (diff-scoped)` reads green. Routed by Kestrel at board #1220 over my findings #1208 and #1209.

**2. BRANCH AND WORKTREE.** `claude/stampaudit-hrn` at `9b3fcfe10` in `~/wt-stampaudit-hrn`. PR #3920, DRAFT, MERGEABLE, rebased onto `origin/main` and 0 behind. The stack is ten commits. They hold the witness fix, its row, the stager union, the seven scratch skips, the five kills with two ledger entries, and the corrected row.

**3. EXACT STOPPING POINT.** I pushed `9b3fcfe10` with a lease and replaced the PR body from `body-new.md`, ste-lint PASS over 37 prose lines. I armed two monitors. `bdkdg03kg` watches the local gate log, and `bzbt0ospg` watches #3920's `mutation (diff-scoped)` context. 

The local `capture-host/check.sh` leg REFUSED with `CHECK_EXIT=2`, because my shell interpreter is miniconda and carries neither ruff nor pytest-cov. `mutate_diff.py` runs on in the same detached shell, and it spawns mutmut under the venv itself, so that leg is faithful.

**4. NEXT STEP.** Re-run the refused leg once `MUT_EXIT=` lands in `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/gate-rebased.log`. The command is `cd ~/wt-stampaudit-hrn/capture-host && PYTHON=~/Tepna/capture-host/.venv/bin/python ./check.sh`, detached with an `EXIT=` sentinel. Then undraft #3920 only on a green CI `mutation (diff-scoped)`, reading the conclusion rather than the bucket.

**5. OPEN QUESTIONS.** Kestrel owes the closures listed in `heron-state-2026-10-19-drain.md`. The owner holds `claude/ringclk-hrn` and `claude/veritysdk-hrn`, the second NOT FOR MERGE until the one-night 176 Hz trial. The arming of `mypy (advisory ratchet)` and the decision on `secret-scan` in ruleset 18794443 are still open from finding #1215.

**6. BLOCKERS.** A red CI `mutation (diff-scoped)` keeps the PR DRAFT, and the WIP cap holds me to this one PR. PR #3919 landed mid-unit and conflicted on the ratchet comment in `test_equivalence_ledger.py`. Any further rebase meets that file again, and it must keep both comment blocks. The repo gate's step 14 `env.equiv.ppgdex` red is main's and this diff cannot reach it.

**7. THE DOC-SEARCH QUERY.** `node tools/doc-search.mjs --read "the mutation stager drops the dotted read the manifest declares"` finds this unit. For the kill lessons use `an input refused by two clauses distinguishes neither`, which reaches `a-fixture-can-hit-the-line-and-still-not-see-the-mutant`.
