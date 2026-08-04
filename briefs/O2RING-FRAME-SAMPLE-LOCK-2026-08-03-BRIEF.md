<!--
  O2RING-FRAME-SAMPLE-LOCK-2026-08-03-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living — measured on the captured corpus) · **Created:** 2026-08-03

# The O2Ring emits exactly 126 PPG samples per status frame

Measured across **90 captured sessions** on device `S8AW2100`, from data already on disk. No hardware
access, no new opcode — `tools`-free arithmetic over `*_PPG.txt` and `*_OXYFRAME.txt`.

## 1 · The lock

```
samples per status frame :  median 125.997   (integer 126, off by 0.003 = 0.00%)   n = 90 sessions
```

The device emits **one 1 Hz status frame per 126 PPG samples**, and the ratio is a hardware lock rather
than a coincidence: the median across 90 sessions lands 0.003 from the integer. The 121–126.6 outlier
spread is *mismatched file pairs* — an `OXYFRAME` covering a different window than the `PPG` it was
paired with by filename prefix — not variation in the ratio.

**Confirmed independently** by the re-anchor cadence in §3: the host column's real corrections occur
every **126 samples = 1.00 s**, arrived at by a completely different measurement.

## 2 · Therefore the two streams are ONE clock

Both streams are counted off a single oscillator. **A second stream is not a second clock**: their ratio
is fixed by construction, so no comparison between them can ever yield an absolute rate, a real ppm, or
an independent timebase. Any proposal of the form "compare the two stream rates to recover the true
frequency" is measuring a hardware constant and cannot work — settle it here rather than re-deriving it.

This is the same conclusion `O2RING-SYNTHESISED-AXIS-2026-08-02` reaches for the sensor column, arrived
at from the other direction.

## 3 · The host column is NOT drawn — it re-anchors every frame

A crude test says otherwise and is wrong. Inter-sample host deltas are **94.15 % `+8 ms`, 5.08 % `+7 ms`**,
which reads as "back-timed on the fs grid". It is not:

* the 8/7 ms alternation is **millisecond rounding** of the 7.953 ms step (7.953 → mostly 8, periodically
  7, every ~20 samples). It is an artifact of timestamp resolution, not of drawing.
* filtering to real deviations (`|Δ − 7.953| > 2 ms`) leaves **1680 events, 0.76 %, spaced a median of
  exactly 126 samples = 1.00 s**, median correction **+11 ms**, range −249 … +271 ms.

Those are `capture.py`'s per-frame re-anchors doing their job, precisely as `O2PPG_FS_DEFAULT`'s comment
claims ("the phone-timestamp column re-anchors to each frame's arrival, so wall-clock never drifts").
**The mechanism a reader might propose adding is already implemented.** Verified before proposing it,
after three earlier readings of the same data each gave a different answer.

The `sensor timestamp [ns]` column is a different matter and *is* drawn — a constant `7 953 045 ns`
increment, i.e. `index × 1/125.738`. Consumers must branch on `timingSource`, never on that column.

## 4 · What the lock is good for

**(a) Exact loss detection, which nothing currently does.** Expected samples between two status frames is
`126`, known exactly rather than estimated from a rate. `126 × frames − samples` is a *count* of dropped
samples, with no rate assumption and no gap heuristic. `O2PPG_GAP_MIN_S = 0.040` currently infers loss
from arrival timing; this measures it.

**(b) A per-second anchor with a quantified residual — the PAT-relevant number.** The re-anchor correction
is **median +11 ms** (§3). `pat-gate.js` requires `residIQR ≤ 60 ms`, so the ring's timing residual is
already inside the gate's bound by a factor of ~5. That is a materially better starting point for
O2Ring↔H10 PAT than the ±63 ms *status-frame arrival* jitter suggests, because the arrival jitter is
absorbed by the re-anchor rather than propagated into sample times.

**Not yet established:** the *phase* of the status frame relative to its 126 samples, and whether the
re-anchor is applied at the frame boundary or distributed. PAT needs the first; §4(a) does not.

## 5 · What must NOT be taken from this

**The delivered-rate figure is contaminated — do not quote it.** `median 125.528 Hz, −1672 ppm vs the
125.738 constant` falls out of the same measurement and is *biased low by dropouts*: a session that loses
samples reads as a slower rate, and `rows/wall` is bounded above by the true rate but not below. It also
contradicts `capture.py`'s own note that each day's maximum `rows/wall` **exceeds** 125.738 (07-18
125.826 … 07-26 126.045) — and that note reasons from the bound in the correct direction, so it wins.

The **ratio** is robust to dropouts in a way the rate is not, which is why §1 stands and §5 does not.
**Do not re-calibrate `O2PPG_FS_DEFAULT` from this brief** — `O2RING-PROTOCOL` and
`O2RING-SYNTHESISED-AXIS` both forbid it, and this measurement is weaker evidence than what they cite.

## 6 · Method note

Four successive readings of one dataset gave four different answers — "sensor axis is lumpy", "host
column is drawn", "anchors every 20 samples", and finally the correct "re-anchors every 126". Each
refinement came from asking what *else* could produce the pattern, not from more data. The 20-sample
result in particular was millisecond rounding wearing the shape of a signal. See
`O2RING-OPCODE-SURFACE-2026-08-03-BRIEF.md` §6 for the same failure mode on the same device the same day.
