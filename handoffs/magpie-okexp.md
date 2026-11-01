<!--
  magpie-okexp.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Magpie · unit `okexp` — the exported host-axis block names its gate

**Unit:** `okexp` · **Branch:** `claude/okexp-mg` · **Worktree:** `../wt-okexp-mg` (repo-relative)
**Row:** `2026-11-01-the-exported-host-axis-block-drops-the-ok-it-was-gated-on` (my own, filed under
unit `ratefloor`) · **Board claim:** #2775

```
Rule 0: "exported host-axis block drops the ok verdict it was gated on, three publishers two shapes"
     -> briefs/RESIDUE.md:1113
     -> briefs/ALLAN-STABILITY-GAPS-2026-09-07-BRIEF.md:53-66
     -> ppgdex-dsp.js:6963 ppgBuildNodeExport
```

## The stopping point

Done and committed. `ppgdex-dsp.js` and `ecgdex-dsp.js` each forward one key, the suite group
`dsp · node-export · hostaxis-ok · three-publishers` holds all three publishers to it, nine fixtures
carry the new byte, and `docs/EXPORT-SHAPES.md` declares the contract.

## What measuring changed

The row offered two remedies and preferred neither. Measuring found a THIRD publisher:
`motiondex-dsp.js:_mdExportAxis` is a field list exactly like the other two, and it names
`ok: ax.ok === true`. So the doc-only remedy would have described one publisher and misdescribed two,
and the choice stopped resting on taste. Decision #2777 on the board, plus a correction: that post says
MotionDex "assigns the parse-layer object whole", which is wrong. It hand-lists its fields like the
others.

## The numbers, measured at `0a34815de`

- 443 files under `uploads/` declare `ganglior.node-export`; 242 carry `recording.hostAxis`
  (PpgDex 180, ECGDex 61, MotionDex 1).
- Exactly ONE of those 242 names `ok` — the MotionDex artifact. A census filtering on `ok` matched it
  alone and read clean.
- ZERO carry a `reason`, which is the new row below.
- `tools/pat-drift-attribution.mjs:126` holds the one read of `.ok` and fails closed, so it answered
  `'axis refused'` over a good axis.

## The next step

Nothing in this unit. Two rows I appended stay OPEN for whoever picks them up:

- `2026-11-01-no-artifact-carries-the-host-axis-refusal-the-spine-published` — the spine refuses at
  three returns with a `reason` and an `n`, and every publisher gates the block on `ok`, so no artifact
  ever carries a refusal. Publishing the block on a refusal changes what its PRESENCE means, so that
  change owes a corpus measurement first.
- `2026-11-01-the-hand-rolled-host-axis-block-has-no-declared-key-set` — three lists, no two alike,
  while `DexExport.timingBlock` already declares nine keys over the same measurement.

## Open questions

None for the owner. I owed no §7 decision beyond #2777, which I took myself.
