<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

**Status:** REFERENCE (living — re-run `node tools/measurement-walk.mjs` when OxyDex, its fixtures or the ledger change; every hash on this page is re-derived by that tool, never transcribed) · **last-verified:** 2026-09-21 · **Executes:** `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26-BRIEF.md` §3 (deliverable D — the backward walk-through) · **Relates:** `docs/EXPORT-SHAPES.md` (the `measurement` block), `measurement-block.js` (the schema authority), CLAUDE.md §🔏 (GATE A/B), §∅

# Walking one number back to its raw input — ODI-4 on a real O2Ring night

Tepna could prove that a **bundle** produced an **export** from an **input**, byte for byte, years later
(`manifestHash`, `computeHash`, GATE A/B). It could not answer the same question about one number
*inside* that export. Since 2026-09-21 OxyDex answers it: every night element carries a `measurement`
map — one block per headline metric (`meanSpo2`, `t90`, `odi4`, `hypoxicBurden`) — and each block
names the window, the channel, the code and the input its number came from. This page walks ODI-4 on
the committed night `OxyDex_2026-06-25_0439_summary.json` back to the file on disk, hop by hop, and
says at each hop **which artifact the claim is checked against**.

⚠️ The hashes below are the ones the tool printed on 2026-09-21. **They will move** the next time
OxyDex's compute closure changes and the fixtures are regenerated — that is the design, not drift.
Do not read this page as the current truth; run the tool. A ✗ it prints is the finding.

## The chain, hop by hop

```
value 1.2 ev/h ─▶ measurement.odi4 ─▶ window ─▶ sourceChannel ─▶ code ─▶ evidence ─▶ ledger ─▶ bytes on disk
```

| hop | the block says | checked against | how |
|---|---|---|---|
| **value** | `odi4.value = 1.2` | the same element's `odi4.rate` | equality — the block adds lineage, it never recomputes; the regenerator reported exactly ONE moved field per fixture (`measurement: undefined → {…}`), every other byte identical |
| **window** | `startTMs 1782340050000 → endTMs 1782361843000` (`clockDomain: device`, `timingSource: device`) | the committed input, re-parsed by the real parser | `startTMs` = `t0Ms` of the first valid row, `endTMs` = the last stamped row's `tMs` — the window is the signal's, not `durationMin` rounded |
| **spreadMs** | `null` — *"single device clock — the O2Ring RTC is the only timebase on this input"* | — | ∅: unmeasured is `null` **with a reason**, never `0` (a `0` would claim two clocks agreed exactly) |
| **channel** | `O2Ring:spo2` | the capture-side naming (`device:stream`) | shape check; the block never carries unit/label/tier — those resolve from `oxydex-registry.js` by `metricId` |
| **code.computeHash** | `c3a111143d7e` | `OxyDex.html` on disk, projected by `manifest-gate.js computeHashFromText` | the compute closure of the shipped bundle — a render-only rebuild leaves it unmoved, a DSP edit moves it and reds the gate until the fixture is regenerated |
| **code.manifestHash** | `57a90c14bc79` | `OxyDex.html` (`manifestHashFromText`) **and** `provenance/OxyDex.json` (`manifestHash`) | GATE A's own identity; the running bundle reads both hashes off its `<html data-manifest-hash data-compute-hash>` tag, stamped at build time *outside* every inline block so the stamp cannot move the hash it carries |
| **evidence.inputHash** | `4aae89d16d90` | `SignalFrame.computeContentId` recomputed from the committed CSV | the suite's 12-hex content address of the *decoded samples + t0Ms* — the same id `recording.contentId` carries, so a `.dat` and a CSV of the same night share it |
| **evidence.envelopeRef** | `null` — *"no acquisition envelope for this input (CSV / legacy path — the envelope joins on the .dat session_id)"* | — | the acquisition-evidence join (Phase C) is on the `.dat` night's `session_id`; a CSV has none and **says so** rather than leaving the field silently absent |
| **ledger.inputHashes** | `O2Ring S 2100_20260624222730.csv → 8776fc2151dc3e38` | `sha256[0:16]` of the input bytes | the raw file — the end of the chain |
| **ledger.outputHash** | `6eb15435fa246d65` | `sha256[0:16]` of the fixture bytes | GATE B's pin on the export itself |
| **basis** | `derived` | LEXICON §4b | ODI-4 is event detection against a baseline model → *derived*; `meanSpo2`/`t90` are statistics read straight off the measured samples → *measured*. This is per-INSTANCE derivation kind, **not** the evidence ladder (`odi4` is `validated`-tier in the registry; the two share the word "measured" and nothing else) |
| **uncertainty** | `null` — *"not estimated — this node carries no uncertainty model for whole-night oximetry summaries"* | — | "unknown" is a valid state, stated |

Run it:

```sh
node tools/measurement-walk.mjs                                            # all three OxyDex fixtures
node tools/measurement-walk.mjs --fixture OxyDex_2026-06-25_0439_summary.json
node tools/measurement-walk.mjs --selftest                                 # 13 plants — each hop catches its own corruption
```

The two real nights need the corpus (`DEX_UPLOADS` → the primary checkout's `uploads/`); the
synthetic golden is committed and walks in CI. An absent input prints `∘ not re-derived`, never ✓.

## What the walk-through does NOT prove

- **Provenance ≠ accuracy.** Every hop above says *where the number came from*, not that it is
  right. Whether ODI-4 = 1.2 ev/h is the true desaturation index of that night is the oracle harness's
  question (§5, `docs/ORACLE-ECG-FIRMWARE-RR-2026-09-21.md` for the ECG leg), not this page's.
- **`inputHash` is a content address of the decoded signal, not of the file.** The file's identity is
  the ledger's `inputHashes` one hop further; the two are deliberately different quantities — a `.dat`
  and its CSV decode have the same `contentId` and different file hashes.
- **The envelope hop is unexercised on the committed fixtures**, because they are CSVs. A `.dat` night
  dropped with its `acq/*.json` envelope carries `envelopeRef = session_id`; the tool walks that by
  presence, not by opening the envelope (the envelope's own `artifact_sha256` is Phase A's).
- **A headless source-module run has no code identity** and its blocks carry `code: null` with a
  reason — and **fail validation loudly**. The regenerator supplies the shipped bundle's hashes; that is
  the only path that writes a fixture.

## How the emitter is gated

- `tests/dex-tests.js` — *"OxyDex emits measurement blocks — roadmap §3 reference path (plant-backed)"*:
  every block validates with all five legs run (the `checked` denominator is asserted), values ≡ the
  element's, `inputHash ≡ contentId`, no-identity → `code:null` + reason + validation names it, an
  unmeasured metric emits **no** block (plant), a zero-length window emits **no** measurement (plant),
  an attached envelope walks by `session_id` (plant).
- *"measurement · fixture code identity"*: each committed fixture's `code.computeHash` /
  `code.manifestHash` ≡ the shipped `OxyDex.html` — the done-when, literally, and the gate that reds a
  rebuild without a regen.
- The Phase-9 equivalence gate treats `measurement.*.code` as identity (volatile in a headless run),
  scoped to that path only; it still pins every number in the block.
- `tests/build-core-tests.mjs`: the `<html>` stamp is manifestHash-invariant (decoy-tested), present
  on all 9 GATE-A bundles, and byte-equal to what `manifest-gate.js` computes from each artifact.
