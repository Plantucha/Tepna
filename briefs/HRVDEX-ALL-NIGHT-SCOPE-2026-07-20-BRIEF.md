<!--
  HRVDEX-ALL-NIGHT-SCOPE-2026-07-20-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-20 · **Created:** 2026-07-20

# An all-night recording is not a spot reading — HRVDex now knows the difference

**HRVDex was built for Welltory spot readings** — ~5-minute measurements taken at whatever hour the user
happened to sit down. Feeding it **ECGDex overnight exports** (via the `rowFromNodeExport` bridge whose
own docstring invites "many days in one import") puts a different *measurement unit* through machinery
that assumes the first. Two of its behaviours are then actively wrong, and both are silent.

Surfaced by running the real ECG corpus end-to-end: **50 raw H10 `_ECG.txt` files → ECGDex → 28 nightly
rows → HRVDex**, spanning 2026-06-06 → 07-13.

## Why — the measurement units differ

A spot reading is a **point sample** of the circadian HRV curve, so comparing two of them requires a
time-of-day correction; that is what `d_rmssd_circ`'s `±8 % / −5 %` factors are for, and for spot
readings they are correct.

An overnight recording is an **integral across ~8 h of that same curve**. The circadian confound the
correction removes has already been averaged out by the recording itself, so applying the point-sample
factor does not remove a bias — **it introduces one**. Worse, the factor is selected by a single scalar
(`_date.getUTCHours()`), which for a long recording reflects *when recording began*, not physiology.

**Measured on the corpus:** 27 of 28 nights started in the evening (21:00–23:00) and **one started at
01:06**. The start-hour branch therefore graded that single night `÷1.08` while its 27 otherwise-identical
neighbours got `÷0.95` — a **12.7 % split within one homogeneous set of whole-night recordings.**

The second failure is the view: **"Morning only" (`getUTCHours() < 10`) kept 1 of those 28 nights.** The
control silently empties the screen for exactly the data the bridge was built to import.

## What landed

### 1 · `_spanMin` — the row knows what it is
`_envToSeed` now reads the recording's span from the strongest available evidence and **never guesses**:
`recording.durationMin` → the 5-min `timeseries.epochs` grid → summed `sleep.stageMinutes` (time in bed)
→ `null`. Carried on the row (added to `HRV_SEED_FIELDS`, so it persists and round-trips).

**Unknown span ⇒ NOT all-night.** A row that cannot prove it spans the curve keeps spot-sample treatment,
so **every pre-existing Welltory row behaves exactly as before** — proven below.

### 2 · `_hrvIsAllNight` + the circadian bypass
`ALL_NIGHT_MIN_MIN = 180`. The floor is 3 h: below it a recording no longer spans enough of the curve to
self-average, and it matches the `--min-hours` convention `tools/trio-batch.mjs` already uses for "is this
a night?". An all-night row takes `circAdj = 1.0`; `d_all_night` is published so consumers read *that*
rather than re-deriving from the hour.

### 3 · Measurement scope, not a checkbox
`morningOnly` → a three-way `measScope` select (**All · Morning spot readings · All-night recordings**),
because these are different measurement units rather than two filters over one pool. `morning` now
excludes all-night rows *explicitly* instead of by start-hour accident. The legacy `morningOnly` checkbox
is still honoured when present, so an older embedding keeps working.

### 4 · The morning band no longer judges an all-night row
`hrvdex-render.js` graded LF/HF `good` only inside 0.4–2.5, labelled *"0.5–2.0 optimal"* — a **morning-rest**
reference. The corpus sits at a median LF/HF ≈ 2.0 with many nights 2.4–3.0, so that band would have
flagged nearly every night against a scale that does not apply to sleep.

An all-night row now shows the **value with no verdict** (`neutral`, sub-label *"all-night — morning band
n/a"*). We deliberately did **not** invent an overnight band: there is no citable reference for one, and
`CLAUDE.md` §📚 forbids fabricated authority. **An honest "—" beats a number graded on the wrong scale.**

This required a real fix in the KPI renderer: its colour ternary fell through to `--red`, so an ungraded
value would have painted as the **worst** possible reading — the exact opposite of "not judging this".
`neutral` now renders in ordinary text colour.

## Verification

- **Node suite 3462 assertions / 221 groups green with ZERO skips** under `DEX_UPLOADS=<corpus>`.
- **12 new assertions** lock the contract: identical physiology at 22:00 and 01:00 starts must agree
  (the exact regression); a 5-min spot reading still gets `÷0.95`; unknown span never upgrades a row;
  span falls back to `stageMinutes`.
- **Backward compatibility is proven, not asserted:** `verify-fixtures.mjs` re-ran the real Welltory
  corpus fixtures and their **outputs did not move** — only `verifiedUnder` was re-stamped. Spot rows
  carry `_spanMin: null`, so nothing about their treatment changed.
- **On the real 28 nights:** rows circadian-adjusted **before 28/28 → after 0/28**; spans correctly
  derived 360–485 min; all 28 tagged all-night; the 01:06 night no longer diverges from its neighbours.
- `build.mjs --check` clean across 11 bundles (`HRVDex 7400f0c644ea → e5ffde8cbc6b`; both orchestrators
  inline `hrvdex-dsp.js` and were rebuilt), `build-analysis.mjs --check` and `build-docs.mjs --check`
  clean, `verify-manifest` GATE A + B pass, pinned Biome clean.

## Not in scope (candidate follow-ups)

- **An all-night reference band, properly sourced.** The honest `—` is a placeholder for a citation, not a
  destination. Sleep-HRV norms exist in the literature; adopting one is a `LITERATURE-USE-POLICY` job
  with a real citation, not a guess.
- **Duration-normalised SDNN.** SDNN grows with recording length, so a 3 h night is not comparable to an
  8 h one on that metric even within all-night scope. Today the mode leans on RMSSD, which is far less
  duration-sensitive; a proper fix normalises or refuses the comparison.
- **High overnight HRV is not automatically good** — sleep-disordered breathing inflates SDNN through
  large cyclic swings. An all-night scope that treats "higher = better" inherits that trap; see the
  periodic-breathing question still open in `VIGIL-OBSERVED-ERRORS-2026-07-20-BRIEF.md`.
- **The other `d_*` metrics** (Baevsky SI, ANS Load, PNS Efficiency) carry spot-reading assumptions too
  and were left untouched; only the circadian factor was demonstrably wrong on the corpus.
