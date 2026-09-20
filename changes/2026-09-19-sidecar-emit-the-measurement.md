<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: changed
nodes: [capture-host]
brief: PPG-ABSENCE-AS-VALUE-2026-09-06-BRIEF.md
---
The run sidecar emits the measurement and names nothing: `absence` / `in-wear-rail` (one afternoon
old, #2675) replaced by TWO observed witnesses per row — the waveform's bracketing class and the
device's own contact byte (owner re-ruling D5 + "fix it", 2026-09-19).

The evening's pre-registered capture on a WORN finger falsified both names: worn + disturbed AC
(occlusion, strong light, handling) ⇒ flat 100 up to 672 samples; 0/199 never a steady rail — paired
transient excursions. Off-finger ⇒ 100 was measured; 100 ⇒ off-finger was written. Over the corpus, of
164 ring 100-runs ≥ `T_STUCK` (55 nights) 3 are bracketed by pulsatile signal, 22 one-sided, 139
resolved by file position — the value is necessary and nowhere near sufficient.

**`bracket=<before>/<after>`**, each `varied` · `flat` · `unavailable`: what was observed in the 375
samples beside the span (3 s — ≥ 2 beats at any resting rate ≥ 40 bpm; ≥ 20 distinct values =
varied). `unavailable` (no window to examine) is a different value from `flat` (examined and quiet).
Live, the after-side is unknown at run close: a row is held until its window arrives and flushed at
`close()` as `after=unavailable`; a back-check row reads `unavailable/unavailable`.

**`contact`**: the ring declares contact out-of-band every second (RtParam byte 5 — 0 lead-off ·
1 normal · 2 unplugged · 3 fault), already persisted in `_OXYFRAME.txt` and already the daemon's
not-worn verdict; the sidecar was the one reader that never saw it. Against the labelled captures
(host-time join, ±2 s): settled off-finger 0 × 423 / 1 × 0; worn 1 × 1,123 / 0 × 20 — those 20 s ARE the
2,492-sample plateau, called by the device itself; ~5 s debounce at removal; occlusion/handling/shake
contact=1 throughout; flashlight 0 on 8 frames exactly where the 672-run sits; `run_status` does NOT
discriminate; `alarm_raw & 3` is empty; of the 25 ambiguous corpus runs the device calls 16 lead-off
and 9 worn (all ≤ 419 samples). The device says "no valid contact" for the flat-100 episodes in both
captures — true absence and an optically blinded worn finger alike — and does not tell those apart;
nothing does, and for a consumer both are "no measurement". The column carries the majority byte over
frames within ±2 s VERBATIM, or `none` when no frame overlapped — distinct from `0`. `ContactLedger`
is fed at the OXYFRAME write in `run_oxyii` and handed to the ppg1 writer; Verity and ACC rows read
`none` with `contact_source=none` on the rule line — bracketing is their only witness.

Emission is unchanged (plant-tested). `ppgdex-dsp.js` parses the ten-column shape identically
(asserted); it consumes neither column yet — naming absence from them is the consumer's.
