<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** IN-PROGRESS — 2026-07-22 (**§1 + §2 shipped (PR #352 / #355); §3 EXECUTED + gated this brief** — foot-anchored gapBeats, validated against paired chest ECG; **§4 PROPOSED** (deferred — the bridged-interval exclusion is not yet exercised by a real gappy segment, so it is not landed).) · **Created:** 2026-07-22 · **Method-parent:** `PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md` · **Data:** `O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`

# O2Ring finger PPG — honest handling of lost time and held samples (the `O2RING-PPG-GAP` charter)

> **What this brief is.** The missing home for the `O2RING-PPG-GAP §N` references that four source files
> already cite (`capture-host/capture.py` §1, `ppgdex-dsp.js` §2/§3, `tests/dex-tests.js`, the synthetic-
> input generator) — a reference this repo pointed at for weeks without the document existing. It records
> the three shipped guards against **fabricated cardiac timing** on the O2Ring finger pleth, the physics
> that separates them, and the paired-ECG validation that settled the one that was in doubt. It also
> parks the un-validated fourth guard (bridged-interval exclusion) with an honest reason.
>
> **The through-line.** A single-channel finger reflectance stream loses time (link dropouts) and carries
> in-band invalid samples (the `156` sentinel). Each failure, handled naively, does not merely *lose* a
> beat — it *invents* one: a hole gets bridged into a doubled interval that `correctRR` median-fills, and
> a held sample lets a beat's timing rest on a value that was never measured. Every guard below exists to
> make a non-measurement **visible** (dropped / excluded) instead of **plausible** (filled). Claims are
> tagged `[CORPUS]` (measured on the real tri-device corpus), `[CODE]` (read from source), `[LIT]`.

## §1 · Honest gaps in capture — insert time, never compress it  *(SHIPPED — PR #352)*
The capture host (`capture-host/capture.py`) writes one PSL-layout `*_PPG.txt` per session. When BLE
frames are lost, the naive writer packs the surviving frames contiguously, **compressing** the missing
wall-clock into zero elapsed time — so a 40 s dropout reads as an instantaneous jump and every later beat
is time-shifted early. §1 inserts an **honest gap**: when the inter-frame arrival exceeds the honest-gap
threshold, real elapsed time is written into the sensor-timestamp column so the hole is a *hole*, not a
seam. `capture-host/tests/test_o2ring_ppg_gap.py` gates it (Python lane). This is the upstream half —
without it, the downstream guards cannot even see where time was lost.

## §2 · Time-discontinuity intervals — never measure across lost time  *(SHIPPED — PR #355)*
`intervalsSpanningTimeGap` (`ppgdex-dsp.js:1028`) marks any foot-to-foot interval whose endpoints
straddle an honest gap: real time passed with no signal, so the difference may span one or more absent
beats and is **not a measurement**. Those intervals are **excluded** from the HRV series (never
corrected to a plausible value), and their count is surfaced as `nGapSpanIntervals` — a night with many
had a lossy link and the reader should know. Fires on nothing without an honest gap; every legacy /
Verity file's grid is contiguous, so the fast path is a no-op there. `[CODE]`

## §3 · Foot-anchored `gapBeats` — a peak sentinel spoils morphology, not timing  *(EXECUTED — this brief)*
### The defect
`gapBeats` (`ppgdex-dsp.js:1064`) drops a beat whenever a rejected (`156`-sentinel) sample lands inside
its guard window. The window was the **whole systolic upstroke** —
`[min(foot,peak)−2, max(foot,peak)+2]`, ~12–25 samples at 125.7 Hz — so a sentinel **anywhere** from the
foot to the peak condemned the beat. Every condemned beat is then a hole that `buildPPI` bridges into a
doubled interval that `correctRR` median-fills. The guard meant to prevent fabrication was **manufacturing
it wholesale**.

### The physics (why the window was wrong)
What actually rests on a held sample is the **timing point**, and for PPI that is the **foot alone**: the
intersecting-tangent foot is built from the diastolic trough and the steepest rise around it, and reads
**nothing** near the systolic peak `[LIT: Charlton 2022 beat-detection benchmark]`. A sentinel by the
peak corrupts **morphology** (systolic amplitude, augmentation index, reflection index — graded
*separately and per-site*, `CLAUDE.md §🎫`) but **cannot move the foot**. Dropping the PPI interval for a
peak-region corruption discards good timing *and* forces a fabricated median-fill — the worst of both.

### The fix
Gate on a tight window about the foot: `[foot−3, foot+3]` (`GAP_FOOT_SPAN = 3`, ~±24 ms — covers the
tangent's own support without reaching the peak). Do **not** widen past ±5 (retention falls off a cliff,
≈77 % at ±10, for no honesty gain). A sentinel is still **rejected from the raw signal** by the isolation
pass (unchanged) — §3 changes only whether a *peak-region* rejection also drops the *interval*.

### Measured effect  `[CORPUS]`
On a real O2Ring **finger** night (2026-07-20, worn on the finger, with a **simultaneous Polar H10 chest
ECG**), over a 63-min overlap:

| | old (foot→peak span) | new (foot-anchored) |
|---|---|---|
| beats condemned by `gapBeats` | **727 / ~3350 (6.9 %)** | **0** |
| `correctRR` fill rate | **34.2 %** | **12 %** |
| finger↔ECG RMSSD error, clean-sleep epochs | up to 10.6 ms | **< 1 ms** |

On **clean deep sleep** the change is a **genuine no-op** — no sentinels to condemn, so the exported HRV
is byte-identical old-vs-new. It bites only on restless/lossy epochs, where it recovers real beats and
halves the median-fill. Per-epoch HRV moved **toward** chest-ECG truth (RMSSD closer in 9/13 clean-ish
epochs; SDNN ~neutral). The residual finger error on *movement* epochs (RMSSD 90–138 ms vs ECG 30–49) is
**foot jitter**, a different fix (`PPGDEX-ALGORITHM-DEEP-DIVE` #1 filtfilt padding / #10 centred TERMA) —
§3 neither helps nor harms it. **Net: safe + accuracy-positive.**

### Gated
- Full node suite green (3677 assertions). The finger-site group now asserts the corrected physics: a
  systolic-peak sentinel is **rejected from the signal but does NOT drop the PPI beat** (`nGapBeats === 0`
  on the twin), and the foot-vs-peak distinction is pinned **directly on `gapBeats`** (now exported):
  a gap at the foot drops the beat, a gap at the peak drops none. A regression to the old wide window
  would drop both and red the group.
- No committed golden moved (`regen-ppgdex-goldens.mjs --check`: 0 moved) — the Verity goldens carry
  `rec.gap === null`, so `gapBeats` is never called on them; the finger twin has a `null` golden
  (property-asserted). PpgDex + both orchestrators re-bundled; GATE A (9/9) + GATE B (12 reproducible)
  PASS; `build.mjs --check` clean across 11 bundles.
- ⚠️ `verifiedUnder` on the corpus-backed `PpgDex_2026-06-27_equiv` fixture expires (a compute-closure
  edit moves `computeHash`) — a release-time re-stamp is owed and `release.mjs` blocks on it. The output
  is provably inert for that Verity input (gap=null), but the gate is a conservative denylist by design.

## §4 · Bridged-interval exclusion  *(PROPOSED — deferred, NOT landed)*
The other half of the stranded WIP (`claude/ppgdex-bridged-intervals`, `a9c03cf`): when `gapBeats` *does*
drop a beat, its two surviving neighbours become adjacent in the array but **not in time**, so the
interval between them silently spans the removed beat and reads ~2× true — a bridge that `correctRR`
median-fills. §4 records those bridges and feeds them into the §2 `cleanMask` so the interval is
**excluded** rather than corrected into a plausible lie.

**Why deferred, not landed with §3.** After §3 the foot-anchored window drops **so few** beats that on
every real segment measured here the bridged path fired **zero times** (`nGapSpanIntervals: 0 → 0`) — so
it is **unexercised by real data** and cannot be validated the way §3 was. Landing an HRV-touching path
with no segment that trips it is exactly the "ship a fourth unsupervised change" the WIP author refused.
**Done-when:** a real gappy finger night on which foot-anchored `gapBeats` still drops ≥1 beat, showing
the bridged interval excluded and HRV unmoved-or-improved vs ECG. Until then it stays PROPOSED; the WIP
branch holds the implementation.

## §5 · Validation method & evidence  `[CORPUS]`
The finger↔ECG comparison that settled §3 is **per-epoch HRV metric agreement**, not cross-modality beat
matching. Beat matching fails by construction — the finger pulse arrives ~250 ms after the ECG R-peak and
that pulse-transit lag varies beat-to-beat, so a fixed tolerance scores ~0.5 sensitivity (the wall the WIP
author hit). Comparing **RMSSD/SDNN per 5-min epoch** instead lets the lag cancel in the differences: on
clean deep sleep the O2Ring finger PPI reproduces chest-ECG HRV within **median 0.3 ms RMSSD / 0.2 ms
SDNN** — `validated`-tier agreement, and the reference the node has lacked through three prior HRV-moving
changes. Real recordings are gitignored (personal biosignal data); the analysis re-runs both code
versions in a co-loaded realm and bins finger `nn`/`tt` + ECG R-peaks onto a shared absolute clock. This
clean-sleep agreement is also the evidence `O2RING-FINGER-HRV-VALIDATION` needs for its emerging→validated
call, pending its ≥10-night replication.

## Done-when
- [x] §1 honest gaps in capture (PR #352, Python gate).
- [x] §2 time-discontinuity interval exclusion (PR #355).
- [x] §3 foot-anchored `gapBeats`, validated vs paired chest ECG; suite green, GATE A/B PASS, re-bundled,
      changeset dropped.
- [ ] §4 bridged-interval exclusion — deferred until a real segment exercises it (WIP branch holds it).
- [ ] release-time `verifiedUnder` re-stamp of the PpgDex corpus fixture (needs the curated corpus).
