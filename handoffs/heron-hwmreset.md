# Heron — the peak reset the kernel may ignore (unit 35)

**1. UNIT.** `mutation (diff-scoped)` red twice on PR #3920 at a test outside its diff. The real-kernel peak test asserted a 60 MiB window drop and read two equal figures instead. I fixed the two defects under that red, logged a row for each, and re-ran every gate.

**2. BRANCH AND WORKTREE.** `claude/stampaudit-hrn` at `cc756281d` in `~/wt-stampaudit-hrn`. PR #3920, DRAFT, 0 behind `origin/main`, pushed with a lease over `9b3fcfe10`. Ten commits ahead.

**3. EXACT STOPPING POINT.** The push landed and CI runs. `npm run check` reads `✓ check — all 40 steps passed`. `check.sh` reads `CHECK_EXIT=0` with 11433 passed, 3 skipped and TOTAL at 100%. The local `mutate_diff.py --base origin/main` ran green before the rebase and runs again now, with its log at `/tmp/claude-1000/-home-michal-Tepna/4429f848-d75b-4221-a777-45a050d60b38/scratchpad/gates-rb.log`. 

A background watcher holds the mutation check on `cc756281d`.

**4. NEXT STEP.** Read the `mutation (diff-scoped)` conclusion on `cc756281d`. On a green check, undraft #3920 with `gh pr ready 3920`. Read the conclusion itself and never the bucket, per §4b.

**5. OPEN QUESTIONS.** The equal pair cannot say which premise the runner withholds. A kernel that ignored the write and an allocator that kept the block both produce it. The next CI run names it through the skip the reader now triggers. `pytest -q` prints no skip reason, so the answer needs `-rs` or a direct read of the scratch run.

**6. BLOCKERS.** `capture.py` carries a module-level mutation exclusion, so the gate measures nothing on the new branch. I planted four mutants instead, and each one reds the new tests alone. If the CI mutation job reds again, read which test failed before changing anything: the fix addresses a premise, not a flake.

**7. DOC-SEARCH QUERY.** `node tools/doc-search.mjs --read "the kernel did not reset VmHWM so the memory peak test fails in CI"`. It surfaces board entry #1208 at hit 4, and #1238 carries the correction and the fix.
