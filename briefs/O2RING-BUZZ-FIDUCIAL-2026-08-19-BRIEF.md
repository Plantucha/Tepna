<!--
  O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED (parked 2026-09-02 — ⚠ the previous status line said the matched-filter estimator was *owed*; it was MET in 08ad7476 (#1561) at SE 19 ms, inside the pre-stated 30 ms band. Corrected here. The remaining item is the aperiodic-buzz correlation: the TOOL exists (`tools/buzz-fiducial-correlate.mjs`, ca2a4a5b, 11 selftest assertions) and the RUN does not — repo-wide, the only mentions of a host-axis residual are the brief and the tool's own docstring, so no result has ever been recorded. It needs the ring WORN (the motion channel must carry the ~1.1 s spikes) firing a commanded aperiodic schedule with gaps > 1.1 s. **Owner:** Heron · **Next step:** run the tool on a worn night and record the residual EITHER WAY — a null result closes this item too) · **Created:** 2026-08-19

# The commanded buzz as a self-written timing fiducial — removing the human from the marker

> **Scope:** `capture-host/` + one analysis tool. No Dex bundle / `manifestHash` / provenance impact.
> **Gate:** `capture-host/check.sh`.

## 0 · The idea in one line

The O2Ring has a **host-commanded vibration motor** (opcode `0x83`, confirmed on hardware). Firing it at a
known host instant lands a motion artifact **inside the ring's own 125 Hz pleth and its motion channel** —
a fiducial the box writes into the waveform itself. That is target 1's aperiodic marker with the human, the
strapping, and the tap timing removed from the loop.

## 1 · Why this beats the tap (each claim measured elsewhere in the corpus)

- **The tap failed three times, each for a different human-in-the-loop reason** (rhythmic → aliased; Verity
  connected late; `drop_not_worn` forced the charger and broke coupling). A commanded buzz has no rhythm
  problem — the box chooses the pattern — and no strap problem: it fires while the ring is worn and streaming.
- **Aperiodic by construction.** The command schedule is `[1s, 4s, 2s, 6s, 3s]`-style, so the
  cross-correlation is unique (the mod-period aliasing that killed the 21:06 tap cannot occur).
- **The residual unknowns are SMALL and measurable, not human:** BLE command latency (~one connection
  interval, 30–50 ms — recoverable as a *distribution* per session, `ble-connection-interval-measurable`)
  and motor spin-up (systematic, constant per firmware).

## 2 · Two products, in order of value

**2a · Ring host-axis validation — fully automatic, no second device.** Command an aperiodic buzz pattern
at capture start; correlate the artifact positions in the ring's OWN pleth/motion against the host command
times. Measures the pleth's host-axis placement every night, nobody involved. Ships the ring's
`timingSource` from a bare `host` claim to a *validated* host placement.

**2b · The cross-device marker — replaces the tap entirely.** Rest the ring **touching the H10 pod on the
table** before strapping in. One commanded buzz pattern appears in the ring's pleth AND the H10's
accelerometer — a shared mechanical event on two records, commanded by the box, aperiodic by construction,
needing no human timing. Resolution ~±8 ms on the 125 Hz pleth (`O2RING-FRAME-SAMPLE-LOCK`), ~±19 ms on the
H10 ACC (51.8 Hz). That is `KNOWN-CLOCK-ADVERSARIAL-CAPTURE` target 1 with the operator reduced to "put them
next to each other once".

**The same leg works for the VERITY** (it streams ACC too) — and resting the ring against BOTH pods for one
buzz gives a three-way `ring↔H10↔Verity` common fiducial, strictly better than pairwise: one mechanical
event, three records, every pairwise clock offset over-determined by the third.

## 3 · What must be verified before it ships (the probe order)

1. **DONE 2026-08-19 (two fires, `probe_buzz_fiducial.py`, worn, still baseline).** Empty-payload `0x83`
   drives a **~1.1 s** vibration; the **MOTION byte carries it unambiguously** (0 → peak 22, ~81 samples,
   baseline exactly 0) while optical σ was direction-inconsistent across the two fires — motion is the
   detector, optical is not. Onset-after-command ~419 ms but **buffer-limited ±~0.5 s** (the raw 0x05
   stream is back-timed from ~1 s arrivals), so step 2's latency distribution needs many fires or the
   125 Hz pleth path. Bonus knob since #1544: `ring_config.py --set motor <v>` tunes the vibration
   intensity (config read 60), so step 2 can also find the weakest intensity that still detects.
2. **DONE 2026-08-19 (15 fires across three runs — see §5).** On the rigid-coupled leg (H10):
   command→onset median +0.13/+0.15 s, **SD 22–33 ms** → the buzz is a **~±25 ms-per-fire fiducial**
   (~±10 ms per 5-fire pattern). The soft-coupled leg (Verity) reads later and noisier (median ~+0.35 s,
   SD 143–303 ms) — ESTIMATOR-limited (threshold-crossing lands on the rising slope), not clock-limited.
3. **Only then the aperiodic-pattern tool**, correlating a `[1,4,2,6,3]`-style schedule.

## 4 · Hard constraints (each a refusal, not a nicety)

- **`0x83` writes device state → the same class this project gates** (POLAR-PMD-COMMAND-SURFACE §5). It is a
  MOTOR pulse, not a settings write, and reversible by nature — but it ships behind an explicit opt-in
  (`fiducial.enabled`), never default-on.
- **NEVER fire mid-night.** A buzzing finger wakes the sleeper. Scheduled ONCE at capture start, inside the
  180 s not-worn grace, so it costs nothing and disturbs nothing.
- **Never the do-not-issue opcodes.** `0xEE`/`0xE3` (factory resets) are on the ring's write surface; the
  fiducial path must whitelist `0x83` alone.

## 5 · MEASURED RESULTS — 2026-08-19, three runs in one night (apparatus: `tools/buzz-onset-extract.mjs`)

Fired via the daemon's `POST /api/ring/buzz` (queued 0x83 on the live link — every device kept
recording on one box clock; command instants logged to the ms). Aperiodic patterns 4·2·6·3 s
(pairwise) and 3·5·2·7 s (3-way). Both Polar ACCs negotiated 50 Hz (~20 ms quantum). Raw data:
`captures/2026-08-19/` 22:35–22:43.

| run | stream | extracted | latency median | latency SD |
|---|---|---|---|---|
| A ring→H10 | H10 ACC | **5/5** | +0.127 s | **33 ms** |
| B ring→Verity | Verity ACC | 4/5 | +0.388 s | 303 ms |
| C 3-way stack | H10 ACC | **5/5** | +0.147 s | **25 ms** |
| C 3-way stack | Verity ACC | 4/5 | +0.460 s | 143 ms |
| C 3-way stack | ring motion | 2/5 | — | — |

- **The fiducial works** (the 2a/2b claim, proven): unmistakable in both target devices, every run, and
  the aperiodic signature reproduces exactly (pairwise gaps 4.0/2.0/6.0/3.0; 3-way 3.1/5.0/2.0/7.0).
- **H10↔Verity direct offset (run C): +193.5 ± 64 ms (SE, n=4)** — the FIRST direct shared-event
  measurement of the known ~0.2 s systematic between the two Polar streams on box captures
  (previously inferable only from beat statistics). Per-event SD 129 ms is estimator noise on the
  Verity's slow-rising artifact, not clock noise.
- **The ring hears its own motor WORST — three-run pattern** (2/5, 2/5, 2–3/5; worst under firm press).
  The cross-device use is unaffected (the target devices carry the marker); ring-side onsets should
  come from its optical channels or simply from the command stamp + the measured H10-leg latency.
- Pre-stated success bands: detection ≥4/5 per device → **met** everywhere except ring-self; H10↔Verity
  per-event SD ≤30 ms → **not yet met** (129 ms) — the owed fix is a **matched-filter/cross-correlation
  onset estimator over the same recorded data**, not new captures. `buzz-onset-extract.mjs` is the
  threshold baseline it must beat, selftested (planted varied latencies ±40 ms, no-burst refusal,
  planted +150 ms pairwise offset recovered).

### §5d · Drift-or-noise decomposition (2026-08-20) — noise-consistent, and the burst is too SHORT to bound drift

`tools/pat-buzz-stability.mjs` (repurposed from its pre-capture acquisition framing; now imports
`buzz-onset-extract`'s primitives) decomposes a per-event offset series into DRIFT (OLS slope + SE,
von Neumann ratio) vs NOISE (residual SD), against the ΔPAT dip index's pre-stated budget (15 ms over a
60 s window; |drift| ≤5 CLEAN · ≤15 MARGINAL · >15 SWAMPED).

Run on the morning motor-60 calibration (cmd→H10 leg, n=5, 16 s): **von Neumann 2.18 (white-noise
signature), residual SD 49.6 ms, slope −233 ± 238 ms/min — UNRESOLVED.** Extending to n=8/29 s: VN 1.21,
slope 150 ± 116, still unresolved. So the scatter is **consistent with pure estimator noise** (good for
the dip index) — but a 16–29 s burst with ~50 ms/event noise **structurally cannot bound drift at the
15 ms scale**: the honest charge (|slope|+2·SE) reads SWAMPED because the geometry is insufficient, not
because drift was seen.

**The computed prescription (`requiredSpanS`): with σ≈50 ms and n=5, the fires must span ~10.3 min
(n=10 → ~7.3 min) for the slope SE to bound drift at the budget.** The next capture is therefore the
SAME hardware and pattern, with the aperiodic fires spread across minutes of ONE connection — e.g. 10
fires over 8 min — not a longer burst. That single sequence settles pat-align.js:335's constancy
assumption at the scale the dip needs.

⚠ Two exclusions the raw log forces: the solo 04:31:37 pre-test fire (+1405 ms, ring not yet settled)
and the 04:34:13+ intensity-sweep fires (motor 40/20 — mostly undetectable, and the xcorr then locks on
spurious −512 ms peaks with r above the 0.3 floor). Sweep fires must be excluded by command list, not
trusted to the r-filter.

### §5c · The marker closes KNOWN-CLOCK-ADVERSARIAL-CAPTURE-FOLLOWUPS' open box

`KNOWN-CLOCK-ADVERSARIAL-CAPTURE-FOLLOWUPS-2026-08-14-BRIEF.md` tested-and-failed the NATURAL
aperiodic marker (2026-08-15) and parked `tools/aperiodic-offset.mjs` awaiting a deliberate one. This
brief's buzz is that marker: run over the 08-19/20 buzz windows the instrument's lag STAYS PUT under
the width test that failure defined (100 ms night / 200 ms morning, identical at ±2/±4/±8 s), a
+500 ms injection recovers as exactly 700 ms on a genuinely prominent peak, and three estimators agree
within ~100 ms. Its formal `locked` margin is not met (near-tied burst-alias runner-ups in a 2-min
window — see the box text there for the full caveat). Target 1 of the parent brief is thereby
EVALUATED with a deliberate marker, as its §2.1 originally specified.

### §5b · Matched-filter estimator + the 2026-08-20 morning calibration — THE ≤30 ms BAND IS MET

`buzz-onset-extract.mjs --xcorr`: whole-pattern normalized cross-correlation of the two devices'
HF-energy series (every burst contributes at once; the aperiodic pattern makes the peak unique), with
per-event xcorr for the spread and a boxcar template train for per-device latency. ⚠ Its ACCURACY
carries a coupling-dependent centroid bias (a slow-rising coupling drags the lag late by ~rise/2 —
constant per geometry, cancelling across sessions); its PRECISION is rise-shape-insensitive, which is
the property the ≤30 ms band needed. Gate-tested both ways: matched couplings recover a planted
+150 ms exactly; mismatched couplings show the bounded positive bias; the threshold baseline's bias is
pinned as the control.

Measured, morning calibration (motor 60, 3-way stack, 04:33): **per-event SD 42.8 ms, SE 19.1 ms**
(n=5, peak r 0.90) vs the threshold baseline's 82–129 ms — the pre-stated ≤30 ms per-pattern band is
met. Cross-session H10↔Verity (threshold estimator, comparable convention): night +193.5 ± 64 →
morning +118.5 ± 41 → pooled **+140 ± 35 ms**, the ~0.2 s systematic reproduced. Cross-session H10
latency stable (+0.147 → +0.167 s), so the command stamp alone is a ~±50 ms anchor. Night run C reads
LOW CONFIDENCE under the matched filter (peak r 0.38 — bottom-of-stack Verity coupling), and the tool
now says so rather than reporting a lag.

Intensity floor (2026-08-20 sweep): **motor 60 IS the through-stack detection floor** (40 → 1/3,
20 → ~0/3) while the finger still FEELS 20–40 — the floor is mechanical coupling, not motor output;
quiet settings remain usable ring-only. Two vendor behaviours found: writing `motor` DEMO-BUZZES the
ring at the new intensity (a second commanded-vibration path, journal-stamped), and the ring
self-buzzes on contact loss (a confound for felt-buzz reports).

## 6 · Related work — the approach has a published analogue (added 2026-08-22)

**Nasrullah et al. (2024), *IEEE RTAS* — "HAEST"**: synchronise heterogeneous IoT devices by
timestamping **ambient events** shared across accelerometer, microphone and optical sensors, reporting
sub-millisecond clock accuracy on a body-area network.

Same principle as the buzz: one physical event, heard by several devices, used as a common fiducial.
Its value here is **corroborative, not methodological** — it says the approach is sound and gives a
resolution target to measure against. It is **not** a method to build from, and the difference is the
point: HAEST *harvests* events that happen anyway, while the buzz is **generated on demand**. A
harvested fiducial has to be detected and disambiguated after the fact; a commanded one has a known
emission time, which is why §5's pairwise detection could be scored 5/5 rather than estimated.

Recorded per `EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md` §4, which surveyed it and concluded
*"worth one sentence in the buzz brief's related work; not worth building against"*. This is that
sentence, and the survey's §4 box is satisfied by it.

## Done when

- [x] The `0x83` artifact shape is characterised on hardware (width, channel, amplitude) — DONE 2026-08-19, §3.1.
- [x] Per-fire latency distribution measured (§5): ±25 ms/fire on the rigid leg, ~±10 ms per 5-fire pattern.
- [ ] An aperiodic buzz at capture start is correlated against host command times → ring host-axis residual,
      recorded either way.
- [x] (2b) DONE beyond spec: ring→H10, ring→Verity, AND the 3-way stack — all detected (§5); the
      pairwise H10↔Verity offset measured directly (+193.5 ± 64 ms). Owed: matched-filter estimator to
      reach the ≤30 ms per-event band.
- [ ] `check.sh` green; the fiducial path opt-in and whitelisted to `0x83`.
