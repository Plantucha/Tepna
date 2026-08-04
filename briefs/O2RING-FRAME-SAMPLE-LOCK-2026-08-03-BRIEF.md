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

---

## 7 · EXECUTED 2026-08-03 — §4(a) built, and two refinements this brief owes its own §1

§4(a) is implemented: `oxyii.ppg_sample_count` surfaces the declared `N`, `capture.O2PpgFrameLedger`
accumulates it **beside** `O2PpgGrid` (never replacing it), and `writers.OxyFrameLogWriter` records
`ppg_n;ppg_dur_step;ppg_expected` per frame. Executing it produced two corrections to the sections
above, both measured, and this brief is `REFERENCE (living)` — so they land here rather than in a note.

### 7.1 · The 126 lock is an AVERAGE, not a per-frame constant

§1's `median 125.997` is a **per-session** ratio, and it stands. But the per-frame value it averages is
**not** 126. Decoded off the 90-frame protocol probe, the device-declared `N` in `[24:26]`:

| declared `N` | 57 | 60 | 61 | 66 | 108 | 123 | 124 | 125 | **126** | 127 | 128 | 129 | 250 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| frames | 1 | 1 | 1 | 1 | 1 | 1 | 7 | 21 | **35** | 16 | 3 | 1 | 1 |

126 is the *mode*. Steady state is **124–128**, because the poll interval jitters (0.989–1.007 s
observed) and the ring hands back whatever accumulated since the last poll; `250` is the connect-time
backlog flush and `57–108` are the next five frames while the cadence settles.

**Consequence for §4(a):** `126 × frames − samples` carries ±2 samples per frame of device-side jitter,
and the constant is 126.00 against a real 126.04. Evaluated on the largest clean night in the corpus
(`…20260801224728`, 9.3 h, 4 228 155 rows) it returns **−5 120** — a *surplus* of five thousand samples.
The subtraction is therefore shipped **signed**, as `counted_loss`, documented as the weakest of the
three counters. **What §4(a) actually detects** is intra-frame loss (the frame arrived, its samples did
not), which is exactly `declared − delivered`; that ships as **`truncated`** — exact, constant-free, and
the only counter here whose being non-zero means something is genuinely broken.

### 7.2 · `Δduration` is a ±1 s quantized counter — do NOT read a step of 2 as a lost frame

The obvious way to make §4(a) catch *whole* lost frames is the ring's own session second (`[0:4]`): a
step of 2 between consecutive replies looks exactly like one status frame that never arrived. **It is
not one.** On the reference night — 33 513 frames, steps `33 172 × +1`, `180 × 0`, `159 × +2`, and none
of `+3` or more — frame boundaries are recoverable (each frame's last PPG sample is stamped at its host
arrival; 2 ms median match residual), and grouped by step they read:

| duration step | n | **host arrival interval** | **samples in the next frame** |
|---|---|---|---|
| `+0` | 180 | 1.000 s | 125 |
| `+1` | 33 172 | 1.005 s | 126 |
| `+2` | **159** | **1.005 s** | **127** |

A genuinely missing frame would show a **~2.0 s** host interval; a recovered backlog would show **~252**
samples. Both read one second's worth. **No frame is missing.** The ring's second is **1.00346
host-seconds** (§5's territory: this is the same −3446 ppm seen as 33 490 device-seconds against
33 605.8 host-seconds) while the poll interval is **1.0028 s** — two nearly-equal periods, so which side
of a ring-tick a poll lands on wanders and the counter occasionally ticks twice or not at all. The 159
and the 180 nearly cancel, which is why the **span** survives as a long-run measure while no single step
is a measurement.

Read as loss, those 159 steps would have claimed **~20 000 dropped samples** on a night where
`O2PpgGrid` found **397** — a 50× overstatement that would have read as authoritative precisely because
it was arithmetic rather than a threshold. The counters therefore ship as `steps_ahead` / `steps_flat` /
`steps_anomalous`, named for what they are, and `ppg_dur_step` records the **raw** step so a wrong
reading can be re-asked from the file.

**This is the third misreading of that field.** `frame_gap()` read it as a sequence counter and emitted
phantom loss for weeks (`session_restarted()` replaced it); this section's own first draft made the
third, and §6's method note applies to it exactly — a "buffering" story fitted three corroborating
facts, none of which *tested* it, while the discriminating query (is the host interval 1 s or 2 s?) took
one command and had not been run.

### 7.3 · `O2PpgGrid` is vindicated, and nothing is retired

The same corpus measures the arrival-timing inference §4(a) proposed to replace. Weighted regression of
delivered samples per device-second over 60 clean sessions / 60.9 h:

```
samples/device-second  ~  126.04  −  6.9 × steps_ahead_frac  −  128.9 × inferred_gap_frac
```

A signal that costs its samples must read **−126.04**. The inferred gaps read **−128.9 (102 %)** — real
loss, essentially 1:1 — and the duration steps read **−6.9**, i.e. nothing. `O2PPG_GAP_MIN_S = 0.040`
stays, and the counters run beside it rather than instead of it.

### 7.4 · PAT — §4(b) is the stronger route, and this adds one thing to it

§4(b)'s re-anchor residual (median +11 ms against `pat-gate.js`'s 60 ms `residIQR` bound) is the
better-grounded argument and is not restated here. What the declared count adds is that cumulative
`Σ N` is the ring's **own sample index** — exact and device-side — which paired with each frame's host
arrival is precisely the `{devMs, hostMs}` anchor pair `DexClock.hostAxis` §7 consumes, ~33 000 anchors
a night. It also escapes `CROSS-DEVICE-DRIFT-AND-CLOSURE` §3.6's trap by construction: frame arrivals
are independent of cardiac timing, so an alignment built on them cannot absorb the pulse transit. Still
**not claimed:** that PAT passes its gate. §4's open item (the *phase* of the status frame relative to
its 126 samples) is untouched by this work.

### 7.5 · What shipped, and the gates

`oxyii.ppg_sample_count` + `PPG_FRAME_SAMPLES` · `capture.O2PpgFrameLedger` (per session; a restart
breaks the span rather than fabricating one; the connect backlog is excluded from the arithmetic
window) · three columns **appended** to the `OXYFRAME` sidecar · both halves in the session-end log.
`O2PPG_FS_DEFAULT` is **untouched**, gate-asserted. Gates: capture-host **2557 passed at 100.00 %**
statement+branch (the CI command); 21 new assertions, the load-bearing one pinning that a `+2` step
costs no samples, plus a JS-lane guard that `oxydex-dsp.parseCSV` ingests the 13-column `OXYFRAME`
byte-identically to the 10-column form. No bundle moved.

**Residue → `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS-2026-08-03-BRIEF.md`.**
