<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** DONE — 2026-10-20 · **Created:** 2026-10-20 · **Owner:** unassigned · **Relates:** `briefs/EXPORT-SCRUB-ALLOWLIST-2026-10-07-BRIEF.md` §7, residue `2026-10-12-one-key-carries-both-a-semantic-tag-and-an-upload-filename`, `export-schema.js` GUARDS, `ppgdex-app.js` buildV2

# `recording.source`: one overloaded key, one node, one line

## 0 · Why this brief exists

The residue row reads `recording.source` as overloaded ACROSS the fleet, and sizes the remedy as a new
key per node plus an allow-list declaration. That is a 10-bundle spine edit, because ten bundles inline
`export-schema.js`.

I measured the corpus before writing any of it. The population is one node and one line.

## 1 · The measurement

Read-only over this checkout's committed corpus, 2026-10-20, every git-tracked JSON holding a
`ganglior.node-export` envelope. Kind by the guard's own test (`export-schema.js` `_FILE_SHAPE_RE`: a
path separator, or a dotted extension of one to five characters at the end).

```
envelopes = 445 · with a recording block = 443 · carrying recording.source = 442
```

| node | block | kind | n | value |
|---|---|---|---|---|
| CPAPDex | `recording` | tag | 4 | `ResMed AirSense 11 (EDF set)` |
| CPAPDex | `nights[].recording` | tag | 20 | `ResMed AirSense 11 (EDF set)` |
| ECGDex | `recording` | tag | 101 | `file`, `ecg` |
| GlucoDex | `recording` | tag | 4 | `file` |
| HRVDex | `recording` | tag | 3 | `welltory` |
| OxyDex | `recording` | tag | 147 | `spo2` |
| PulseDex | `recording` | tag | 3 | `rr` |
| PpgDex | `recording` | tag | 179 | `ppg` |
| **PpgDex** | **`recording`** | **path** | **1** | **`Polar_Sense_BBBBBBBB_20260611_210416_PPG.txt`** |

**441 of 442 values are tag-shaped.** The one path-shaped value in the whole corpus sits in
`tests/fixtures/ppgdex.node-export.json`.

The row's third kind does not exist as a third kind: CPAPDex's device phrase is tag-shaped and the
guard never mistakes it.

## 2 · The defect is a sibling divergence, not a fleet-wide overload

PpgDex has TWO export builders, and they disagree about what the key means:

| builder | reachable from the suite | `schema.version` | `recording.source` |
|---|---|---|---|
| `ppgdex-dsp.js` `ppgBuildNodeExport` | yes, `PPGDSP.buildNodeExport` | `2.1` | the literal tag `'ppg'` |
| `ppgdex-app.js` `buildV2` | no, an inline object literal | `2.0` | `r.fname \|\| 'wrist-ppg'` |

`buildV2` is the USER-FACING path: `download(JSON.stringify(payload …))` in the same function, and the
multi-session shape maps it over every session. So the one path-shaped value in the corpus is not a
stale artefact. It is what a real upload exports today.

🔴 **The live consumer reads the key as a TAG.** `signal-orchestrate.js` routes on
`exp.recording.source === 'welltory'`. A filename there is a value no consumer reads, in a key one
consumer dispatches on.

🔴 **The one node with no committed tag assertion is the one node that diverged.** The suite pins
`recording.source` for PulseDex (`rr`), OxyDex (`spo2`), HRVDex (`welltory`) and ECGDex (`ecg`), and
pins the scrub's own tag survival for `file` and the CPAP device phrase. It pins nothing for PpgDex.
Same family as `gate-must-publish-its-denominator`: the unpinned member is where the drift lives.

## 3 · What the scrub does today, and why that is not the fix

`GUARDS.recording.source = _tagNotPath` drops the value by SHAPE. It caught this one. It is still a
guess in both directions: a tag ending in a short dotted token drops, and a filename with neither mark
survives. The ambiguity is in the writer, so the guard stays as the tripwire and stops being the
remedy.

## 4 · The remedy, re-sized

**No new key. No `export-schema.js` edit. No spine move.** One node-local change in `ppgdex-app.js`:

```js
recording: {
  source: 'ppg',            // the tag the DSP's builder already writes
  fname: r.fname || null,   // the identifier, undeclared in the allow-list, so dropped BY NAME
```

The allow-list declares no `recording.fname`, so the scrub drops it and names it — which is what the
contract already does with every identifier route. A scrubbed export is byte-identical in meaning
either way; an unscrubbed local export keeps the filename, under a key that means a filename.

## 5 · Acceptance

1. `ppgdex-app.js` `buildV2` writes `source: 'ppg'` and routes the upload filename to `fname`, null
   when absent (§∅).
2. `tests/dex-tests.js` pins `PPGDSP.buildNodeExport(...).recording.source === 'ppg'` — the per-node
   assertion the family lacks — and pins the app builder's two literals through
   `env.sources['ppgdex-app.js']`, because that builder is unreachable any other way.
3. `node tools/build.mjs --app PpgDex` plus `npm run check`. One bundle's `manifestHash` moves.
4. `tests/fixtures/ppgdex.node-export.json` is NOT regenerated. It is a committed sample of a real app
   export, referenced by `audits/ABSENCE-SURVEY-2026-09-22.json` for an unrelated field. After item 1
   it reads as evidence of the defect, which is what a dated sample is for.
5. The residue row closes as `fixed #3762`.

**Discharged by #3762.** Items 1, 2, 3 and 5 landed there. Item 4 is a
negative: the fixture was not regenerated, and it now reads as evidence of the defect.

## 6 · Sequencing

A PpgDex re-bundle collides with every open PpgDex draft. Kestrel holds the queue, so item 3 waits for
a slot rather than racing one. Nothing in items 1 and 2 touches a shared module, so this is a
single-node unit whenever that slot opens.

## 7 · What this brief does not claim

- **No rate for the real world.** 1 of 442 is the rate over a corpus dominated by synthetic DSP
  goldens. The app path has one sample in it, so the corpus under-represents the builder a browser
  export uses. The claim is the DIRECTION, read from two call sites, not a frequency.
- **The version split is not addressed.** `2.0` against `2.1` between the two builders is the same
  divergence in another field, and it is not this unit's scope.
- **This brief infers nothing about the other nodes.** Every other node writes one literal tag from one builder,
  measured above.
