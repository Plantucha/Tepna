<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-10-18 · **Created:** 2026-10-13 · **Follows:** `TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md`

# The hat's reference check: which nights, which clock, and how the card stays current

**One line.** The trio page's validation note quotes one frozen run over 37 nights from 2026-09-26.
This brief makes the check name its nights, report three populations, and measure what the uncorrected
device clocks cost.

## 1 · What is already measured and must not be re-measured

- `tools/tch-firmware-reference.mjs` scores a night against beats that two independent R-peak detectors
  agree on: ECGDex Pan–Tompkins and the H10 firmware RR.
- The published record is `analysis/published-numbers/tch-firmware-reference-2026-09-26.json`. It
  scored 37 of 38 eligible box nights. The status is FAIL: 53 of 74 optical night-corners sit inside
  the ±0.3 bpm or ±30 % band, against a threshold of 80 %.
- Its pooled figures are in this table.

| corner | hat σ̂ (bpm) | reference σ (bpm) |
|---|---|---|
| H10 | 0.97 | 0.81 |
| Verity | 0.41 | 0.73 |
| O2Ring | 1.46 | 1.71 |

- The Verity–O2Ring error correlation is ρ ≈ 0.32. The classic hat assumes ρ = 0, which explains the
  direction of both optical misreads.
- `TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS-2026-08-04-BRIEF.md` (DONE) showed that the correlated
  solve needs ρ as an input. Without a reference, nobody can measure ρ. This brief does not reopen it.
- `tepna-tchref-nightly.timer` runs the same tool every night from 2026-10-13 15:32. It writes its
  verdict outside the repo and changes no surface.

## 2 · The four defects this brief answers

1. **The card names no population.** `sensor-trio-night.js:508-511` hard-codes "37 nights". The text
   does not say which nights or which dates, and it never updates.
2. **The card mixes two populations.** The hero values are one night. The note under them is 37 other
   nights. The card says neither.
3. **The device clocks are not rate-corrected at the join.** The tool re-aligns firmware beats to ECG
   beats every 600 beats by coincidence lag. The join of the reference with the Verity and the O2Ring
   corners uses whole wall-clock seconds. `sensor-trio-worker.js` calls no `DexClock.hostAxis`. Nobody
   has measured what this costs.

   **Correction, 2026-10-18 (Osprey), from the source rather than from this brief.** The second
   sentence above is true and the inference drawn from it is not. `sensor-trio-worker.js` indeed calls
   no `DexClock.hostAxis`, because the DSPs own that call: ECGDex's `tMsAt` adds `correctionAt` to the
   device counter (`ecgdex-dsp.js:5610`) and PpgDex builds `relSec` the same way (`ppgdex-dsp.js:1268`).
   The tool loads `clock.js` into its realm, so **every corner is already host-disciplined today** —
   `--axis host` is the status quo, and `--axis wall` is §3's counterfactual leg, which suppresses
   `hostAxis` so each parser takes its own documented refusal path and keeps the raw device counter
   (Clock Contract §7: a node never hand-rolls a rate).

   **And the join is not where the mismatch sits.** `analyze` builds its beat clock from
   `rec.devMsAt` — the **raw** device counter, with no `correctionAt` (`ecgdex-dsp.js:2824-2831`) —
   while the H10 corner's HR series rides `tMsAt`, which carries the correction. So under `--axis host`
   the reference and the corner it comes from sit on two axes that diverge by the correction over a
   night, and the H10's apparent error against its own reference carries that divergence. Putting the
   reference on `tMsAt` is a change to the estimator's inputs and is **out of scope here** (§7); it is
   logged as residue, and §6's paired drift result covers both axes until the owner settles that.
4. **Night quality is not a variable.** The 37 nights include nights that the SOLID-NIGHT verdict
   later failed on continuity or timebase.

## 3 · The measurement

Run the tool once per night over every eligible box night. Report three populations.

| population | role | expected n |
|---|---|---|
| all eligible nights | the headline on the card | 40 or more |
| rolling last 30 eligible nights | a trend, never the headline | 30 |
| solid nights only (`SOLID-VERDICT.json` status PASS) | a stratum beside the headline | 6 to 10 |

- Each population carries its night count and its first and last date.
- The solid list comes from the box's per-night `SOLID-VERDICT.json`. Read it read-only.
- A night with no verdict file is outside the solid stratum. It is not a failed night.

Run every night twice: with the current whole-second join, and with each device on the host-disciplined
axis (`DexClock.hostAxis` → `correctionAt()`, Clock Contract §7). The difference per night is the drift
effect. It is a paired comparison over the same nights, so it needs fewer nights than a split.

## 4 · Criteria, stated before any run

| question | criterion | direction |
|---|---|---|
| does the drift matter? | median paired \|Δσ\| per corner | material when > 0.05 bpm |
| does night quality explain the misread? | solid-stratum bias vs all-nights bias | same sign and inside the all-nights CI ⇒ the estimator, not the nights |
| has the behaviour changed? | rolling-30 σ outside the all-nights 95 % CI | change point when this holds on 7 consecutive nights |

- The solid stratum will most likely read UNDERPOWERED. Report it with its n and a bound. Do not call it a
  FAIL.
- At a change point, split the nights at that date and report the two periods. Do not average over the
  change.
- Nobody adjusts a threshold after the first run. A threshold that the data moves is `UNKNOWN`.

## 5 · What changes in code (after 2026-10-17)

1. `tools/tch-firmware-reference.mjs` gains a `--axis host|wall` option and a `--solid <list>` option.
   It emits one `tepna.verdict/1` per population. — **BUILT 2026-10-18.** `--axis host|wall`,
   `--solid auto|<file>|<list>`, an axis-keyed night ledger (a legacy row with no axis reads as
   `host`), and one verdict per population: the all-nights object stays at the top level of `--json`
   under the gate name `tch-firmware-reference`, so `tepna-tchref-nightly.service` is unaffected, with
   `tch-firmware-reference:rolling30` and `tch-firmware-reference:solid` beside it in `verdicts`. Each
   night also reports, per corner, whether a second clock existed (`independent`) and whether the axis
   refused — never a near-zero ppm read as agreement.
2. A new published-number record replaces the 2026-09-26 one. It holds pooled figures only, with the
   night count and the date range. The owner ruled on 2026-09-24 that per-night rows stay off the public
   repo.
3. `sensor-trio-night.js` reads the note from that record and stops hard-coding it. The note names its
   population ("N nights, first → last"). The hero names its night.
4. The rolling-30 trend goes to the board, not to the card.

## 6 · Acceptance

- Three verdict objects, one per population, each with `population.checked`, the date range and
  `evidence`.
- One paired drift result per corner, judged against the §4 threshold.
- The card names both of its populations, and no number on it is hard-coded.
- `npm run check` passes. The tool's selftest covers both axis modes.

## 7 · Out of scope

- A correlated hat that uses the measured ρ. That stays with the knife-edge brief.
- Any change to the hat estimator itself. The owner settled D7 on 2026-10-12 (option A).
- Publishing per-night values.
