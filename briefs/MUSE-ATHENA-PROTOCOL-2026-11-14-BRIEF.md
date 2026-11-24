<!--
  MUSE-ATHENA-PROTOCOL-2026-11-14-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS (§2.4 tick fold corrected to the ns modulus — verified 2026-11-16 on one recorded session, see §2.4) · **Created:** 2026-11-14

# Muse S Athena — wire protocol, measured (unit `musenative`)

Rule 0: `Muse S Athena GATT characteristic packet layout native recorder` → `briefs/CAPTURE-HOST-2026-06-29-BRIEF.md:100-111`,
`capture-host/capture.py` `run_muse`, board #6271 (the order), #6273 (the claim). No prior protocol record exists.

**Owner order, 2026-11-14:** a native recorder for the Athena inside `capture-host`, to this repo's standards, in place of
the child recorder tool. Fleet-Session: Finch builds it; Wren measures it on the box.

## 1 · Clean room

- We measured every fact in §2 from this project's own captures of the owner's headband. The capture is the evidence.
- We did not read or copy any third-party decoder source for §2. We used the child recorder tool only to RECORD: its raw
  output is one line per notification (host time, characteristic, payload hex), which is the device's own bytes.
- The GATT start sequence (§5) is not measured yet. It will be read from a BSD-3 library and credited in
  `THIRD-PARTY.md` § Device protocols when that step lands.

**Evidence capture.** `muse-probe2-20261112-195853.txt`, sha256 `ba84cc28fcb4943f9f5ce25279df3530d4f9be610df57bfd37b50b2ab0ef115f`,
recorded 2026-11-12 on the development machine: 58 075 notifications over 600.6 s, all on characteristic
`273e0013-4c4d-454d-96be-f03bac821358`. It holds EEG of the owner and stays on that machine (private corpus). The probe
scripts are `muse1.py` and `muse2.py` beside it. Whether the headband was on the head is NOT recorded for this capture.

## 2 · Measured facts

| # | fact | measurement (population: all 58 075 packets unless stated) |
|---|---|---|
| 2.1 | Packet = 9-byte header + records. Byte 0 = total length. Byte 1 = packet counter. Bytes 5–8 constant `77 8e 01 00`. | byte 0 equals the length in 58 075 of 58 075; byte 1 steps by 1 (mod 256) in 58 058 of 58 074 steps; bytes 2–4 vary |
| 2.2 | Record = `[tag][index][tick, 24 bit LE][data]`. Five tags, fixed sizes: `0x12` 33, `0x36` 45, `0x47` 41, `0x53` 29, `0x88` 25 bytes. | with these sizes 58 075 of 58 075 packets tokenise to their last byte; no other tag occurs |
| 2.3 | The index is a per-tag counter, +1 mod 256. | unit steps: `0x12` 76 432 of 76 448; `0x36` 38 338 of 38 351; `0x47` 10 556 of 10 558; `0x53` 2 511 of 2 512; `0x88` 593 of 594 |
| 2.4 | The tick is a device clock at 10 000 000 units/s, carried in 24 bits and folded at 2^28 ns (0.268 s = 2 684 354.56 ticks). Corrected 2026-11-16 (Wren): this row first read "the low 24 bits", a fold at 1.678 s. | modal step per record: `0x12` 78 125 (= 1/128 s), `0x36` 156 250 (= 1/64 s), `0x47` 576 923 (= 3/52 s). Fold, one 632 s session: 2779 EEG folds, 1567 imply 2 684 355 ticks and 1212 imply 2 684 354 (share 0.564, the fraction of 2^28/100) |
| 2.5 | `0x36` data = 16 fields × 20 bit, LSB-first, one sample per record: the optical block at 64 Hz. | smoothest of 14 layouts tried (roughness 0.008; next 0.031); 63.86 records/s received |
| 2.6 | `0x47` data = 3 samples × 6 × int16 LE, sample after sample: motion at 52 Hz. The first three values are an accelerometer at 16 384 counts per g. | smoothest of 10 layouts (0.012; next 0.028); the norm of the first three values is 1 g within 2 % on the tested record |
| 2.7 | `0x12` data = 16 fields × 14 bit, LSB-first: EEG, 128 records/s. | 14-bit LSB-first layouts are the only smooth ones (0.07–0.12; 8 other widths and orders ≥ 0.30); 127.29 records/s received + 427 lost by index = 128.0/s |
| 2.8 | Loss is visible in two counters. | 17 non-unit packet-counter steps (largest 58 and 67); records lost by index: `0x12` 427, `0x36` 208, `0x47` 61, `0x53` 15, `0x88` 4 |

Rates received: `0x12` 127.29/s · `0x36` 63.86/s · `0x47` 17.58/s · `0x53` 4.18/s · `0x88` 0.99/s.

## 3 · What the code implements

`capture-host/muse_athena.py` (PURE): `tokenise` (refuses a malformed packet with a named reason: `short`, `length-byte`,
`unknown-tag`, `truncated-record`, `no-record`), `lost_between`, `tick_seconds`, `unpack_lsb`, `optics`, `motion`,
`eeg_fields`. Since unit `musenative` it also holds §6: `eeg_samples` (2 × 8), `battery_pct` (0x88), `frame_counter`,
`TickClock` (unwrap at 2^28 ns, in ns), `command`, `start_sequence`, `STOP_SEQUENCE`, `ControlReplies`, the GATT table and the
0x11 / 0x34 / 0x35 sizes (stored raw). The tests in `tests/test_muse_athena.py` are SYNTHETIC only, packed by a second
method. Unit `musenative` took the five captured packets out, because a data notification carries the EEG of the
wearer. The hand-decoded record and the 1 g norm went with them; §2 keeps the measurement. Module coverage is 100 %.

The recorder is `capture.run_muse_athena` (config `protocol: athena`, `preset:`). It writes each data notification
verbatim to `<base>_RAW.txt`: host stamp, unwrapped device tick in ns, packet counter, length and hex. Counter gaps go
to `<base>_RAWRUNS.txt` (`_RunSidecar`, rule `counter-gap`; a repeat is `counter-repeat`). Clock seams go to
`<base>_RAWSEAMS.txt` and arrivals to the `PMDARRIVAL` sidecar. Battery from each 0x88 record goes to STATUS and LINK.csv.

## 4 · Unresolved — the code returns wire order or raw bytes and guesses nothing

- [ ] **EEG field order.** 16 fields per record at 128 records/s gives 2 samples × 8 channels at 256 Hz, or 4 × 4.
  Field groups 0–3 and 8–11 share one distribution, and 4–7 and 12–15 another, which fits "two samples of eight
  channels, sample after sample". This is NOT proven: the capture's EEG fields sit at a rail in 9 % of samples, so
  smoothness does not separate the layouts. Needs a worn capture with known events (blink, jaw clench, one electrode
  lifted, eyes closed for alpha).
- [ ] **The zeros.** Exact zeros are 4.6 % of the fields in groups 0–3 and 8–11 and 0.02 % elsewhere. They are rail
  values of particular channels, not filled dropouts; which channels is the same open question.
- [ ] **Tag `0x53`** (4.18 records/s, 24 data bytes; the sampled record holds 12 little-endian 16-bit values near
  0x2000): meaning unknown.
- [x] **Tag `0x88`** (20 data bytes) — a fuel-gauge record, decoded 2026-11-24 (unit `musegauge`, §6.4). Bytes 6–13
  stay unread.
- [x] **Header bytes 2–4 and 5–8** — decoded 2026-11-24 (unit `musehdr`, `muse-frame.js`).
  - Bytes 1–2 are a 16-bit little-endian packet counter. Byte 1 alone is its low byte.
  - Bytes 3–7 are a 40-bit little-endian device Unix time in units of 2^28 ns. Byte 8 is 0.
  - Device time of a record = header time × 2^28 ns + signed tick × 100 ns.
  - Measured on 22 recordings, 26 161 677 EEG records: 26 161 590 steps are clean. `eegdex-dsp.js` now reads a gap
    off this time, and the index count stays the fallback.
  - Open: the recorder keeps its own tick clock. The first packets of a stream can carry a stale header time.
- [ ] **Units and scales** of every field (EEG µV per count, optical channel map, gyroscope scale).
- [ ] **A second capture** must reproduce §2 before the recorder relies on it (one capture is one firmware state).

## 5 · Plan

- [x] 1. Frame, records, counters, tick, optics and motion packing — §2, with tests.
- [x] 2a. A worn capture with known events: EEG layout and the four electrodes (§6.5), battery (§6.4), GATT and control
  channel (§6.2–6.3), presets (§6.7). Measured, not yet in the code.
- [ ] 2b. Put §6 into `muse_athena.py` with tests: tags 0x11 / 0x34 / 0x35 (verify their layouts first), EEG as 2 × 8,
  battery, the control codec. Second-capture replication of §2. Unit `musenative` did the code part, with the three
  tags stored raw at their measured sizes. The replication is open. Unit `musepulse` (2026-11-22) decoded 0x34 as
  3 samples × 4 optical channels at 64 Hz (`muse_athena.optics4`), measured on the worn test of 2026-11-15, and feeds
  the live PPG card. 0x11 and 0x35 stay raw.
- [x] 3. GATT layout and start sequence, read from the BSD-3 library and credited; measured against the headband.
- [x] 4. Writer: raw notifications immutable (host stamp + packet counter per row); parsed streams beside them; a runs
  sidecar where a counter jump is a gap, never a zero (§∅); host stamp and device tick on every row (§🔒.7).
  Done in unit `musenative`, raw only: the parsed streams move to the app (EEGDex parser, unit `museparse`).
- [x] 5. `run_muse_athena` in `capture.py` on the `run_polar` pattern (bleak in the daemon, reconnect, status);
  `capture-host/check.sh` at the 100 % floor. The Gen 1–2 path is not touched.
- [ ] 6. Branch to the relay for the PR; Wren measures on the box. No deploy by Finch.

## 6 · Probe of 2026-11-14 evening: worn capture, our own client, presets (measured; NOT yet in the code)

Recorded here so that the recorder can be built from it. `muse_athena.py` still implements only §2: it refuses the three
record tags found below, and it returns EEG in wire order. Evidence stays on the development machine, in
`/srv/scratch/muse-probe` (private: it holds the owner's EEG).

| evidence | what | sha256 |
|---|---|---|
| `muse-worn-hci1-20261114-221237.txt` | worn, 75 888 notifications, 03:12:45–03:25:45 UTC, preset p1041, through adapter hci1 | `b22909259c74baa2b3109e646b55b0cfa316707760b4dd0081d472a5799c2735` |
| `modes-20261114-224309/` | our own client, about 22 s in each of 18 presets (all files concatenated in name order) | `bae90d728ccd886787fe643b9559cb73344044bb112e3512f0cdf67680d3971c` |
| `tool-writes.log` | the GATT writes and subscriptions of the child recorder tool, logged at the bleak boundary (black box; its source not read) | — |
| probe scripts | `muse1.py` 1869d1b14aecc72c · `muse2.py` a53c1f72eb30bd29 · `muse3.py` 65d8d7f5b2aef0fa · `muse4.py` 11471e421da2085c · `muse_presets.py` 26aba99596172d0b · `muse_modes.py` 6d1dc115cd8fe30f · `hci1-wrap-log.py` fb5e0cfe3e29b63f | sha256[:16] beside each |

**6.1 Radio.** Use the Nordic dongle (`hci1` on the development machine, the adapter type the capture box uses). The
built-in adapter lost the link silently after 153 s (2026-11-12) and after 10 s (2026-11-14); the child tool did not
notice and wrote nothing more. Through `hci1`: 128.02 EEG records/s over 13 minutes. A recorder needs a stall watchdog
(no notification for a few seconds = reconnect) and must take the adapter from config. A stale connection makes the
headband stop advertising ("not found"): disconnect it first.

**6.2 GATT, measured.** Service `0000fe8d-0000-1000-8000-00805f9b34fb`. Characteristics: `273e0001-…` control
(write-without-response, notify) · `273e0013-…` data (notify) · `273e0014-…` (write, indicate) · `273e0015-…`
(write-without-response, notify). BlueZ reports MTU 23; data notifications are up to 116 bytes.

**6.3 Control channel, measured.** A command is `[length + 1][ASCII][0x0a]`, the public convention of the earlier Muse
models (credit owed in `THIRD-PARTY.md` § Device protocols when the code lands). A reply is JSON, sent as
length-prefixed fragments on the control characteristic.
- `v6` → `{"fw":"3.1.31","bn":1,"tp":"consumer","hw":"01.1","pv":4,"ap":"headset","sp":"Athena_RevE","hb":"Athena_RevF_NW","bl":"1.0.1","be":"1.5.1","rc":0}`
- `s` → `{"hn":…,"sn":…,"ma":…,"hs":…,"id":"0","bp":80.42,"ps":4161,"ln":"0","ch":[0,0],"rc":0}`. `bp` is the battery in
  percent. `ps` is the active preset as an integer (4161 = 0x1041 = preset `p1041`).
- `h` halts. The classic start `d` answers `rc 255` and starts nothing.
- **Start sequence, as the child tool sends it (black box):** subscribe to 0001, 0013, 0014; then `v6`, `s`, `h`,
  `p1041`, `s`, `dc001`, `dc001`, `L1`; at the end `s`, `h`. Our own client streams with `dc001` twice and `L1`.
  We have not measured what `L1` does, or whether the device needs the second `dc001`.

**6.4 Battery, confirmed.** Record `0x88`: the first two data bytes, little-endian, divided by 256, are the battery
percent. Against the device's own `bp`: 78.61 and 78.64, 76.27 and 76.27, 74.88 and 74.89 (18 presets, largest
difference 0.09). In preset p1023 this record arrives 50 times per second and nothing else does.

The record is a dump of a fuel gauge, as ten 16-bit little-endian fields. Measured 2026-11-24 on 3 429 records, one per
minute, on 9 nights (2026-11-15 to 11-23). `muse_athena.gauge` reads the resolved fields.

| bytes | field | evidence |
|---|---|---|
| 0–1 | percent × 256 | §6.4 above |
| 2–3, 4–5 | remaining and full capacity, raw | percent × full / 100 equals remaining within 2.02 counts |
| 6–7 | unread; possibly time to empty | 0 at empty, noisy |
| 8–9 | unread; 0 or 65535 | possibly time to full |
| 10–11 | unread; rises with charge and discharge | 267 to 907 over the 9 nights |
| 12–13 | unread; constant 29500 | one value in all records |
| 14–15 | cell voltage × 78.125 µV | inferred from the range: 3.77 V at 50 %, 3.01 V at the last record before the stop |
| 16–17 | signed current, raw | median −72 to −84 on discharge |
| 18–19 | temperature × 256 °C | 22 to 33 °C |

**6.5 EEG layout and electrodes, from the worn capture (preset p1041).** Fields j and j + 8 of a `0x12` record are the
same channel (correlation 0.90 for 0↔8 and 3↔11; medians and spreads equal pairwise). So a record is **2 samples × 8
channels, sample after sample, 256 Hz**. Events done by the owner while recording:

| channel | electrode | event (UTC) |
|---|---|---|
| 0 | left ear | two jaw clenches, 03:16:01 and 03:16:06, hit channels 0 and 3 together (confirmed by the owner) |
| 1 | left forehead | the owner tapped the left forehead sensor: bursts on this channel only, 03:21:43 and 03:22:01 |
| 2 | right forehead | by elimination; also disturbed 03:17:08–13 while the owner reached for the right ear |
| 3 | right ear | the owner lifted this electrode: at a rail and noisy 03:17:10–03:17:21, no other channel |

Channels 4–6 move together (correlation 0.96–0.98) and are noisier; channel 7 sits near the top rail a third of the
time. Their meaning is not known. Worn, channels 0–2 are never at a rail (the unworn capture of §2: 9 %).

**6.6 Optics in the worn capture (preset p1041, 16 values).** No value is ever 0 or at the rail. Ten values (0, 1, 8–15;
levels 6 000–107 000) show mostly slow drift and carry a line near 52 per minute: the tissue signal. They form two
families that move together at 0.98–0.99 (even: 0, 8, 10, 12, 14; odd: 1, 9, 11, 13, 15). Values 4–7 sit near 337 000;
2 and 3 near 250. Which value is which wavelength or detector is NOT measured.

**6.7 Presets, measured with our own client** (accepted = reply `rc 0` and `ps` changes; about 22 s recorded in each).
Rejected (`rc 69`): p20, p22, p23, p31, p32, p50, p51, p60, p61, p63.

| presets | data records, per second | battery fall in the 22 s window (percent points) |
|---|---|---|
| p21, p1021 | `0x11` + motion `0x47` | 0.10–0.11 |
| p1022 | EEG `0x12` 128 only | 0.06 |
| p1023 | `0x88` at 50/s only | 0.11 |
| p1024 | motion `0x47` 17.8 only | 0.05 |
| p1025, p1041, p1042 | EEG `0x12` 128 + optics `0x36` 63 + motion | 0.39–0.47 |
| p1031, p1032 | `0x11` + optics `0x36` + motion | 0.34–0.45 |
| p1033, p1034 | `0x11` + `0x35` + motion | 0.20 |
| p1043, p1044 | EEG `0x12` + `0x35` + motion | 0.20–0.21 |
| p1035, p1036 | `0x11` + `0x34` + motion | 0.10–0.11 |
| p1045, p1046 | EEG `0x12` + `0x34` + motion | 0.08–0.11 |

- **Three more record tags**, sizes solved from single-record packets: `0x11` 33 bytes, `0x35` 45 bytes, `0x34` 35
  bytes. The sizes fit EEG without the four extra channels (4 × 4 samples × 14 bit), optics with 8 values (8 × 20 bit ×
  2 samples) and optics with 4 values (4 × 20 bit × 3 samples). **We inferred those layouts from the sizes only, and nobody
  has verified them.**
- The battery falls come from 22-second windows at a resolution near 0.05: they order the presets but give no rate. Scaled, 16 optical
  values cost about 55–75 % per hour, 8 about 30 %, 4 about 13–18 %, none about 8–16 %. The headband fell from 95.6 % to
  74.8 % in the 39 minutes of this session.
- What separates the two presets of each pair is not identified.

**6.8 Requirements stated by the owner on 2026-11-14.** The estimate needs the pulse signal of the optics all night, as the
fourth device of the reference-free noise estimate. So the night preset keeps optics. Candidates: p1045 / p1046 (EEG 8
channels + 4 optical values + motion). Open before choosing: a drain run of at least 20 minutes, and a check that the
4-value optics carry a usable pulse line.

**6.9 The drain of p1045, measured 2026-11-24 over 9 nights.** This answers the drain run of §6.8.

- The drain is steady. It is 25.2 to 28.7 raw capacity counts per hour on every night.
- The gauge reads low. On the night of 2026-11-21 it read 1 % at 03:24, and the headband streamed at full rate until
  07:18. That is 3 h 54 min at 1 %, and 11 h 37 min on one charge. The last record reads 3.01 V.
- The believed full capacity was 200 to 217 counts before that discharge and 237 after it. The night used about 300.
- So the percent falls 11 % per hour early and 13 to 16 % per hour late, at one steady current.
- On all 8 complete nights the headband stopped within about 1 minute of the chest strap. Its gauge then read
  14, 3, 26, 16, 12, 17, 1 and 31 %. Only the 1 % night ended on an empty cell.
- The drain of p1046 is not measured. One discharge to empty is on record, so no voltage threshold is set.
