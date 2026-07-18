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


def frame_gap(prev_seq: int | None, seq: int) -> int:
    """Frames DROPPED between two live replies, from the [0] sequence counter (wraps at 256).

    0 = consecutive, N = N frames lost, -1 = a repeat of the same counter. Measured over 271 real frames
    2026-07-18: 262 steps were exactly +1, plus 5 repeats and 3 double-steps — so drops and duplicates do
    happen and were, until this existed, indistinguishable from the ring simply pausing."""
    if prev_seq is None:
        return 0
    step = (seq - prev_seq) % 256
    return -1 if step == 0 else step - 1


def parse_live(payload: bytes) -> dict | None:
    """cmd=0x04 24-byte header → live values.

    Offsets, established by correlating 244 real frames against known physiology (2026-07-18):
      [0]  frame sequence counter, +1 per reply, wraps at 256   → gap/drop detection (frame_gap)
      [1:5] constant 104,0,0,2 · [9]=0 [10]=199 [12]=0          → protocol/version markers
      [5]  contact   [6] SpO2   [7] motion   [8] HR   [13] battery
      [11] the ONLY other varying byte: 0 in 249/271 frames, occasional 1-29. Correlates with pleth
           AC/DC only weakly (r=0.42, driven by single observations), so NOT read as perfusion. The
           vendor's other (legacy Viatom) format carries a vibration-alert byte in the same spirit, which
           fits an occasional event flag better — plausible, unproven, so left unparsed rather than
           surfaced under a name we cannot defend.
      [14:24] all zero in every frame observed — reserved padding.
    """
    if len(payload) < 14:
        return None
    spo2, hr, motion, batt, contact = payload[6], payload[8], payload[7], payload[13], payload[5]
    return {
        "seq": payload[0],                             # frame counter → drop detection
        "spo2": spo2 if 50 <= spo2 <= 100 else None,   # 0/invalid off-finger
        "pr":   hr if 20 < hr < 250 else None,
        "motion": motion,
        "batt": batt,
        "contact": contact,                            # 0x00 no finger, 0x01 idle-present, 0x03 file open
        "worn": contact in (0x01, 0x03),
        # RAW, deliberately un-named (see the docstring): returned so it can be RECORDED and finally
        # identified. It was discarded before, which is exactly why 271 opportunistic frames could not
        # settle it. Never surface this under a physiological name until it is proven.
        "flag11": payload[11],
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
def parse_ppg(payload: bytes) -> list[int]:
    """cmd=0x04 body → the raw ~125 Hz PPG waveform samples (u8), or [] if no body/too short."""
    if len(payload) < 27:
        return []
    n = payload[24]
    return list(payload[26:26 + n])
