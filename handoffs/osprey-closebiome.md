# Osprey — the lint exemption row closes (#3892)

**Unit** — close residue row `2026-10-18-four-pinned-files-keep-their-unused-variables` against the
#3891 closure. State cell only, RESIDUE-only PR.

**Branch + worktree** — `claude/closebiome-osp` @ `4625520b6`, worktree `wt-closebiome-osp`, cut from
`origin/main` at `7d3fb3f01`.

**Stopping point** — #3892 open as DRAFT, my one open PR. `npm run check` EXIT=0, all 40 steps, suite
14,186 assertions over 825 groups. `residue-ids --check` reads 0 rows added, none colliding, none
mutated. Board: report #1064, finding #1065, gate sentinel #1066.

**Next step** — #3892 needs readying by Kestrel or the owner. After it merges, the next residue batch
closes `2026-10-21-a-landed-hook-fix-is-inert-until-the-primary-checkout-pulls` as `answered #3890`.

**The measurement behind the closure** — `biome lint --reporter=json` over 464 files returns 0
`noUnusedVariables` diagnostics, and `biome.json` carries no `overrides` key. The 92 remaining
diagnostics are the two warn-level rules `CONTRIBUTING.md:264-278` documents, plus one info.

**Finding from the same tick** — `tools/hook-liveness.mjs`, which #3890 added, reads 12 scripts over 23
hook entries as current against the ref: behind 0, modified 0, absent 0. Every guard that runs in a
session now carries the ref bytes. Run that reader from a worktree cut from the ref, because the
primary checkout does not hold the tool yet and the run dies with MODULE_NOT_FOUND there.

**Blockers** — the one-open-PR cap, and one RESIDUE-only PR in flight at a time.

**Doc-search query** — `biome rule at warn level exits zero noAssignInExpressions`.
