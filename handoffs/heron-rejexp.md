# Heron · unit 102 `rejexp` — which trio exports carry a recorded code era

**Unit.** Row `2026-10-12-rejected-trio-nights-keep-exports-no-fold-rewrites` asked first for a
measurement: a trio export sitting in a night the fold never stamped has no record of the code that
wrote it. This unit produces that measurement as a committed verdict and puts a tripwire under it.

**Branch + worktree.** `claude/rejexp-hrn` in `~/wt-rejexp-hrn`, cut from `747adae76`.

**What it measures.** 80 of 415 tracked exports sit in 57 nights with no stamp, so they carry no code
era at all. The per-node split is ECGDex 5, OxyDex 57, PpgDex 9, PpgDexFinger 9.

**Why the exposure is narrow, and how that is held.** Over the tracked tree the nights carrying all
three trio exports and the nights carrying a stamp are the same 90 nights, with an empty symmetric
difference. A three-leg consumer therefore cannot reach an era-less export, and the exposure is the
partial-leg tools. That equality is the verdict's criterion, so a 2-of-3 night that gains a third
export without a stamp reds rather than passing quietly.

**The criterion is not the figure.** `stamp_three_leg_disagreements`, threshold 0 nights, direction
lte. A threshold read off the count it publishes is UNKNOWN under the verdict contract, so the 80
rides in `result`.

**Where it lives.** `tools/fold-generation.mjs` gained `nodeOfExport`, `eraCensus`, `eraVerdict` and
an `--era [--json|--write|--check]` mode. The artifact is `analysis/trio-export-era.json`. The suite
group `docs · claude-md · trio-era` holds the committed artifact against a live census.

**Measured under two plants.**

| plant | red legs |
|---|---|
| committed `exports.unrecorded` 80 to 79 | 3, naming the stale count both ways round |
| `nodeOfExport` reads a prefix rather than the token before the first `_` | 3, and the equality leg named 2026-07-31 and 2026-08-22 |

The second plant is the finding worth keeping: a prefix match reads `PpgDexFinger` as the PpgDex leg,
which makes two 2-of-3 nights look complete. The criterion caught both by name.

**Gates.** `node tools/fold-generation.mjs --selftest` reads `all 87 selftests passed`. The sweep
reads 209 tools green. `npm run typecheck` 0 and `npm run lint` 0 over 470 files. The full gate figure
is in the PR body.

**Not done here, and why.** The row stays OPEN. This artifact records the absence of an era, it does
not restore one, so a closure would be untrue. Restoring an era needs the stamp contract to change,
which board #1632 recorded as the owner's and brief-shaped.

**Owed.** A row for the partial-leg consumers this unit measures and does not repair, on a later
RESIDUE-only PR.

**The doc-search query that finds the prior work.** `rejected trio nights keep exports no fold
rewrites`.

Fleet-Session: Heron
