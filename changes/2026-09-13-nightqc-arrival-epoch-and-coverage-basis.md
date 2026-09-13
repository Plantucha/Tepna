---
bump: patch
type: fixed
brief: none
---

`nightqc.arrival_quality` spent the device column as if it were already epoch-milliseconds. It is a
nanosecond counter anchored to **2000-01-01 UTC**, so every arrival delay carried the 1970→2000 delta —
**946 684 800 000 ms** — on top of the real link delay, and `clock_offset.estimate` then certified that
number. The two columns are anchored differently and both anchors are stated in the producer:
`capture.py:_utcnow` ("Device clocks are set in UTC … so skew is measured against UTC") for the device
counter, and `writers._phone_ts` ("Do not pass a UTC instant", with `capture.py:2748` passing `_now()`)
for the host stamp, which is naive local civil time. The fix subtracts the Polar epoch so both sides are
true epoch-ms before differencing. Measured on the real 2026-08-11 H10 capture, 50 192 ECG rows: the old
path's minimum delay read **946 684 799 461.936 ms** where the corrected one is **−538.064 ms** (median
−183.623), a difference of exactly 946 684 800 000.0 ms. The corrected median agrees in sign and order
with the value `arrival_quality`'s own docstring table has carried for H10 ecg since 2026-08-11 (−228.7 ms)
— the code and its documentation had disagreed by thirty years, and no spread-based check could see it
because a constant added to every row moves none of them relative to each other.

A device counter of `0` is now ABSENT rather than the year 2000 (§∅). `_POLAR_EPOCH + 0` is a real
instant, so spending it fabricated a 26-year delay out of a stamp that was never measured —
`arrival_quality`'s own docstring records every Verity `ppi` stream carrying `last_sensor_ns` literally 0
for all 4864 packets. Such a row is dropped rather than re-paired against `first_sensor_ns`, because
mixing the two pairings inside one stream splits the population the offset is estimated over.

`nightqc.summarize` now publishes **`coverage_basis`** per stream — `measured` where the stream's rate
was observed off the file, `expected` where the configured rate was substituted because none could be
measured — and tags the degraded line `(rate assumed)`. Coverage is worth exactly what its rate is worth,
and the two were previously indistinguishable. Making the fallback null-propagating instead was
considered and measured first: of 9 rate rows on the 09-12 night only **4** carry a `measured_hz`, so
nulling would have deleted coverage for **5 of 9** streams — and coverage is how a stream that DIED
becomes visible, so that cure removes the signal rather than the fabrication.

Two fixtures were corrected because they encoded the same misreading as the code, which is why they
agreed with it: `test_arrival_quality_recovers_the_planted_offset` computed its expected offset with no
device anchor (out by exactly the 1970→2000 delta, now referenced through the module constant so moving
the anchor reds the test), and `test_arrival_quality_skips_blank_and_malformed_rows` built its "150 real
rows" as `i * 1000`, making row 0 an absent stamp among them.

⚠️ **Not fixed here, and filed as residue `2026-09-13-dst-fallback-splits-the-host-axis`:** seven call
sites convert that naive local column with `.timestamp()`, which is ambiguous for one hour a year. On
the DST fall-back night the host axis steps **−3540 s** mid-recording while the device counter marches
on. It also reaches `nightqc.py:1960-1961`, where a night's `span` would read an hour short and so
*inflate* the coverage this changeset touches. The mechanism is proven synthetically; no corpus night
crosses a seam, and the next one is 2026-11-01.
