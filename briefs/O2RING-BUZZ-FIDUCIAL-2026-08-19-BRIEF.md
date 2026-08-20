<!--
  O2RING-BUZZ-FIDUCIAL-2026-08-19-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-19 · **Follows:** `O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md` (0x83=VIBRATE, confirmed on hardware), `KNOWN-CLOCK-ADVERSARIAL-CAPTURE-2026-08-14-BRIEF.md` (target 1's aperiodic marker)

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

## 3 · What must be verified before it ships (the probe order)

1. **One manual `0x83` while streaming → confirm the artifact SHAPE** in pleth and motion. `0x83`'s payload
   (duration/intensity) is only partially mapped (OPCODE-SURFACE §2); a probe measures the artifact width
   and which channel carries it. The MOTION byte is the safer detector; optical-channel amplitude is unverified.
2. **Latency distribution:** fire N buzzes at known host times, measure artifact-minus-command per fire. The
   spread IS the BLE-interval-plus-spin-up jitter, and its floor is the achievable resolution.
3. **Only then the aperiodic-pattern tool**, correlating a `[1,4,2,6,3]`-style schedule.

## 4 · Hard constraints (each a refusal, not a nicety)

- **`0x83` writes device state → the same class this project gates** (POLAR-PMD-COMMAND-SURFACE §5). It is a
  MOTOR pulse, not a settings write, and reversible by nature — but it ships behind an explicit opt-in
  (`fiducial.enabled`), never default-on.
- **NEVER fire mid-night.** A buzzing finger wakes the sleeper. Scheduled ONCE at capture start, inside the
  180 s not-worn grace, so it costs nothing and disturbs nothing.
- **Never the do-not-issue opcodes.** `0xEE`/`0xE3` (factory resets) are on the ring's write surface; the
  fiducial path must whitelist `0x83` alone.

## Done when

- [ ] The `0x83` artifact shape is characterised on hardware (width, channel, amplitude) — probe, not assumed.
- [ ] Per-fire latency distribution measured; its floor is stated as the resolution the marker can claim.
- [ ] An aperiodic buzz at capture start is correlated against host command times → ring host-axis residual,
      recorded either way.
- [ ] (2b) One ring-touching-H10 capture shows the pattern in both records, aligned to the measured floor.
- [ ] `check.sh` green; the fiducial path opt-in and whitelisted to `0x83`.
