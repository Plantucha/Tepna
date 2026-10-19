# Magpie — a committed fixture that pairs an OxyDex night with an ECG export

Unit: residue `2026-10-06-no-committed-fixture-pairs-an-ecg`.
Branch `claude/ecgpair-mg`, worktree `/home/michal/wt-ecgpair-mg`, off `a8f55de82`.

Rule 0: `node tools/doc-search.mjs "committed synthetic fixture pairing an OxyDex night with an ECG
export for fusion"` → `tests/dex-tests.js:74327-74343` (validateExport), `briefs/RESIDUE.md:566-567`,
`Integrator.html:2753-2897`. Every `SYNTH-*` and `FIXTURE-*` brief reads DONE, so no live brief owns
this and no peer holds it.

## The defect

GATE C cannot see an OxyDex fusion change. Every committed OxyDex fixture is built with
`ecgFusion: null` (`tools/regen-oxydex-goldens.mjs:166`), and `provenance/OxyDex.json` lists only
O2Ring inputs for all five. So a fusion edit moves `computeHash` while every fixture moves only its
code-hash stamps, which is silent by construction. Only the fusion plants carry the behaviour, the ones
in `tests/dex-tests.js`.

## What the fixture needs

`oxyEcgForNight` reads `window._ecgByDate[date]`, which holds ECGDex NODE-EXPORTS, so the ECG side of
the pair is a small committed JSON and not a raw recording. `oxyComputeFusion` reads exactly:
`recording.startEpochMs`, `hrv.time`, `hrv.frequency.respRateEpochStats`, `timeseries.sleepStages`,
`personalization.restingHR`, `personalization.restingHRNocturnalFloor`, `ganglior_events`,
`cardiorespiratory` and `apnea`.

## The plan

1. Generate a whole-night synthetic pair from ONE `synth-gen.js` timeline, so the two sides are true counterparts by
   construction rather than by assertion. `renderECGInt16(tl, win)` takes a whole-night span (line 1028),
   and `renderOxy(tl)` already stamps at 1 Hz.
2. Run ECGDex on the ECG stream through the realm loader `tools/regen-ecgdex-goldens.mjs` already
   uses, and commit the resulting node-export as the fixture INPUT. The raw ECG text is ~220 MB at
   130 Hz, so it stays uncommitted, exactly as the `real: true` H10 clip does.
3. Add a fused OxyDex fixture built with that export as `ecgFusion`, a `tools/regen-oxydex-goldens.mjs`
   entry, and the GATE B record naming BOTH inputs.
4. Assert in `tests/dex-tests.js` that the fused fixture carries a non-null `ecgFusion` block, so a
   future `ecgFusion: null` regression reds rather than passing silently.

## Costs measured today, before starting

- Nine bundles carry `oxydex-dsp.js` and four hide it in the `cohort-worker.js` blob string, so survey
  by an identifier, never by `data-inline-src`.
- A DSP edit costs a 19-minute yield-pin re-cut. A FIXTURE-ONLY change moves no `manifestHash`, so this
  unit should owe neither the re-cut nor a re-bundle. Check that before paying it.
- `tools/verify-fixtures.mjs` is the only writer of `verifiedUnder`, and it needs the primary
  checkout's `uploads/`.

## Open question for the owner, not blocking

The corpus line forbids committing anything captured, so both sides of this pair are synthetic. A real tri-device night
would be the stronger fixture and that is the owner's call, not mine.
