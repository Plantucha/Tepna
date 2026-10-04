<!--
  NIGHTLY-CHANGE-DETECTION-2026-10-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** PROPOSED · **Created:** 2026-10-04 ·

# Differentiator — the nightly series gets a change detector (the "derivator", reading two: d/dt across nights)

**SIZED, NOT BUILT.** Owner ruling 2026-10-04 ("should we build derivator?" → "both"). This is the second
reading: the time derivative. Every night is judged on its own (`QC-VERDICT`, `LOSS-VERDICT`, `SOLID-VERDICT`,
the per-night hat), and the trio table re-derives over the whole corpus, but nothing watches the **series** of
nightly figures for the night something changed. Two changes this cycle were found late, by hand:

| change | when it happened | when it was found | by |
|---|---|---|---|
| ring host-axis replay seam, +4170.55 ppm and a 7.37 h `maxStepMs` published for a crystal | night of 2026-09-21 | 2026-10-03, in the 93-night re-fold (#3255) | Heron, re-deriving the corpus |
| Vigil Nights page empty (`KeyError: 'gaps_s'`) | ≤ 2026-09-30 06:00 | 2026-10-03 16:2x, owner screenshot | the owner |
| ring completeness read 98.4–98.5 % every night (polled-snapshot model error, E17) | since the band existed | 2026-09-29, the first SOLID verdict read | Wren |

A detector over the nightly series would have raised the first on the morning of 09-22 (one night's ppm 50×
the corpus p95), the second the first morning the index returned an error object instead of a list, and the
third as "every night, same value, never PASS" — a flat line is a change too.

## 1 · The property

A rig-side tool, **Differentiator** (`tools/differentiator.mjs`), runs after the archive pull and reads **only the published verdict
files** (never raw signal): per night and per device, the band statuses, the per-site σ, the loss fraction and
causes, the QC coverages, the ring `ppm` and `maxStepMs`, the RTC offset/drift once the RTC band exists. It
keeps one tracked series file per figure (append-only, keyed by night) and emits ONE `tepna.verdict/1` per
morning:

- **`PASS`** — no figure crossed its pre-stated change bound last night.
- **`FAIL`** — never. A detector does not convict; it names. The non-PASS status is **`UNKNOWN`** with
  `reason` listing each figure that moved, its bound, and the night it moved from.
- **Bounds are pre-stated from the corpus**, per figure, before the first morning it runs: a level bound
  (|x − median₉₀| > k·MAD₉₀) and a run bound (the same value N nights running where the figure is expected
  to vary — the E17 shape). `k` and `N` are written here when the corpus is read, with the distribution quoted,
  and are not tuned afterwards; a figure whose corpus MAD is 0 (it never varied) reports `NOT_APPLICABLE` for
  the level bound and keeps the run bound.
- **∅ rule:** a night with no verdict file (unsettled, as 2026-10-02 was for 12 h) is a point of *unknown*,
  not a gap to skip and not a zero; three unknown nights running is itself a named change ("the box has not
  judged a night since …").
- One line per moved figure goes to the morning report; nothing is filed automatically — a bird reads it.

## 2 · What it reads first (the adoption set)

| figure | source file | shape to catch |
|---|---|---|
| ring `ppm` and `maxStepMs` per segment | `PpgDex` export / fold record | the 09-21 step: a level jump 50× p95 |
| per-device band status, SOLID | `SOLID-VERDICT.json` | the same band failing N nights running; a device flipping PASS↔UNKNOWN |
| `worn_not_recorded_fraction` + `top_cause` | `LOSS-VERDICT.json` | a cause appearing that never appeared; the fraction trending toward the bar |
| QC coverage per stream | `QC-VERDICT.json` | a stream stepping down and staying down (a strap, a firmware, a BLE change) |
| nights-index health | `/api/nights` reachable via the pull's copy | an error object where a list should be — the 09-30 blank page |
| RTC offset at every read, drift | `*_RTCLOG.csv` summary (RTC band, pending) | a reset (0 in 620 files so far — the first one is the point) |

## 3 · Cost

- Reader + series files + one verdict: one unit (Osprey's analysis lane, or Wren's measurement lane since it
  consumes box verdicts). No DSP, no bundle, no fixture moves. Rig timer after `tepna-archive-pull.timer`,
  owner-enabled like the tier.
- Bounds derivation: half a unit — the 90-night corpus is already mirrored; the RTC derivation Magpie did on
  2026-10-04 (620 files → p50/p95/p99, cadence, resets) is the template.
- The morning-report line: the fleet already reads the SOLID verdict each morning; this adds one paragraph.

## 4 · What this is not

- Not a verdict on the night; the night's own verdicts stay authoritative. This is a verdict on the *series*.
- Not anomaly detection over signals; it never opens a raw file. Signal-level steps belong to the Clock
  Contract and the seam sidecars.
- Not an alert that acts. It names; the bird and the owner decide.

## 5 · Done when

- [ ] Series files exist for the §2 figures over the mirrored corpus, with each figure's bounds written here
  with the distribution they came from.
- [ ] The tool emits one verdict per morning and the 09-21 night, replayed, reads as the change it was.
- [ ] One real change caught the morning after it happened — cited here with the figure and the bound.
- [ ] Timer installed (repo-tracked unit, owner-enabled); `TOOLS-INDEX` row.

Companion: `VERDICT-CONTRIBUTIONS-2026-10-04-BRIEF.md` — **Attribution**, reading one (a fused figure says which input it is made of).

**Name (owner, 2026-10-04):** Integrator ↔ **Differentiator** — the mathematical inverse, chosen over "derivator" so the pair reads
as one idea; the owner's word is kept here for search.
