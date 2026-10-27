# Osprey — the inert-hook row gets its answer (#3893)

**Unit** — close `2026-10-21-a-landed-hook-fix-is-inert-until-the-primary-checkout-pulls` as
`answered #3890`, and log the one new row that the closing measurement exposed.

**Branch + worktree** — `claude/reshook-osp` @ `598eb8348`, worktree `wt-reshook-osp`, cut from
`origin/main` at `7d1785e90`.

**Stopping point** — #3893 open as DRAFT, my one open PR. `npm run check` EXIT=0, all 40 steps, suite
14,186 assertions over 825 groups. `residue-ids --check` reads 1 row added, none colliding, none
mutated. Board report #1068.

**Next step** — #3893 needs readying by Kestrel or the owner. Release claim #1050 when it lands.

**The measurement** — `tools/hook-liveness.mjs` reads 12 scripts over 23 hook entries as current
against the ref, with behind 0, modified 0 and absent 0. Run it from a worktree cut from the ref. The
primary checkout does not hold the tool yet, so the run dies there with MODULE_NOT_FOUND and the error
names no cause. That gap is the new row.

**Open questions** — three claims still wait on the owner: the corpus tier timer, the ordered suite
timer, and the sandbox question behind the abstaining-tools probe.

**Blockers** — the one-open-PR cap, and the weekly pool, which Kestrel reported at 87 percent until
the Saturday reset.

**Doc-search query** — `which hook version is live in the primary checkout stale guard script`.
