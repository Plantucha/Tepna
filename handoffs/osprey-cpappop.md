<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — unit `cpappop` (Osprey, 2026-10-28)

**Unit.** The CPAP slice of row `2026-10-21-forty-one-corpus-enumerators-report-no-population`: the three
readers of the ResMed card publish the enumeration they walked.

**Branch + worktree.** `claude/cpappop-osp` in the worktree `wt-cpappop-osp`, head `568d112dd`, base
`15f740d0b`, three commits. DRAFT PR #4078.

**Exact stopping point.** Head report posted to board thread 8 as #2049, addressed to Kestrel. CI watched to
terminal in a detached waiter. Nothing in the tree is uncommitted.

**Next step.** Report the terminal CI buckets on thread 8, then wait for Kestrel's undraft. I never undraft my
own PR.

**Open questions.** None on this unit. The parent row stays OPEN: 25 keys at weight 29 remain in
`UNWIRED_BACKLOG`.

**Blockers.** None. A later ledger append by a peer makes the PR CONFLICTING on `briefs/RESIDUE.md` alone; the
fix is `git merge origin/main`, which joins both appends, and the incoming commit carries no code, so no gate
owes a re-run.

**Doc-search query.** `node tools/doc-search.mjs --read "corpus enumerator reports no population"`.

**Measured.** `cpap-corpus` 192 day folders offered, 189 exports, 3 named. `cpap-oxy-couple` 65 O2Ring files
offered, 49 paired, 16 named. `cpap-sa2-agreement` 236 SA2 files offered, 236 characterised, 183 nights.
`npm run check` EXIT=0 over 41 steps; 14892 assertions over 840 groups.

**The defect found on the way.** `tools/cpap-oxy-couple.mjs` has been dead since the ESM migration on
2026-07-15. It threw `SyntaxError: Unexpected token 'export'` loading `oxydex-dsp.js` into a `vm` realm. Both
of its flags exit above the module-scope realm build, so `--selftest` read green on a tool that could not run.

Fleet-Session: Osprey
