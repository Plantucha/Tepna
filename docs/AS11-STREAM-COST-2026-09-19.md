<!-- SPDX-License-Identifier: Apache-2.0 -->
# AS11 live-stream cost — the baseline before any dataId is added (2026-09-19, Wren, measured on vigil)

**Why this exists.** Unit 2 of the 2026-09-19 ruling ("dataId set justified per consumer, measure the cost
first") — a channel added without a baseline is a preference. This records what the two-id stream
(`PatientFlow` + `MaskPressure` @ 40 ms, 5 reports/s) costs the box today, from the box's own record; what
the record cannot see; and the instrument that closes that gap on the first night after deploy.

## 1 · What 15 live sessions on the box measured (journal `CPAP stream gap accounting`, 2026-09-07 → 09-19)

| ended (host) | frames_ok | samples | hours @ 5 fps | `malformed` | frames_ok ÷ malformed | overflow | sink_errors |
|---|---|---|---|---|---|---|---|
| 2026-09-07 | 117883 | 1178830 | 6.55 | 786 | 150.0 | 0 | 0 |
| 2026-09-07 | 3197 | 31970 | 0.18 | 21 | 152.2 | 0 | 0 |
| 2026-09-08 | 109083 | 1090830 | 6.06 | 727 | 150.0 | 0 | 0 |
| 2026-09-09 | 93920 | 939200 | 5.22 | 627 | 149.8 | 0 | 0 |
| 2026-09-10 | 137998 | 1379980 | 7.67 | 920 | 150.0 | 0 | 0 |
| 2026-09-11 | 119656 | 1196560 | 6.65 | 797 | 150.1 | 0 | 0 |
| 2026-09-12 | 153463 | 1534630 | 8.53 | 1023 | 150.0 | 0 | 0 |
| 2026-09-13 | 152840 | 1528400 | 8.49 | 1019 | 150.0 | 0 | 0 |
| 2026-09-14 | 139902 | 1399020 | 7.77 | 932 | 150.1 | 0 | 0 |
| 2026-09-15 | 70270 | 702700 | 3.90 | 468 | 150.1 | 0 | 0 |
| 2026-09-16 | 116321 | 1163210 | 6.46 | 775 | 150.1 | 0 | 0 |
| 2026-09-17 | 105874 | 1058740 | 5.88 | 706 | 150.0 | 0 | 0 |
| 2026-09-18 | 111178 | 1111780 | 6.18 | 742 | 149.8 | 0 | 0 |
| 2026-09-18 | 600 | 6000 | 0.03 | 4 | 150.0 | 0 | 0 |
| 2026-09-19 | 103400 | 1034000 | 5.74 | 689 | 150.1 | 0 | 0 |
| **all 15** | **1,535,585** | — | **85.3 h** | **10,236** | **150.02** | **0** | **0** |

- **Rate:** `samples_ok / frames_ok = 10.000` on every session — 2 channels × 5 samples per 200 ms report,
  i.e. **5.00 frames/s, 50 samples/s**, never a different report cadence. A full night is 5–8.5 h →
  **0.7–1.5 M samples, 94–153 k frames.**
- **Host-side loss: zero.** `overflow = 0` and `sink_errors = 0` on 15/15; the one session with the new
  fields (09-19) reads `sink_slow = 2`, `sink_max_ms = 1541` — two slow sink writes the bounded queue
  absorbed with no overflow — and `continuity_status = continuous`.
- **`malformed` is NOT loss, and `total_lost` has been claiming it is.** `frames_ok ÷ malformed = 150.0`
  on every one of 15 sessions (150.02 pooled). At 5 frames/s that is one frame per **30 s** — the
  device's periodic `HeartBeat` notification, which `classify_frame` called MALFORMED ("anything that is
  not StreamData") and `total_lost` summed. The log therefore reported **689–1023 "lost" frames per night
  on a link that lost none.** Fixed in this unit: a JSON-RPC notification the loop does not decode is
  `FrameKind.NOTIFICATION`, counted apart, never in `total_lost`; a frame with no method at all stays
  MALFORMED. Prediction for the first night after deploy: `notifications ≈ frames_ok/150`, `malformed = 0`,
  `total_lost = 0`. If `malformed` stays non-zero, the 1:150 population was not what this says it is.
- **Storage:** the EDF is 2 B/sample — 09-12: 3,062,044 B for 1,534,630 samples (**~3 MB per full night**);
  the raw record (off on the box, INV9) would be the JSON size below, ~10× that.

## 2 · What the record CANNOT see, and why

- **Radio bytes.** Nothing on the box counts what the link carried. The sniffer captures that exist
  (`/srv/tepna/captures/sniffer/`, incl. the 67 MB "overnight" of 09-04) are **100 % advertising channel**
  (1,078,085 packets, one access address `0x8e89bed6`) — no connection was ever followed, the same verdict
  the nightly files print. The notify path (`_cpap_ble_connect._on_notify`) reassembles FIG frames and
  counts nothing.
- **The ATT MTU.** The AS11 connect never acquired it: `mtu_size` was bleak's placeholder on every night,
  so notifications-per-frame — the number that turns bytes into airtime — was unknown. (The O2Ring path
  acquires it and reads 247; the AS11 is a different peripheral and may negotiate differently.)
- **Whether a 0.5 Hz id costs 1 value or 5 per report.** SomnoTrace's session writer reads `vals[n-1]`
  of every report for the PLD channels and decimates 10:1 — consistent with the device HOLDING a 2 s value
  across the 40 ms reports (5 values per report), which would make `_LKF` cost the same as a third
  waveform channel. Not confirmed on the air; measurable the first night it is requested.

## 3 · The instrument (this unit), so the next number is measured rather than estimated

- `GapCounters.bytes_wire` (FIG payload as received — IV + padded ciphertext) and `bytes_json` (decrypted
  text), summed over EVERY frame the loop reads, on the gap line and in `provenance.counters`. Marginal
  cost of an id = `Δ(bytes_json / frames_ok)`, on vs off, same box, same MTU.
- `_cpap_ble_connect` acquires the real MTU after `start_notify` (the ring's idiom) and logs
  `link MTU=<n> (write step <n-3>)` once per session. Notifications per frame ≈ `⌈(bytes_wire/frames + 16) /
  (MTU−3)⌉`; at MTU 247 a ~250 B frame is 1–2 notifications, at 23 it is 12–13.
- `cpap.ble_stream.extra_data_ids` — ids requested in the SAME stream but **published nowhere**: no bus
  channel, no EDF channel; verbatim into the raw record (which is why the daemon REFUSES the key without
  `raw_record_dir`). This is how `_LKF` is added: cost measured and unit pinned from recorded values
  BEFORE a consumer exists. Default OFF.

## 4 · Estimate, labelled as such, until the first instrumented night

Frame plaintext for the hardware-confirmed shape (`{"jsonrpc","method":"StreamData","params":{"data":[
{"PatientFlow":[5 floats]},{"MaskPressure":[5 floats]}],"intervalMs":40,"startTime":"…Z","streamId":1}}`)
is ~190–260 B depending on the device's float formatting (unknown); +2 length +≤15 pad +16 IV +16 FIG
header ⇒ **~230–310 B/frame on the wire, ~1.2–1.5 kB/s, ~30–40 MB per 7 h night**, before ATT/L2CAP/LL
framing. A third channel of 5 held values adds ~35–50 B plaintext, **~+15–20 %**. The AS11 is
mains-powered; the cost is the box's airtime on the pinned CPAP adapter, not a battery.

## 5 · What this unit did NOT do

- Did not add `_LKF` to `POLL_ITEMS` (WU5, the detector's `Get`): the named box ("`Leak`-validity
  promotion timing") is answered by `_ZLE`'s edge (Unit 1, when armed) plus the stream's `_LKF` series once
  the stream runs — the poll would add one row per session at the sighting and defer for the rest of the
  night. Left for its own consumer.
- Did not arm anything on the box.
