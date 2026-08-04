<!--
  O2RING-RAW-STREAMS-ABSENT-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living — hardware-validated negative result) · **Created:** 2026-08-04

# The O2Ring does not export raw red/IR or raw 3-axis ACC

The ring **must** compute a red/IR ratio internally — SpO₂ *is* the ratio-of-ratios, it cannot be derived
from one optical channel — and it must integrate 3-axis acceleration, because it reports `motion` as a
derived scalar. The question this brief settles is not whether those exist inside the device, but whether
the firmware puts them on the wire. **It does not.** Device `S8AW2100`, SN `2592302100`, firmware
`1.0.5.0`.

This is a **protocol** limit, not an algorithm one. Anything requiring raw photodiode data needs
different hardware; no amount of decoding reaches it on this ring.

## 1 · What was tested

| pass | coverage | result |
|---|---|---|
| Empty-payload sweep | **all 256 opcodes** (`O2RING-OPCODE-SURFACE`) | 25 responders; only `0x03` carries a waveform |
| Parameterised re-test | 16 responders × args `none/00/01/02` | payload changes **nothing** |
| Multi-byte args | `0x03` × `0100 / 0200 / 0001 / ff` | identical 6-byte empty-buffer reply |
| Positive control | `0x03`, known PPG buffer | **passed** — see §2 |

Docked, with a 34/34-stable frame, the payload argument produced **byte-identical replies**:

```
0x03 + none/00/01/02  ->  6 bytes, all zero, identical
0x02 + none/00/01/02  ->  20 bytes, identical heads
0x00 + none/00/01/02  ->  40 bytes, identical heads
0x05 + none/00/01/02  ->  922 bytes every time
```

## 2 · The positive control is what makes the negative admissible

A sweep that finds nothing is worthless without a demonstration that it *could* have found something.
In the same session, on the same hardware:

* **`0x03` — drains** (31 → 120 → 256 bytes as the interval grows) and scores **0.126** on the
  de-interleave metric at stride 1: one smooth channel.
* **`0x05` — fixed 922 bytes at every interval**, scoring **1.02 / 1.45 / 1.35 / 0.75** across strides
  1/2/3/4 — indistinguishable from the **1.15 noise floor**.

The metric was validated on planted signals before use: one smooth channel scores 0.048, two interleaved
0.051 at stride 2, three interleaved 0.045 at stride 3, and pure noise ~1.15 at every stride. A real
channel and noise differ by **20×**, so this is an absolute threshold, not a relative "pick the lowest".

`0x05` was the prime suspect — it returns 4 zero bytes docked and 922 bytes measuring, and a
signal-dependent payload is the profile of a raw stream. It is a fixed-size structure, most likely a log.

## 3 · A false lead, recorded because it was nearly shipped

**Worn**, `0x03` with different payloads returned different lengths (170 / 213 / 199 / 198 / 200) and
different sample counts, and `0x03+02` scored a *smoother* 0.043. That reads as channel selection.

It is **buffer accumulation**. `0x03` drains — each call returns whatever arrived since the last one — so
per-payload length differences are timing, not content. Docked, with no signal to accumulate, all four
payloads return the identical 6 zero bytes. **Length is worthless as evidence for this opcode**; only
content is admissible, and content is identical.

## 4 · The vendor app corroborates the negative

ViHealth displays **Oxygen Level, Pulse Rate, Motion**, plus derived summaries (O₂ score, drops over
3 %/4 %, per-hour rates, distribution tables). Every one is computed from the **1 Hz** series the live
`0x04` frame already provides and OxyDex already ingests. There is no plethysmogram, no red/IR trace, no
perfusion ratio anywhere in the app.

That is evidence *for* the negative: the vendor's own client is the one consumer that would use raw
optical data if it were exposed, and it does not.

## 5 · Confirmed as a side-effect

**`0xE1` returns the DEVICE SERIAL NUMBER.** Its 60-byte payload contains ASCII `2592302100`, matching
the SN on the firmware screen exactly. Previously recorded as "model/serial-ish strings"; now settled.
Firmware version `1.0.5.0` (the app's own screen; `0x06`'s stored `20260527040055` remains undecoded).

## 6 · Consequences — separate the two goals

* **Pulse timing / PAT does NOT need red/IR.** `0x03` already yields ~125 Hz plethysmograph, and
  `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §5 measured the ring's timing residual at 7.5× inside
  `pat-gate.js`'s bound. Reachable today.
* **Re-deriving SpO₂ under a different calibration DOES need it**, and is impossible on this hardware.
  Treat the ring's SpO₂ as a closed, vendor-calibrated output.
* **`motion` is a derived scalar and stays one.** No 3-axis stream exists on the wire; a study needing
  ring-site acceleration must use the H10 or Verity IMU instead.

## 7 · Limits of this result — what would overturn it

1. **Actuator effects were invisible** on the final passes (no human observer). A data-frame detector
   cannot see the motor or display, which is how `0x83` was found; conclusions are bounded to *reported*
   state.
2. **Arguments tested were single bytes `00/01/02` plus four 2-byte forms.** A longer structured enable —
   a mode command with a payload shape nobody has guessed — remains unexplored.
3. **One firmware, one unit.** `1.0.5.0` on SN `2592302100`.
4. The null in the parameterised pass was **weaker than intended**: `0xF1` sets live-frame byte 17 to the
   same value `OP_LIVE` does, so the scratch byte survived and every trial flagged `[17, 33]`. That is a
   known artifact (`O2RING-OPCODE-SURFACE` §6), not evidence, but the fix is **two different** control
   commands — a single control cannot disqualify a byte it happens to agree with.

## 8 · Operational note

Parameterised probing is riskier than the empty-payload sweep, and behaved that way. Empty payloads were
safe across all 256 opcodes; after sending arguments to `0x09`/`0x15`/`0x02`/`0x05`/`0x03` the ring was
observed buzzing repeatedly and later stuck on a Bluetooth icon, unresponsive. It recovered. **Causation
is NOT established** — the ring self-buzzes on lost finger contact (`O2RING-OPCODE-SURFACE` §2), and it
was being taken on and off through that window — but the coincidence is on record, and an argument-bearing
call to an unknown opcode is a genuinely different risk class from a bare one. Do not run §1's
parameterised pass without a human watching the device.
