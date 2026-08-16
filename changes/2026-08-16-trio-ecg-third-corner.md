<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator]
brief: none
---

Two nights of the committed trio corpus were missing their **ECGDex leg** — the chest-strap corner —
so three-cornered hat rejected them outright. The exports existed on disk and had simply never been
committed.

```
tools/tch-multinight.mjs --dir uploads/trio
  before:  45 estimated / 55 nights   (2026-06-19 and 2026-08-04 both: `overlap 0 < 12`)
  after:   47 estimated / 55 nights
```

`2026-06-19` and `2026-08-04` each had `OxyDex` + `PpgDex` + an agreement sidecar but no `ECGDex`, so
they were 2-corner in a corpus whose whole purpose is 3-corner. TCH needs three observers; with two it
cannot separate anything, which is why both were reported as zero-overlap rather than as a weak
estimate. **+2 nights is +4.4 % of the estimable corpus**, and they are ordinary nights, not edge
cases — 77 and 98 comparable epochs respectively.

Both files validate as `ganglior.node-export` v2.0 with `startEpochMs` matching their folder date
(2026-06-19 22:14, 2026-08-04 22:48) and 109 / 167 `ganglior_events`. `tch-multinight` reads the
node-export JSONs directly from each night directory, so committing the exports is what restores the
corner.

⚠️ **The `agreement_*.json` sidecars for these two nights still say `nodes: [PpgDex, OxyDex]` and are
NOT updated here.** Regenerating one requires `tools/trio-batch.mjs --src <raw capture folder>`, i.e. a
full refold from the raw Polar/O2Ring capture, which is a separate work-unit needing the raw corpus.
The sidecar is derived and the analysis does not read it; leaving it stale is visible and honest,
whereas hand-editing a derived artifact is neither. **Owed:** refold those two nights so the sidecar
agrees with the directory.

**How this was found, since the method generalises:** an audit of eight `rescue/*` branches — snapshots
of uncommitted work going back a month, none ever triaged. Seven turned out to hold nothing lost
(changesets consumed by releases, worktree stubs, and one 500-line "orphan tool" that is a working copy
of `tools/pat-matchrate-strict.mjs`, already committed and its brief item ticked). These two files were
the only real gap. ⚠️ A first pass mis-measured it by reading the primary checkout, which is **197
commits behind `origin/main`**, so its dirty state is largely staleness rather than work; the finding
was re-verified against current `origin/main` in a clean tree before anything was committed.
