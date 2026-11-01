<!--
  EXPORT-SHAPES.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living) · **Created:** 2026-07-04 · last-verified 2026-11-01 · **Origin:** `briefs/SELF-INGEST-FOLLOWUPS-II-2026-07-04-BRIEF.md` F3

# Export shapes per node — the light-vs-rich contract

> **Why this exists.** Every node emits a `schema.name:"ganglior.node-export"` JSON, but **not the same
> shape**. Most nodes emit a **LIGHT** stream (`exportGanglior` → `<node>BuildNodeExport`: recording +
> `ganglior_events[]`, the byte-identical **Integrator fusion** currency) and — for some — a **RICH**
> artifact (`exportSummary` → `buildV2` / an enriched builder: the full derived layer, the **clinical**
> reload target). Confusing the two caused three mis-classifications in the 6-node self-ingest roll-out
> (GlucoDex + HRVDex were assumed rich but shipped light → real enrichment; ECGDex + PpgDex were assumed
> to need enrichment but already had a rich `buildV2` → export-inert). **New nodes (EEGDex/SpiroDex) must
> decide their export shape up front** and fill in a row here — don't ship light then retrofit.

## The two builders

- **LIGHT — `<node>BuildNodeExport`** (in `<node>-dsp.js`, DOM-free, headless `compute()` + the app's
  `exportGanglior` both call it → byte-identical). Carries `recording` (source/contentId/startEpochMs/…)
  + `ganglior_events[]` (+ node aggregates). This is what the **Integrator** consumes; keep it stable.
- **RICH — `buildV2` / `exportSummary`** (in `<node>-app.js`, DOM-adjacent) OR an **enriched** light
  builder. Carries the full clinical derived layer (hrv / quality / glucose / measurements / epochs / …).
  This is the "full AI-readable JSON" a user brings to a doctor, and what `<node>LoadOwnExport` renders.

## Per-node table (verified 2026-07-04)

| Node | Signal | LIGHT `exportGanglior` (`…BuildNodeExport`) | RICH clinical export | Multi-carrier key | `loadOwnExport` reads |
|---|---|---|---|---|---|
| **OxyDex** | SpO₂ | per-night element (`oxyBuildNightElement`) — already rich (`date`, `stats`, `summary`) | same — the `nights[]` export IS the rich artifact | **`nights[]`** | `nights[]` (rich per-night) |
| **CPAPDex** | CPAP EDF | `cpapBuildExport` per night — rich (`metrics`, `oximetry[]`, `quality`) | same — `nights[]` export is rich | **`nights[]`** | `nights[]` (rich per-night) |
| **PulseDex** | RR HRV | `pdBuildNodeExport` — **single-record + already rich** (`recording` + `hrv.{time,frequency,poincare}` + `summary`) | same builder (no separate `buildV2`) | **`recordings[]`** | single obj or `recordings[]` |
| **GlucoDex** | CGM | `glucoBuildNodeExport` — was **LIGHT** → **ENRICHED 2026-07-04** with a `glucose{}` block (mean/GMI/CV/TIR/MODD/ADRR/dawn/daypart) | the enriched ganglior export (+ a separate `exportSummary` AI-readable JSON) | single-record | single obj (`glucose` block) |
| **ECGDex** | ECG | `ecgBuildNodeExport` — **LIGHT** (recording + events; `opts.rich` adds hrv/quality/timeseries, **orchestrate-only**) | **`buildV2`/`exportSummary`** — RICH (recording + `quality` + full `hrv` + `epochs` + `timeseries`) | **`recordings[]`** | rich `buildV2` **or** light — reads whatever's present |
| **HRVDex** | HRV summaries | `hrvBuildNodeExport` — was **LIGHT** (`recording.measurements:N` + events) → **ENRICHED 2026-07-04** with a per-measurement `measurements[]` table | the enriched ganglior export | (ledger; single obj) | single obj (`measurements[]`) |
| **PpgDex** | Wrist PPG | `ppgBuildNodeExport` — **LIGHT** (recording + events; `opts.rich` orchestrate-only) | **`buildV2`/`exportSummary`** — RICH (recording + `hrv{time,frequency,nonlinear}` + `personalization` + `apnea`) | **`sessions[]`** | rich `buildV2` **or** light — reads whatever's present |
| **EEGDex** *(planned)* | EEG | — decide at build time — | — decide at build time — | — | — |

## The `measurement` block — per-instance lineage (additive, MINOR; OxyDex emits it since 2026-09-21, ECGDex and PpgDex since 2026-09-22)

Specified by `MEASUREMENT-PROVENANCE-ROADMAP-2026-08-26` §1 and validated by **`measurement-block.js`**
(`validateMeasurement(block, opts) → {ok, errors[], checked[]}`), which is the schema authority the way
`signal-frame.js` is for the canonical intermediate.

**It is a NEW BLOCK INSIDE `ganglior.node-export`, not a sibling artifact.** The gap it closes, in one
line: Tepna can prove that a BUNDLE produced an EXPORT from an INPUT, byte for byte, years later — and
cannot answer the same question about one number *inside* that export. Provenance is airtight at
ARTIFACT granularity (`manifestHash`, `computeHash`, GATE A/B) and absent at INSTANCE granularity.

**OxyDex is the first emitter (roadmap §3, 2026-09-21).** Every OxyDex night element carries
`measurement: { meanSpo2, t90, odi4, hypoxicBurden }` — one block per headline metric, keyed by registry
id (each block still carries its own `metricId`) — and its `schema.version` is **2.1**. The values are
the element's own numbers (`stats.meanSpo2` / `stats.t90pct` / `odi4.rate` / `hypoxicBurden.rate`);
the block adds lineage and recomputes nothing. `code` is read off the bundle's own `<html
data-manifest-hash data-compute-hash>` stamp (build-time, outside every inline block); a headless
source-module run has none and emits `code: null` + `codeReason`. `evidence.inputHash` is the
recording's `contentId`; `evidence.envelopeRef` is the attached acquisition envelope's `session_id` or
`null` + reason on a CSV. Desat events carry `inputHash` + `evidenceRef` (§2). Walk-through + tool:
`docs/MEASUREMENT-WALKTHROUGH-OXYDEX-2026-09-21.md`, `tools/measurement-walk.mjs`. **ECGDex is the second
emitter (roadmap §12, 2026-09-22):** the export carries a recording-level `measurement: { hr, rmssd, sdnn }`
— the WHOLE-RECORD numbers (`hrv.time.wholeRecordHR/RMSSD/SDNN`, the Integrator's consensus axis), not the
epoch-median display values; `basis: derived` on all three (a statistic over a detected, Malik-corrected beat
train — LEXICON §4b); `sourceChannel: H10:ecg`; `window.spreadMs` is the host axis's measured spread on a box
night (the H10 has a second clock, so this emitter can publish what OxyDex cannot) and null-with-reason on a
phone export; `evidence.envelopeRef` is null with the reason that no acquisition envelope joins the ECG path
yet. Present on BOTH the light and the rich export; `schema.version` 2.1. **PpgDex is the third emitter (roadmap
§12, 2026-09-22):** `measurement: { hr, rmssd }` — the WHOLE-RECORD Pulse HR and rMSSD (`hrv.time.hr/rmssd`;
single-site PPG, so the rich values ARE whole-record), `basis: derived`, `sourceChannel` `O2Ring:ppg` or
`Verity:ppg` from the optical `site` the export already declares, `evidence.envelopeRef` null with the reason
that no envelope joins the PPG path. **The rule the PpgDex row carries (§∅ owner ruling 2026-09-17): a
`clock-seam` refusal ⇒ NO block.** A capture-side sensor-clock resync means the NN train spans two clocks, so
the export carries `measurement: null` and a `measurementReason` that opens with `clock-seam:` and counts the
resyncs — the whole-record numbers are still computed for display, but a number over a discontinuity gets no
lineage claim. Reduced coverage (dropouts, pinned spans) is not a seam and annotates through `quality`.
`window.spreadMs`: PpgDex inlines `clock.js` since 2026-10-29 (CLAUDE.md §✅), so the app, the fixtures and
the fold all build the same host axis and publish the same measured spread. Before that date the bundle
omitted the module, published null with the reason `no DexClock in this bundle`, and a `spreadMs` NUMBER
meant "co-loaded run" (residue `2026-09-22-ppgdex-fixture-spread-not-bundle-reproducible`). The null branch
remains for a realm that loads no `clock.js`.
Emission is still staged per node — the other five do not emit it yet, and a missing block on THEIR exports is
not a defect. **The Integrator consumes it (roadmap §8, 2026-09-21; the generic `adaptEnvelopeNode` too since
2026-09-22, so an ECGDex export's recording-level map is consumed the same way):** `adaptOxyDex` turns each block into a
REF on the rec (`measurements.blocks.<id>` = metricId · value · basis · window · code · evidence join ·
`provenance: resolved | unresolved` + reason) and the fusion export's `nodes[].measurements` carries
those refs forward — never the payload. Absence adds no key (a legacy export fuses byte-identically);
a block whose refs do not resolve (inputHash ≠ the element's contentId, missing code identity, value ≠
the element scalar, non-positive window) is marked `unresolved` loudly and never silently accepted.

**Back-compat:** additive, so **consumers tolerating its absence is the contract**, gated the same way
the `t`-only event tolerance already is. The `schema.version` MINOR bump lands with the FIRST EMITTER,
not with the shape: a version announcing a block no node writes is a claim the artifact does not
honour.

Field rules a reviewer should know without reading the module:

- **`metricId` resolves; it never carries `unit`/`label`/`evidence` inline.** Those are the registry's
  (the metric contract's single source), and the validator REJECTS them inline. An id the registry does
  not resolve is the fabricated-identity failure one layer below `no-fabricated-tier`.
- **`basis` is NOT the evidence ladder.** `measured | derived | estimated` is per-INSTANCE derivation
  kind; the ladder is per-METRIC epistemics. They share the word `measured` and nothing else, which is
  exactly why the validator rejects the ladder's other four values *by name*.
- **`code: {manifestHash, computeHash}` — a hash IS the version.** §📦 forbids a hand-typed version
  string, so the validator accepts only a 12-hex content hash.
- **∅ at every optional field.** `window.spreadMs`, `uncertainty` and `evidence.envelopeRef` are
  `null` **with a reason beside them**, never `0` and never silently absent — "unknown" is a valid
  state, and a `spreadMs: 0` asserts the two clocks agreed exactly, which is a claim nobody made.
- **`window.clockDomain` is named** (`device | host | host-corrected`), never implied.

## `recording.timing` — one shared timing block on every node-export (additive, PATCH; all eight nodes since 2026-10-29)

Specified by `briefs/DEVICE-TIME-HANDLING-2026-10-29-BRIEF.md` U5 and built by **one** function,
`DexExport.timingBlock(opts)` in `dex-export.js`. Every node-export carries it, whatever the node.

**What it replaced.** Three nodes reshaped the `DexClock.hostAxis` verdict by hand, field by field, and a
reshape drops whatever it does not name. `stability` was computed in `clock.js` and vanished one layer
down; `independent` and `spreadMs` were discarded a line after they were measured; `tau0` and `noiseType`
were read back off names the spine never wrote, so both exported as permanent `null`. Each loss cost its
own trace. The other five nodes published no timing provenance at all, so a consumer could not tell
"this input carries one clock" from "nobody looked" — different facts, and only one is a measurement.

**The nine keys, always all nine, in this order.**

| key | type | meaning |
|---|---|---|
| `timingSource` | `'device+host' \| 'host' \| 'device' \| 'device-only' \| 'none'` | which clock(s) set the published axis |
| `independent` | `true \| false \| null` | Clock Contract §7 — was the host column a SECOND clock (`spreadMs > 2 ms`)? |
| `anchors` | int \| null | host↔device anchor pairs the axis was built from |
| `spanMs` | number \| null | the span the `ppm` was measured over — §7 forbids a rate quoted without it |
| `ppm` | number \| null | the smoothed host−device divergence rate |
| `spanPpm` | number \| null | the same ratio BEFORE the running median, so a reader can size what the smoother did |
| `resyncs` | int \| null | device-clock resync steps detected |
| `seams` | int \| null | discontinuities in the PUBLISHED axis |
| `reason` | string \| null | why anything above is `null`; `null` only when nothing is |

**`'device-only'` is not `'device'`.** `'device'` means a host column was present and carried nothing the
device column did not already have (`independent:false` — the whole phone-captured tree). `'device-only'`
means there was no host column to read. A consumer picking clock legs for a three-cornered hat, or sizing
a capture path, has to tell those apart, and the five silent nodes were publishing neither.

**∅ at every field.** A node that does not look for resyncs writes `null`, never `0`: nobody looked is not
none found. A node with no host stamp column writes `timingSource:'device-only'` and `independent:false` —
a measured fact about its input format, not silence — and every number it could not measure stays `null`
beside a `reason` that names the cause.

**The top tier is a claim.** An UNMEASURED drawn verdict routes to `'host'`, never `'device+host'`: that
tier says a real second clock disciplined the recording, and "we never measured whether the device column
is a clock" may not reach it. Under-claiming is the honest failure.

**Why `dex-export.js` and not `clock.js`.** `clock.js` sits in 6 of 8 app bundles since #4105 inlined it
into PpgDex; GlucoDex and CPAPDex still carry none, so `DexClock` is undefined there (CLAUDE.md §✅). A
builder living in the spine therefore needs a hand-written twin in every node without it, which is the
duplication this block exists to end — and the twin would be owed by exactly the two nodes with no host
column, the ones whose block is all absence. `dex-export.js` is inlined in all nine bundles. The block
CONSUMES a `hostAxis` result and never produces one, so it needs the spine no more than
`coverageFromSegments` does.

**Gate.** The suite group `one shared timing block — nine keys, one vocabulary, every node-export` pins the
key set and its ORDER, the closed `timingSource` vocabulary, the ∅ rule, and a source leg asserting all
eight node-export builders reach `DexExport.timingBlock`. A node that goes back to hand-rolling reds there
before a single fixture moves.

## `recording.hostAxis` — the older per-node block, and the one key all three publishers now name (additive, PATCH; 2026-11-01)

`recording.timing` above is the shared block, and it carries no `ok`. `recording.hostAxis` predates it.
Three nodes still publish one: `ppgdex-dsp.js`, `ecgdex-dsp.js` and `motiondex-dsp.js`
(`_mdExportAxis`). Each is a hand-written field list over the same `DexClock.hostAxis` result, so each
drops whatever it does not name — the seam the section above describes.

**Every publisher emits the block only when the gate passed, and two of the three dropped that verdict
until 2026-11-01.** The `if` one line above each field list tests `r.hostAxis.ok`. The PpgDex and ECGDex
lists never named `ok`, so the key read `undefined` over every artifact they wrote. MotionDex's list
names it (`ok: ax.ok === true`). Three publishers shipped two shapes, which is why documenting "the
block's presence IS the verdict" was never the remedy — that contract would describe one publisher and
misdescribe two.

**The harm had two faces, both measured.** Of the 443 node-exports tracked under `uploads/`, 242 carry
the block — PpgDex 180, ECGDex 61, MotionDex 1 — and exactly ONE of those 242 names `ok`: the single
MotionDex artifact. A reader FILTERING on `hostAxis.ok` therefore matched one file and read clean.
`tools/pat-drift-attribution.mjs:126` fails closed (`!hostAxis.ok` → `ppm: null, reason: 'axis
refused'`), so over a PpgDex or ECGDex block it reported a refusal against a good axis.

**The line FORWARDS the gate's value; it never writes a literal `true`.** The value states what the gate
read, so a later change that publishes this block on a REFUSAL travels through the same line. A source
object without the key exports `null` per CLAUDE.md §∅, because unknown is not false. `anchors` beside it
already carries the spine's own `n`.

**Gate.** The suite group `the exported host-axis block names the gate it was built under`
(`dsp · node-export · hostaxis-ok · three-publishers`) builds one real axis through `DexClock.hostAxis`,
asserts its own premises, and holds all three publishers to the same key with the same type. Removing
either forward reds three of its thirteen legs.

## A refused host axis — where its reason travels (2026-11-01)

PpgDex and ECGDex emit `recording.hostAxis` only under a built axis, so a refusal leaves no block there.
**That absence is not the refusal.** The spine's own sentence travels in the DECLARED block instead.
`DexExport.timingBlock` writes `the host axis refused: <ax.reason>` into `recording.timing.reason`
whenever the axis exists and `ok` reads falsy.

Running the real builders over a real refusal — `DexClock.hostAxis` on two anchors, under its floor of
three — all three publishers answer:

    the host axis refused: need ≥3 host anchors, got 2

**The corpus stays silent and the path does not.** Over 455 tracked JSON files declaring the schema, none
carries a refusing axis. None of the 26 `recording.timing` blocks names a refusal either. That population
is the 443 under `uploads/` plus 12 elsewhere. No committed fixture refuses, so nothing exercised the
path — a gap in the FIXTURES rather than in the code. Residue row
`2026-11-01-no-artifact-carries-the-host-axis-refusal-the-spine-published` read that silence as an absent
path, and the measurement says otherwise.

**∅ 2026-09-17, both halves.** A refusal reduces COVERAGE rather than breaking continuity, so the block
ANNOTATES: `anchors`, `ppm` and `spanMs` read `null`, never 0. The sentence also stays distinct from the
one a node with no host column publishes. "The gate refused, here is why" and "there was never a second
clock" are different facts, and a consumer branches on them differently.

**MotionDex differs on purpose.** `_mdExportAxis` gates on the axis EXISTING rather than on `ok`. So that
node publishes `recording.hostAxis` on a refusal too, carrying `ok:false` and the spine's `reason`.

**Gate.** The suite group `a refused host axis names its refusal in the declared timing block`
(`dsp · node-export · hostaxis-refusal · three-publishers`). Deleting `timingBlock`'s refusal clause reds
4 legs across this group and `hostaxis-ok`.

## `recording.hostAxis` — the declared key set, per publisher (2026-11-01)

The block is three hand-written field lists, so its key set is per NODE. These are the declared sets. The
gate reads each one out of its source and holds it to the declaration in both directions.

| key | PpgDex | ECGDex | MotionDex |
|---|---|---|---|
| `anchors` | ✓ | ✓ | ✓ |
| `anchorsDroppedPreResync` | — | — | ✓ |
| `applied` | ✓ | ✓ | ✓ |
| `deviceDrawn` | ✓ | ✓ | ✓ |
| `drawn` | ✓ | — | — |
| `drawnReason` | ✓ | — | — |
| `drawnShare` | ✓ | ✓ | ✓ |
| `independent` | ✓ | ✓ | ✓ |
| `inertReason` | ✓ | — | — |
| `maxStepMs` | ✓ | ✓ | ✓ |
| `note` | — | ✓ | — |
| `ok` | ✓ | ✓ | ✓ |
| `ppm` | ✓ | ✓ | ✓ |
| `ppmUncertainty` | — | ✓ | — |
| `quantizedShare` | ✓ | — | — |
| `rate` | ✓ | — | — |
| `rateApplied` | ✓ | — | — |
| `rateReason` | ✓ | — | — |
| `reason` | — | — | ✓ |
| `resyncs` | — | — | ✓ |
| `spanMs` | ✓ | ✓ | ✓ |
| `spanPpm` | ✓ | ✓ | ✓ |
| `spreadMs` | ✓ | ✓ | ✓ |
| `stability` | ✓ | ✓ | ✓ |
| `stream` | — | — | ✓ |
| `tMsCorrected` | — | ✓ | — |
| `timingSource` | ✓ | ✓ | ✓ |
| `totalMs` | ✓ | — | — |

**Thirteen keys sit in all three publishers.** Each node's own keys name what only that node measures.
PpgDex owns the rate it corrects, so `rate`, `rateApplied` and `rateReason` say what happened to `fs`.
Its `drawn`, `quantizedShare` and `totalMs` carry the §7 provenance lattice. ECGDex spends `ppm` as a
crystal figure, so it measures `ppmUncertainty` and `tMsCorrected`, and `note` holds the sentence its span
gate wrote. MotionDex names the `stream` its axis belongs to, because that node carries several, and
`resyncs` with `anchorsDroppedPreResync` are its seam accounting.

**Why a declaration, and why a closed one.** A consumer meeting an absent key could not tell "this node
does not measure it" from "this artifact predates the key". The committed artifacts show both states: 30
distinct keys appear over the 242 blocks, and 7 PpgDex keys sit in 7 of its 180 artifacts. The reshape
seam has also eaten `applied`, both `stability` names, `independent`, `spreadMs`, `inertReason` and `ok`,
one at a time. A FLOOR gate sees none of that, because a floor cannot red on a key nobody declared.

**Gate.** The suite group `the hand-rolled host-axis block has a declared key set, per publisher`
(`dsp · node-export · hostaxis-keyset · three-publishers`). A planted block proves the key reader first.
Three closed equalities then hold each publisher to its set, and three more name the keys only one node
publishes. Adding one undeclared key to a field list reds it.

## Rules that fall out of this (for a new node / a reviewer)

1. **Decide the clinical export shape up front.** If the node's value is a derived table (HRV rows, glycemic
   summary), the LIGHT stream is NOT a useful clinical reload — either make the light builder rich (GlucoDex/
   HRVDex pattern, **fixture-moving**) or add a `buildV2` rich `exportSummary` (ECGDex/PpgDex pattern).
2. **`loadOwnExport` reads, never recomputes.** It surfaces whatever derived layer the dropped export carries
   (rich or light), provenance/kernel/events **verbatim**, and never calls `GangliorProvenance.stamp()`.
3. **Multi-carrier key is node-specific** — `nights[]` (OxyDex/CPAPDex), `recordings[]` (PulseDex/ECGDex),
   `sessions[]` (PpgDex). Any code that walks per-element blocks (e.g. `dexScrubExport`) must cover **all
   three** — see `SELF-INGEST-FOLLOWUPS-II` F1 (the scrub only walked `nights[]`).
4. **Keep the LIGHT stream byte-identical for the Integrator** unless you deliberately enrich it (then it's
   fixture-moving: regenerate the node's `env.equiv` fixture + re-record).
5. **Never hand-roll `recording.timing`.** Call `DexExport.timingBlock` and pass what your node measured.
   A node that owns a `timingSource` lattice already passes its own value and the builder validates it;
   a node that owns none passes nothing and gets `'device-only'` with a reason, never silence.

6. **A hand-rolled `recording.hostAxis` names `ok`.** The block ships only when the gate passed, so a
   list that omits the key makes every consumer read `undefined` — falsy — over a good axis. Forward the
   gate's own value; never write a literal.
7. **A refusal's reason lives in `recording.timing.reason`.** The absent `recording.hostAxis` block never
   carries it. Pass the raw axis to `DexExport.timingBlock` and let it quote the spine.
8. **A hand-rolled `recording.hostAxis` declares its key set.** Add the key to the declaration in the
   `hostaxis-keyset` group, and say in the table above which nodes measure it.

> Cross-refs: `docs/CROSSNIGHT-ENVELOPE-SPEC.md` (the `crossNight` aggregate header), `CLAUDE.md` §🔒 Clock
> Contract §6 (the export currency), `ARCHITECTURE-PRINCIPLES.md` §8 (adding a new Dex — this table is the
> "what does it export" checklist item).
