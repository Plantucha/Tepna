# tepna-capture — muse_athena.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Muse S Athena: tokeniser and field unpackers for the notifications of data characteristic
# 273e0013-4c4d-454d-96be-f03bac821358. PURE (no bleak, no I/O).
#
# WIRE FORMAT, not vendor code, and CLEAN ROOM: every layout fact below was measured from this
# project's own captures of the owner's headband and is recorded, with the capture as evidence, in
# `briefs/MUSE-ATHENA-PROTOCOL-2026-11-14-BRIEF.md`. No third-party decoder source was read or copied.
#
# What is MEASURED (brief §2): the packet frame, the five record tags and their sizes, the per-tag
# record index, the 24-bit device tick, and the bit packing of the optics and motion records.
# Measured on the worn probe of 2026-11-14 (brief §6): the GATT table, the control channel and its
# start sequence, the battery in record 0x88, the EEG record as 2 samples x 8 channels, and the sizes
# of three more tags (0x11, 0x34, 0x35). Those three have layouts INFERRED from their sizes only, so
# this module tokenises them and returns their bytes raw. It never guesses a layout.
#
# ABSENCE (CLAUDE.md §∅): a packet that does not tokenise is refused with a named reason and yields
# no sample; a jump in a counter is reported as a count of lost packets or records. Nothing is filled.

from __future__ import annotations
import json as _json
from dataclasses import dataclass

SERVICE = "0000fe8d-0000-1000-8000-00805f9b34fb"  # brief §6.2
CONTROL_CHAR = "273e0001-4c4d-454d-96be-f03bac821358"  # write-without-response + notify: commands and JSON replies
DATA_CHAR = "273e0013-4c4d-454d-96be-f03bac821358"  # notify; the only characteristic in the evidence capture
CHAR_0014 = "273e0014-4c4d-454d-96be-f03bac821358"  # write + indicate; meaning not measured (brief §6.2)
CHAR_0015 = "273e0015-4c4d-454d-96be-f03bac821358"  # write-without-response + notify; meaning not measured
# The probe client subscribed to every notify or indicate characteristic, and it streamed. The
# recorder subscribes to the same set, so the one sequence that was measured is the one it runs.
NOTIFY_CHARS = (CONTROL_CHAR, DATA_CHAR, CHAR_0014, CHAR_0015)

HEADER_LEN = 9  # [length u8][packet counter u8][7 bytes, see brief §2.1]
RECORD_HEAD = 5  # [tag u8][record index u8][device tick, 24 bit little-endian]

TAG_EEG = 0x12
TAG_OPTICS = 0x36
TAG_MOTION = 0x47
TAG_53 = 0x53  # meaning unresolved
TAG_88 = 0x88  # battery in its first two data bytes (brief §6.4); the other 18 bytes unresolved
TAG_BATTERY = TAG_88
TAG_11 = 0x11  # layout INFERRED from the size only (brief §6.7): kept raw
TAG_34 = 0x34  # layout INFERRED from the size only: kept raw
TAG_35 = 0x35  # layout INFERRED from the size only: kept raw

# Whole record size per tag, head included. Solved from the capture: with the first five sizes all
# 58 075 packets of the evidence capture tokenise to their last byte (brief §2.2). The last three
# were solved from single-record packets of the preset probe (brief §6.7).
RECORD_SIZE = {
    TAG_EEG: 33,
    TAG_OPTICS: 45,
    TAG_MOTION: 41,
    TAG_53: 29,
    TAG_88: 25,
    TAG_11: 33,
    TAG_34: 35,
    TAG_35: 45,
}

TICK_HZ = 10_000_000  # device ticks per second: 78 125 per EEG record at 128 records/s (brief §2.4)
TICK_MOD = 1 << 24  # the tick field wraps every 1.6777 s

EEG_FIELDS = 16  # 14-bit, LSB-first: 2 samples x 8 channels, sample after sample (brief §6.5)
EEG_WIDTH = 14
EEG_CHANNELS = 8
EEG_SAMPLES = 2
# The four electrodes pinned by the owner's events in the worn capture (brief §6.5). Channels 4-7
# are not identified, so they keep their wire number and no name.
EEG_ELECTRODES = ("left-ear", "left-forehead", "right-forehead", "right-ear")
OPTICS_CHANNELS = 16  # 20-bit, LSB-first, one sample per record
OPTICS_WIDTH = 20
MOTION_CHANNELS = 6  # int16 little-endian, sample-major
MOTION_SAMPLES = 3


@dataclass(frozen=True)
class Record:
    tag: int
    index: int  # per-tag counter, +1 modulo 256 from one record of this tag to the next
    tick: int  # low 24 bits of the device clock, TICK_HZ units
    data: bytes


@dataclass(frozen=True)
class Packet:
    counter: int  # +1 modulo 256 from one notification to the next
    header: bytes  # bytes 2..8 of the notification, kept verbatim
    records: tuple[Record, ...]


def _records(pkt: bytes, off: int) -> tuple[tuple[Record, ...], str | None]:
    """Records from `off` to the end of `pkt`, or a refusal reason. Recursion, not a hand-advanced
    index: a packet holds at most nine records, and a wrong size cannot loop."""
    if off == len(pkt):
        return (), None
    size = RECORD_SIZE.get(pkt[off])
    if size is None:
        return (), "unknown-tag"
    if off + size > len(pkt):
        return (), "truncated-record"
    rest, why = _records(pkt, off + size)
    if why is not None:
        return (), why
    rec = Record(
        pkt[off],
        pkt[off + 1],
        int.from_bytes(pkt[off + 2 : off + RECORD_HEAD], "little"),
        bytes(pkt[off + RECORD_HEAD : off + size]),
    )
    return (rec,) + rest, None


def tokenise(pkt: bytes) -> tuple[Packet | None, str | None]:
    """One notification → (Packet, None), or (None, reason). A refused packet yields nothing."""
    if len(pkt) < HEADER_LEN:
        return None, "short"
    if pkt[0] != len(pkt):
        return None, "length-byte"
    recs, why = _records(pkt, HEADER_LEN)
    if why is not None:
        return None, why
    if not recs:
        return None, "no-record"
    return Packet(pkt[1], bytes(pkt[2:HEADER_LEN]), recs), None


def lost_between(prev: int | None, cur: int) -> int:
    """Packets (or records of one tag) lost between two consecutive 8-bit counters. The counter is
    modulo 256, so a loss of exactly 256 reads as 0 and a repeated counter reads as 255: the caller
    pairs this with the device tick when the stream has one."""
    if prev is None:
        return 0
    return (cur - prev - 1) % 256


def tick_seconds(prev: int, cur: int) -> float:
    """Device time from one tick to a later one, in seconds, across at most one wrap."""
    return ((cur - prev) % TICK_MOD) / TICK_HZ


def unpack_lsb(data: bytes, width: int, signed: bool = False) -> list[int]:
    """Consecutive `width`-bit fields, least-significant bit first; trailing bits are dropped."""
    v = int.from_bytes(data, "little")
    mask = (1 << width) - 1
    out = [(v >> (width * j)) & mask for j in range(len(data) * 8 // width)]
    if signed:
        out = [x - (1 << width) if x >> (width - 1) else x for x in out]
    return out


def eeg_fields(rec: Record) -> list[int] | None:
    """The 16 raw 14-bit fields of an EEG record, in WIRE ORDER. Not channels: see brief §4."""
    if rec.tag != TAG_EEG or len(rec.data) != RECORD_SIZE[TAG_EEG] - RECORD_HEAD:
        return None
    return unpack_lsb(rec.data, EEG_WIDTH)[:EEG_FIELDS]


def optics(rec: Record) -> list[int] | None:
    """The 16 raw 20-bit optical values of one sample, in wire order."""
    if rec.tag != TAG_OPTICS or len(rec.data) != RECORD_SIZE[TAG_OPTICS] - RECORD_HEAD:
        return None
    return unpack_lsb(rec.data, OPTICS_WIDTH)[:OPTICS_CHANNELS]


def motion(rec: Record) -> list[tuple[int, ...]] | None:
    """Three samples of six signed 16-bit values each, in wire order (sample after sample)."""
    if rec.tag != TAG_MOTION or len(rec.data) != RECORD_SIZE[TAG_MOTION] - RECORD_HEAD:
        return None
    v = unpack_lsb(rec.data, 16, signed=True)
    return [tuple(v[s * MOTION_CHANNELS : (s + 1) * MOTION_CHANNELS]) for s in range(MOTION_SAMPLES)]


def eeg_samples(rec: Record) -> list[tuple[int, ...]] | None:
    """The two samples of eight channels in one EEG record, sample after sample (brief §6.5). Channels
    0-3 are `EEG_ELECTRODES`; 4-7 are unidentified. Raw 14-bit counts: the scale is not measured."""
    f = eeg_fields(rec)
    if f is None:
        return None
    return [tuple(f[s * EEG_CHANNELS : (s + 1) * EEG_CHANNELS]) for s in range(EEG_SAMPLES)]


def battery_pct(rec: Record) -> float | None:
    """Battery percent from a 0x88 record: the first two data bytes, little-endian, over 256. Held
    against the device's own `bp` reply in 18 presets, largest difference 0.09 points (brief §6.4)."""
    if rec.tag != TAG_BATTERY or len(rec.data) != RECORD_SIZE[TAG_BATTERY] - RECORD_HEAD:
        return None
    return int.from_bytes(rec.data[:2], "little") / 256


def frame_counter(pkt: bytes) -> int | None:
    """The packet counter of a notification whose frame header holds, or None. It reads the header
    only, so a packet that `tokenise` refuses for a record fault still keeps its place in the counter
    sequence. A short packet or a wrong length byte has no trusted header and gives None."""
    if len(pkt) < HEADER_LEN or pkt[0] != len(pkt):
        return None
    return pkt[1]


class TickClock:
    """The 24-bit device tick unwrapped into a running count of ticks.

    Each step is read as a SIGNED step of less than half the modulus (0.84 s), so a packet whose first
    record is a little older than the last packet's steps back a little and never forward by a whole
    wrap. A real silence longer than 0.84 s aliases by a multiple of 1.68 s. The host stamp beside each
    row still carries the true gap, and the seam sidecar compares the two clocks."""

    def __init__(self) -> None:
        self.ticks: int | None = None

    def feed(self, tick: int) -> int:
        # `ticks` is congruent to the last tick modulo TICK_MOD, so it is its own previous tick.
        if self.ticks is None:
            self.ticks = tick
        else:
            step = (tick - self.ticks) % TICK_MOD
            if step >= TICK_MOD // 2:  # half a wrap or more forward reads as a step back
                step -= TICK_MOD
            self.ticks += step
        return self.ticks

    def ns(self, tick: int) -> int:
        """The unwrapped device time of `tick` in nanoseconds: 100 ns per tick at 10 MHz."""
        return self.feed(tick) * 1_000_000_000 // TICK_HZ


# ── The control channel (brief §6.3) ──────────────────────────────────────────────────────────────
# A command is [length + 1][ASCII][0x0a], the public convention of the earlier Muse models. A reply is
# JSON, sent as fragments of [length][ASCII] on the control characteristic.


def command(text: str) -> bytes:
    """One control command on the wire."""
    body = text.encode("ascii") + b"\n"
    return bytes([len(body)]) + body


def start_sequence(preset: str) -> tuple[str, ...]:
    """The commands that started a stream in the probe client of 2026-11-14 (brief §6.3), in order.
    What `L1` does, and whether the second `dc001` is needed, is not measured: the sequence is kept
    whole, because it is the one that was seen to work."""
    return ("h", "v6", "s", "h", preset, "s", "dc001", "dc001", "L1")


STOP_SEQUENCE = ("s", "h")


class ControlReplies:
    """Joins the fragments of the control channel into whole JSON replies.

    A fragment is [n][n bytes of text]; a reply is complete when its braces balance. Text that does not
    parse is returned as a string, so a reply is never lost and never invented."""

    def __init__(self) -> None:
        self._buf = ""

    def feed(self, frag: bytes) -> list:
        if not frag:
            return []
        self._buf += frag[1 : 1 + frag[0]].decode("ascii", errors="replace")  # the slice stops at the end
        out: list = []
        depth = 0
        # `opened` (where the reply now open began) is bound at the first `{`: until then `depth` is 0,
        # so neither read of it below can run first.
        for i, ch in enumerate(self._buf):
            if ch == "{":
                if depth == 0:
                    opened = i
                depth += 1
            elif ch == "}" and depth > 0:
                depth -= 1
                if depth == 0:
                    out.append(_reply(self._buf[opened : i + 1]))
        # An open reply waits for its next fragment; text outside any reply is dropped.
        self._buf = self._buf[opened:] if depth else ""
        return out


def _reply(text: str):
    try:
        return _json.loads(text)
    except ValueError:
        return text
