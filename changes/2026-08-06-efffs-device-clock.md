---
bump: patch
type: fixed
nodes: []
brief: DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md
---

`effFs` on the monitor measured the radio, not the sensor, and overstated every waveform stream by a
fixed factor.

Two defects sharing one cure. The trailing window ran `span` from the OLDEST frame's ARRIVAL while
`total` counted that frame's samples as well — but those samples arrived AT the start of the interval,
they were not produced during it, so k frames of n samples at spacing T reported `k·n / ((k−1)·T)`. That
is a k/(k−1) overstatement that is always positive and never averages out: the 5 s window holds ~9 ECG
frames, so 130 Hz read 146.25 predicted and 146.6 observed on the box. Separately, BLE hands several
frames over in one connection event, so their arrival times collapse together and an arrival-time
denominator measures batching rather than rate.

`push()` now accepts the frame's last sample on the device's own counter (`dev_ns` — additive and
optional), and `_stream_rate` measures between the first and last device stamps while counting exactly
the frames that closed inside that interval. That is an identity rather than an estimate. Streams with
no device clock (the O2Ring paths) keep the arrival-time rate with the off-by-one still fixed, and a
device clock that did not advance falls back the same way — the H10 resets to a 2019 epoch whenever it
leaves the strap, so a non-monotonic pair is an event this corpus contains, and refusing beats reporting
a negative rate that `stream_health` would paint as a failing radio.

Below two frames there is no interval, and the answer is now `None` rather than `0.0`: zero is a
measurement of silence and reads downstream as a dead stream, while silence is already caught by the
sample age. `stream_health` treats `None` as "cannot judge" so it can never manufacture WEAK, and
`meta()` publishes JSON `null`; the monitor already null-guarded it.

Also lands DEVICE-RATE-TRUTH §3's corrections in the source rather than only in the briefs: `156` is an
inserted per-beat marker and not an invalid-sample sentinel (`PPG_INVALID` → `PPG_BEAT_MARKER`, old name
kept as an alias), `PPG_FRAME_SAMPLES = 126` is `125 + markers` and moves with the wearer's pulse, and
−3446 ppm describes the ring's duration counter on one atypical night (44-session median +540 ppm) and
never its crystal-exact sample clock.
