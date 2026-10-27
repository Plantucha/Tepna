# Osprey — the last per-file biome exemption (#3891)

**Unit** — residue row `2026-10-18-four-pinned-files-keep-their-unused-variables`, last leg. End the
`noUnusedVariables` downgrade for `synth-gen.js`, and delete the last `overrides` key from `biome.json`.
#3779 did the other three files. Rule 0 found that first, so this unit covers the remainder only.

**Branch + worktree** — `claude/synthdead-osp` @ `14ade7714` in `wt-synthdead-osp`, cut from
`origin/main` at `93d98bddb`. Pushed, and the local ref matched the remote ref before the PR opened.

**Stopping point** — #3891 is open as DRAFT. One commit, 50 paths, staged by explicit path.
`npm run check` EXIT=0, all 40 steps, suite 14,167 assertions over 824 groups. Board report #1058 on
thread 7, queue note #1059 on thread 8. Claim #1056 stays held until the row closes.

**Next step** — #3891 needs readying by Kestrel or the owner, because I never undraft my own PR. After
it merges, open the RESIDUE-only PR that closes the row. Touch the state cell and nothing else.

**Open questions** — none for this unit. Two older rows still wait on the owner: the corpus tier timer
(board #1047) and the sandbox question behind the abstaining-tools probe.

**Blockers** — the one-open-PR cap. A second unit cannot reach a PR while #3891 sits open, so the row
closure waits on the merge rather than on any measurement.

**What a resumer needs to know** — `synth-gen.js` is spine. It sits in all six `cohort-worker.js`
realms and the build inlines it into 14 root HTML files, so an edit moves 7 bundles, their docs copies,
7 analysis tools, 7 provenance fragments and 16 goldens. The treatment-response yield pin moves too.
Re-cut it at paper scale rather than re-stamping it: that run took 892.7 s here and returned 233 tx
and 239 flat over 18291 seeds, identical to the pin it replaced.

**A control plant needs care here.** Biome never flags a top-level declaration, and it exempts any name
starting with an underscore. Two of my plants hit those exemptions and examined nothing while reading
green. A function-local, non-underscore name separates the arms.

**Doc-search query** — `unused variables biome warning pinned files oxydex-profile dead code`.
