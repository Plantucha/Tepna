# Magpie · ECG explorer y-scale (#113) and the clock.js drawn-axis note

**Unit:** both closed 2026-10-18.

## Landed

- **#3635 MERGED** as `4ffc7afaf` — `clock.js`'s drawn-axis consequence note corrected to the measured
  consumer set (ECGDex relabels over 8 sites, the Integrator refuses on `deviceDrawn !== true` over 3,
  `pat-gate.js` carries no site and refuses earlier on `timingSource === 'none'`). The suite's
  `clock · drawn-axis · source-scan` group now pins each fact to the sentence that states it, so the
  next migration reds the gate instead of staling the prose. Board entry #114.
- **#3636 DRAFT** on `claude/ecgy-scale-mg`, worktree `~/wt-ecgy-mg`, head `8f29c4ddb` —
  `ecgdex-render.js:_viewScale(start, span, factor)` scales the explorer's y-axis to the window on
  screen, p0.5/p99.5 clipped, 8 % pad, cached on `start|span|factor`, with `draw` clipped to the plot
  box and `drawMini` left on the whole-recording scale on purpose. Board entry #115.

## The exact stopping point

#3636 is open as DRAFT with the full gate green (all 38 steps) on head `8f29c4ddb`, `behind=0`. The
walker undrafts it. Neither unit owes anything further.

## What the next session should know

- **The gate computes render-only; prose never claims it.** ECGDex `computeHash` `a99dac9a351b` on base `4ffc7afaf`
  and on the head. `manifestHash` `cd7a62da1f7d` → `8ff8a5eb3e8a`. Recompute with
  `ManifestGate.computeHashFromText` over the BUNDLE text — `computeHash` is not a `provenance/*.json`
  field, and looking for it there wasted a cycle.
- **A commit holding only regenerated artifacts is a rebase trap.** `rebase-safe` exited 2 on exactly
  that commit: four goldens, the ledger fragment and the served copy all conflicted at once. Dropping
  it with `git rebase --skip` and re-deriving from source on the new base beat resolving generated
  files by hand. Keep regenerated output in the same commit as the source edit.
- **A spine comment is not export-inert.** `clock.js` reaches 22 generated root files, so #3635 cost 9
  fixture regenerations, 13 `verifiedUnder` re-stamps and a 25m41s paper-scale rerun for the
  treatment-response yield pin.

## Still open for my lane

- Residue `2026-09-25-drawn-consumers-closure-unverified` and
  `2026-10-12-clock-js-names-two-migrated-drawn-consumers-as-live` stay OPEN. #3635 answers both;
  the closures ride the RESIDUE-only PR Kestrel sequences.
- Queued owner rulings: remedy (a) for `2026-09-22-ppgdex-fixture-spread-not-bundle-reproducible`; the
  OxyDex resp-rate number reading `null` with a named reason; retiring the duplicate id `crCoupling`
  for `crcPLV` and binding `cmpResidSD`; making CI re-run a quoted verdict tool.
- Brief lane, four live: OXYDEX-PB-DETECTOR-FOLLOWUPS, PPGDEX-ALGORITHM-DEEP-DIVE,
  PPGDEX-MULTICHANNEL-FUSION, ZEPHYR-INSTRUMENT.

## Doc-search query that found the prior work

`node tools/doc-search.mjs --brief "ECG waveform explorer y axis scale flattened by an artifact spike"`
→ no prior work on the explorer's y-scale. For the spine unit:
`"clock.js drawn timing source consumers consequence comment stale"` →
`briefs/KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md:468-510`.

## Ledger unit, 2026-10-18 22:19Z

DRAFT #3641 on `claude/res1-mg` at `b441fdf66`, worktree `~/wt-res1-mg`, base `6b60044e8`.
It moves four state cells and appends one row. `npm run check` passed all 38 steps. `residue-ids`
reports 1 row added, none mutated. The number went to Kestrel as board entry #125 on thread 1.

Next step: run `node tools/wt-done.mjs ~/wt-res1-mg` once the walker lands it.

The new row owes a code PR of its own. `guard-format.sh:200-201` prints an `npx --no-install biome`
remedy, and the guard already holds the resolved path from `:148`. Print that path instead. Never put
the repair on a ledger PR.

## The guard repair, 2026-10-18 22:28Z

DRAFT #3644 on `claude/fmtremedy-mg` at `c3eff7783`, worktree `~/wt-fmtremedy-mg`, base
`6b60044e8`. `npm run check` passed all 38 steps. Kestrel has the number as board entry #127.

Two fixes, both in the BLOCKED block of `.claude/hooks/guard-format.sh`. The remedy prints the
resolved Biome and the directory to run it from. The `biome ci` run passes `--colors=off`, because
Biome's markup put an ANSI reset inside the filename the remedy prints.

Still owed: the state cell for `2026-10-18-format-guards-remedy-line-prescribes-the-squatting-biome`.
#3641 holds the ledger, so that closure belongs in the next RESIDUE-only batch, and it reads the
#3644 number once that PR lands.

Next step: `node tools/wt-done.mjs ~/wt-fmtremedy-mg` when it merges, then the same for
`~/wt-res1-mg`.

## Ledger landed, 22:30Z

#3641 merged at 22:25:39Z as `bf9c28d53`, and `wt-done.mjs` reclaimed `~/wt-res1-mg`.
A peer's ledger PR #3643 now holds the slot, so the format-guard row's closure waits for the batch
after that one, and it reads the #3644 number once that PR lands.
