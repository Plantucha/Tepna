<!--
  O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS — 2026-08-19 (§3 steps 1–2 DONE; §5 results measured: pairwise + 3-way all detected; matched-filter estimator owed) · **Created:** 2026-08-19 · **Follows:** `O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md` (0x83=VIBRATE, confirmed on hardware), `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md` (target 1's aperiodic marker)

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

## Done when

- [x] The `0x83` artifact shape is characterised on hardware (width, channel, amplitude) — DONE 2026-08-19, §3.1.
- [x] Per-fire latency distribution measured (§5): ±25 ms/fire on the rigid leg, ~±10 ms per 5-fire pattern.
- [ ] An aperiodic buzz at capture start is correlated against host command times → ring host-axis residual,
      recorded either way.
- [x] (2b) DONE beyond spec: ring→H10, ring→Verity, AND the 3-way stack — all detected (§5); the
      pairwise H10↔Verity offset measured directly (+193.5 ± 64 ms). Owed: matched-filter estimator to
      reach the ≤30 ms per-event band.
- [ ] `check.sh` green; the fiducial path opt-in and whitelisted to `0x83`.
