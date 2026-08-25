<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-25 — 2026-08-21 · **Created:** 2026-08-21 · **Follows:** `INTEGRATOR-POOLED-CLOCK-APPLY-2026-08-01-BRIEF.md`, `CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md` · **Affects:** `integrator-dsp.js`

# CPAP clock — a step-aware, per-night longitudinal offset model

**One line:** the Integrator already measures and applies a per-night CPAP offset *on nights that carry a
co-recorded reference* (`fitClockOffsetPooled` runs per-fusion). Two things it does NOT do, and both are
the owner's stated requirement: (1) give an offset to a **CPAP-only night** (no reference that night), and
(2) do it **step-aware** — the CPAP clock DRIFTS (crystal) and STEPS (travel / timezone / cloud re-sync;
`#1606`: *"the CPAP clock STEPS by an hour mid-corpus"*), so a single offset can never be smeared across
the corpus. This adds a longitudinal model that fits the drift **within** step-bounded segments and
**refuses** across steps and on unanchored gaps — never fabricating an offset.

## Why (the gap, precisely)

- `UNDISCIPLINED_NODES = { CPAPDex: 'no user-settable clock, no NTP — its offset is permanent and must be
  measured' }` (integrator-dsp.js) — the CPAP clock cannot be *set* (confirmed exhaustively: no BLE
  setter, menu is time-zone only, cloud-dependent, no-firmware). So the only lever is measuring the
  offset and correcting the **data** timebase.
- Per-night fusion already measures it where a reference exists (~−21.9 ± 0.6 min pooled, 19/24 nights).
  But a CPAP-only night gets nothing, and the offset is **not constant**: it drifts over weeks and steps
  on travel. A single pooled number is `#1606`-known-inadequate.

## Design — `fitClockOffsetSegments(nightOffsets, opts)` (pure)

Input: per-night `{ dateMs, offsetSec, confident }` (the measured offsets from fusion; unanchored nights
carry `offsetSec: null`). Output: one record per night — `{ dateMs, offsetSec, source, reason? }` where
`source ∈ measured | interpolated | refused`, plus segment metadata. Pure, deterministic, no Date.now().

1. **Anchors** = confident, non-null offsets, sorted by `dateMs`.
2. **Step detection** — between consecutive anchors the offset should move by ~the local drift rate. A gap
   whose implied rate exceeds `STEP_PPM_MAX` **or** whose jump exceeds `STEP_ABS_SEC` (whichever is the
   clearer signal) is a **step boundary**; segment there. (Travel is an abrupt whole-hour-ish jump; crystal
   drift is a slow ppm — the two populations separate cleanly, and where they don't the night is refused,
   not guessed.)
3. **Per-segment drift fit** — least-squares `offsetSec = a + b·(dateMs)` within each segment; compute
   residual RMS + implied ppm. **Fitting checks:** the segment is usable only if residual ≤ `FIT_RES_SEC`
   AND |ppm| ≤ `FIT_PPM_MAX` AND it has ≥2 anchors. A segment that fails is `refused` wholesale.
4. **Per-night resolution:**
   - anchored night → `measured` (truth wins; the fit never overrides a real measurement).
   - unanchored night **inside** a passed segment (between its first and last anchor) → `interpolated`.
   - unanchored night **outside** all anchors (extrapolation past the freshest / before the earliest),
     or inside a failed/single-anchor segment, or on a step boundary → **`refused`** with the reason.
     Extrapolation is refused on principle (§2.6 / hostAxis "flat outside anchors" — no fabricated offset
     beyond what was measured). Forward capture measures each night, so extrapolation is only ever a gap.

## Done when

- [ ] `fitClockOffsetSegments` in integrator-dsp.js, exported, pure, deterministic.
- [ ] Step detection separates a planted travel-step from crystal drift; interpolates within a segment;
      refuses across the step, on single-anchor segments, and on extrapolation — each with a named reason.
- [ ] A suite group drives it: linear-drift segment (interpolates), a planted step (segments + refuses
      across), an unanchored gap inside a good segment (interpolates), an extrapolation night (refused),
      a failed-fit segment (refused wholesale), truth-wins-on-anchor.
- [ ] Full chain + verify-fixtures green; changeset (bump: minor, type: added, nodes: [Integrator]).

## Deliberately NOT in scope

- **Setting the CPAP clock** — impossible (no setter anywhere), and moot: this corrects the data timebase.
- **BLE data pull** — the encrypted-channel path is separate and unbuilt.
- **Changing the per-fusion apply** — the single-night measurement path is correct and stays; this is the
  *longitudinal* layer that fills unanchored nights and makes cross-night views step-safe.
- **Sub-second** — the CPAP offset is coarse (minutes); this models minutes-scale drift + steps, not the
  sub-second axis the wearables get from `hostAxis`.

## Verification at DONE — 2026-08-25 (coordinator sweep)

`fitClockOffsetSegments` ships in `integrator-dsp.js` (exported, pure) and is driven by its
`tests/dex-tests.js` group (planted-step vs drift separation per the box text); the chain landed
with its changeset in the release history. Checked as a block rather than per-box. Longitudinal
device-clock evidence continues to accrue via the AS11-CLOCK-DISCIPLINE sidecar (#1749), which
supersedes this brief as the living collection mechanism.
