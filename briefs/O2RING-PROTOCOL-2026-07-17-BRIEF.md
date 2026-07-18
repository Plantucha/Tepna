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
  `[0]` is a frame **sequence counter** (+1 per reply, wraps at 256) — wired in as drop detection.
  `[1:5]`=`104,0,0,2`, `[9]`=0, `[10]`=199, `[12]`=0 are constant protocol markers; `[14:24]` are zero
  in every frame observed (reserved padding).

  **`[11]` is UNIDENTIFIED and deliberately un-named.** It is the only other varying byte: 0 in 249/271
  frames, occasionally 1–29. Correlation with pleth AC/DC is weak (r=0.42, driven by single
  observations), so it is **not** read as a perfusion index. The leading hypothesis is an event/alert
  flag — the ring **vibrates on desaturation**, and the vendor's legacy Viatom format carries a
  vibration-alert byte in the same spirit. Plausible, unproven.
  **Experiment now instrumented (2026-07-18):** the byte was previously DISCARDED, which is exactly why
  271 opportunistic frames could not settle it. `parse_live` now returns it raw as `flag11` and
  `writers.OxyFrameLogWriter` records one row per frame to a `*_OXYFRAME.txt` **sidecar** (never a
  column — the SpO₂ CSV is a vendor layout OxyDex parses positionally). A worn night with natural
  desaturations is the answer: **an alert flag should fire AT desat events; a perfusion index should
  track pleth amplitude continuously.** Do not name the byte until that correlation is in hand.

### 3b · The `0x04` body is ALSO a ~125 Hz PPG waveform (decoded 2026-07-18)
Every `0x04` reply carries **more than the 24-byte header** — the rest is the ring's raw plethysmograph.
This is why `oxyii.Reassembler` exists (the frames span many BLE notifications). Layout, decoded off 90
real frames (all matched; concatenated bodies gap-free, boundary jumps 0–8; header HR/SpO₂ cross-checked
against the paired ECG at 49 bpm) — see `oxyii.parse_ppg`:

| Bytes | Meaning |
|---|---|
| `[0:24]` | status header (§3 above, `parse_live`) |
| `[24]` | sample count `N` (u8) — verified `len(payload) == 24 + 2 + N` on **every** frame |
| `[25]` | flag / reserved (only `0x00` observed) |
| `[26:26+N]` | `N` **unsigned 8-bit** optical samples, **single channel** |

- **Single channel, not interleaved LEDs** — even/odd samples are near-identical.
- **Rate: 125.738 Hz measured**, not the ~100 Hz the upstream reference states, and not the round 125.0
  first guessed (which was 0.59 % low ⇒ ~212 s of divergence over a 10 h night between the phone-timestamp
  column and the synthesized relative-ms column). Calibrated over 12 sessions / 5.8 h / 2 616 483 samples,
  per-session spread 125.59–125.88 Hz. Short-window swings (~84–147 Hz) are BLE delivery jitter, not ADC
  drift. Overridable per unit via `o2ring.ppg_fs` (`settings_schema.py`, range 100–200).
- **Raw by design** — occasional isolated spike samples (e.g. `0x9c`, ~0.66/frame, scattered, not a fixed
  marker) are left in place for a downstream consumer to reject. No on-box DSP (HEALTH-BOX-VISION §4).
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
