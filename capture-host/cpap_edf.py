# tepna-capture — cpap_edf.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# BIT-ACCURATE ResMed EDF / EDF+ WRITER (and a matching reader for verification). Turns BLE-captured
# CPAP data into STR.edf / BRP.edf / PLD.edf / EVE.edf files that OSCAR and SleepHQ read exactly like a
# night pulled off the SD card. The suite already DECODES these (cpapdex-edf.js); this is the inverse.
#
# WHY BIT-ACCURATE IS ACHIEVABLE. Every field layout, signal scaling, and the per-record checksum were
# reverse-engineered from REAL AirSense 11 files in uploads/ and are pinned by a round-trip test:
# decode a genuine file → re-encode here → the bytes are IDENTICAL. The checksum is the crux —
#
#   ResMed Crc16 = CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflect, no xorout),
#   computed over every data byte of a record EXCEPT the trailing Crc16 int16 itself.
#
# Confirmed against three consecutive BRP records (0xdf1e/0xca15/0x6735). The suite's reader and OSCAR
# both IGNORE the checksum, so it is not needed for a file to OPEN — but reproducing it is what makes a
# written file byte-identical to what the device would have written.
#
# EDF STRUCTURE (Kemp & Olivan 2003; EDF+ Kemp & Roessen 2013): a 256-byte main header, then ns × 256
# byte signal headers (field-major), then data records of int16-LE samples (signal-major within a
# record). Physical value = digital × (physMax-physMin)/(digMax-digMin) + offset. All header fields are
# ASCII, left-justified, space-padded — reproduced verbatim so a re-encode is byte-exact.
from __future__ import annotations

import struct

# ── CRC-16/CCITT-FALSE, table-driven (the ResMed EDF checksum) ────────────────────────────────────────
_CRC16_TABLE = []
for _b in range(256):
    _c = _b << 8
    for _ in range(8):
        _c = ((_c << 1) ^ 0x1021) & 0xFFFF if _c & 0x8000 else (_c << 1) & 0xFFFF
    _CRC16_TABLE.append(_c)


def crc16_ccitt(data: bytes) -> int:
    """CRC-16/CCITT-FALSE over `data` — the ResMed EDF per-record checksum. init 0xFFFF, no reflect."""
    c = 0xFFFF
    for byte in data:
        c = ((c << 8) & 0xFFFF) ^ _CRC16_TABLE[(c >> 8) ^ byte]
    return c


_MAIN = 256
_SIGHDR = 256


def _fld(raw: bytes, off: int, length: int) -> str:
    return raw[off:off + length].decode("latin1")


def _pad(value, width: int) -> bytes:
    """One EDF field: ASCII, left-justified, space-padded (0x20) to `width`. Overlong is truncated,
    which the EDF spec forbids — callers pass values that fit, and the round-trip test proves it."""
    s = str(value)
    return s.encode("latin1")[:width].ljust(width, b" ")


class Signal:
    """One EDF signal: its header fields (raw, for byte-exact reproduction) plus its int16 samples per
    record, flat. `samples` length is `spr * n_records`. The Crc16 lane is a Signal like any other."""

    __slots__ = ("label", "transducer", "dim", "pmin", "pmax", "dmin", "dmax", "prefilter", "spr",
                 "reserved", "samples")

    def __init__(self, label, transducer, dim, pmin, pmax, dmin, dmax, prefilter, spr, reserved, samples):
        self.label, self.transducer, self.dim = label, transducer, dim
        self.pmin, self.pmax, self.dmin, self.dmax = pmin, pmax, dmin, dmax
        self.prefilter, self.spr, self.reserved = prefilter, spr, reserved
        self.samples = samples


class Edf:
    """A decoded/constructed EDF: the raw main-header fields plus the signals. `raw_reserved` /
    `version` etc. are kept verbatim so re-encoding is byte-exact."""

    __slots__ = ("version", "patient_id", "recording_id", "startdate", "starttime",
                 "reserved", "n_records", "record_duration", "signals")

    def __init__(self, version, patient_id, recording_id, startdate, starttime,
                 reserved, n_records, record_duration, signals):
        self.version = version
        self.patient_id = patient_id
        self.recording_id = recording_id
        self.startdate = startdate
        self.starttime = starttime
        self.reserved = reserved
        self.n_records = n_records
        self.record_duration = record_duration
        self.signals = signals



def read_span(raw: bytes):
    """`(n_records, record_duration_str)` from the 256-byte MAIN header alone.

    Split out of `read_edf` so a caller that only needs the DURATION of a recording does not decode
    every sample to learn it — a QC pass re-reading a night every 10 minutes cannot afford that, and
    the alternative it reaches for otherwise is copying the offsets 236/244 into its own file. There
    is one place that knows where those fields are, and this is it."""
    if len(raw) < _MAIN:
        raise ValueError(f"EDF too short: {len(raw)} bytes (need >={_MAIN} header)")
    return int(_fld(raw, 236, 8)), _fld(raw, 244, 8)


def read_edf(raw: bytes) -> Edf:
    """Parse an EDF/EDF+ file into an Edf. Preserves every header field VERBATIM (trailing spaces
    included) so `write_edf(read_edf(x)) == x`. Samples are read as signed int16 LE, signal-major
    within each data record."""
    if len(raw) < _MAIN:
        raise ValueError(f"EDF too short: {len(raw)} bytes (need ≥{_MAIN} header)")
    version = _fld(raw, 0, 8)
    patient_id = _fld(raw, 8, 80)
    recording_id = _fld(raw, 88, 80)
    startdate = _fld(raw, 168, 8)
    starttime = _fld(raw, 176, 8)
    hdr_bytes = int(_fld(raw, 184, 8))
    reserved = _fld(raw, 192, 44)
    n_records, record_duration = read_span(raw)
    ns = int(_fld(raw, 252, 4))
    if hdr_bytes != _MAIN + ns * _SIGHDR:
        raise ValueError(f"header-bytes {hdr_bytes} != 256 + {ns}×256")

    def col(off, width):
        base = _MAIN + off
        return [_fld(raw, base + i * width, width) for i in range(ns)]

    labels = col(0, 16)
    transducers = col(ns * 16, 80)
    dims = col(ns * 16 + ns * 80, 8)
    o = ns * 16 + ns * 80 + ns * 8
    pmins = col(o, 8); pmaxs = col(o + ns * 8, 8)
    dmins = col(o + ns * 16, 8); dmaxs = col(o + ns * 24, 8)
    prefilters = col(o + ns * 32, 80)
    sprs = [int(x) for x in col(o + ns * 32 + ns * 80, 8)]
    reserveds = col(o + ns * 40 + ns * 80, 32)

    rec_samples = sum(sprs)
    data = raw[hdr_bytes:]
    # each record is rec_samples int16 LE, laid out signal-major (all of sig0, then sig1, …)
    per_sig: list[list[int]] = [[] for _ in range(ns)]
    for r in range(n_records):
        base = r * rec_samples * 2
        p = base
        for s in range(ns):
            cnt = sprs[s]
            per_sig[s].extend(struct.unpack_from(f"<{cnt}h", data, p))
            p += cnt * 2

    signals = [Signal(labels[i], transducers[i], dims[i], pmins[i], pmaxs[i], dmins[i], dmaxs[i],
                      prefilters[i], sprs[i], reserveds[i], per_sig[i]) for i in range(ns)]
    return Edf(version, patient_id, recording_id, startdate, starttime, reserved,
               n_records, record_duration, signals)


# Signals whose name marks them as the checksum lane — recomputed on write, never trusted on read.
def _is_crc(label: str) -> bool:
    return "crc" in label.strip().lower()


def write_edf(edf: Edf) -> bytes:
    """Encode an Edf to bytes, byte-exact against a device file. The Crc16 lane (if present) is
    RECOMPUTED from the other signals' bytes per record — copying it would not prove the algorithm."""
    ns = len(edf.signals)
    hdr_bytes = _MAIN + ns * _SIGHDR
    crc_idx = next((i for i, s in enumerate(edf.signals) if _is_crc(s.label)), None)

    out = bytearray()
    out += _pad(edf.version, 8)
    out += _pad(edf.patient_id, 80)
    out += _pad(edf.recording_id, 80)
    out += _pad(edf.startdate, 8)
    out += _pad(edf.starttime, 8)
    out += _pad(hdr_bytes, 8)
    out += _pad(edf.reserved, 44)
    out += _pad(edf.n_records, 8)
    out += _pad(edf.record_duration, 8)
    out += _pad(ns, 4)
    for s in edf.signals: out += _pad(s.label, 16)
    for s in edf.signals: out += _pad(s.transducer, 80)
    for s in edf.signals: out += _pad(s.dim, 8)
    for s in edf.signals: out += _pad(s.pmin, 8)
    for s in edf.signals: out += _pad(s.pmax, 8)
    for s in edf.signals: out += _pad(s.dmin, 8)
    for s in edf.signals: out += _pad(s.dmax, 8)
    for s in edf.signals: out += _pad(s.prefilter, 80)
    for s in edf.signals: out += _pad(s.spr, 8)
    for s in edf.signals: out += _pad(s.reserved, 32)
    assert len(out) == hdr_bytes

    for r in range(edf.n_records):
        rec = bytearray()
        for i, s in enumerate(edf.signals):
            if i == crc_idx:
                # the checksum over every data byte of the record SO FAR (ResMed places Crc16 last, so
                # this is the whole non-CRC payload); computed, never copied from the source.
                rec += struct.pack("<H", crc16_ccitt(bytes(rec)))
            else:
                base = r * s.spr
                rec += struct.pack(f"<{s.spr}h", *s.samples[base:base + s.spr])
        out += rec
    return bytes(out)


# ── Constructors: build files from DATA (BLE capture) with the exact ResMed signal specs ──────────────
# Field specs are (label, dim, pmin, pmax, dmin, dmax) — verbatim from real AirSense 11 files, so a
# constructed file's headers are byte-for-byte what the device writes. spr is set from the record length.
_CRC = ("Crc16", "", "-32768.0", "32767.00", "-32768", "32767")   # phys strings are asymmetric ON PURPOSE
_BRP_SPECS = [("Flow.40ms", "L/s", "-2.00", "3.00", "-1000", "1500"),
              ("Press.40ms", "cmH2O", "0.00", "40.00", "0", "2000")]
_PLD_SPECS = [("MaskPress.2s", "cmH2O", "0.00", "40.00", "0", "2000"),
              ("Press.2s", "cmH2O", "0.00", "50.00", "0", "2500"),
              ("EprPress.2s", "cmH2O", "0.00", "30.00", "0", "1500"),
              ("Leak.2s", "L/s", "0.00", "2.00", "0", "100"),
              ("RespRate.2s", "bpm", "0.00", "90.00", "0", "450"),
              ("TidVol.2s", "L", "0.00", "4.00", "0", "200"),
              ("MinVent.2s", "L/min", "0.00", "30.00", "0", "240"),
              ("Snore.2s", "", "0.00", "5.00", "0", "250"),
              ("FlowLim.2s", "", "0.00", "1.00", "0", "100")]
_ANN = ("EDF Annotations", "", "-32768.0", "32767.00", "-32768", "32767")
_EMPTY80 = " " * 80
_RES32 = " " * 32


def _digital(value: float, pmin: float, pmax: float, dmin: int, dmax: int) -> int:
    """Physical → digital int16, clamped to [dmin, dmax]. Inverse of the EDF read scaling."""
    d = round((value - pmin) * (dmax - dmin) / (pmax - pmin) + dmin)
    return max(dmin, min(dmax, d))


def _num_signal(spec, physical, spr):
    """One numeric Signal from physical values, scaled to int16 by its spec. `physical` length must be a
    whole number of records of `spr` samples (pad upstream)."""
    label, dim, pmin_s, pmax_s, dmin_s, dmax_s = spec
    pmin, pmax, dmin, dmax = float(pmin_s), float(pmax_s), int(dmin_s), int(dmax_s)
    samples = [_digital(v, pmin, pmax, dmin, dmax) for v in physical]
    return Signal(label, _EMPTY80, dim, pmin_s, pmax_s, dmin_s, dmax_s, _EMPTY80, spr, _RES32, samples)


def _crc_signal(n_records):
    return Signal(_CRC[0], _EMPTY80, _CRC[1], _CRC[2], _CRC[3], _CRC[4], _CRC[5], _EMPTY80, 1, _RES32,
                  [0] * n_records)   # values are recomputed on write; placeholders here


_MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")


def _dates(y, mo, d, hh, mm, ss):
    """ResMed header timing: startdate DD.MM.YY, starttime HH.MM.SS, and the recording-ID prefix."""
    startdate = f"{d:02d}.{mo:02d}.{y % 100:02d}"
    starttime = f"{hh:02d}.{mm:02d}.{ss:02d}"
    rid_date = f"{d:02d}-{_MONTHS[mo - 1]}-{y:04d}"
    return startdate, starttime, rid_date


def _recording_id(rid_date, serial, mid, vid):
    # mid/vid are always supplied by the build_* callers (each carries its own default), so no default
    # here — a defaulted value nothing exercises is an unkillable mutant, not a convenience.
    return f"Startdate {rid_date} X X X SRN={serial} MID={mid} VID={vid}"


def _pad_records(values, spr, fill=0.0):
    """Pad a physical-sample list up to a whole number of `spr`-sample records."""
    values = list(values)
    rem = len(values) % spr
    if rem:
        values += [fill] * (spr - rem)
    return values


def build_brp(flow_lps, press_cmh2o, start, serial, *, record_seconds=60, mid=46, vid=3):
    """A bit-accurate BRP.edf from 25 Hz flow (L/s) + mask pressure (cmH2O). `start` is (y,mo,d,hh,mm,ss).
    The two channels must be the same length; they are zero-padded to a whole number of records."""
    spr = record_seconds * 25
    flow = _pad_records(flow_lps, spr)
    press = _pad_records(press_cmh2o, spr)
    if len(flow) != len(press):
        raise ValueError("flow and pressure must have the same sample count")
    n = len(flow) // spr
    sd, st, rd = _dates(*start)
    signals = [_num_signal(_BRP_SPECS[0], flow, spr), _num_signal(_BRP_SPECS[1], press, spr),
               _crc_signal(n)]
    return Edf("0", "X X X X", _recording_id(rd, serial, mid, vid), sd, st, "EDF", n,
               f"{record_seconds}.00", signals)


def build_pld(channels, start, serial, *, record_seconds=60, mid=46, vid=3):
    """A bit-accurate PLD.edf from the nine 0.5 Hz (2 s) derived channels. `channels` maps each
    _PLD_SPECS label to its physical samples; missing channels are zero-filled."""
    spr = record_seconds // 2
    lengths = {len(v) for v in channels.values() if v}
    base = max(lengths) if lengths else 0
    n = -(-base // spr) if base else 0
    total = n * spr
    signals = []
    for spec in _PLD_SPECS:
        vals = list(channels.get(spec[0], []))
        vals += [0.0] * (total - len(vals))
        signals.append(_num_signal(spec, vals, spr))
    signals.append(_crc_signal(n))
    sd, st, rd = _dates(*start)
    return Edf("0", "X X X X", _recording_id(rd, serial, mid, vid), sd, st, "EDF", n,
               f"{record_seconds}.00", signals)


# ── SA2.edf — oximetry, the one ResMed type this box can fill ─────────────────────────────────────
# The AS11 writes SA2.edf on every therapy night whether or not the optional wired oximeter is
# attached; with none attached both channels are the sentinel for the whole session. So the CONTAINER
# is exceptionally well evidenced even on a machine that never populates it, and the reverse
# direction — put the O2Ring's SpO2 into the channel the machine leaves empty — is open precisely
# because CPAP-SA2-OXIMETRY-SOURCE-2026-08-01 refuted the forward one.
#
#   [HW] over 294 SA2 files on this card: 2 signals + Crc16, record_seconds 60.00, spr 60 (1 Hz),
#        Pulse.1s bpm phys 0..300 dig 0..300, SpO2.1s % phys 0..100 dig 0..100 — both 1:1.
#   [HW] the absent-sample sentinel is -1, on every sample of every file.
#   [INF] the encoding of REAL samples. Every SA2 on this box is entirely sentinel, so nothing here
#        proves the AS11 writes SpO2 as a plain integer percent. CPAP-SA2-OXIMETRY-SOURCE records one
#        2.5 h populated session (2026-06-13) that is NOT in this tree and that I could not read.
#        The 1:1 mapping below is taken from the declared ranges, not from observed samples.
_SA2_SPECS = [("Pulse.1s", "bpm", "0.00", "300.00", "0", "300"),
              ("SpO2.1s", "%", "0.00", "100.00", "0", "100")]

SA2_ABSENT = -1          # [HW]; deliberately BELOW dig_min — see build_sa2


def _sentinel_signal(spec, digital_values, spr):
    """A Signal from DIGITAL values, bypassing `_digital`'s clamp.

    🔴 `_num_signal` cannot be used for a channel that carries the AS11's -1 sentinel. It routes
    every value through `_digital`, which clamps to [dmin, dmax]; SpO2.1s declares dmin 0, so -1
    would clamp to 0 and every "no reading" would become a genuine 0 % — a fabricated desaturation,
    written into a file that looks entirely normal. The card writes a sentinel outside its own
    declared range on purpose, and reproducing the card means reproducing that.
    """
    label, dim, pmin_s, pmax_s, dmin_s, dmax_s = spec
    return Signal(label, _EMPTY80, dim, pmin_s, pmax_s, dmin_s, dmax_s, _EMPTY80,
                  spr, _RES32, list(digital_values))


def build_sa2(samples, start, serial, *, record_seconds=60, mid=46, vid=3):
    """A ResMed-layout SA2.edf from 1 Hz oximetry. `start` is (y, mo, d, hh, mm, ss), local civil.

    `samples` is an iterable of `(offset_s, spo2_pct, pulse_bpm)` with `offset_s` whole seconds from
    `start`; either reading may be None for "no value".

    ⚠️ IT TAKES OFFSETS, NOT TWO LISTS, AND THAT IS THE POINT. Gaps are FILLED with the device's own
    sentinel rather than closed up. A caller handing over a plain list with a dropout simply omitted
    would shift every later sample earlier, and the file would look continuous while being wrong by
    the length of the gap — the same silent-time-axis failure as assuming 1 Hz in `parse_dat`, and as
    stepping a day with `t -= 86400`. Absence has to be representable or it gets compressed away.

    The O2Ring is a native fit: `parse_dat` yields 1 Hz samples with None for finger-off. Check
    `parse_dat.implied_interval_s` before trusting that a given .dat really is 1 Hz — the file does
    not record its own cadence.
    """
    spr = record_seconds                       # 60 samples per 60 s record = 1 Hz [HW]
    seen = {}
    for offset, spo2, pulse in samples:
        offset = int(offset)
        if offset < 0:
            raise ValueError(f"negative sample offset {offset}: a sample before the start instant "
                             "cannot be placed on the record grid")
        if offset in seen:
            raise ValueError(f"duplicate sample offset {offset}: two readings claim the same second, "
                             "so one would silently overwrite the other")
        seen[offset] = (spo2, pulse)

    n_seconds = max(seen) + 1 if seen else 0
    n = -(-n_seconds // spr) if n_seconds else 0
    total = n * spr
    pulse_d, spo2_d = [], []
    for i in range(total):
        spo2, pulse = seen.get(i, (None, None))
        pulse_d.append(SA2_ABSENT if pulse is None else int(pulse))
        spo2_d.append(SA2_ABSENT if spo2 is None else int(spo2))

    sd, st, rd = _dates(*start)
    signals = [_sentinel_signal(_SA2_SPECS[0], pulse_d, spr),
               _sentinel_signal(_SA2_SPECS[1], spo2_d, spr),
               _crc_signal(n)]
    return Edf("0", "X X X X", _recording_id(rd, serial, mid, vid), sd, st, "EDF", n,
               f"{record_seconds}.00", signals)


def declaration_matches(kind, header_signals, dictionary):
    """Differences between a real file's signal block and the derived dictionary; [] means identical.

    `header_signals` is a sequence of (label, unit, pmin, pmax, dmin, dmax, spr) read off disk, all
    ASCII and **TRIMMED**. Returns human-readable differences rather than a bool: "it differs" is not
    actionable, "Leak.2s dig_max 100 vs 200" is.

    ⚠️ `read_edf` returns these fields space-padded to their EDF field widths and does not strip, so a
    caller passing its output straight in gets a difference on every field. Trim first. The
    dictionary holds trimmed ASCII because that is what the generator writes; comparing trimmed to
    padded is the one mistake this function cannot detect for you, since a padded value really is
    different text.
    """
    spec = dictionary.get(kind)
    if spec is None:
        return [f"{kind}: not in the dictionary (derived from a card that never wrote this type)"]
    want = spec["signals"]
    out = []
    if len(header_signals) != len(want):
        out.append(f"{kind}: {len(header_signals)} signals on disk, {len(want)} in the dictionary")
    names = ("label", "unit", "phys_min", "phys_max", "dig_min", "dig_max", "spr")
    for i, (got, exp) in enumerate(zip(header_signals, want)):
        for j, field in enumerate(names):
            if got[j] != exp[j]:
                out.append(f"{kind} sig[{i}] {exp[0]} {field}: disk={got[j]!r} dict={exp[j]!r}")
    return out


def _tal_record(onset, duration, label, byte_width):
    """One EVE data record: the mandatory timekeeping TAL (+0) then one annotation TAL, zero-padded to
    `byte_width` bytes. EDF+ markers: 0x15 splits onset/duration, 0x14 ends each field, 0x00 terminates."""
    dur = "" if duration is None else str(duration)
    b = b"+0\x14\x14\x00" + f"+{onset}".encode("latin1")
    b += (b"\x15" + dur.encode("latin1")) if dur != "" else b""
    b += b"\x14" + label.encode("latin1") + b"\x14\x00"
    if len(b) > byte_width:
        raise ValueError(f"annotation {label!r} exceeds the {byte_width}-byte record")
    return b.ljust(byte_width, b"\x00")


def build_eve(events, start, serial, *, ann_spr=31, mid=46, vid=3):
    """A bit-accurate EVE.edf (EDF+D annotations) from respiratory events. `events` is a list of
    (onset_seconds:int, duration_seconds:int|None, label:str), device convention = one event per record.
    A leading 'Recording starts' TAL is prepended if absent, matching the device."""
    evs = list(events)
    if not evs or evs[0][2] != "Recording starts":
        evs = [(0, 0, "Recording starts")] + evs
    byte_width = ann_spr * 2
    n = len(evs)
    ann_samples = []
    for onset, dur, label in evs:
        rec = _tal_record(onset, dur, label, byte_width)
        ann_samples.extend(struct.unpack(f"<{ann_spr}h", rec))
    ann = Signal(_ANN[0], _EMPTY80, _ANN[1], _ANN[2], _ANN[3], _ANN[4], _ANN[5], _EMPTY80,
                 ann_spr, _RES32, ann_samples)
    sd, st, rd = _dates(*start)
    return Edf("0", "X X X X", _recording_id(rd, serial, mid, vid), sd, st, "EDF+D", n, "0.00",
               [ann, _crc_signal(n)])
