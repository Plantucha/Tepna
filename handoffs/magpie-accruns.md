<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
# Handoff — `accruns` (Magpie)

**Unit.** The remaining node call site of residue row
`2026-10-17-sample-parsers-called-without-their-sidecar`, ordered by Kestrel after #4069 merged.

**Branch.** `claude/sidenode-mg`, cut from `origin/main` at `405d379e9`.

## What the unit found

`resp-acc-analysis-app.js` was the last `parseSensorXYZ` caller outside `tools/` that read the H10
chest ACC with no `…_ACCRUNS.txt` companion. Wiring it alone would have changed no number. The
sidecar attaches validity out of band, and a blanked run keeps every row — a NaN there would delete
the ROW and turn an absence of VALUE into an absence of TIME. So the stamps march on at the native
period across a span the device never measured.

`respiratoryRate` already refuses a window it did not observe, but the mask it reads is built in
`respResample` from inter-sample GAPS, and a blanked run leaves no gap to see. The interpolator drew
a smooth line through the span and `respWindowSpectrum` normalised the amplitude away. That is the
sensor-off defect of DEEP-AUDIT-III §4.2 arriving by the one door the gap rule cannot watch.

## What changed

- `motiondex-dsp.js` — `respResample` reads `rows._blankSpans` and clears the coverage mask at both
  grid points that bracket a blanked sample. The spans MERGE first: the writer emits one row per
  channel, so x/y/z spans of one event arrive overlapping, and the cursor walk is correct only over
  disjoint intervals.
- `resp-acc-analysis-app.js` — buckets `…_ACCRUNS.txt` and pairs it with its stream by EXACT name
  (never by stamp proximity, which takes another session's runs on a multi-session night), hands the
  bytes over as `{ runsText }`, and publishes the span count and blanked seconds on the night.
- `tests/dex-tests.js` — the `done-when 4` pin for this file drops, the WIRED-caller list gains it,
  and a behavioural group proves the refusal, the merge and five discriminations.

## What stays open

The row stays OPEN. The `tools/` population keeps its pin at 64 calls over 38 files: wiring
unexecuted research tools, verified only by a name scan, would be a green over something never
examined.

## State

Push HELD by Kestrel's order until #4049, #4070 and #4071 land, to avoid ledger conflicts. I never
undraft my own PR.

## Searches that found the prior work

`node tools/doc-search.mjs --read "sample parsers called without their sidecar"` and
`"respiratory rate coverage window refusal"`.

Fleet-Session: Magpie
