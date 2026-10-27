<!-- SPDX-License-Identifier: Apache-2.0 -->
# Handoff — what moves the chest strap's per-session ECG rate (Magpie)

**Unit:** the fs-estimate half of residue row
`2026-10-20-h10-session-fs-moves-hundreds-of-ppm-between-sessions`. Wren holds the row and the
verdict half; Wren closes it. Claimed on the board as entry #555.
**DRAFT #3789**, `claude/h10fs-mg` @ `996e92eba` in `~/wt-h10fs-mg`. `npm run check` reads 40 of 40 on the merged head.
**Doc-search query that found the prior work:** `H10 ECG sample rate per session ns counter step mean
estimator` → `briefs/DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md:547-564` ·
`briefs/H10-ECG-RATE-CORPUS-CHECK-2026-08-04-BRIEF.md:31-55` ·
`briefs/PAT-COMPENDIUM-2026-08-10-BRIEF.md:120-137`. A second phrasing —
`pre-break sensor_ns built off the nominal rate drawn axis exclude from a rate spread` — found
`tools/device-stability.mjs:80-106`, which is where the two bounds below come from.

## The deliverable

`tools/h10-session-rate.mjs`, a `decides` producer with its adoption row and a changeset. It reads
every exported ECG stream the corpus root holds, and per session prints the gap count, the gap total,
the counter-step distribution, the shipped `fs` with its `fsSource`, and the rate the two axes would
each give. The tool names a session only `sNN` and a night only `nNN`: no corpus path, filename or stamp
leaves the tool.

## What the pre-stated criterion decided

**The mechanism is REFUTED.** The band the two axes disagree about — a step above the `[ms]` path's
`msStep x 2.5` gap test but below the counter path's `< 50 ms` admission — is **empty on every
session**. So excluding it changes nothing, `tightSpreadPpm` equals `shippedSpreadPpm` to the digit,
and the guard asymmetry does not account for the movement. The verdict reads `FAIL` by the criterion
I pre-stated before running it, which is the honest outcome, not a broken tool.

## What the same run DID establish

Figures are in the PR body and in the tool's own `## Measured` section. The four that matter:

1. The between-session spread is three orders above a crystal and survives every exclusion: it is
   not our own nominal leaking through a pre-break capture, not an averaging artefact (the modal
   step moves with it), and not the short sessions.
2. Nights whose fragments disagree by more than one shipped bound and less than another. The repo
   carries two: `device-stability.mjs MAX_CRYSTAL_SPREAD_PPM = 50` ("A crystal does not change rate
   between fragments of one night", and `dual-clock-rate.mjs:346` refuses such a night — "this is
   not a rate"), against `mergeEcg`'s 0.05 Hz = 385 ppm. Nights fall in the gap.
3. The 77 ppm window the comment at `ecgdex-dsp.js:5141` quotes holds under a quarter of the
   sessions, with sessions above its top and below its floor by hundreds of ppm.
4. The two drawn bounds disagree about this corpus. `clock.js CK_AXIS_DRAWN_SHARE = 0.67` turns away
   sessions that `device-stability.mjs DRAWN_MODAL_SHARE = 0.99` keeps, and a pre-`80e05501` capture
   at 98.63 % falls between them, so which bound a tool picks decides it. This tool excludes at the
   Contract's bound and prints the modal share of everything it turns away.

## The measurement limit, priced twice

An unbiased 17-stream stride sample priced the `--max-steps 100000` bound at up to 166.4 ppm. A
whole-file pass over the 115 LARGEST sessions prices it at median **55.5 ppm** and worst
**1278.8 ppm**, with 30 of 115 over the 100 ppm ceiling. The stride sample under-priced it eightfold,
because it held only three sessions long enough to truncate and this cost falls only on long ones.
**Draw the control on the quantity at issue.**

Read whole, those 115 span 1686.9 ppm and their minimum sits BELOW the bounded pass's global minimum,
so the bound UNDERSTATES the movement. Every figure in the PR is a floor. The refutation is untouched:
the band is empty by count on both passes.

## Next step — finish the full read

This session stopped the whole-corpus full read at 115 of 642 sessions rather than hold a loaded
window for 2.5 h of NAS I/O while the fleet's gates contended. One command finishes it:

```sh
W=~/wt-h10fs-mg
setsid nohup bash -c "cd $W && ( node $W/tools/h10-session-rate.mjs \
  --uploads /srv/data/tepna-corpus/uploads ; echo \"EXIT=\$?\" ) > /tmp/h10fs-full.log 2>&1" &
```

Two traps it cost an hour to find. The corpus root is **`/srv/data/tepna-corpus/uploads`** and must be
passed with `--uploads`: a worktree has no corpus, `corpusSearch` finds none, and the tool then reads
`NOT_RUN` with a green exit. And `~/Tepna/uploads` is NOT that root — it is a partial
symlink farm of 393 links whose ECG files carry `_partNNofNN` names the population rule turns away,
so pointing there finds 0 streams.

Then replace the `## Measured` block in the tool and the matching PR section with the whole-read
figures, and keep the bounded ones beside them as the bound's price.

## Rows this unit owes and has not logged

The RESIDUE-only slot was held when this ran. This unit verified each one and logged none:

- `ecgdex-dsp.js:4961`'s comment claims the counter path uses "the same `< 50` guard the `[ms]` path
  uses". It does not: the `[ms]` path latches `msStep` and excludes anything past `msStep x 2.5`,
  about 19.2 ms, which is 2.6x tighter. The band is empty on this corpus, so the defect is the
  comment, not the arithmetic.
- `tools/trio-batch.mjs:2953` sizes a shipped refusal on a "~30 ppm crystal" while
  `DEVICE-RATE-TRUTH` §1 attributes the same device an RC-class oscillator at -105 ppm.
- The two drawn bounds (item 4 above) and the two night bounds (item 2) are each one quantity with
  two shipped numbers.
