# Magpie · unit `ratefloor`

**Unit:** row `2026-10-29-the-implied-single-segment-publishes-a-rate-with-no-floor-applied`.
**Branch:** `claude/ratefloor-mg`. **Worktree:** `../wt-ratefloor-mg`.
**Rule 0:** `node tools/doc-search.mjs --read "implied single segment publishes a rate with no floor applied per-segment model ring nights"`
→ `tools/ring-offset-census.mjs measureFragment`, board #2163, board #2148,
`capture-host/tests/test_solid_night_inputs.py`, `DEEP-STAGE-DESAT-CONFOUND-2026-07-29-BRIEF.md`.

## What the row asked for, and what was already done

#4098 sized the remedy in three items and implemented none. Item 1 asked for both of the
node's floors on the implied single segment. The span half of it landed on 2026-10-31,
two days after the row: `out.recording.hostAxis` now carries `rate` and `rateReason`,
and the span floor decides them.

So the live gap was narrower than the row reads. The verdict consulted the span alone.
`drawn` and `independent` sat in the same object as sibling keys and never entered it.

## What this unit changed

The verdict now asks Clock Contract §7's first question first — is there a second clock —
and reaches the span test only after both discriminators pass. Both read tri-state, so an
unmeasured verdict publishes `unknown` rather than certifying a rate. It annotates and never
refuses, per the owner's ruling on board #2180, which the file quotes twice.

Measured effect: six committed exports change their `rateReason` and none changes its `rate`.
Five now name the inert host column and one names the drawn device column. All six used to
blame a span that was true and was not the reason.

## What I left for the owner

Row A and row B both reserve one choice: whether a rate like this should publish `null` or
publish labelled. I did not take it, and nothing here decides it. The owner's own #2180
ruling already chose labelled for this surface, so the label now says what the node knew.
Row B's reserved choice is about the published fold artifacts and a recompute. I touched
neither.

## Residue filed

Row `2026-11-01-the-exported-host-axis-block-drops-the-ok-it-was-gated-on`. The export block
gates itself on `hostAxis.ok` and then forwards no `ok`, so a reader filtering the artifacts
on that key matches almost nothing and reads clean. It cost me one wrong census in this unit.

## Verification

`node tools/build.mjs --all`, `node tools/regen-ppgdex-goldens.mjs` (7 fixtures moved),
`node tools/verify-fixtures.mjs` (suite green, `PpgDex_2026-06-27_equiv` stamped
`verifiedUnder → ea4817278776`), then one full `npm run check` on the final state.

A DSP edit moves `computeHash`, so a regen alone does not discharge it. Regenerating an
output and proving it under the new closure are two steps.
