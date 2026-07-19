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
    # 20 Hz is the PROJECT default (pmd._PREF_RATE), not the maximum on offer: heading changes
    # slowly in bed and body position comes from the ACC gravity vector, so 100 Hz would be 5x the disk
    # for no analysis gain. Deliberately below max — this asserts the choice, not just "some rate".
    assert pmd.chosen_rate(pmd.MAG, s) == 20
    assert pmd.chosen_rate(pmd.MAG, s) != max(s[0x00]), "must not silently revert to max()"
    # an explicit user override still wins, but only when the device offers it
    assert pmd.chosen_rate(pmd.MAG, s, 100) == 100
    assert pmd.chosen_rate(pmd.MAG, s, 33) == 20, "an unoffered rate must fall back, not be sent"


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
    # The offset is ROUNDED per sample, not truncated-then-multiplied: 1e9/130 = 7692307.69 ns, so the old
    # int(step)*back accumulated 0.69 ns of error per sample (138 ns at back=200). Each stamp is now within
    # half a nanosecond of the ideal, for any frame length.
    assert [x.sensor_ns for x in s] == [last_ns - round(2 * 1e9 / fs), last_ns - round(1e9 / fs), last_ns]
    assert all(abs((last_ns - x.sensor_ns) - k * 1e9 / fs) <= 0.5 for k, x in zip((2, 1, 0), s))
    assert s[0].t_ms == s[0].sensor_ns / 1e6                     # t_ms tracks sensor_ns exactly


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


# ── Compressed/delta + GYRO/MAG/PPI decode known-answers (FOLLOWUPS §2, wave 2) ─────────────────────
# _decode_delta (the Verity compressed path) + the GYRO/MAG/PPI decode branches had ZERO value coverage.
# LSB-first bit-packer mirrors _decode_delta.read(): value bit i lands at stream bit (start+i).
def _packbits(fields):                     # fields: [(value, nbits), ...]
    bits = []
    for v, n in fields:
        bits += [(v >> i) & 1 for i in range(n)]
    while len(bits) % 8:
        bits.append(0)
    out = bytearray(len(bits) // 8)
    for i, b in enumerate(bits):
        if b:
            out[i >> 3] |= 1 << (i & 7)
    return bytes(out)


def test_decode_delta_ecg_reference_plus_accumulated_deltas():
    # NEGATIVE 24-bit ref (pins the SIGNED reference read), then block delta_size=4 count=3 deltas +2,-1,+3
    payload = _packbits([(-1000, 24), (4, 8), (3, 8), (2, 4), (-1, 4), (3, 4)])
    assert pmd._decode_delta(payload, channels=1, ref_bits=24) == [(-1000,), (-998,), (-999,), (-996,)]


def test_decode_delta_ppg_four_channels():
    # Verity PPG: 4 channels (3 LED + ambient), 24-bit ref, 5-bit deltas, 2 delta samples
    ref = [(10, 24), (20, 24), (30, 24), (40, 24)]
    blk = [(5, 8), (2, 8), (1, 5), (-1, 5), (2, 5), (-2, 5), (0, 5), (3, 5), (-3, 5), (1, 5)]
    got = pmd._decode_delta(_packbits(ref + blk), channels=4, ref_bits=24)
    assert got == [(10, 20, 30, 40), (11, 19, 32, 38), (11, 22, 29, 39)]   # each channel accumulates independently


def test_decode_delta_acc_three_channels_16bit_ref():
    ref = [(-100, 16), (200, 16), (-300, 16)]      # negatives pin the signed 16-bit reference read
    blk = [(3, 8), (2, 8), (1, 3), (-1, 3), (0, 3), (2, 3), (0, 3), (-2, 3)]
    got = pmd._decode_delta(_packbits(ref + blk), channels=3, ref_bits=16)
    assert got == [(-100, 200, -300), (-99, 199, -300), (-97, 199, -302)]


def test_decode_frame_routes_and_backtimes_a_delta_ppg_frame():
    # frame_type high bit 0x80 → compressed; decode_frame must route to _decode_delta AND back-time
    fs, last_ns = 55, 5_000_000_000
    ref = [(10, 24), (20, 24), (30, 24), (40, 24)]
    blk = [(5, 8), (1, 8), (1, 5), (1, 5), (1, 5), (1, 5)]          # 1 delta sample → 2 samples total
    payload = _packbits(ref + blk)
    meas, s = pmd.decode_frame(_pmd_header(pmd.PPG, last_ns, 0x80) + payload, _dt.datetime(2026, 7, 16), fs=fs)
    assert meas == pmd.PPG and [x.values for x in s] == [(10, 20, 30, 40), (11, 21, 31, 41)]
    step = int(1e9 / fs)
    assert [x.sensor_ns for x in s] == [last_ns - step, last_ns]


def test_decode_gyro_uncompressed_frame():
    # Values come out SCALED to dps. The wire carries raw int16; the device's range=2000 / 16-bit means
    # one LSB is 2000/2^15 dps. Asserting the raw ints here is what let the units defect ship: the file
    # said [dps] while carrying LSB, and a resting arm read 47 dps instead of ~2.9 (PMD-DECODE-SCALE-AND-RATE).
    fs, last_ns = 52, 6_000_000_000
    rows = [(-5, 6, -7), (8, -9, 10)]
    k = 2000 / 32768
    payload = b"".join(v.to_bytes(2, "little", signed=True) for row in rows for v in row)
    meas, s = pmd.decode_frame(_pmd_header(pmd.GYRO, last_ns, 0x00) + payload, _dt.datetime(2026, 7, 16), fs=fs)
    assert meas == pmd.GYRO
    assert [x.values for x in s] == [(-5 * k, 6 * k, -7 * k), (8 * k, -9 * k, 10 * k)]


def test_decode_mag_uncompressed_frame():
    fs, last_ns = 50, 7_000_000_000
    rows = [(11, -22, 33), (-44, 55, -66)]
    k = 50 / 32768                                             # range=50 gauss, 16-bit
    payload = b"".join(v.to_bytes(2, "little", signed=True) for row in rows for v in row)
    meas, s = pmd.decode_frame(_pmd_header(pmd.MAG, last_ns, 0x00) + payload, _dt.datetime(2026, 7, 16), fs=fs)
    assert meas == pmd.MAG
    assert [x.values for x in s] == [(11 * k, -22 * k, 33 * k), (-44 * k, 55 * k, -66 * k)]


def test_acc_is_native_mg_and_must_not_be_scaled():
    """THE trap in this area: GYRO/MAG need range/2^15, ACC does NOT — Polar delivers it already in mg
    (a resting H10 reads 1000.9 mg per-sample gravity). "Unifying" the IMU scaling breaks the one stream
    that was always right, and the break is invisible without a magnitude check."""
    assert pmd.axis_scale(pmd.ACC) == 1.0
    assert pmd.axis_scale(pmd.ECG) == 1.0 and pmd.axis_scale(pmd.PPG) == 1.0 and pmd.axis_scale(pmd.PPI) == 1.0
    assert pmd.axis_scale(pmd.GYRO) != 1.0 and pmd.axis_scale(pmd.MAG) != 1.0
    last_ns = 5_000_000_000
    payload = b"".join(v.to_bytes(2, "little", signed=True) for v in (377, -66, 932))
    _, s = pmd.decode_frame(_pmd_header(pmd.ACC, last_ns, 0x01) + payload, _dt.datetime(2026, 7, 16), fs=52)
    assert s[0].values == (377, -66, 932), "ACC must pass through untouched, in mg"


def test_axis_scale_prefers_the_device_reported_range_over_the_default():
    # The device's own negotiation is authoritative; DEFAULT_RANGE is only the fallback.
    assert pmd.axis_scale(pmd.GYRO, {0x01: [16], 0x02: [1000]}) == 1000 / 32768
    assert pmd.axis_scale(pmd.MAG, {0x01: [16], 0x02: [16]}) == 16 / 32768
    assert pmd.axis_scale(pmd.GYRO, {}) == pmd.DEFAULT_RANGE[pmd.GYRO] / 32768   # no settings → default
    assert pmd.axis_scale(pmd.GYRO, {0x01: [12], 0x02: [2000]}) == 2000 / 2048   # resolution honoured


def test_ppi_values_are_never_scaled():
    """PPI's tuple is (hr, pp_ms, err_ms, flags) — counts and milliseconds, not axis readings. A scale
    factor applied here would corrupt beat intervals into nonsense."""
    last_ns = 8_000_000_000
    payload = bytes([60, 0xE8, 0x03, 0x05, 0x00, 0x02])
    _, s = pmd.decode_frame(_pmd_header(pmd.PPI, last_ns, 0x00) + payload,
                            _dt.datetime(2026, 7, 16), fs=1, scale=0.061035)
    assert s[0].values == (60, 1000, 5, 0x02), "PPI must ignore the scale factor entirely"


def test_decode_ppi_events_not_backtimed():
    # PPI: per-beat event — hr(u8), pp_ms(u16 LE), err_ms(u16 LE), flags(u8); NOT back-timed (all == last_ns)
    last_ns = 8_000_000_000
    beats = [(60, 1000, 5, 0x02), (62, 970, 3, 0x06)]
    payload = b"".join(bytes([hr]) + pp.to_bytes(2, "little") + err.to_bytes(2, "little") + bytes([fl])
                       for hr, pp, err, fl in beats)
    meas, s = pmd.decode_frame(_pmd_header(pmd.PPI, last_ns, 0x00) + payload, _dt.datetime(2026, 7, 16))
    assert meas == pmd.PPI and [x.values for x in s] == [(60, 1000, 5, 0x02), (62, 970, 3, 0x06)]
    assert [x.sensor_ns for x in s] == [last_ns, last_ns]          # per-beat events share the frame stamp


def test_h10_acc_uses_the_project_rate_not_the_maximum():
    """The H10 offers 25/50/100/200 Hz and used to run at 200 — 369 MB/night, 30% of everything the box
    wrote — because the preferred value was 52, which the H10 does not offer, so it fell through to
    max(). 50 Hz is the project choice (actigraphy convention, ample for posture/effort/activity)."""
    s = {0x00: [25, 50, 100, 200], 0x01: [16], 0x02: [2, 4, 8]}
    assert pmd.chosen_rate(pmd.ACC, s) == 50
    assert pmd.chosen_rate(pmd.ACC, s) != max(s[0x00]), "regressed to max() — check _PREF_RATE is offered"
    # the Verity offers only 52, so it must still take that rather than failing to match the 50 default
    assert pmd.chosen_rate(pmd.ACC, {0x00: [52]}) == 52


def test_in_charger_is_transient_not_a_bad_request():
    """A Polar on its dock refuses every PMD START with 0x0D. That is the device working as designed:
    the caller must retry, NOT tear the stream down (which deleted the file and unregistered the card,
    leaving the stream dead after the sensor came off the charger — the link survives charging, so
    nothing re-ran the negotiation)."""
    assert pmd.is_transient(0x0D)          # in_charger
    assert pmd.is_transient(0x0C)          # invalid_state
    assert not pmd.is_started(0x0D)


def test_started_and_transient_are_disjoint_and_dont_swallow_real_rejections():
    assert pmd.is_started(0x00) and pmd.is_started(0x06)
    assert not (pmd.STARTED_STATUS & pmd.TRANSIENT_STATUS)
    # genuine settings rejections must stay in NEITHER bucket, or a real fault renders as "charging"
    for bad in (0x01, 0x02, 0x03, 0x04, 0x05, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0xFF):
        assert not pmd.is_started(bad), hex(bad)
        assert not pmd.is_transient(bad), hex(bad)


# ── Frame-seam: which timestamp column is a SAMPLE CLOCK ────────────────────────────────────────────
# Measured on a real 2.4 M-row corpus (2026-07-18): the device column has ZERO backward steps, while
# the Phone/arrival column steps backwards at ~0.5-0.8 % of rows — always at an exact frame boundary
# (ECG frame = 73 samples), median ~1.8 samples, worst 42 (a BLE stall that bunched notifications).
#
# That is INHERENT, not a bug to filter away: `phone` back-times each frame from its own notification
# arrival, and BLE arrival jitters; the device clock does not. Smoothing `phone` would fabricate
# precision the arrival stamp does not have and would destroy the only record of real link timing.
# So the contract is: **`phone` is arrival, NOT a sample clock — sensor_ns/t_ms is the sample clock.**
# These tests pin the property every consumer is entitled to rely on.

def _frame(meas, last_ns, n, fs, channels=1):
    """Build an uncompressed frame of `n` samples ending at device time `last_ns`."""
    import struct
    head = bytes([meas]) + struct.pack("<Q", last_ns)
    if meas == pmd.ECG:
        return head + bytes([0x00]) + b"".join(int(0).to_bytes(3, "little", signed=True) for _ in range(n))
    ftype = 0x01 if meas == pmd.ACC else 0x00     # ACC uncompressed is frame_type 1; GYRO/MAG are 0
    return head + bytes([ftype]) + b"".join(struct.pack("<hhh", 0, 0, 0) for _ in range(n))


def test_device_clock_is_strictly_increasing_within_a_frame():
    import datetime as _d
    _, s = pmd.decode_frame(_frame(pmd.ECG, 1_000_000_000, 73, 130), _d.datetime(2026, 7, 18), fs=130)
    assert len(s) == 73
    ns = [x.sensor_ns for x in s]
    assert all(b > a for a, b in zip(ns, ns[1:])), "device clock must be strictly increasing"
    assert ns[-1] == 1_000_000_000, "last sample must carry the frame's own device timestamp"


def test_device_clock_does_not_step_backwards_across_a_frame_seam():
    """The seam case: two back-to-back frames. The device column must stay monotonic across the join
    even though each frame is back-timed independently — this is the property the Phone column LACKS."""
    import datetime as _d
    step = int(1e9 / 130)
    a_last = 1_000_000_000
    b_last = a_last + 73 * step                      # next frame, exactly one frame later
    arr = _d.datetime(2026, 7, 18)
    _, a = pmd.decode_frame(_frame(pmd.ECG, a_last, 73, 130), arr, fs=130)
    _, b = pmd.decode_frame(_frame(pmd.ECG, b_last, 73, 130), arr, fs=130)
    joined = [x.sensor_ns for x in a + b]
    assert all(y > x for x, y in zip(joined, joined[1:])), "device clock stepped backwards at the seam"


def _seam(meas, n, true_fs, nominal_fs, a_last=800_000_000_000_000_000):
    """Two back-to-back frames from a device whose REAL rate is `true_fs` while we negotiated `nominal_fs`.
    Returns the decoded halves, the second one seam-anchored on the first."""
    import datetime as _d
    true_step = 1e9 / true_fs
    b_last = a_last + round(n * true_step)
    arr = _d.datetime(2026, 7, 19)
    _, a = pmd.decode_frame(_frame(meas, a_last, n, nominal_fs), arr, fs=nominal_fs)
    _, b = pmd.decode_frame(_frame(meas, b_last, n, nominal_fs), arr, fs=nominal_fs, prev_last_ns=a_last)
    return a, b, true_step


def _seam_unanchored(meas, n, true_fs, nominal_fs, a_last=800_000_000_000_000_000):
    """The same two frames decoded WITHOUT the seam anchor — i.e. the pre-fix behaviour, since omitting
    prev_last_ns falls back to the nominal step. Used to prove the anchor is load-bearing."""
    import datetime as _d
    b_last = a_last + round(n * 1e9 / true_fs)
    arr = _d.datetime(2026, 7, 19)
    _, a = pmd.decode_frame(_frame(meas, a_last, n, nominal_fs), arr, fs=nominal_fs)
    _, b = pmd.decode_frame(_frame(meas, b_last, n, nominal_fs), arr, fs=nominal_fs)
    return a, b


def test_backtiming_uses_the_device_clock_when_the_true_rate_is_FASTER_than_nominal():
    """MAG's real case: 20.516 Hz behind a nominal 20. Stepping back by the nominal 50 ms over-reaches into
    the previous frame — that produced 678 backwards timestamps in one night (to -112 ms)."""
    # DIRECTION 1 — without the anchor the seam goes BACKWARDS. If this ever stops holding, the test below
    # has stopped testing anything.
    ua, ub = _seam_unanchored(pmd.MAG, 100, true_fs=20.516, nominal_fs=20)
    assert ub[0].sensor_ns < ua[-1].sensor_ns, "unanchored MAG seam must overlap — else this fixture is inert"

    # DIRECTION 2 — with it, monotonic, and spaced by exactly one TRUE interval.
    a, b, true_step = _seam(pmd.MAG, 100, true_fs=20.516, nominal_fs=20)
    joined = [x.sensor_ns for x in a + b]
    assert all(y > x for x, y in zip(joined, joined[1:])), "device clock stepped backwards at the seam"
    assert abs((b[0].sensor_ns - a[-1].sensor_ns) - true_step) <= 1, "seam gap must equal one TRUE interval"


def test_backtiming_uses_the_device_clock_when_the_true_rate_is_SLOWER_than_nominal():
    """GYRO/ACC's real case: 51.68 Hz behind a nominal 52. This sign leaves a silent GAP instead of an
    overlap, so it never trips a monotonicity check — it looked clean for as long as the defect existed.
    Monotonicity alone is NOT sufficient here; the seam SPACING is the assertion that bites."""
    # DIRECTION 1 — unanchored, the seam is still monotonic (which is exactly why this hid) but the gap is
    # wrong: it is short by the rate error, silently compressing every frame.
    ua, ub = _seam_unanchored(pmd.GYRO, 188, true_fs=51.684, nominal_fs=52)
    assert ub[0].sensor_ns > ua[-1].sensor_ns, "unanchored SLOWER seam stays monotonic — the silent case"
    assert abs((ub[0].sensor_ns - ua[-1].sensor_ns) - 1e9 / 51.684) > 1e5, "unanchored gap must be wrong"

    # DIRECTION 2 — anchored, the gap is exactly one true interval.
    a, b, true_step = _seam(pmd.GYRO, 188, true_fs=51.684, nominal_fs=52)
    joined = [x.sensor_ns for x in a + b]
    assert all(y > x for x, y in zip(joined, joined[1:]))
    assert abs((b[0].sensor_ns - a[-1].sensor_ns) - true_step) <= 1, "seam gap must equal one TRUE interval"
    assert b[0].sensor_ns - a[-1].sensor_ns > 1e9 / 52, "true interval is LONGER than the nominal one"


def test_backtiming_falls_back_to_nominal_on_the_first_frame_after_connect():
    import datetime as _d
    n, fs, last_ns = 73, 130, 1_000_000_000
    _, s = pmd.decode_frame(_frame(pmd.ECG, last_ns, n, fs), _d.datetime(2026, 7, 19), fs=fs)   # prev=None
    assert s[-1].sensor_ns == last_ns
    assert abs((s[-1].sensor_ns - s[0].sensor_ns) - (n - 1) * 1e9 / fs) <= 1


def test_backtiming_rejects_an_implausible_step_from_a_dropped_frame():
    """A dropped frame inflates (last_ns - prev_last_ns), which would stretch the estimated step and smear
    the frame across the gap. Outside ±10 % of nominal the estimate must be discarded for nominal."""
    import datetime as _d
    n, fs, last_ns = 100, 20, 800_000_000_000_000_000
    stale = last_ns - round(5 * n * 1e9 / fs)                 # as if 4 frames went missing
    _, s = pmd.decode_frame(_frame(pmd.MAG, last_ns, n, fs), _d.datetime(2026, 7, 19), fs=fs,
                            prev_last_ns=stale)
    span = s[-1].sensor_ns - s[0].sensor_ns
    assert abs(span - (n - 1) * 1e9 / fs) <= 1, "must fall back to the nominal step, not stretch to the gap"


def test_a_frame_never_reaches_back_past_its_predecessor():
    """Frames arriving CLOSER than nominal (burst / BLE retransmit) fail the plausibility band, and the
    nominal fallback would over-reach into the previous frame. The clamp forbids that."""
    import datetime as _d
    n, fs = 100, 20
    prev = 800_000_000_000_000_000
    last_ns = prev + round(n * 1e9 / fs * 0.5)        # half a frame's worth of device time — way off-band
    _, s = pmd.decode_frame(_frame(pmd.MAG, last_ns, n, fs), _d.datetime(2026, 7, 19), fs=fs,
                            prev_last_ns=prev)
    assert s[0].sensor_ns > prev, "frame reached back past the previous frame's last sample"
    assert s[-1].sensor_ns == last_ns


def test_an_out_of_order_frame_is_reported_faithfully_not_invented():
    """If the DEVICE's own last_ns regresses (out-of-order notification — seen once in ~80 k real MAG
    samples), no step can make the stamp monotonic. We report what the device said rather than fabricate;
    the Clock Contract's rule is that a bad stamp must stay visible."""
    import datetime as _d
    prev = 800_000_000_000_000_000
    last_ns = prev - 78_000_000                        # device went backwards 78 ms
    _, s = pmd.decode_frame(_frame(pmd.MAG, last_ns, 1, 20), _d.datetime(2026, 7, 19), fs=20,
                            prev_last_ns=prev)
    assert s[-1].sensor_ns == last_ns, "must carry the device's own (regressed) stamp, not a synthesised one"


def test_frame_stamp_survives_a_real_18_digit_polar_timestamp():
    """Polar ns-since-2000 is ~8.4e17, past float64's 2^53 exact-integer limit. Pulling last_ns through
    float arithmetic silently rounds the frame stamp to ~64 ns."""
    import datetime as _d
    last_ns = 837_766_660_046_534_119                          # a real Verity stamp from 2026-07-19
    _, s = pmd.decode_frame(_frame(pmd.MAG, last_ns, 100, 20), _d.datetime(2026, 7, 19), fs=20)
    assert s[-1].sensor_ns == last_ns, "last sample must carry the frame's exact device timestamp"


def test_ppi_is_arrival_stamped_not_back_timed():
    """PPI/HR carry per-beat events, so they are NOT back-timed (back=0) — which is exactly why their
    Phone column measures monotonic on real files while ECG/ACC/PPG's does not. PulseDex reads the
    Phone column and has a one-way two-pointer matcher, so it depends on this."""
    import datetime as _d
    arr = _d.datetime(2026, 7, 18, 3, 0, 0)
    payload = b"".join(bytes([60, 0xE8, 0x03, 0x00, 0x00, 0x00]) for _ in range(4))
    _, s = pmd.decode_frame(bytes([pmd.PPI]) + (1_000_000_000).to_bytes(8, "little") + bytes([0x00]) + payload,
                            arr, fs=1)
    assert len(s) == 4
    assert all(x.phone == arr for x in s), "PPI must be arrival-stamped, never back-timed"
