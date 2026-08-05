# tepna-capture — oxyii.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Wellue O2Ring-S / T8520 "OxyII" BLE protocol — live SpO2 + pulse. This is NOT the legacy Viatom
# protocol (viatom.py / the 14839ac4 service); the T8520 exposes a separate "OxyII" service and every
# legacy tool silently fails against it. Reverse-engineered reference + verification on hardware
# 2026-07-16: github.com/nglessner/o2ring-s-protocol.
#
# Flow: connect (no bond) → auth (cmd=0xFF, XOR-keyed, no reply) → setup (cmd=0x10, ack) → poll
# cmd=0x04 (~1/s); its 24-byte header carries the live SpO2/HR/motion/battery the ring's display shows.
# The live path uses only CRC-8 + MD5 + XOR — NO AES (auth is XOR; 0x10/0x04 are plaintext).
#
# Frame: [0xA5][cmd][~cmd][flag][seq][len_lo][len_hi][payload][crc8], CRC-8 poly 0x07 over all-but-crc.

from __future__ import annotations
import hashlib, time

OXYII_SERVICE = "e8fb0001-a14b-98f9-831b-4e2941d01248"
OXYII_WRITE   = "e8fb0002-a14b-98f9-831b-4e2941d01248"   # write-without-response
OXYII_NOTIFY  = "e8fb0003-a14b-98f9-831b-4e2941d01248"   # notify
OP_AUTH, OP_SETUP, OP_LIVE, OP_SET_TIME = 0xFF, 0x10, 0x04, 0xC0

# Largest declared payload the reassembler will believe. Deliberately loose rather than tight: the live
# frame is tens of bytes and a stored-session chunk is bounded by the negotiated ATT MTU (247 measured
# 2026-07-18), so anything real is far below this — but a bound set near today's MTU would break the
# .dat transfer outright if a firmware ever negotiated the 517 MTU. 2048 cannot be reached by a genuine
# frame, still caps a mis-framed stream's damage at ~2 KB instead of ~64 KB, and cannot regress the pull.
MAX_FRAME_LEN = 2048
_LEPU = hashlib.md5(b"lepucloud").digest()   # protocol salt (MD5 of the literal ASCII "lepucloud")


def crc8(data: bytes) -> int:
    """CRC-8, poly 0x07, init 0, no reflection/xorout (standard "ITU" CRC-8 — NOT the legacy XOR sum)."""
    crc = 0
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = ((crc << 1) ^ 0x07) & 0xFF if (crc & 0x80) else (crc << 1) & 0xFF
    return crc


def encode(op: int, payload: bytes = b"", seq: int = 0, flag: int = 0) -> bytes:
    h = bytes([0xA5, op, (~op) & 0xFF, flag, seq & 0xFF, len(payload) & 0xFF, (len(payload) >> 8) & 0xFF])
    return h + payload + bytes([crc8(h + payload)])


def auth_payload(serial: str = "0000", ts: int | None = None) -> bytes:
    """16-byte XOR'd auth payload. serial: 4 ASCII bytes ("0000" is the portable default). ts: epoch s.
    Note the deliberate `>> 0,1,2,3` shift (a faithful port of the vendor code — both sides match)."""
    ts = int(time.time()) if ts is None else ts
    key = bytearray(16)
    for i in range(8):
        key[i] = _LEPU[i * 2]
    key[8:12] = serial[:4].encode("ascii")
    for n in range(4):
        key[12 + n] = (ts >> n) & 0xFF
    return bytes(a ^ b for a, b in zip(bytes(key), _LEPU))


def auth_frame(serial: str = "0000") -> bytes:
    return encode(OP_AUTH, auth_payload(serial))

def setup_frame() -> bytes:
    return encode(OP_SETUP, b"\x00")

def live_frame() -> bytes:
    return encode(OP_LIVE, b"")


def set_time_frame(dt, seq: int = 0) -> bytes:
    """SET_UTC_TIME (0xC0): push the wall clock to the ring's onboard RTC so its STORED-session .dat
    timestamps line up with the NTP-synced host (the ring's RTC free-runs and drifts — measured ~+151 s
    2026-07-17; it also resets on any battery/factory event). 8-byte payload: year(u16 LE), month, day,
    hour, minute, second, then the vendor tail byte 0xCE (0x00 also accepted). The ring stores the fields
    VERBATIM with no timezone conversion, so pass LOCAL CIVIL time per the Clock Contract — the same wall
    clock the file-list `YYYYMMDDhhmmss` stamps use. Sent after the 0xFF→0x10 handshake, plaintext, in the
    standard 0xA5+CRC-8 envelope. Ref: github.com/nglessner/o2ring-s-protocol (SET_UTC_TIME)."""
    y = int(dt.year)
    pl = bytes([y & 0xFF, (y >> 8) & 0xFF, dt.month, dt.day, dt.hour, dt.minute, dt.second, 0xCE])
    return encode(OP_SET_TIME, pl, seq)


# ── Stored-session file transfer (the ONBOARD recording — the .dat the ViHealth app syncs on removal).
# Same 0xA5 envelope; opcodes + layout per github.com/nglessner/o2ring-s-protocol. NOTE the transfer
# CORRECTED 2026-07-18: an earlier note here claimed the transfer needs ATT MTU >= 517. It does NOT —
# the real negotiated MTU is 247 and an 8 h / 86 506 B session pulls clean at that. The myth came from
# printing bleak's PLACEHOLDER mtu_size (23 on BlueZ until a characteristic is acquired) plus a 6 s
# timeout against a ~4.1 s FILE_LIST reply. Do not re-introduce an MTU precondition.
OP_FILE_LIST, OP_FILE_START, OP_FILE_DATA, OP_FILE_END = 0xF1, 0xF2, 0xF3, 0xF4
OP_RT_PPG = 0x05          # raw dual-wavelength buffer (see parse_rt_ppg)


def file_list_frame(seq: int = 0) -> bytes:
    return encode(OP_FILE_LIST, b"", seq)

def file_start_frame(ts14: str, ftype: int = 0, seq: int = 0) -> bytes:
    pl = ts14.encode("ascii")[:14].ljust(14, b"\x00") + b"\x00\x00" + int(ftype).to_bytes(4, "little")
    return encode(OP_FILE_START, pl, seq)

def file_data_frame(offset: int, seq: int = 0) -> bytes:
    return encode(OP_FILE_DATA, int(offset).to_bytes(4, "little"), seq)

def file_end_frame(seq: int = 0) -> bytes:
    return encode(OP_FILE_END, b"", seq)


def parse_file_list(payload: bytes) -> list[str]:
    """GET_FILE_LIST reply → recorded-session timestamps. count byte + 16-byte slots (14-char ASCII
    `YYYYMMDDhhmmss` + 2 zero pad)."""
    if not payload:
        return []
    n, out = payload[0], []
    for i in range(n):
        slot = payload[1 + i * 16: 1 + i * 16 + 16]
        if len(slot) >= 14:
            ts = slot[:14].decode("ascii", "replace").strip("\x00")
            if ts.isdigit() and len(ts) == 14:
                out.append(ts)
    return out


class Reassembler:
    """Notify bytes → complete 0xA5 frames. The T8520 splits big live frames (24-B header + PPG body)
    across multiple notifications, so we accumulate until a full declared frame is buffered."""

    def __init__(self):
        self.buf = bytearray()

    def feed(self, data: bytes) -> list[bytes]:
        self.buf += data
        out: list[bytes] = []
        while True:
            if self.buf and self.buf[0] != 0xA5:          # resync to a lead byte
                i = self.buf.find(0xA5)
                if i < 0:
                    self.buf.clear(); break
                del self.buf[:i]
            if len(self.buf) < 8:
                break
            ln = self.buf[5] | (self.buf[6] << 8)
            # A LENGTH IS ONLY AS TRUSTWORTHY AS THE BYTE IT CAME FROM. `ln` is 16-bit, so a mis-framed
            # or truncated notification can claim up to 65535 and park the reassembler waiting for bytes
            # that never come — swallowing every VALID frame that follows into one bogus buffer (~64 KB
            # is ~7 minutes at this data rate) until the link happens to drop. Nothing this device sends
            # is anywhere near that (see MAX_FRAME_LEN). Treat an implausible length as loss of sync —
            # drop the lead byte and resync on the next 0xA5 — rather than trusting it.
            if ln > MAX_FRAME_LEN:
                del self.buf[:1]
                continue
            total = 7 + ln + 1
            if len(self.buf) < total:
                break
            out.append(bytes(self.buf[:total])); del self.buf[:total]
        return out


def decode(frame: bytes):
    """Validate one complete frame → (opcode, payload) or None."""
    if len(frame) < 8 or frame[0] != 0xA5 or frame[2] != (~frame[1]) & 0xFF:
        return None
    ln = frame[5] | (frame[6] << 8)
    if len(frame) != 7 + ln + 1 or crc8(frame[:-1]) != frame[-1]:
        return None
    return frame[1], frame[7:7 + ln]


def session_restarted(prev_duration: int | None, duration: int) -> bool:
    """Did the ring start a NEW recording session between two live replies?

    Replaces the former `frame_gap()`, which was built on a false premise. That function read `[0]` as a
    frame sequence counter and reported "N live frame(s) dropped" whenever it stepped by more than one.
    `[0:4]` is not a counter — it is the session DURATION in seconds (u32 LE), confirmed against the
    vendor's own parser (LepuDemo `lepu-blepro` → RtParam.setDuration) AND against our data: 2736
    consecutive frames read 0 while the ring sat idle, which no frame counter can do. The old function
    therefore emitted phantom loss — 9 warnings in one evening, including "111 live frame(s) dropped",
    which was simply a session starting.

    A duration that goes BACKWARDS is the one real event here: the ring began a new session."""
    return prev_duration is not None and duration < prev_duration


def parse_live(payload: bytes) -> dict | None:
    """cmd=0x04 live header → live values.

    LAYOUT CORRECTED 2026-07-18 against the VENDOR'S OWN PARSER — the previous offsets were partly wrong
    and one of them was a live data bug. Source: viatom-develop/LepuDemo ships the official
    `lepu-blepro` SDK as an AAR; its OxyII parser (`TAG="OxyIIBleInterface"`) maps bytes into the public
    `oxy2.RtParam` DTO. Read directly from the decompiled class, the chain is:

        [0:4] u32 LE -> setDuration      [8:10] u16 LE -> setPr
        [4]          -> setRunStatus     [10] & 0x01   -> setFlag
        [5]          -> setSensorState   [11]          -> setMotion
        [6]          -> setSpo2          [12]          -> setBatteryState
        [7] / 10.0   -> setPi            [13]          -> setBatteryPercent

    The SDK's offset base is identical to ours: it parses `copyOfRange(payload, 0, 20)` of the same
    payload our `decode()` returns, so SDK offset N == payload[N].

    TWO CORRECTIONS THAT MATTERED, both independently confirmed against our own recordings:

    * **[7] is PERFUSION INDEX (value/10 %), not motion. [11] is motion.** They were swapped. This was
      not cosmetic: `[7]` was being written into the SpO2 CSV's `Motion` column, and OxyDex excludes
      artifact samples with `r.motion === 0`. Measured over a real 5288-row night, `[7]` is non-zero in
      99.9% of frames (mean 13.6 => PI 1.36%, range 0-18.3%) — a perfusion index is continuously
      non-zero, a sleeping subject's motion is not. The vendor's OWN ViHealth exports settle it from the
      other side: their Motion column is 99.4-99.8% ZERO (max 18-62), which is exactly how `[11]`
      behaves (0 in 249/271 frames). So on Vigil-captured files that filter was keeping ~0.1% of
      samples. Files written before this fix carry PI in the Motion column.
    * **[0:4] is the session duration (u32 LE), not a frame counter** — see session_restarted().

    `[1]`=104 was never a constant: it is duration's second byte (104*256 ~ 7.4 h into a session), with
    the low byte ticking +1/s. `[10]`=199 (0xC7) is not a constant either; the SDK reads only bit 0.
    `[14]` carries four 2-bit subfields the SDK parses but does not expose in RtParam — left unparsed
    rather than surfaced under a name we cannot defend.
    """
    if len(payload) < 14:
        return None
    spo2, contact = payload[6], payload[5]
    pr = int.from_bytes(payload[8:10], "little")     # u16 LE — [9] is the HIGH byte, not padding
    return {
        "duration": int.from_bytes(payload[0:4], "little"),   # seconds into the ring's session
        "spo2": spo2 if 50 <= spo2 <= 100 else None,   # 0/invalid off-finger
        "pr":   pr if 20 < pr < 250 else None,
        "pi":   payload[7] / 10.0,                     # perfusion index, %
        "motion": payload[11],                         # WAS [7] — the swap that caused the data bug
        "flag": payload[10] & 0x01,
        # The WHOLE byte, beside the bit. The vendor names [10] `flag(标志参数, 0:脉搏音标志)` —
        # "indicator parameter, bit 0 = pulse-tone flag" — and its SDK reads bit 0 and nothing else, which
        # is why we did too. Measured 2026-08-05 across 8 nights / 184 362 frames: bit 0 is set on
        # **100.0 % of frames on every night**, so it carries no per-frame information at all and is a
        # SETTING (the buzzer is enabled), not an event. The byte itself reads 0xC7, and this module's own
        # note has said since 2026-07-18 that it "is not a constant either" — so bits 1-7 vary and nothing
        # has ever looked at them. Recorded raw so a night can answer what changes there without a
        # re-capture; interpreting them is not attempted here.
        "flag_raw": payload[10],
        "batt": payload[13],
        "batt_state": payload[12],                     # 0 = not charging
        "run_status": payload[4],
        "contact": contact,                            # 0x00 no finger, 0x01 idle-present, 0x03 file open
        "worn": contact in (0x01, 0x03),
    }


# ── Live PPG waveform (O2RING-LIVE-PPG-WAVEFORM Phase 1, decoded + validated 2026-07-18) ──────────────
# Each cmd=0x04 reply is NOT just the 24-B status header parse_live reads — it also carries the ring's
# raw ~125 Hz plethysmograph, which parse_live (and every prior tool) discarded. Layout decoded off 90
# real frames (all matched; concatenated bodies are gap-free, boundary jumps 0-8; header HR/SpO2 cross-
# checked vs the paired ECG at 49 bpm):
#   [0:24]  status header (parse_live)
#   [24]    sample count N (u8)             — verified: len(payload) == 24 + 2 + N on every frame
#   [25]    flag / reserved (seen 0x00)
#   [26:26+N]  N one-byte UNSIGNED optical samples, ~125 Hz (steady-state ~126 samples per ~1.0 s poll),
#              single channel (even/odd samples are near-identical, so NOT interleaved LEDs).
# The stream is RAW (per HEALTH-BOX-VISION: no on-box DSP): occasional isolated spike samples (e.g. 0x9c,
# ~0.66/frame, scattered — not a fixed marker) are left in place for a downstream consumer to reject.
PPG_INVALID = 156          # 0x9C — the device's INVALID-SAMPLE sentinel, NOT a signal excursion

# Samples the ring produces per SESSION-SECOND — the unit that makes PPG loss ARITHMETIC instead of
# inferred (O2RING-FRAME-SAMPLE-LOCK). Note carefully what this is NOT: it is not a per-FRAME constant.
# Measured over 60 clean sessions / 60.9 h of the real corpus, delivery is 126.04 samples per session-
# second (the u32 `duration` counter in [0:4]) with a per-session spread of 125.6-126.5. Per FRAME it is
# 124-128 — the ring hands back whatever accumulated since the last poll, and the poll interval jitters
# (0.989-1.007 s observed), so a frame count is NOT a fixed quantity and 126*frames is not an expectation.
#
# It is also NOT a sample RATE and must never be used as one: 126 samples per DEVICE second is 125.80
# samples per HOST second, because the ring's own second runs -3446 ppm against the NTP-disciplined host
# (measured, 2026-08-01, 33 490 device-seconds vs 33 605.8 host-seconds). The device axis is the ring's,
# and it is the right axis for COUNTING what the ring produced; it is the wrong axis for TIMING, which is
# why the samples are still host-arrival stamped (O2RING-SYNTHESISED-AXIS §6). Do not reconcile this
# number with `O2PPG_FS_DEFAULT`; they are counts on two different clocks and both are correct.
PPG_FRAME_SAMPLES = 126


def ppg_sample_count(payload: bytes) -> int | None:
    """The count of PPG samples the DEVICE DECLARES for this 0x04 frame ([24:26], u16 LE) — or None
    when the frame carries no waveform section at all.

    Surfaced separately from `parse_ppg` because the declared count and the delivered samples answer
    different questions and are allowed to disagree. `parse_ppg` slices `[26:26+N]`, which silently
    returns SHORT if the frame's own length field and its declared count are inconsistent — so
    `len(parse_ppg(p))` cannot distinguish "the ring sent 60 samples" from "the ring said 126 and we got
    60". `declared - delivered` is that distinction, and it costs one u16 read to keep.

    None (no body) is deliberately NOT 0 (a body declaring zero samples). The first is a frame shape,
    the second is a measurement of nothing — the same blank-vs-zero rule the writers keep."""
    if len(payload) < 26:
        return None
    return int.from_bytes(payload[24:26], "little")


def ppg_stream_offset(payload: bytes) -> int | None:
    """The ring's own CUMULATIVE stream position for this frame ([20:24], u32 LE) — or None when the
    frame is too short to carry the field.

    This is the vendor's `RtWave.offset` (`lepu-blepro` 1.3.6, `doad/Cthrow.java`), and because samples
    are ONE BYTE it is a sample index, not a byte count. The field has sat in this module's layout
    comment as "[20:24] u32 counter" since 2026-07-18 and has never been read by anything — the vendor's
    own SDK decodes it and discards it too.

    WHY IT EARNS A COLUMN. It is the only device-side sequence number the ring exposes, so
    `SUM(declared)` against `DELTA(offset)` decides — with **no host clock anywhere in the comparison** —
    whether the ring counts its own `PPG_INVALID` bytes in its stream position. That is the difference
    between those bytes being INSERTED extras (=> the ADC runs at 125 Hz and the markers are not samples)
    and being REPLACEMENTS for real ones (=> 126 Hz and they are). Arrival timing cannot separate those
    two; this counter can. Paired with `duration` ([0:4], session seconds) it also gives
    `DELTA(offset)/DELTA(duration)` — a sample rate measured entirely on the device's own counters, which
    is a different class of evidence from every rate figure this project currently holds.
    See `DEVICE-RATE-TRUTH-2026-08-05-BRIEF.md` §2.2 and §6.1.

    Threshold is 24, not 26: the offset occupies [20:24] and the sample count [24:26], so a frame can
    carry an offset without carrying a wave header. Requiring 26 would silently drop the field on
    exactly the malformed frames worth seeing.

    None (field absent) is deliberately NOT 0, matching `ppg_sample_count`: **0 is a real offset** — it
    is what the first frame of a session reports — while None means the bytes were not there at all."""
    if len(payload) < 24:
        return None
    return int.from_bytes(payload[20:24], "little")


# ── RAW DUAL-WAVELENGTH PPG (cmd 0x05) — MEASURED ON HARDWARE 2026-08-05 ─────────────────────────────
# `O2RING-RAW-STREAMS-ABSENT-2026-08-04` concluded this ring exports no raw red/IR. It does. That sweep
# scored 0x05's fixed 922-byte reply as noise-like against a GENERIC byte-wise metric — which is exactly
# what interleaved little-endian u32 pairs look like without record framing. Read as 9-byte records of
# {u32, u32, u8} (the layout `lepu-blepro` 1.3.6's `oxyIIGetRtPpg` uses), both channels are waveforms:
#
#   IR   range 8585  median|delta| 127   ratio 0.0148      ratio = median|delta| / range
#   RED  range 5471  median|delta|  92   ratio 0.0168      a waveform is << 1
#   IR, SAME data shuffled                ratio 0.3395      <- 23x rougher; ordering is the signal
#
# So the payload is not noise, and "re-deriving SpO2 is impossible on this hardware" no longer follows
# from the premise it rested on. Whether the ratio-of-ratios is RECOVERABLE is a separate question this
# does not answer — it only establishes that the two channels exist and are readable.
# ⚠️ MEASURED NOT REQUIRED (hardware A/B, 2026-08-05). The SDK sends this argument, so we send it — but
# a same-session control alternating `{0x07,0x01}` against an EMPTY payload got 15 replies each, every
# one 922 bytes with 102 records. The argument neither unlocks nor changes the reply. Keep it for
# fidelity to the vendor flow; do not describe it as the thing that revealed the stream, and do not
# assume a future opcode's argument matters just because an SDK passes one.
RT_PPG_ARG = bytes([0x07, 0x01])
RT_PPG_REC = 9                       # u32 LE chA | u32 LE chB | u8 motion  (see WHICH-IS-WHICH below)

# WHICH IS WHICH — MEASURED 2026-08-05: chA (`channel 0`) is RED, chB (`channel 1`) is IR.
# ⚠️ THAT IS THE OPPOSITE OF THE VENDOR SDK, which names the first u32 IR and the second RED. Trusting
# the header would have produced a confident WRONG saturation, because SpO2 is the ratio-of-ratios
# R = (AC/DC)_red / (AC/DC)_ir and a swapped pair does not fail loudly. Over 3060 contiguous samples
# (see parse_rt_ppg on why they reconstruct): AC/DC = 0.1184 on chA vs 0.2425 on chB, so R = 0.4885 ->
# SpO2 ~ 97.8% against the ring's own reported 97%. The swap gives 59%, off by 38 points.
#
# THE COLUMNS ARE STILL RECORDED IN DEVICE ORDER, deliberately. A capture writes what the device sent;
# the identification is an interpretation, it rests on ONE session at ONE saturation against a generic
# `110 - 25R` calibration, and it belongs in the analysis layer where it can be revised without
# rewriting recorded files. Re-confirm at a different saturation before any clinical number uses it.
#
# HOW IT WAS MEASURED, including the way that did NOT work: "take ONE buffer and compute AC/DC" fails —
# it returns R ~ 1.00 both ways, because 102 samples span well under one cardiac cycle and peak-to-peak
# over that window measures the local trend, not the pulse. The working method needs the whole
# reconstruction: concatenate the tiled buffers, subtract a slow moving baseline, take AC as the rms of
# the residual over many full cycles, then form R both ways and compare against the ring's own reported
# SpO2 (cmd 0x04) in the same session. The right assignment lands within ~1 point; the swap is ~38 off.


def rt_ppg_frame(seq: int = 0) -> bytes:
    """cmd=0x05 — ask for the raw dual-wavelength buffer."""
    return encode(OP_RT_PPG, RT_PPG_ARG, seq)


def parse_rt_ppg(payload: bytes) -> list[tuple[int, int, int]]:
    """cmd=0x05 reply -> [(chA, chB, motion), ...], or [] when the frame carries no records.

    Layout, measured on device `S8AW2100` and matching the vendor SDK's `RtPpg`:
        [0:2]        u16 LE record count
        [2 : 2+9N]   N records of {u32 LE chA, u32 LE chB, u8 motion}  (chA/chB per WHICH-IS-WHICH)
    The observed reply is 922 B with a declared count of 102, i.e. 2 + 9*102 = 920 and TWO BYTES OVER.
    Those two are not decoded here and are not assumed to be padding — the record count is taken from
    the device's own field and the slice is bounded by the buffer, so a trailer of any size is ignored
    rather than silently absorbed into a record.

    ⚠️ THE RATE IS BOUNDED, NOT KNOWN, AND IS NOT ASSERTED HERE. 102 is a CAP: polled slowly the count
    pins at 102, but polled every 0-0.3 s it falls right through 0, 4, 10 ... 70 (measured 2026-08-05),
    which is what lets `count = fs*dt` be fitted at all. Over 35 unsaturated replies: 125.7 Hz by least
    squares (intercept 7.9 records), 155.5 Hz forced through the origin, 150.7 Hz as the median per-point
    ratio. Solid: it is NOT the 200 Hz the SDK claims. Suggestive only: the 125.7 coincides with the
    pleth's own O2PPG_FS_DEFAULT = 125.738, which would make this the same ADC stream delivered raw --
    but the estimators disagree by 25%, so do not quote it. fs stays 0 on the bus until a longer
    starvation run settles it.

    ⚠️ AND DO NOT USE A VALUE-BASED SEAM TEST to argue the replies are contiguous. That was tried and
    RETRACTED: it called consecutive replies contiguous at 0.5s, 1.0s AND 2.0s spacing, which cannot all
    be true. On a smooth waveform a gap of hundreds of samples still lands close in value.

    `motion` is returned as the raw byte. The vendor doubles it for display (`* 2`); that is a
    presentation choice and is not applied to a recorded value."""
    if len(payload) < 2:
        return []
    n = int.from_bytes(payload[0:2], "little")
    avail = max(0, (len(payload) - 2) // RT_PPG_REC)
    out = []
    for i in range(min(n, avail)):
        o = 2 + i * RT_PPG_REC
        out.append((int.from_bytes(payload[o:o + 4], "little"),
                    int.from_bytes(payload[o + 4:o + 8], "little"),
                    payload[o + 8]))
    return out


def parse_ppg(payload: bytes) -> list[int]:
    """cmd=0x04 body → the raw ~125 Hz PPG waveform samples (u8), or [] if no body/too short.

    ⚠️ 156 (0x9C) is a SENTINEL, not signal. The vendor SDK replaces it by interpolating its neighbours
    (both the OxyII wave class and the gen-1 `OxyBleResponse.RtWave` do this), and it occurs ~0.66x per
    frame in our captures. It is returned RAW here — we do not fabricate an interpolated measurement —
    but a consumer MUST reject `PPG_INVALID` rather than treat it as a real amplitude. The earlier note
    calling these "raw signal, left in place for a downstream consumer to reject" was half right: they
    are not signal, and no consumer rejects them yet.

    Also note the vendor's DISPLAY transform is `127 - sample` (gen-1 used `100 - temp/2`), i.e. the
    vendor's rendered pleth is INVERTED relative to these raw bytes. Anything comparing our waveform to
    a vendor screenshot, or assuming systolic peaks are maxima, must account for that.
    """
    # u16 LE, not u8: the vendor SDK splits the payload at 20 and reads the wave section as
    # [20:24] u32 counter, [24:26] u16 LE sample count, [26:] samples. Our [26:] start was already
    # right; [25] was mislabelled "flag/reserved, seen 0x00" — it is this count's HIGH byte.
    # Single-sourced on ppg_sample_count so the declared count has ONE reader; a frame with no body
    # (None) and a body declaring nothing (0) both slice to [], which is what this function promises.
    n = ppg_sample_count(payload)
    if n is None:
        return []
    return list(payload[26:26 + n])
