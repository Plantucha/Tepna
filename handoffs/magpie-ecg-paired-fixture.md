# Magpie — a committed fixture that pairs an OxyDex night with an ECG export

Unit: residue `2026-10-06-no-committed-fixture-pairs-an-ecg`.
Branch `claude/ecgpair-mg`, worktree `~/wt-ecgpair-mg`, off `a8f55de82`.

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

---

## DONE — 2026-10-18, DRAFT #3655 (`claude/ecgpair-mg` @ `216be1e92`, `~/wt-ecgpair-mg`)

All four steps shipped, plus one the plan did not foresee. Two `.gitignore` allow-list lines let the repo
carry `uploads/synthetic_ecg_night.node-export.json` and
`uploads/OxyDex_synthetic_ecg_paired_summary.json`, `tools/gen-ecg-night-pair.mjs` builds the ECG half,
and `tools/regen-oxydex-goldens.mjs` gained a `fromCSVWithEcg` builder and a fifth fixture. `npm run check` ran green over all 38 steps on that commit,
and `tools/verify-fixtures.mjs` re-stamped three corpus-backed fixtures under `computeHash a4471a916bc5`.

The step the plan missed: `oxydex-app.js` assembled the export's block inline, and an
app-level assembly sits outside a headless regen's reach. It moved to `oxydex-fusion.js` as
`oxyEcgFusionBlock`, `tools/realm-manifest.js` gained `OXY_FUSION_REALM`, and `oxydex-app.js` now calls
it. That edit does move `computeHash` (`d64f76e7a3f7` → `a4471a916bc5`), because the denylist in
`manifest-gate.js` fails closed INTO the compute closure for an asset it does not know. The yield pin
reads `cohort-worker.js`'s `SCRIPTS` table, which lists neither file, so the 19-minute re-cut stayed unowed.

### Two lessons

The fixture-reproducibility gate builds its "something re-runs this" registry out of
`Object.keys(env.equiv)` mapped through `EQ[k].fixtureFile`, and out of nothing else. My first wiring hung
the record on its own `env.oxyEcgPair` key and the gate called the new fixture an orphaned code claim on
the first run. The record now lives in `readEquiv()`'s `out` as `oxydex_ecg_pair`, and it carries no
`input` field, because its fixture needs two and the `CASES` table keys by node.

A fixture conflict makes `tools/rebase-safe.mjs` fail closed: it classifies `uploads/*.json` as `source`,
and `guard-shared-tree.sh` then denies `git checkout --ours` over the same paths. The hook declines to
exempt `provenance`, since a wholesale restore discards `verifiedUnder` stamps only a corpus run re-earns.
This branch therefore stays four commits BEHIND on purpose. Kodiak updates the front PR when it is BEHIND,
CI runs on the merge commit, and I read the diff to confirm it adds no defect-pin annotation phrase, so
main's census gate needs nothing from this branch.

### Owed next

A residue row, once the RESIDUE slot frees: the fusion block drops `undefined` keys on the way into the
export, so `estimatedAHI` and `riskCategory` vanish instead of reading `null`. A consumer cannot tell an
absent AHI from one nobody wrote.
