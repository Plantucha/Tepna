<!--
  INTEGRATOR-GAP-AWARE-OVERLAP-2026-07-27-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-28 · **Created:** 2026-07-27 · **Found-by:** the 11-night capture-host corpus fold (2026-07-16 … 07-26) · **Builds-on:** `DEEP-AUDIT-III-2026-07-26-BRIEF.md` §6.2 (`recording.coverage` + `segmentsOverlap`, landed `986d17e`) · **Relates:** `NODE-EXPORT-DURATION-SEMANTICS-2026-07-27-BRIEF.md` (the `durSec`/`endEpochMs` ruling), `CAPTURE-HOST-INTEGRATOR-FOLD-2026-07-24-BRIEF.md`

# The coverage contract exists. Nothing emits it — and the capture nodes are the sparse ones.

> **What changed under this brief.** It was drafted arguing the Integrator needed a coverage model.
> Between drafting and landing, `986d17e` **shipped one** — `recording.coverage.{kind,segments,recordedSec,spanSec}`
> plus `segmentsOverlap`. That is the right mechanism and this brief no longer proposes it. What survives
> is sharper and narrower: **no node emits the block**, the mechanism is wired to a *boolean* rather than
> to the published *quantities*, and the assumption written into the code — "null for every node that
> records continuously, **which is all of them today**" — is **false for the three capture nodes**, which
> is precisely where it costs a published number.

---

## 1 · What already landed (do not rebuild it)

`986d17e` (DEEP-AUDIT-III §6.2) added, for the HRVDex 29-day-spot-measurement case:

```
recording.coverage = { kind: "continuous"|"sparse", spanSec, segments:[{startMs,durSec}], recordedSec, nWithDuration, n }
```

- `recCoverageSegments(r)` / `segmentsOverlap(a,b)` in `integrator-dsp.js`;
- `normalizeFile` carries `coverage` through (`coverage: (json.recording && json.recording.coverage) || null`);
- sparse coverage **extends the envelope** so a spot-measurement record stops being a point;
- `spanSec` (envelope) and `recordedSec` (coverage) are deliberately separate so neither reads as the other.

That is option (a) of this brief's original §4, built. The remaining findings are about its **reach**.

## 2 · Finding A — the capture nodes are sparse, and the code assumes they are not

`integrator-dsp.js` §6.2 comment: *"Null for every node that records continuously, which is all of them today."*

On the real capture-host corpus that is not true. A BLE link drops and the daemon opens a **new segment**;
one night routinely spans **24–47 segments per stream**:

| night | H10 ECG segments | Verity PPG | O2Ring |
|-------|------------------|------------|--------|
| 2026-07-26 | 3 | 24 | 7 |
| 2026-07-23 | 3 | 24 | — |

`ecgdex-dsp.js` and `ppgdex-dsp.js` contain **zero** occurrences of `coverage:`. So the block that exists
for HRVDex's benefit is not emitted by the three nodes whose recordings actually have holes in them.

## 3 · Finding B — the mechanism gates a boolean, not the published quantities

`segmentsOverlap` is consulted in exactly one place — `_mayOverlap(a,b)`, which answers *did these two
overlap at all*. Every **quantity** still comes from the envelope:

- `recWindow(r)` still returns a single `[t0Ms, endMs]` interval;
- `overlapInterval(a,b)` intersects those pairs;
- `totHrs` sums merged envelope intervals → **`apnea.overlapHours`** → **`confirmedAHI = nConf / totHrs`**, and the Poisson null model's chance expectation.

So even a node that *did* declare sparse coverage would still be divided by envelope hours.

## 4 · The measured cost

`tools/trio-batch.mjs` computes the honest figure — it intersects the three nodes' **actual session
interval sets** (`ivIntersect(mergeIv(ecg), mergeIv(ppg))`) and prints it:

| night | trio-batch three-way (gap-aware) | Integrator `apnea.overlapHours` | ratio |
|-------|----------------------------------|----------------------------------|-------|
| **2026-07-23** | **2.1 h** | **6.86 h** | **3.3×** |

2026-07-23 is the corpus's most fragmented night **and the only one of eleven marked
`confirmedAHIReportable: true`** (`confirmedAHI 0.29`). On the gap-aware 2.1 h the same 2 confirmed
events are **0.95/h**.

The error does not simply run conservative: an inflated denominator **understates** `confirmedAHI`, while
the same coverage **raises** the Poisson chance expectation, pushing toward withholding. The two do not
cancel and the net sign is night-dependent — so the reportability verdict rests on a coverage figure
wrong by an unbounded factor.

## 5 · Why no gate saw it

- **GATE B is static** — it pins bytes, and the bytes are self-consistent. A wrong denominator reproduces perfectly.
- **The equiv/GATE-C fixtures are single-recording and gapless**, so the envelope *is* the coverage there.
- **The synthetic fusion tests build contiguous windows by hand** — they *encode* the assumption rather than test it.
- §6.2's own tests exercise the **sparse-spot-measurement** shape (HRVDex), not the **fragmented-continuous** shape (a night of BLE reconnects), so they do not reach this.

Per `CLAUDE.md` §🔒, the fix must ship an **adversarial committed fixture with holes** — a committed twin
beats a real one because CI re-runs it from committed bytes.

## 6 · Done when

- [x] **PART 2, LANDED 2026-07-28.** ECGDex / PpgDex / OxyDex emit `recording.coverage` with
      `kind:"sparse"` and real `segments`. Each derives them from evidence it was ALREADY computing and
      discarding: ECGDex from the dropouts `parseECGText` records (now carrying both edges of each in
      the file's own ms column, `atRelMs`/`endRelMs`), PpgDex from the `relSec` jumps
      `intervalsSpanningTimeGap` already drops intervals across (same `TIME_GAP_STEPS`, deliberately —
      two constants would eventually disagree), OxyDex from the row stamps `computeDataGaps` already
      counts (same threshold, now named `GAP_STEP_SEC`). Assembly is single-sourced in
      `DexExport.coverageFromSegments`; only the derivation is node-local.
      **The block is ABSENT, not null, on a contiguous recording** — a node with no hole makes no
      coverage claim, the Integrator falls back to the envelope (which then IS the coverage), and every
      committed fixture's bytes are untouched. Verified: the fleet re-bundle moved no export.
      **The shape that actually costs a number is the MERGED one.** Each capture file is internally
      clean — the holes are BETWEEN files — and `tools/trio-batch.mjs` folds a night's sessions into one
      rec, carrying the off-link silence as a `gaps` entry with no ms column. That path is pinned
      separately, because a sample INDEX is data time: reading `idx/fs` as a clock position under-states
      every boundary by the accumulated silence (mutation-checked — the naive read loses a segment).
      Measured on the real 2026-07-23 fold: 6 sessions, **6.71 h recorded inside a 23.02 h envelope**,
      the recorded sum agreeing exactly with the parser's independent `n/fs`.
- [x] **LANDED 2026-07-28 (part 1 of 2).** `totHrs` / `apnea.overlapHours` / `confirmedAHI` / the
      null-model expectation are computed on **recorded** time when coverage is declared, falling back to
      the envelope when it is not. New `overlapIntervals(a,b)` — the quantity-bearing sibling of
      `segmentsOverlap`, returning every intersected RECORDED interval — replaces the single
      `overlapInterval` push inside `_desatUnion`, so the merged union, `inUnion`, `totHrs`, the Poisson
      expectation and the index all become gap-aware at one seam.
      Back-compat is **by construction**: with neither side declaring segments it delegates to
      `overlapInterval` and returns exactly the old interval. Verified two ways — an explicit
      absent-coverage pin (identical `overlapHours` and `confirmedAHI`), and GATE B still reporting 25/25
      fixtures reproducible after the re-bundle.
      Demonstrated on a synthetic 2 h-of-8 h coverage: same confirmed events, `overlapHours` 8 → 2,
      `confirmedAHI` 2.5 → 10.0. Mutation-checked (reverting the union to envelope-only fails 2;
      ignoring declared segments fails 4).
- [x] The fusion export publishes the coverage it used — `apnea.overlapCoverage`
      `{ basis, recordedHours, envelopeHours, recordedFrac, segments, declaredBy }`. `overlapHours`
      alone cannot be audited: 2.1 and 6.86 look equally reasonable, and the difference between them
      decided a reportability verdict. `basis:'envelope'` means nobody declared coverage, and the two
      hour figures are then equal by construction — itself the honest statement. `declaredBy` names the
      nodes, so the claim is attributable rather than anonymous.
- [x] **Adversarial committed fixture** — `uploads/synthetic_ecgdex_h10_gapped.txt` (three ~6.7 s
      recorded segments inside a 60 s envelope, a 3× ratio) + `synthetic_ecgdex_gapped_golden.node-export.json`,
      minted through `tools/regen-ecgdex-goldens.mjs` and registered in `provenance/ECGDex.json`. It runs
      as a full equiv/GATE-C leg (`env.equiv.ecgdex_gapped`, wired in BOTH runners via the `_gapped`
      suffix). **A COMMITTED twin, not the real night, deliberately** (CLAUDE.md §🔒): the real
      fragmented recording is gitignored, so CI would be exactly as blind to a regression as it was to
      the original defect. **Verified RED**: suppressing the emitter reds 10 assertions INCLUDING the
      committed equiv leg, which needs no corpus.
      *(Scope note: the fixture is single-node. The three-node case is covered by the fusion group's
      two fragmented nodes sharing one recorded hour of a 7 h envelope — a committed three-node golden
      would pin the Integrator's whole output tree, which is a fixture this brief did not need.)*
- [x] Absent coverage ⇒ byte-identical results to today. Pinned three ways: the key is ABSENT (not
      null) from a clean export; `basis:'envelope'` runs return the pre-existing `overlapHours` and
      `confirmedAHI` exactly; and the full fleet re-bundle re-stamped **zero** fixture outputs.
- [x] Gates: `run-tests.mjs` green both lanes (4166 + 12 corpus skips in CI mode; **4194** with the real
      corpus) · `build.mjs --check` clean (11 owned) · `verify-manifest.mjs` GATE A 9/9 + GATE B 13
      reproducible · `tools/build-analysis.mjs` + `tools/build-docs.mjs` re-run (worker blobs + served
      docs carry the DSPs too). `computeHash` moved fleet-wide (`dex-export.js` is inlined into every
      bundle), so all 14 corpus-backed fixtures were re-verified under the real corpus. The
      `integrator_fusion_*` fixtures are `historical:true` and were left alone.
- [x] Changeset `bump: minor` — `changes/2026-07-28-coverage-emitters.md`, saying in those words that
      **published AHI values will move on fragmented nights**.

## 7 · What this brief does NOT claim

The 2026-07-23 reportable finding is **not** shown to be false — 2 confirmed desat⟷surge matches happened,
and on the honest denominator the index is *higher*, not lower. What is wrong is the number published
next to it, and that the reportability decision was made against a coverage figure 3.3× the truth. No
other night in the corpus was reportable, so no published index outside 2026-07-23 changes.
