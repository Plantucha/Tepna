# tepna-capture — polar_pmd.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Polar Measurement Data (PMD) service: control-point start commands + data-frame decoders for
# ECG / ACC / PPG. Reference: the official Polar BLE SDK (PMD spec). This decodes the COMMON,
# uncompressed frame types fully (ECG type-0 especially — the mandatory stream).
#
# ⚠️ UNVERIFIED ON HARDWARE in this environment (no BLE / no Python runtime here). Before trusting
#    it: (1) some firmware emits COMPRESSED (delta) frames (frame_type >= 1 for ACC/PPG) that need
#    the SDK's delta decoder — handle_* below warns on an unexpected frame_type instead of guessing;
#    (2) the start-command TLVs (sample rate / resolution / range) must match what the device's
#    requestStreamSettings (control op 0x01) reports for YOUR firmware. Query first if start fails.
#    Capture a few frames raw and diff against PSL output before relying on a night.

from __future__ import annotations
import struct, datetime as _dt
from dataclasses import dataclass

PMD_SERVICE = "fb005c80-02e7-f387-1cad-8acd2d8df0c8"
PMD_CONTROL = "fb005c81-02e7-f387-1cad-8acd2d8df0c8"   # write + indicate
PMD_DATA    = "fb005c82-02e7-f387-1cad-8acd2d8df0c8"   # notify

# Measurement types
ECG, PPG, ACC = 0x00, 0x01, 0x02

# Default stream settings as control-point START commands (op 0x02). TLV = [setting_id, count, value...].
# setting_id: 0x00=SAMPLE_RATE, 0x01=RESOLUTION, 0x02=RANGE, 0x04=CHANNELS.
# Value width matters: SAMPLE_RATE/RESOLUTION/RANGE are u16; CHANNELS is u8 (a trailing u16 byte makes
# the Verity reject START with 0x05 ERROR_INVALID_PARAMETER — verified on hardware 2026-07-16). Pass a
# 3-tuple (setting_id, value, width_bytes) to override the default u16.
def _start_cmd(meas: int, *tlvs) -> bytes:
    body = bytearray([0x02, meas])
    for tlv in tlvs:
        setting_id, value = tlv[0], tlv[1]
        width = tlv[2] if len(tlv) > 2 else 2
        body += bytes([setting_id, 0x01])
        body += struct.pack("<B", value) if width == 1 else struct.pack("<H", value)
    return bytes(body)

START = {
    # H10 ECG: 130 Hz, 14-bit.
    ECG: _start_cmd(ECG, (0x00, 130), (0x01, 14)),
    # Verity PPG: 55 Hz / 22-bit / 4 channels (3 LEDs + ambient). CHANNELS (0x04) is MANDATORY and its
    # value is a SINGLE byte — omit it → 0x0B ERROR_INVALID_NUMBER_OF_CHANNELS; send it as u16 → 0x05
    # ERROR_INVALID_PARAMETER. `04 01 04` (u8) is what the Verity accepts (verified on hardware; data flows).
    PPG: _start_cmd(PPG, (0x00, 55), (0x01, 22), (0x04, 4, 1)),
    # ACC: 200 Hz, 16-bit, ±8G, 3 channels (channels u8, same rule as PPG).
    ACC: _start_cmd(ACC, (0x00, 200), (0x01, 16), (0x02, 8), (0x04, 3, 1)),
}
SAMPLE_HZ = {ECG: 130, PPG: 55, ACC: 200}  # keep in sync with START; used to back-time samples in a frame


@dataclass
class Sample:
    phone: _dt.datetime   # host arrival time for THIS sample (local civil), back-timed within the frame
    sensor_ns: int        # Polar ns (since 2000-01-01) for this sample
    t_ms: float           # PSL "timestamp [ms]" = sensor_ns / 1e6
    values: tuple         # ecg:(uv,) | acc:(x,y,z) | ppg:(c0,c1,c2,ambient)


def _i24(b: bytes, o: int) -> int:
    v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
    return v - (1 << 24) if v & 0x800000 else v


def _decode_delta(payload: bytes, channels: int, ref_bits: int) -> list[tuple]:
    """Polar PMD compressed/delta frame (frame_type high bit 0x80). Layout: one full reference sample
    (`channels` × `ref_bits` signed, LSB-first) then repeated blocks — [deltaSize:u8][sampleCount:u8]
    followed by sampleCount×channels deltas of `deltaSize` bits (signed), each accumulated onto the
    running sample. Bit-packed LSB-first (Polar convention). Verified against real Verity PPG frames."""
    pos = 0
    nbits_total = len(payload) * 8

    def read(nbits: int, signed: bool) -> int:
        nonlocal pos
        v = 0
        for i in range(nbits):
            v |= ((payload[pos >> 3] >> (pos & 7)) & 1) << i
            pos += 1
        if signed and nbits and (v >> (nbits - 1)) & 1:
            v -= (1 << nbits)
        return v

    cur = [read(ref_bits, True) for _ in range(channels)]
    out: list[tuple] = [tuple(cur)]
    while pos + 16 <= nbits_total:
        delta_size = read(8, False)
        count = read(8, False)
        if delta_size == 0 or count == 0:
            break
        if pos + count * channels * delta_size > nbits_total:
            break                                   # truncated block — stop, don't fabricate
        for _ in range(count):
            for ch in range(channels):
                cur[ch] += read(delta_size, True)
            out.append(tuple(cur))
    return out


def decode_frame(data: bytes, arrival: _dt.datetime):
    """Parse one PMD data notification → (meas_type, [Sample,...]). arrival = host time the notification fired."""
    if len(data) < 10:
        return None, []
    meas = data[0]
    last_ns = struct.unpack_from("<Q", data, 1)[0]   # ns since 2000-01-01 of the LAST sample in the frame
    frame_type = data[9]
    payload = data[10:]
    fs = SAMPLE_HZ.get(meas, 0) or 1
    step_ns = int(1e9 / fs)

    raw: list[tuple] = []
    delta = bool(frame_type & 0x80)     # PMD high bit = compressed/delta frame
    base = frame_type & 0x7F
    if meas == ECG and delta:
        raw = _decode_delta(payload, channels=1, ref_bits=24)
    elif meas == ECG and base == 0:
        for o in range(0, len(payload) - 2, 3):
            raw.append((_i24(payload, o),))
    elif meas == PPG and delta:                          # Verity streams delta PPG (3 LEDs + ambient)
        raw = _decode_delta(payload, channels=4, ref_bits=24)
    elif meas == PPG and base == 0:
        for o in range(0, len(payload) - 11, 12):       # uncompressed: 3 channels + ambient, int24 each
            raw.append((_i24(payload, o), _i24(payload, o + 3), _i24(payload, o + 6), _i24(payload, o + 9)))
    elif meas == ACC and delta:
        raw = _decode_delta(payload, channels=3, ref_bits=16)
    elif meas == ACC and base == 1:
        for o in range(0, len(payload) - 5, 6):          # int16 x,y,z (mg)
            raw.append(struct.unpack_from("<hhh", payload, o))
    else:
        raise ValueError(f"PMD meas={meas} frame_type={frame_type:#04x} not decoded (see SDK).")

    n = len(raw)
    out: list[Sample] = []
    for i, vals in enumerate(raw):
        back = (n - 1 - i)
        out.append(Sample(
            phone=arrival - _dt.timedelta(seconds=back / fs),
            sensor_ns=last_ns - back * step_ns,
            t_ms=(last_ns - back * step_ns) / 1e6,
            values=vals,
        ))
    return meas, out
