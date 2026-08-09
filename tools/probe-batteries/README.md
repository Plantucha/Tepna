<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# `tools/probe-batteries/` — the inputs a `probe-equivalence` run actually ran

One module per source file: `tools/probe-batteries/<file>.mjs` for `<file>.js`. The engine is
`tools/probe-equivalence.mjs`; **adding a file is a battery, not a fork of the engine.**

## Why these are committed

`MUTATION-PROGRAM-2026-08-09-BRIEF` §2: roughly **83 equivalence classifications had been measured
with a battery and written down in brief prose**, while `tools/mutate-equivalence.json` carried
`clock.js` and nothing else. The batteries themselves were never committed — so those verdicts could
not be re-checked, widened, or re-run after the code moved. A classification is only as good as the
battery behind it, and a battery nobody can see is prose.

`MUTATION-EQUIVALENCE` §8.4 is why they are re-derived rather than transcribed: *"writing twelve
entries from a prose summary would be inventing data of exactly the kind this mechanism exists to
replace."*

## The contract

```js
export const deps = ['clock.js'];        // optional — files the SUITE co-loads first (dex-coload.js)
export function realmGlobals() { … }     // the vm context; `ctx.window = ctx` for an IIFE-on-window DSP
export function subject(ctx) { … }       // pull the callables out; return null if they are absent
export const families = [
  {
    name: 'lombScargle · numeric/spectral',
    fn: 'lombScargle',                   // the SOURCE function name — the engine finds its line range
    probe: (s) => CASES.map(c => call(s.PPGDSP.lombScargle, c)),   // ← an ARRAY, one entry per input
    minDistinct: 2                       // optional; the floor for "the subject actually ran"
  }
];
```

**`probe` must return an array, not a joined digest.** The engine counts distinct entries in the
baseline and refuses a family that produced one answer for everything — that is #1052's artefact,
where reading the undefined `PPGDSP.loadOwnExport` made every case throw identically and the run
reported 0 of 22 distinguishable. Variety in the baseline is the evidence the subject ran.

## Writing one: seven failures to expect, all of them recorded

1. **Reading the wrong global.** `parsePPG`/`lombScargle` hang off `PPGDSP`; `loadOwnExport` hangs off
   `PpgDex`. The first draft of the ppgdex battery also put the node name at `json.node` when the
   code reads **`json.schema.node`** — every case then took the same refusal arm and the family
   reported **2 distinct answers over 41 inputs**. Neither was visible by reading; both were caught
   by the degenerate-baseline check.
2. **A control the battery cannot reach.** Controls are mutants the sweep KILLED, so a sound battery
   must separate them too. Any that reads as equivalent marks the family **BLIND** and voids every
   verdict in it. Widen the battery — do not lower the bar.
3. **Reaching without magnifying.** An input that merely executes the mutated line does not separate
   it. `f >= 0.003` → `>` costs one unit in 3910 at 0.0401 Hz and 27 % at exactly 0.003 Hz. Put cases
   *on* each boundary, not near it, and on both sides.
4. **A constant column.** A field held at one value across the whole battery hides every guard that
   reads its *spread*. The hrvdex battery held `_sdnn` at 62, so `stdSDNN7` was 0 or NaN in every
   case and `r._sdnn > 0 && stdSDNN7 > 0` matched its `||` mutant — both NaN, one by refusing and one
   by dividing by zero. A killed control read as equivalent. **Vary anything a window is taken over,
   and put one row exactly on the window's own filter** (`v > 0`).
5. **Moving inputs as a GROUP because the data moves them as a group.** Welltory's six subjective
   scores are all-or-none in every real file, so the first hrvdex draft only varied them together —
   which never separates `r._sns > 0 && r._stress > 0 && …` from its `>=` mutant. Each gate has to be
   moved on its own. `null >= 0` is **true** and `null + 61` is **61**, so a single absent column is
   usually the whole test.
6. **Deriving a fixture's dependent fields before the overrides.** hrvdex's row builder computed
   `_date` from the default `_tMs` and then let an override move `_tMs` underneath it — so every
   clock-hour band in `circAdj` (`mHour < 10`, `> 16`) was unreachable, and a state flag nothing set
   (`_spanMin`) made a whole `_hrvIsAllNight` arm dead. **Grep the function for the row fields it
   reads and make sure the battery actually sets each one.**
7. **Believing a low control count.** `--controls` defaults to 12. On hrvdex, 8 / 16 / 24 controls
   each surfaced *different* blind mutants, and only at **40/40** did it stop finding new ones. A
   family proven against 8 controls has not been proven against 40 — raise it until the blind list
   is empty and stays empty.

Give the realm what the suite gives it (`deps`), or a mutant will differ from the original only by
`DexClock is not defined` — a difference caused by the probe, not by the code. #1052 had to discard
one of those by hand. `deps` is not always one file: hrvdex needs `quantity.js` too, because
`computeDerived` takes a **different documented fallback arm** when `DexUnits` is absent (the hard
`/1000`), so probing without it compares two runs of the fallback and clears the guard it was meant
to test.

**Stripping a volatile key can strip the mutant with it.** `hrvBuildNodeExport`'s
`generated: opts.generated || new Date().toISOString()` is a live gate whose `&&` mutant the sweep
kills — but the stamp is the clock, so a raw fingerprint differs from itself run to run. Deleting the
key made that control read as equivalent. **Classify it instead** (`FROM-OPTS` / `ISO-NOW` /
`ABSENT`): which arm ran is a function of the input; the instant is not.

## Running

```sh
node tools/mutate.mjs --file ppgdex-dsp.js --limit 9999 --jobs 10 --bail --json > /tmp/sweep.json
node tools/probe-equivalence.mjs --file ppgdex-dsp.js --sweep /tmp/sweep.json --controls 40   # report
node tools/probe-equivalence.mjs --file ppgdex-dsp.js --sweep /tmp/sweep.json --controls 40 --emit
node tools/probe-equivalence.mjs --selftest                                                   # known-answer
```

A sweep left on disk by **`tools/mutation-crawl.mjs`** (`.mutation-crawl/<file>.sweep.json`) is a
valid `--sweep` input and saves the ~12 min re-run. It is pretty-printed rather than NDJSON;
`parseSweep` reads both since 2026-08-09 — before that it read only the first `{`-line and threw on
the crawl's format, which is why two tools built to feed each other never had (MUTATION-PROGRAM §2b).

`--emit` writes only `no-distinguishing-input` entries, and refuses entirely if any family was blind,
degenerate or uncontrolled. **DISTINGUISHABLE survivors are never emitted** — they are real gaps, and
they stay in the denominator. A classification file is not a place to launder debt into a better
number.
