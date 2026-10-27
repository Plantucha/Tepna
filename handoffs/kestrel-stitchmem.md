# kestrel-stitchmem (2026-10-19)
- Unit: vigil capture-loop stalls 15.7/25.1/25.4 s; cause = PASS-triggered stitch_31d (19 GB rewrite, swap-out).
- PR #3702, branch claude/stitchmem-k9e, worktree ~/wt-stitchmem-k9e. Residue row 2026-10-19-stitch-31d-swaps-the-capture-daemon-out closed `fixed #3702`.
- State: check.sh EXIT=0 before the origin/main merge; CI pending at 20:50Z. Watch `mutation (diff-scoped)`.
- Next: on merge, `node tools/wt-done.mjs ~/wt-stitchmem-k9e`, then post a board finish note.
- Owner-only: deploy, vm.swappiness, slow_callback + stall_sampler in config.yaml.
- Doc-search query: "re-judge child swaps out the capture daemon memory loop stall MemoryLow swappiness".
