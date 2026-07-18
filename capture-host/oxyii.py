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
    if len(payload) < 27:
        return []
    # u16 LE, not u8: the vendor SDK splits the payload at 20 and reads the wave section as
    # [20:24] u32 counter, [24:26] u16 LE sample count, [26:] samples. Our [26:] start was already
    # right; [25] was mislabelled "flag/reserved, seen 0x00" — it is this count's HIGH byte.
    n = int.from_bytes(payload[24:26], "little")
    return list(payload[26:26 + n])
