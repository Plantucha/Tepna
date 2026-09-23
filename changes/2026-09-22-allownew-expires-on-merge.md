---
bump: patch
type: fixed
brief: none
---

guard-shared-tree.test.sh compares against the MERGE-BASE rather than origin/main, skips the relaxation and regression checks entirely when there is no base to compare (on main, merge-base resolves to HEAD itself), and says which mode it ran in - a skipped comparison and a clean one must not read alike. And the two `allowNEW` markers from #2871 are DEMOTED to plain `allow`, because that marker is a claim about an OPEN PR: it asserts the base still denies the case, which is true while the PR is open and false forever once the relaxation IS the base. Measured: both assertions failed on main in every checkout from the moment #2871 landed, reaching every session through `npm run check` as a red unrelated to their change, and the merge-base alone does not rescue them because any branch cut after #2871 has a merge-base that already allows them. Also repairs a dangling symlink left in guard-format.test.sh by #2883: the first `ln -s` was switched to the resolved Biome path and the restore two lines later was not, so every assertion after the fail-open case failed in a fresh worktree.
