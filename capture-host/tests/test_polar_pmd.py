# tepna-capture — polar_pmd protocol tests
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# The settings-response fixtures are REAL bytes captured from the H10 + Verity Sense on 2026-07-16 —
# the ones that proved the fixed START table was per-device-wrong (Verity ACC is 52 Hz, not 200).
import datetime as _dt

import polar_pmd as pmd


def test_parse_features_bitmask():
    # control-feature flag 0x0F + a byte with bits {1,2,3,5,6} = ppg,acc,ppi,gyro,mag (0x6E)
    assert pmd.parse_features(bytes([0x0F, 0x6E])) == {1, 2, 3, 5, 6}
    assert pmd.parse_features(b"") == set()


def test_settings_ppg():
    s = pmd.parse_settings_response(bytes.fromhex("f0010100000001370001011600040104"))
    assert s == {0x00: [55], 0x01: [22], 0x04: [4]}          # 55 Hz, 22-bit, 4 channels
    assert pmd.chosen_rate(pmd.PPG, s) == 55


def test_settings_acc_verity_is_52hz_not_200():
    s = pmd.parse_settings_response(bytes.fromhex("f001020000000134000101100002010800040103"))
    assert s[0x00] == [52] and s[0x02] == [8] and s[0x04] == [3]
    assert pmd.chosen_rate(pmd.ACC, s) == 52                  # the whole reason negotiation exists


def test_settings_mag_multi_rate_needs_range():
    s = pmd.parse_settings_response(bytes.fromhex("f00106000000040a001400320064000101100002013200040103"))
    assert s[0x00] == [10, 20, 50, 100] and s[0x02] == [50] and s[0x04] == [3]
    assert pmd.chosen_rate(pmd.MAG, s) == 50                  # 50 is offered → preferred


def test_settings_response_rejects_error_status():
    # byte[3] != 0x00 (error) → empty
    assert pmd.parse_settings_response(bytes.fromhex("f0010105000000")) == {}


def test_build_start_from_negotiated_settings():
    s = pmd.parse_settings_response(bytes.fromhex("f00105000000013400010110000201d007040103"))  # gyro
    # SR 52 (0x34), RES 16, RANGE 2000 (0x07d0), CH 3 (u8) — exactly what the device offered.
    assert pmd.build_start(pmd.GYRO, s) == bytes.fromhex("020500013400010110000201d007040103")


def test_channels_is_u8_in_start():
    s = {0x00: [55], 0x01: [22], 0x04: [4]}
    cmd = pmd.build_start(pmd.PPG, s)
    # …04 01 04 — CHANNELS setting id 0x04, count 1, value 0x04 as ONE byte (u16 → device rejects 0x05)
    assert cmd.endswith(bytes([0x04, 0x01, 0x04]))


def test_decode_uncompressed_ecg_frame():
    last_ns = 599636646177065964
    header = bytes([pmd.ECG]) + last_ns.to_bytes(8, "little") + bytes([0x00])   # meas, ns, frame_type=0
    payload = (4).to_bytes(3, "little", signed=True) + (2).to_bytes(3, "little", signed=True)
    meas, samples = pmd.decode_frame(header + payload, _dt.datetime(2026, 7, 16, 21, 34, 53))
    assert meas == pmd.ECG and len(samples) == 2
    assert samples[0].values == (4,) and samples[-1].values == (2,)
    assert samples[-1].sensor_ns == last_ns                  # last sample carries the frame's last_ns


def test_decode_frame_fs_override():
    # ACC differs per device — decode_frame must honour the negotiated fs for back-timing
    last_ns = 1_000_000_000
    header = bytes([pmd.ACC]) + last_ns.to_bytes(8, "little") + bytes([0x01])   # uncompressed acc (base==1)
    payload = b"".join(v.to_bytes(2, "little", signed=True) for v in (1, 2, 3, 4, 5, 6))  # 2 samples xyz
    meas, samples = pmd.decode_frame(header + payload, _dt.datetime(2026, 7, 16), fs=52)
    assert meas == pmd.ACC and len(samples) == 2 and samples[0].values == (1, 2, 3)
    # back-timing at 52 Hz: first sample is one step (1/52 s) before last
    step_ns = int(1e9 / 52)
    assert samples[0].sensor_ns == last_ns - step_ns


# ── Full-frame decode known-answers (TEST-AUDIT-FINDINGS-FOLLOWUPS §2) ──────────────────────────────
# The older decode tests assert only samples[0]/[-1] values + the last sensor_ns, so mutations to the
# per-sample loop stride/offset, _i24, the PPG path (untested entirely), and the back-timing of the
# MIDDLE samples all survived. These pin EVERY sample value AND every back-timed sensor_ns/t_ms — a
# real decode/timestamp corruption reds here. Inputs are hand-chosen constants; expected timestamps
# follow the Clock-Contract back-timing sensor_ns = last_ns − (n−1−i)·int(1e9/fs).
def _i24le(v):
    return (v & 0xFFFFFF).to_bytes(3, "little")


def _pmd_header(meas, last_ns, frame_type):
    return bytes([meas]) + last_ns.to_bytes(8, "little") + bytes([frame_type])


def test_decode_ecg_full_frame_every_sample_and_timestamp():
    fs, last_ns = 130, 1_000_000_000
    vals = [100, -100, 50_000]                                    # 3 int24 ECG samples (µV)
    payload = b"".join(_i24le(v) for v in vals)
    meas, s = pmd.decode_frame(_pmd_header(pmd.ECG, last_ns, 0x00) + payload, _dt.datetime(2026, 7, 16), fs=fs)
    assert meas == pmd.ECG and len(s) == 3                        # stride-3 loop must yield EXACTLY 3
    assert [x.values for x in s] == [(100,), (-100,), (50_000,)]  # every value, in order (kills _i24 / stride)
    step = int(1e9 / fs)
    assert [x.sensor_ns for x in s] == [last_ns - 2 * step, last_ns - step, last_ns]   # all back-timed, incl. middle
    assert s[0].t_ms == (last_ns - 2 * step) / 1e6               # t_ms tracks sensor_ns exactly


def test_decode_ppg_full_frame_all_channels():
    # PPG had ZERO decode coverage — this pins the 4-channel (3 LED + ambient) int24 unpack.
    fs, last_ns = 55, 2_000_000_000
    rows = [(1, 2, 3, 100), (4, 5, 6, 200)]                       # 2 samples × 4 channels
    payload = b"".join(_i24le(c) for row in rows for c in row)
    meas, s = pmd.decode_frame(_pmd_header(pmd.PPG, last_ns, 0x00) + payload, _dt.datetime(2026, 7, 16), fs=fs)
    assert meas == pmd.PPG and len(s) == 2
    assert [x.values for x in s] == [(1, 2, 3, 100), (4, 5, 6, 200)]   # every channel of every sample (kills the 12-stride / offsets)
    step = int(1e9 / fs)
    assert [x.sensor_ns for x in s] == [last_ns - step, last_ns]


def test_decode_acc_full_frame_every_sample():
    # strengthens the fs-override test: assert ALL samples' xyz (the old test checked only samples[0],
    # so a "read offset 0 for every sample" bug — constant ACC — survived).
    fs, last_ns = 52, 3_000_000_000
    rows = [(10, 20, 30), (40, 50, 60), (70, 80, 90)]             # 3 int16 xyz samples
    payload = b"".join(v.to_bytes(2, "little", signed=True) for row in rows for v in row)
    meas, s = pmd.decode_frame(_pmd_header(pmd.ACC, last_ns, 0x01) + payload, _dt.datetime(2026, 7, 16), fs=fs)
    assert meas == pmd.ACC and len(s) == 3
    assert [x.values for x in s] == [(10, 20, 30), (40, 50, 60), (70, 80, 90)]   # distinct per sample (kills constant-offset / stride)
    step = int(1e9 / fs)
    assert [x.sensor_ns for x in s] == [last_ns - 2 * step, last_ns - step, last_ns]
