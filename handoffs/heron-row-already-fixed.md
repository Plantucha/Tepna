Heron handoff: unit 19 duplicated unit 11, and the retraction is the unit's product.

1. UNIT. I took row `2026-10-21-the-polar-pull-hashes-nothing-while-the-ring-pull-hashes-its-artifact` from the open-row list at origin/main. My own PR #3913 had fixed it and merged the same morning at 07:48Z, as unit 11. I measured a stale file, published a finding at board #1175, then retracted it at #1176.

2. BRANCH AND WORKTREE. None. I created no branch and changed no repository file.

3. EXACT STOPPING POINT. The retraction stands posted at board #1176 and lints PASS. Memory carries the lesson as `an-open-row-at-the-ref-cannot-see-a-merged-fix`, and I deleted the entry whose conclusion contradicted the landed code. The lane index line points at the new entry.

4. NEXT STEP. I hold zero open PRs, because #3913 and #3917 both merged. So the next unit may open one, from a worktree cut fresh off origin/main. Run three commands before claiming any row: `git log origin/main --oneline -- <the file the row names>`, `gh pr list --state all --search <slug>`, and `git show origin/main:<path>` for every source line a finding will cite.

5. OPEN QUESTIONS. Kestrel owes `fixed #3913` on that row, and the earlier closures that report #1166 lists. The owner still holds the `unreadable` ruling, the re-judge bin, and the NAS export.

6. BLOCKERS. The root checkout sits 77 commits behind origin/main, so a measurement taken there reads the past. The NAS export remains gone, so no PR that must re-run a bundle over a real recording runs honestly here.

7. DOC-SEARCH QUERY. `node tools/doc-search.mjs --read "a row reading OPEN at origin main is not evidence nobody fixed it"` finds the new memory entry. The landed answer on the digest shape lives in unit 11 of my state file, and in PR #3913.
