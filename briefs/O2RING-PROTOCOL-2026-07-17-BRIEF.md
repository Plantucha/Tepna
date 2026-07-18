<!--
  O2RING-PROTOCOL-2026-07-17-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** REFERENCE (living — protocol reverse-engineering, validated on hardware) · **Created:** 2026-07-17

# Wellue O2Ring-S (T8520 / "OxyII") — BLE protocol & capabilities

Reverse-engineered + hardware-validated reference for the **Wellue O2Ring-S** finger pulse-oximeter as
used by the Tepna capture box (`capture-host/`, out-of-suite). Covers the BLE service, the live protocol,
the **stored-session file download** (the `.dat` the ViHealth app syncs on removal), the on-flash file
format, the device's operational quirks, and the on-hardware validation. Primary external reference:
[github.com/nglessner/o2ring-s-protocol](https://github.com/nglessner/o2ring-s-protocol). Code:
`capture-host/oxyii.py` (protocol) · `capture-host/pull_session.py` (stored-file puller) ·
`capture-host/capture.py` `run_oxyii` (live) · `capture-host/viatom.py` (legacy fallback, see §1).

## 1 · Device identity — it is NOT the legacy Viatom
The unit advertises as **`S8-AW <n>`** (e.g. `S8-AW 2100`) and speaks the **"OxyII"** protocol on a
**dedicated service**, *not* the legacy Viatom protocol. Every legacy tool (and `viatom.py`, service
`14839ac4…`) connects but gets **zero data** — the wrong service. OxyII lives on:
- **Service** `e8fb0001-a14b-98f9-831b-4e2941d01248`
- **Write**   `e8fb0002-…` (write-**without**-response)
- **Notify**  `e8fb0003-…`

The BLE **address is Random-Static** and rotates on factory reset (and occasionally otherwise) — resolve
**by name**, don't hardcode the MAC. No bonding / no pairing is needed.

## 2 · Frame envelope (shared by live + file transfer)
```
[0xA5][cmd][~cmd][flag][seq][len_lo][len_hi][payload…][crc8]
```
- `~cmd` = one's-complement of `cmd` (a cheap integrity byte, validated on decode).
- `flag` 0x00 host→device request, 0x01 device→host response.
- `len` little-endian u16 payload length. Big frames are split across multiple notifications → reassemble
  until a full declared frame is buffered (`oxyii.Reassembler`).
- **CRC-8, poly 0x07, init 0, no reflection/xorout** over all bytes except the trailing CRC. This is the
  only integrity mechanism — **no AES anywhere on the live or file path**; auth is a plaintext XOR (§3).

## 3 · Live protocol (real-time SpO₂ / pulse)
Flow: **connect → auth (0xFF) → setup (0x10) → poll (0x04) ~1/s**.
- **AUTH `0xFF`** — 16-byte XOR-keyed payload, no reply. Key = a MD5(`"lepucloud"`) salt (first 8 bytes at
  even indices) + 4 ASCII serial bytes (`"0000"` is the portable default) + 4 timestamp bytes
  (`(ts>>0,1,2,3)&0xFF` — a faithful, deliberately-odd port of the vendor code), all XOR'd with the full
  MD5(`"lepucloud"`). No AES.
- **SETUP `0x10`** — payload `00`, acked.
- **LIVE `0x04`** — empty payload; the device replies with a 24-byte header. Offsets:
  `[5]` contact · `[6]` SpO₂ (%) · `[7]` motion · `[8]` HR (bpm) · `[13]` battery (%).
  **contact:** `0x00` no finger · `0x01` idle-present · `0x03` file-open. SpO₂/HR are `None` off-finger.

  **⚠️ LAYOUT CORRECTED 2026-07-18 against the vendor's own parser.** The offsets above were derived by
  correlating 244 real frames against known physiology. SpO₂ and PR were right; three others were not,
  and one of them was a live data bug. Source: `viatom-develop/LepuDemo` ships the official
  `lepu-blepro` SDK as an AAR whose OxyII parser (`TAG="OxyIIBleInterface"`) maps bytes into the public
  `oxy2.RtParam` DTO. Its offset base is identical to ours (it parses `copyOfRange(payload, 0, 20)` of
  the same payload our `decode()` returns). The verified mapping:

  | byte | field | note |
  |---|---|---|
  | `[0:4]` u32 LE | **duration (s)** | *not* a frame counter — see below |
  | `[4]` | runStatus | |
  | `[5]` | sensorState (contact) | ✓ as before |
  | `[6]` | SpO₂ % | ✓ as before |
  | `[7]` | **perfusion index**, `value/10` % | was mislabelled *motion* |
  | `[8:10]` u16 LE | pulse rate | `[9]` is the HIGH byte, not padding |
  | `[10] & 0x01` | flag | `199`/`0xC7` was never a constant; only bit 0 is read |
  | `[11]` | **motion** | was the unidentified byte |
  | `[12]` | batteryState | `0` = not charging |
  | `[13]` | battery % | ✓ as before |
  | `[14]` | four 2-bit subfields | SDK parses them; not exposed in `RtParam`, so left unparsed |

  **`[7]`/`[11]` were SWAPPED, and it was not cosmetic.** `[7]` was written into the SpO₂ CSV's
  `Motion` column, and OxyDex excludes artifact samples with `r.motion === 0`. Two independent
  measurements settle it: over a real 5288-row night `[7]` is non-zero in **99.9 %** of frames
  (mean 13.6 ⇒ PI 1.36 %, range 0–18.3 %) — a perfusion index is continuously non-zero, a sleeping
  subject's motion is not; and the vendor's **own ViHealth exports** have a Motion column that is
  **99.4–99.8 % zero** (max 18–62), exactly how `[11]` behaves (0 in 249/271 frames). So on
  Vigil-captured files that filter was keeping ~0.1 % of samples. **Files written before this fix carry
  PI in the Motion column.**

  **`[0:4]` is the session duration, not a frame counter.** The old `frame_gap()` read `[0]` as a
  sequence counter and reported phantom loss — 9 warnings in one evening, one claiming *"111 live
  frames dropped"*, which was simply a session starting. Our own data refutes the counter reading
  outright: **2736 consecutive frames read `[0] = 0`** while the ring sat idle. Replaced by
  `session_restarted()` (duration going *backwards* = a new session). The ring exposes no
  frame-sequence field, so we now report **nothing** rather than a fabricated zero.

  This is why byte `[11]` never needed the desaturation experiment: it is **motion**, not the
  vibration/alert flag hypothesised. The legacy *vibration* byte is real but lives in the **file
  record**, not the live frame — `MackeyStingray/o2r` `o2file.py` shows the 5-byte VLD record as
  `spo2, heartrate, oximetry_invalid, motion, vibration`. Do not cross-apply offsets between
  generations: the legacy `0xAA/0x55` live protocol has `[10]` = PI/signal-strength and `[11]` =
  finger-present, and gen-1 `RtWave` is a third layout again.

### 3b · The `0x04` body is ALSO a ~125 Hz PPG waveform (decoded 2026-07-18)
Every `0x04` reply carries **more than the 24-byte header** — the rest is the ring's raw plethysmograph.
This is why `oxyii.Reassembler` exists (the frames span many BLE notifications). Layout, decoded off 90
real frames (all matched; concatenated bodies gap-free, boundary jumps 0–8; header HR/SpO₂ cross-checked
against the paired ECG at 49 bpm) — see `oxyii.parse_ppg`:

| Bytes | Meaning |
|---|---|
| `[0:24]` | status header (§3 above, `parse_live`) |
| `[24:26]` | sample count `N` — **`u16` LE** (PR #212). Frames seen so far carry `[25] = 0`, so an earlier `u8` read at `[24]` agreed by accident; it breaks silently above 255 samples/frame. `len(payload) == 24 + 2 + N` holds on every frame. |
| `[26:26+N]` | `N` **unsigned 8-bit** optical samples, **single channel** |

- **Single channel, not interleaved LEDs** — even/odd samples are near-identical.
- **Rate: 125.738 Hz measured**, not the ~100 Hz the upstream reference states, and not the round 125.0
  first guessed (which was 0.59 % low ⇒ ~212 s of divergence over a 10 h night between the phone-timestamp
  column and the synthesized relative-ms column). Calibrated over 12 sessions / 5.8 h / 2 616 483 samples,
  per-session spread 125.59–125.88 Hz. Short-window swings (~84–147 Hz) are BLE delivery jitter, not ADC
  drift. Overridable per unit via `o2ring.ppg_fs` (`settings_schema.py`, range 100–200).
- **`156` (0x9C) is `PPG_INVALID` — the device's MISSING-SAMPLE SENTINEL, not noise** (PR #212; an earlier
  revision of this section wrongly called it a scattered spike *"not a fixed marker"*). The vendor
  interpolates it away; **we return it raw and named**, because fabricating a measurement over known-missing
  data is worse. A consumer must treat a sentinel as a **gap**, never median-fill it. No on-box DSP
  (HEALTH-BOX-VISION §4).
  - **It is IN-BAND** — 156 is a legal signal value, so it cannot be rejected on value alone. Measured on
    the 90 s probe: 156 occurs **61×** while every neighbouring value (152–160) occurs **2–10×** (~8×
    over-represented). Two independent estimates agree — excess-over-neighbours ⇒ ~55 sentinels;
    isolation test (|156 − mean of 4 neighbours| > 25) ⇒ **57 isolated vs 4 fitting the local trend**.
    So **~93 % sentinel, ~7 % legitimate**. Reject on `value === 156` **AND** isolation; a trend-consistent
    156 is real data.
  - With sentinels excluded, genuine impulsive noise is **0.04 %** of samples (mean step 0.82 LSB) — i.e.
    there is **no spike problem**, and no despiker is warranted.
- **The stream is INVERTED relative to the vendor's display** — their transform is `127 − sample`, so
  systolic peaks are **minima** in our raw bytes (PR #212). Consumers that assume peaks-are-maxima must
  orient first (PpgDex's `orient()` infers polarity from derivative skewness and handles this — verified).
  Inversion does not change any dispersion statistic (SD is identical either way).
- **Clock Contract:** samples are back-timed from the frame's **host arrival** across the fs grid. The ring's
  RTC free-runs (§9, ~+151 s) and must **never** stamp the waveform. A dropped frame is a gap, never
  fabricated samples.
- **Validated on ONE unit** (`S8-AW 2100`, Random-Static MAC). Treat the rate as unit-specific until a
  second ring is measured.

⚠️ The waveform exists **only in live BLE traffic** — the onboard `.dat` (§5) is 1 Hz only, no waveform.

## 4 · Stored-session file download (the `.dat`) — §3-derived, hardware-verified
The ring records **every wearing period to onboard flash** (its backstop). Four opcodes, same envelope:

| Opcode | Name | Payload | Reply |
|--------|------|---------|-------|
| `0xF1` | LIST  | empty | count byte + N×16-byte slots: `YYYYMMDDhhmmss` (14 ASCII) + 2 zero pad |
| `0xF2` | START | 20 B: 14-B ASCII ts + 2 zero + **4-B LE file-type** | 4-B LE file **size** + metadata |
| `0xF3` | DATA  | 4-B LE **offset** | ≤ 512 B chunk (loop, offset += len, until size) |
| `0xF4` | END   | empty | ack — **required** before opening another file |

**Verified on hardware:** `file-type = 0` works.

⚠️ **CORRECTED 2026-07-18 — the "needs ATT MTU ≥ 517" claim above was WRONG and cost a long
misdiagnosis.** The real negotiated MTU on this host is **247**, and transfers work perfectly at 247
(an 8 h / 86 506 B session pulled clean). Two separate mistakes produced the myth: (a) `pull_session.py`
printed `mtu_size` immediately after connect, but on BlueZ bleak returns a **placeholder 23** until a
characteristic is acquired — so it *always* logged `MTU=23 ⚠ <517`, regardless of reality; (b) the actual
failure was a **timeout**, not MTU. `_wait()` allowed 6 s while the ring takes **~4.1 s** to answer
`FILE_LIST` (measured), so any radio contention tipped it over and produced a bare `TimeoutError()` that
read like a dead device. Timeout is now 20 s and the MTU is acquired before it is reported. **Do not
re-introduce an MTU≥517 precondition.**

## 5 · On-flash file format ("Format A")
```
[Header  10 B:  01 03 00 00 00 00 00 00 04 00 ]
[Samples  3 B × N, one per SECOND:  SpO₂(0–100)  HR(bpm)  status ]
[Trailer 48 B at file_end−48:  averages · desat counts · "O₂ Score ×10" at offset 42 ]
```
So `N = (filesize − 10 − 48) / 3` seconds. A 10-h night ≈ 36 000 samples ≈ 108 KB.

⚠️ **10 h is a HARD CAP, not just a typical night (established 2026-07-18).** The ring stops a session at
**36 000 samples / 108 058 B** and does not roll over. This is not academic: when the capture host slept
04:44→08:20, the onboard `.dat` recovered 2.48 h of the 3.6 h gap and the remaining **1.12 h simply did
not exist** — the session had hit the cap at 07:13. So the ring is a backstop for gaps **up to 10 h from
the session start**, not an unconditional one. A session shorter than the cap is unaffected (a 2026-07-18
07:16→15:16 wearing pulled complete at 8.00 h / 28 816 samples, 100 % valid). `pull_session.py`
saves the raw bytes verbatim as `Wellue_O2Ring-S_<ts>_STORED.dat` + a `.meta.json` sanity record
(bytes, header, format_a flag, sample count, trailer). Header `01 03…` confirms Format A on decode.

## 6 · Operational quirks (the ones that cost hours — READ before automating)
- **Advertises ONLY when worn (finger-in).** NOT while idle, NOT on the USB charger, NOT just after
  removal. To connect for a download you must physically **wear it**.
- **BUT an ESTABLISHED link SURVIVES removal — that is the download window (2026-07-18).** On taking the
  ring off, `contact` goes to "no finger" and `worn=False`, yet the BLE connection stays up (the ring keeps
  showing its Bluetooth symbol). Since the session is finalised on removal, the moment right after taking
  it off is the *ideal* time to pull: the just-ended session is complete AND still reachable. Verified by
  pulling the 07:16→15:16 session seconds after removal. Wait too long and it powers down, and then you
  must wear it again to re-advertise.
- **It never PUSHES.** There is no auto-upload: the ring only serves files when a client asks. What the
  ViHealth app does "on removal" is the phone pulling. Any automation must poll deliberately.
- **The phone ViHealth app auto-grabs the single BLE link.** A BLE peripheral holds ONE connection — if
  the phone/app has it, nothing else can connect. **Close the app** (or phone Bluetooth off) to let the
  box connect.
- **One link, period** — the capture daemon and the puller can't both hold the ring; stop the daemon
  (`fuser -k 8760/tcp`) before `pull_session.py`.
- **Short advertising burst** — the ring advertises briefly then sleeps; a fixed-timeout `discover()`
  finds it but misses the connect window. Use an **early-exit scan**
  (`BleakScanner.find_device_by_filter`) that connects on first sight (`pull_session.py`).
- **`_HR.txt`/onboard-HR is not exposed the same way** — the honest HR is in the live 0x04 header and the
  stored `.dat`, both above.

## 7 · Capabilities summary
- **Live:** SpO₂, pulse, motion, battery, finger-contact, ~1 Hz. Feeds the daemon's ViHealth-CSV writer
  (`Spo2CsvWriter`) that OxyDex already parses — no new parser branch.
- **Onboard download:** full recorded sessions (SpO₂ + HR @1 Hz + status + a session O₂-score trailer),
  pulled without the phone. This is the same record the vendor app produces.
- **Not available on this unit:** **PPI** (peak-interval) — the live 0x04 header has no reliable IBI, and
  there is no separate PPI stream (cf. the Verity's dead PPI in `CAPTURE-HOST-FOLLOWUPS-II §V3`). Beat
  intervals, if wanted, come from a raw-PPG device, not this ring.

## 8 · Hardware validation (2026-07-17)
- Pulled **4 stored sessions**, incl. a **10 h night**: mean SpO₂ **96.3 %**, HR **50**, min SpO₂ 86 %,
  O₂-score **9.2/10**, 35 955/36 000 valid — a clean, plausible nocturnal-oximetry record.
- **Stored `.dat` vs the daemon's live SpO₂ CSV**, ~6.2 h overlap: **SpO₂ MAE 0.76 %** (bias +0.01 %,
  85 % within ±1 %), **HR MAE 2.42 bpm** (bias +0.08). The live `oxyii` capture faithfully reproduces the
  ring's own recording — validating both the live decode and the file decode against each other.

## 9 · Clock Contract implication (⚠️ carry this forward)
The comparison's best alignment needed a **+151 s (~2.5 min) shift**: the ring's **onboard clock is not
NTP-synced** and drifts from the host. Consequences under CLAUDE.md §🔒:
- The **live** path stamps with the **host's NTP wall clock** (`_now()`, monotonic-anchored) — correct
  and Clock-Contract-compliant.
- The **stored `.dat`** timestamps are on the **ring's own unsynced clock** → they need a per-download
  **offset correction** (estimated by aligning against a same-window NTP-stamped signal) before the `.dat`
  can be fused with ECG/PPG/etc. Treat onboard-`.dat` time as *approximate* until corrected.

## Related
- [`CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md`](CAPTURE-HOST-FOLLOWUPS-II-2026-07-16-BRIEF.md) — the capture bring-up (O2Ring OxyII live path landed there).
- [`CAPTURE-HOST-2026-06-29-BRIEF.md`](CAPTURE-HOST-2026-06-29-BRIEF.md) — the Health Box / capture architecture.
- [`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md) — the sibling reverse-engineering note (Polar PMD).
