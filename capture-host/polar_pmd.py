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

# Default stream settings as control-point START commands (op 0x02). TLV = [setting_id, count, val_le16...].
# setting_id: 0x00=SAMPLE_RATE, 0x01=RESOLUTION, 0x02=RANGE.
def _start_cmd(meas: int, *tlvs: tuple[int, int]) -> bytes:
    body = bytearray([0x02, meas])
    for setting_id, value in tlvs:
        body += bytes([setting_id, 0x01]) + struct.pack("<H", value)
    return bytes(body)

START = {
    # H10 ECG: 130 Hz, 14-bit.
    ECG: _start_cmd(ECG, (0x00, 130), (0x01, 14)),
    # Verity PPG: rate is firmware-dependent (28/44/55/135/176). 55 Hz/22-bit is a safe default;
    # QUERY settings (op 0x01) and rebuild if start is rejected. (how-to-collect/verity-ppg.md notes ~176 Hz.)
    PPG: _start_cmd(PPG, (0x00, 55), (0x01, 22)),
    # ACC: 200 Hz, 16-bit, ±8G.
    ACC: _start_cmd(ACC, (0x00, 200), (0x01, 16), (0x02, 8)),
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
    if meas == ECG and frame_type == 0:
        for o in range(0, len(payload) - 2, 3):
            raw.append((_i24(payload, o),))
    elif meas == PPG and frame_type == 0:
        for o in range(0, len(payload) - 11, 12):       # 3 channels + ambient, int24 each
            raw.append((_i24(payload, o), _i24(payload, o + 3), _i24(payload, o + 6), _i24(payload, o + 9)))
    elif meas == ACC and frame_type == 1:
        for o in range(0, len(payload) - 5, 6):          # int16 x,y,z (mg)
            raw.append(struct.unpack_from("<hhh", payload, o))
    else:
        # Compressed/delta or unknown variant — do NOT guess (would write subtly-wrong samples).
        raise ValueError(f"PMD meas={meas} frame_type={frame_type} not decoded (likely compressed; see SDK).")

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
