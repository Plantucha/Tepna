---
bump: minor
type: added
---

**22 of 23 refused streams are not skewed clocks. Their device timestamp never advanced at all, and
nothing said so.**

`clock_offset.estimate` correctly refuses both cases, because a stamp frozen at one value makes
`delay = host - const`, whose slope is **exactly 1e6 ppm** — far past `MAX_PPM`. But it refuses them as
**`implausible-skew`**, which describes a clock running 100 % fast. That is not what happened: the field
is unpopulated. `arrival_quality` now publishes **`device_stamp_constant`** beside the refusal.

Measured across **470 streams / 5 real nights**:

| offset outcome | `device_stamp_constant` | streams |
|---|---|---|
| ok | False | 398 |
| `implausible-skew` | **True** | **22** |
| `implausible-skew` | False | 1 |
| `too-few` | None | 36 |

Separation is total — **no healthy stream has a frozen stamp**, and the single genuine skew
(193 892.8 ppm) reads `False`. The 22 are every Verity **`ppi`** stream (`last_sensor_ns` is literally
`0` for all **4864** packets of one night — `distinct=1`) and every frozen O2Ring `OXYLIVE_DURATION_S`.

The remedies differ, which is the point: a skewed clock is a clock and can be corrected; an absent one
cannot, and the operator needs to know the field is empty rather than hunt a 100 %-fast oscillator.

## The statistic this REPLACES, and why it was wrong

This work-unit set out to make the `quantised` flag checkable. `nightqc` decides it by **filename** —
`meas.endswith("_DURATION_S")` — while `ppgdex-dsp.js:497` decides the same thing by **measuring**
(`quantizedShare >= 0.99`). A modal-delta-share statistic was implemented here to close that gap, and
the corpus refuted it:

    Polar H10 ecg   modal delta 561.409 ms   share 0.61   <- a HEALTHY clock
    Polar Verity ppg modal delta 147.585 ms  share 0.71   <- also healthy

561.409 ms is **73 samples at 130 Hz — exactly one packet**. These sidecars carry *packet*-level stamps,
so a uniformly filled packet train scores high on a statistic meant to detect a synthesised axis;
`ppgdex-dsp.js` measures *per-sample* stamps, a different axis, and its `0.99` bound does not transfer.
Publishing the share as "the measurement behind `quantised`" would have named packet-fill uniformity as
a drawn timebase. It was deleted rather than shipped with a caveat.

**The filename flag has no live defect on this corpus** — it is correct on all 470 streams, and the one
drawn axis it misses (`ppi`) is already refused by the estimator and by `floor_ok`. What was actually
missing was a name for *why*.

⚠️ **`device_stamp_constant` is not a synonym for `not offset.ok`**, and a test pins that in both
directions: a device clock running 20 % slow refuses identically while reading `False`. Without that
case the field could be reimplemented as the refusal itself and every test would still pass.

`None` below 200 packets — a handful can repeat a stamp by chance. `None` stamps are dropped, not
defaulted; absent readings are not evidence either way.
