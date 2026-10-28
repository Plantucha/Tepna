# Osprey — unit `cliguard`

**Status:** AWAITING UNDRAFT — PR #4052, draft, head `71b5793b3` · 2026-10-28

1. **Unit.** Row `2026-10-28-mutate-mjs-runs-its-cli-on-import-so-no-sibling-can-read-its-matcher`:
   give `tools/mutate.mjs` a CLI-entry guard so a sibling can import its matcher.
2. **Branch + worktree.** `claude/cliguard-osp` in `wt-cliguard-osp`, two commits
   (`b1e72c56f` the guard, `71b5793b3` the row closure). Claim #1905.
3. **Stopping point.** Draft #4052 open, gate green on the pushed head (`EXIT=0`, 41 of 41 steps,
   14592 assertions, 0 red lines). CI read 26 pass / 1 pending / 1 skipping. Undraft ask #1907 and
   correction #1908 on board thread 8. Kestrel holds a watcher and undrafts when every check is
   terminal and green.
4. **Next step.** Nothing on this unit until it merges. Then `node tools/wt-done.mjs <the worktree>`,
   release claim #1905. Kestrel's ordered next unit is my claimed row
   `2026-09-07-ppg-ecg-hrv-paper-predates-the-fill-removal` (owner ruling 2026-10-27: RE-CUT the
   stale papers), sized from a worktree cut from `origin/main`.
5. **Open questions.** None on this unit.
6. **Blockers.** The one hazard the wrap carries: `DIFF_LINES` must stay at module scope, because
   `runFile()` closes over it. `npm run typecheck` cannot see it — `tsconfig.json` includes no
   `tools/` path — and `node --check` passes it, so the instruments are the selftest legs and a run.
7. **Doc-search query.** `mutate.mjs runs its CLI on import so a sibling tool cannot read its
   mutation matcher` — top hits `tools/mutate-recover.mjs:3-18`, `changes/2026-10-21-cli-predicate-survives-a-symlink.md`.
