# tepna-capture — oxyii protocol tests
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# Fixtures are real/verified O2Ring-S (OxyII) bytes — see O2RING-PROTOCOL-2026-07-17-BRIEF.md.
import oxyii


def test_crc8_known_frame():
    # a5 e1 1e 00 02 00 00 | bf  — CRC-8 poly 0x07 over the 7-byte header == 0xbf (hardware-verified).
    frame = bytes.fromhex("a5e11e00020000bf")
    assert oxyii.crc8(frame[:-1]) == frame[-1] == 0xBF


def test_encode_decode_roundtrip():
    f = oxyii.encode(oxyii.OP_LIVE, b"\x01\x02\x03")
    assert f[0] == 0xA5 and f[1] == oxyii.OP_LIVE and f[2] == (~oxyii.OP_LIVE) & 0xFF
    op, payload = oxyii.decode(f)
    assert op == oxyii.OP_LIVE and payload == b"\x01\x02\x03"


def test_decode_rejects_bad_crc():
    f = bytearray(oxyii.encode(oxyii.OP_LIVE, b"\x01"))
    f[-1] ^= 0xFF
    assert oxyii.decode(bytes(f)) is None


def test_decode_rejects_bad_complement():
    f = bytearray(oxyii.encode(oxyii.OP_LIVE, b"\x01"))
    f[2] ^= 0xFF                       # break the ~cmd byte
    f[-1] = oxyii.crc8(f[:-1])         # keep CRC valid so only the complement check can catch it
    assert oxyii.decode(bytes(f)) is None


def test_reassembler_splits_across_notifications():
    f = oxyii.encode(oxyii.OP_LIVE, b"\x01\x02\x03\x04")
    r = oxyii.Reassembler()
    assert r.feed(f[:4]) == []                    # partial → nothing yet
    out = r.feed(f[4:])                           # completes the frame
    assert len(out) == 1 and oxyii.decode(out[0])[1] == b"\x01\x02\x03\x04"


def test_reassembler_resyncs_to_lead():
    f = oxyii.encode(oxyii.OP_LIVE, b"\xaa")
    r = oxyii.Reassembler()
    out = r.feed(b"\x00\x99" + f)                 # leading garbage before the 0xA5 lead
    assert len(out) == 1 and oxyii.decode(out[0])[0] == oxyii.OP_LIVE


def test_parse_live_offsets():
    # CORRECTED 2026-07-18. This test previously asserted `motion` came from p[7] — it encoded the same
    # misreading as the code, so it passed while a real data bug shipped (PI was being written into the
    # SpO2 CSV's Motion column, which OxyDex filters on). p[7] is PI, p[11] is motion; see
    # oxyii.parse_live for the vendor-parser evidence and the corroborating corpus measurement.
    p = bytearray(24)
    p[5], p[6], p[7], p[11], p[13] = 0x03, 97, 5, 9, 88
    p[8:10] = (62).to_bytes(2, "little")
    v = oxyii.parse_live(bytes(p))
    # Pin the OFFSETS, not the exact dict: parse_live is allowed to gain fields (the contract is
    # additive — new data goes in a NEW key, per CLAUDE.md §🧪), and asserting equality would red on
    # every additive change.
    for k, exp in {"spo2": 97, "pr": 62, "pi": 0.5, "motion": 9, "batt": 88,
                   "contact": 0x03, "worn": True}.items():
        assert v[k] == exp, f"{k} offset moved"


def test_parse_live_off_finger_is_none():
    p = bytearray(24)
    p[5], p[6], p[8] = 0x00, 0, 0                 # no finger, invalid spo2/hr
    v = oxyii.parse_live(bytes(p))
    assert v["spo2"] is None and v["pr"] is None and v["worn"] is False


# ── live PPG waveform (Phase 1 decode) — fixture is a REAL captured cmd=0x04 reply ──────────────────
_REAL_PPG_FRAME = bytes.fromhex(
    "df290000020164053200c702005c000000000000000000003c00"       # 24-B header + count(0x3c=60) + flag
    "c8c7c7c7c7c7c7c7c7c8c8c5bfb6ada6a19f9e9d9ea1a4a9adb2b7bbbdbcbab8b6b4"  # 60 one-byte PPG samples
    "b1afadaba9a8a7a7a8a9abadafb0b1b1ada69d948b81766b6158")

def test_parse_ppg_real_frame_layout():
    # header still parses (worn, SpO2 100, HR 50 — HR cross-checked vs paired ECG @49 bpm)
    live = oxyii.parse_live(_REAL_PPG_FRAME)
    assert live["worn"] and live["spo2"] == 100 and live["pr"] == 50
    # body = count(60) one-byte samples at [26:86]
    ppg = oxyii.parse_ppg(_REAL_PPG_FRAME)
    assert len(ppg) == 60 == _REAL_PPG_FRAME[24]
    assert 24 + 2 + _REAL_PPG_FRAME[24] == len(_REAL_PPG_FRAME)   # the length invariant
    assert ppg[:3] == [200, 199, 199] and all(0 <= v <= 255 for v in ppg)

def test_parse_ppg_no_body():
    assert oxyii.parse_ppg(bytes(24)) == []       # header-only / too short → no samples


def test_auth_payload_is_deterministic_16b():
    a = oxyii.auth_payload("0000", ts=1000)
    b = oxyii.auth_payload("0000", ts=1000)
    assert a == b and len(a) == 16


# ── stored-file transfer ────────────────────────────────────────────────────
def test_parse_file_list():
    slot = lambda ts: ts.encode("ascii") + b"\x00\x00"
    payload = bytes([2]) + slot("20260716174241") + slot("20260717034252")
    assert oxyii.parse_file_list(payload) == ["20260716174241", "20260717034252"]


def test_file_start_frame_layout():
    op, pl = oxyii.decode(oxyii.file_start_frame("20260716174241", ftype=0))
    assert op == oxyii.OP_FILE_START
    assert len(pl) == 20
    assert pl[:14] == b"20260716174241" and pl[14:16] == b"\x00\x00" and pl[16:20] == b"\x00\x00\x00\x00"


def test_file_data_frame_offset_le():
    op, pl = oxyii.decode(oxyii.file_data_frame(512))
    assert op == oxyii.OP_FILE_DATA and pl == (512).to_bytes(4, "little")
def _live_frame(duration=0, spo2=97, pi=14, pr=62, motion=0, batt=88, contact=0x01, flag=0xC7):
    b = bytearray(24)
    b[0:4] = int(duration).to_bytes(4, "little")
    b[4] = 2
    b[5], b[6], b[7] = contact, spo2, pi
    b[8:10] = int(pr).to_bytes(2, "little")
    b[10], b[11], b[12], b[13] = flag, motion, 0, batt
    return bytes(b)


def test_pi_comes_from_byte7_and_motion_from_byte11_not_the_reverse():
    """The swap that caused a live data bug. Verified against the vendor's own parser (LepuDemo
    lepu-blepro: byArray[7]/10 -> setPi, byArray[11] -> setMotion) AND against a real 5288-row night:
    [7] is non-zero in 99.9% of frames (a perfusion index is continuously non-zero), while the vendor's
    own ViHealth Motion column is 99.4-99.8% ZERO (which is how [11] behaves)."""
    r = oxyii.parse_live(_live_frame(pi=136, motion=0))
    assert r["pi"] == 13.6                     # 136/10 %
    assert r["motion"] == 0
    r2 = oxyii.parse_live(_live_frame(pi=0, motion=29))
    assert r2["pi"] == 0.0 and r2["motion"] == 29


def test_pulse_rate_is_u16_little_endian_not_a_single_byte():
    """[8:10] is a u16 LE; [9] is its HIGH byte, not padding. Below 256 bpm the old u8 read happened to
    agree, which is why this stayed hidden."""
    assert oxyii.parse_live(_live_frame(pr=62))["pr"] == 62
    assert oxyii.parse_live(_live_frame(pr=200))["pr"] == 200
    raw = bytearray(_live_frame()); raw[8], raw[9] = 0x2C, 0x01      # 300 -> out of range -> None
    assert oxyii.parse_live(bytes(raw))["pr"] is None


def test_duration_is_u32_le_and_byte1_is_not_a_constant():
    """[1]=104 was never a protocol constant — it is duration's second byte (104*256 ~ 7.4 h in)."""
    r = oxyii.parse_live(_live_frame(duration=26624))
    assert r["duration"] == 26624
    assert _live_frame(duration=26624)[1] == 104


def test_session_restarted_replaces_the_phantom_frame_gap_counter():
    """The old frame_gap() read [0] as a frame counter and reported phantom loss (9 warnings in one
    evening, one claiming 111 dropped, which was a session starting). 2736 consecutive real frames read
    [0]=0 while the ring idled — impossible for a frame counter."""
    assert not oxyii.session_restarted(None, 0)      # first frame is never a restart
    assert not oxyii.session_restarted(100, 101)     # normal 1 Hz tick
    assert not oxyii.session_restarted(100, 211)     # a big FORWARD jump is not loss, just elapsed time
    assert oxyii.session_restarted(500, 3)           # duration went backwards => new session
    assert not hasattr(oxyii, "frame_gap"), "the phantom-loss counter must not come back"


def test_flag_reads_only_bit0_of_byte10():
    """[10]=199 (0xC7) was recorded as a constant; the SDK reads only bit 0."""
    assert oxyii.parse_live(_live_frame(flag=0xC7))["flag"] == 1
    assert oxyii.parse_live(_live_frame(flag=0xC6))["flag"] == 0


def test_ppg_sample_count_is_u16_le():
    body = bytes(24) + (3).to_bytes(2, "little") + bytes([10, 20, 30])
    assert oxyii.parse_ppg(body) == [10, 20, 30]


def test_ppg_invalid_sentinel_is_exposed_not_silently_interpolated():
    """156 (0x9C) is the device's invalid-sample sentinel. The vendor interpolates it away; we return it
    RAW (fabricating a measurement is worse) but name it so a consumer can reject it."""
    assert oxyii.PPG_INVALID == 156
    body = bytes(24) + (3).to_bytes(2, "little") + bytes([10, 156, 30])
    assert oxyii.parse_ppg(body) == [10, 156, 30]


def test_short_frame_yields_no_reading_at_all_never_a_fabricated_zero():
    for n in (0, 5, 11, 13):
        assert oxyii.parse_live(_live_frame()[:n]) is None, n


def test_reassembler_rejects_an_implausible_declared_length():
    """A mis-framed or truncated notification can declare up to 65535 and park the reassembler waiting
    for bytes that never arrive — swallowing every VALID frame that follows into one bogus buffer. An
    implausible length means we have lost sync, so drop the lead byte and resync on the next 0xA5."""
    r = oxyii.Reassembler()
    bogus = bytes([0xA5, 0x04, 0xFB, 0x00, 0x00, 0xFF, 0xFF])   # declares 65535 bytes of payload
    good = oxyii.encode(oxyii.OP_LIVE, b"\x01\x02\x03")
    out = r.feed(bogus + good)
    assert good in out, "a valid frame after a bogus length must still be recovered"


def test_reassembler_still_accepts_a_large_but_plausible_frame():
    """The bound must not be so tight that a real stored-session chunk is rejected — that would break
    the .dat pull. A frame at the limit still reassembles."""
    r = oxyii.Reassembler()
    big = oxyii.encode(oxyii.OP_FILE_DATA, b"\x5a" * 240)        # ~ATT MTU-sized chunk
    assert big in r.feed(big)


# ── RtWave.offset — the ring's own stream position ([20:24], u32 LE) ──────────────────────────────────
# Recorded so `SUM(declared)` vs `DELTA(offset)` can decide, with no host clock in the comparison,
# whether the ring counts its PPG_INVALID bytes in its own sequence (DEVICE-RATE-TRUTH-2026-08-05 §6.1).


def test_ppg_stream_offset_is_u32_le_at_20():
    body = bytes(20) + (70000).to_bytes(4, "little") + (3).to_bytes(2, "little") + bytes([1, 2, 3])
    assert oxyii.ppg_stream_offset(body) == 70000
    # ...and it does not disturb the count that lives immediately after it
    assert oxyii.ppg_sample_count(body) == 3


def test_ppg_stream_offset_zero_is_a_READING_not_an_absence():
    """The first frame of a session legitimately reports offset 0. Returning None there would make a
    real measurement indistinguishable from a missing field — the blank-vs-zero rule the writers keep."""
    body = bytes(20) + (0).to_bytes(4, "little") + (1).to_bytes(2, "little") + bytes([7])
    assert oxyii.ppg_stream_offset(body) == 0
    assert oxyii.ppg_stream_offset(body) is not None


def test_ppg_stream_offset_absent_field_is_None_never_zero():
    for n in (0, 5, 19, 23):
        assert oxyii.ppg_stream_offset(bytes(n)) is None, n


def test_ppg_stream_offset_needs_24_not_26_bytes():
    """The offset is [20:24] and the sample count [24:26], so a frame can carry an offset and no wave
    header. Gating this on 26 would drop the field on exactly the malformed frames worth seeing."""
    body = bytes(20) + (42).to_bytes(4, "little")
    assert len(body) == 24
    assert oxyii.ppg_stream_offset(body) == 42
    assert oxyii.ppg_sample_count(body) is None


def test_flag_raw_is_the_whole_byte_beside_the_bit():
    """Bit 0 is the vendor's pulse-tone flag and is set on 100 % of frames across 8 nights, so it is a
    SETTING, not an event. The byte's other bits vary and nothing has ever read them."""
    live = oxyii.parse_live(_live_frame(flag=0xC7))
    assert live["flag"] == 1
    assert live["flag_raw"] == 0xC7
    off = oxyii.parse_live(_live_frame(flag=0xC6))
    assert off["flag"] == 0            # bit 0 clear
    assert off["flag_raw"] == 0xC6     # ...while the byte is still reported in full


# ── every field on its OWN byte, and every validity band on its OWN edge ─────────────────────────────
# Found by `tools/mutate.py oxyii` (2026-08-05): 11 of parse_live's 13 surviving mutants are an offset
# or a bound, and NOTHING distinguished them. Two are byte indices — `batt_state` reading payload[13]
# instead of [12], and `run_status` reading [5] instead of [4] — which is the "plausible but wrong
# value" class this suite fears most: a battery state or run status silently taken from the neighbouring
# field, with every existing test green.
#
# That is not hypothetical here. This function's own docstring records that [7] and [11] were once
# SWAPPED, that it "was not cosmetic — it was a live data bug", and that perfusion index went into the
# SpO2 CSV's Motion column for months, breaking OxyDex's `r.motion === 0` artifact filter. The layout
# was corrected against the vendor SDK; what was missing is anything that holds it there.

def _distinct_frame():
    """A 14-byte live frame whose every byte is DIFFERENT, so an off-by-one index cannot read the same
    number by luck. Values are chosen to stay inside each field's validity band where one exists, so a
    surviving offset mutant changes the VALUE rather than merely nulling it."""
    b = bytearray(14)
    b[0:4] = (0x11223344).to_bytes(4, "little")   # duration
    b[4] = 0x51                                    # run_status
    b[5] = 0x52                                    # sensor contact
    b[6] = 96                                      # spo2 (inside 50..100)
    b[7] = 137                                     # pi/10 = 13.7 %
    b[8:10] = (72).to_bytes(2, "little")           # pr (inside 20..250)
    b[10] = 0xC7                                   # flag byte
    b[11] = 0x5B                                   # motion
    b[12] = 0x5C                                   # batt_state
    b[13] = 0x5D                                   # batt percent
    return bytes(b)


def test_every_live_field_reads_its_own_documented_byte():
    """The vendor-SDK layout, pinned field by field. Any single-index slip reads a different value."""
    v = oxyii.parse_live(_distinct_frame())
    assert v["duration"] == 0x11223344, "[0:4] u32 LE"
    assert v["run_status"] == 0x51, "[4] — NOT [5]; the surviving mutant read the contact byte"
    assert v["spo2"] == 96, "[6]"
    assert v["pi"] == 13.7, "[7]/10 — the byte that was once swapped with motion"
    assert v["pr"] == 72, "[8:10] u16 LE"
    assert v["flag_raw"] == 0xC7 and v["flag"] == 1, "[10] whole byte, bit 0 beside it"
    assert v["motion"] == 0x5B, "[11] — the other half of the swap"
    assert v["batt_state"] == 0x5C, "[12] — NOT [13]; the surviving mutant read battery PERCENT"
    assert v["batt"] == 0x5D, "[13]"


def test_a_frame_one_byte_short_is_refused_and_exactly_14_is_accepted():
    """The guard is `< 14`. Both `<= 14` and `< 15` survived, so nothing held the boundary — and 14 is
    exactly the length that carries `batt` at [13]."""
    assert oxyii.parse_live(_distinct_frame()[:13]) is None, "13 bytes cannot carry [13]"
    assert oxyii.parse_live(_distinct_frame()) is not None, "14 bytes is a complete frame"


def _with(idx, val, span=1):
    b = bytearray(_distinct_frame())
    if span == 1:
        b[idx] = val
    else:
        b[idx:idx + span] = int(val).to_bytes(span, "little")
    return bytes(b)


def test_the_spo2_validity_band_is_closed_at_both_ends():
    """`50 <= spo2 <= 100`. Each edge survived independently, so each is asserted on both sides: an
    admitted reading is a number, a refused one is None — never a fabricated 0."""
    assert oxyii.parse_live(_with(6, 49))["spo2"] is None, "49 is off-finger"
    assert oxyii.parse_live(_with(6, 50))["spo2"] == 50, "50 is a real reading — the band is CLOSED"
    assert oxyii.parse_live(_with(6, 100))["spo2"] == 100, "100 is a real reading"
    assert oxyii.parse_live(_with(6, 101))["spo2"] is None, "101 is impossible"


def test_the_pulse_rate_band_is_OPEN_at_both_ends():
    """`20 < pr < 250` — strict, unlike SpO2's closed band, and the asymmetry is the point: all four
    of its edge mutants survived, so nothing recorded which convention this field uses."""
    assert oxyii.parse_live(_with(8, 20, 2))["pr"] is None, "20 is excluded (strict >)"
    assert oxyii.parse_live(_with(8, 21, 2))["pr"] == 21, "21 is the first admitted rate"
    assert oxyii.parse_live(_with(8, 249, 2))["pr"] == 249, "249 is the last admitted rate"
    assert oxyii.parse_live(_with(8, 250, 2))["pr"] is None, "250 is excluded (strict <)"


# ── THE CANARY FOR THE MEASUREMENT NIGHT ─────────────────────────────────────────────────────────────
# `ppg_offset` exists to answer ONE question — does the ring count its PPG_INVALID bytes in its own
# stream position — and the answer arrives only after a night of capture. If the field is mis-wired, the
# column still fills with plausible integers and the first thing to notice is the analysis coming back
# nonsense, a night later. These assert the wiring end-to-end BEFORE the night is spent.


def _rt_data(offset: int, n: int, duration: int = 100) -> bytes:
    """A `cmd=0x04` reply shaped the way the device sends it: RtParam[0:20], then RtWave = offset u32 LE
    at [20:24], size u16 LE at [24:26], then `n` one-byte samples."""
    param = bytearray(20)
    param[0:4] = duration.to_bytes(4, "little")
    param[5], param[6], param[7] = 0x01, 97, 14          # contact, spo2, pi
    param[8:10] = (62).to_bytes(2, "little")             # pr
    param[10], param[11], param[13] = 0xC7, 0, 88        # flag byte, motion, battery
    return bytes(param) + offset.to_bytes(4, "little") + n.to_bytes(2, "little") + bytes([100] * n)


def test_ppg_offset_advances_by_exactly_the_declared_count():
    """The relationship the whole measurement rests on: frame i starts at offset O_i and carries N_i
    samples, so O_(i+1) - O_i == N_i. Reading the wrong four bytes, or the wrong endianness, breaks this
    while still producing a column full of integers."""
    frames = [(0, 126), (126, 127), (253, 125), (378, 126)]
    got = [(oxyii.ppg_stream_offset(_rt_data(o, n)), oxyii.ppg_sample_count(_rt_data(o, n)))
           for o, n in frames]
    assert got == frames, "offset/count did not round-trip out of a device-shaped frame"
    for (o1, n1), (o2, _n2) in zip(got, got[1:]):
        assert o2 - o1 == n1, f"delta offset {o2 - o1} != the declared count {n1} of the frame before it"


def test_ppg_offset_is_monotonic_across_a_frame_run():
    offs = [oxyii.ppg_stream_offset(_rt_data(o, 126)) for o in (0, 126, 252, 378, 504)]
    assert offs == sorted(offs) and len(set(offs)) == len(offs)


def test_offset_and_count_cannot_be_silently_swapped():
    """Distinct magnitudes, so a transposed read is visible. A u32 offset past 65535 cannot even fit the
    count's field, and 126 is not a plausible stream position four frames in."""
    p = _rt_data(70000, 126)
    assert oxyii.ppg_stream_offset(p) == 70000
    assert oxyii.ppg_sample_count(p) == 126


def test_a_wave_body_that_is_all_sentinel_still_reports_its_offset():
    """The pathological case the field exists to measure: a frame whose samples are entirely
    PPG_INVALID. The offset must still be readable — it is the only thing that could say whether the
    device counted those bytes."""
    param = bytearray(20)
    param[10] = 0xC7
    body = bytes(param) + (900).to_bytes(4, "little") + (3).to_bytes(2, "little") + bytes([156, 156, 156])
    assert oxyii.ppg_stream_offset(body) == 900
    assert oxyii.parse_ppg(body) == [156, 156, 156]


# ── cmd 0x05 raw dual-wavelength buffer ──────────────────────────────────────────────────────────────
def _rt_ppg_payload(recs, declared=None, trailer=b""):
    """Build a cmd=0x05 body: u16 LE count + 9-byte records + an optional trailer."""
    body = b"".join(a.to_bytes(4, "little") + b.to_bytes(4, "little") + bytes([m]) for a, b, m in recs)
    n = len(recs) if declared is None else declared
    return n.to_bytes(2, "little") + body + trailer


def test_parse_rt_ppg_decodes_little_endian_u32_pairs():
    """Byte order is load-bearing: these values differ under big-endian, so a flipped decode cannot pass."""
    recs = [(0x00010203, 0x04050607, 9), (1, 2, 0)]
    assert oxyii.parse_rt_ppg(_rt_ppg_payload(recs)) == recs


def test_parse_rt_ppg_ignores_a_trailer_of_any_size():
    """The real 922 B reply declares 102 records = 920 B and carries TWO BYTES OVER. The trailer is not
    decoded and not assumed to be padding — a record must never be assembled from it."""
    recs = [(11, 22, 3), (44, 55, 6)]
    for trailer in (b"", b"\xff\xff", b"\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a"):
        assert oxyii.parse_rt_ppg(_rt_ppg_payload(recs, trailer=trailer)) == recs


def test_parse_rt_ppg_is_bounded_by_the_buffer_not_the_declared_count():
    """A truncated reply must yield only whole records present in the bytes. Trusting the device's count
    would either raise or, worse, emit records zero-padded out of absent bytes — a fabricated sample."""
    full = _rt_ppg_payload([(7, 8, 1), (9, 10, 2), (11, 12, 3)])
    assert oxyii.parse_rt_ppg(full[:2 + 9 + 4]) == [(7, 8, 1)]      # one whole record + a partial second
    assert oxyii.parse_rt_ppg(_rt_ppg_payload([(7, 8, 1)], declared=99)) == [(7, 8, 1)]


def test_parse_rt_ppg_returns_empty_rather_than_guessing():
    for payload in (b"", b"\x05", _rt_ppg_payload([])):
        assert oxyii.parse_rt_ppg(payload) == []


def test_rt_ppg_frame_sends_the_argument_the_sdk_specifies():
    """`{0x07, 0x01}` is the whole reason this stream was found: the 256-opcode sweep sent
    `none/00/01/02` to 0x05 and scored the reply as noise. A bare 0x05 is not this request."""
    fr = oxyii.rt_ppg_frame()
    assert oxyii.RT_PPG_ARG == b"\x07\x01"
    assert b"\x07\x01" in fr and fr[1] == oxyii.OP_RT_PPG


def test_parse_rt_ppg_reads_the_channels_as_SIGNED():
    """The channels are 24-bit two's complement sign-extended into 32 bits, and reading them unsigned
    turns a small negative into ~4.29e9 — which destroys any mean it lands in rather than looking wrong.

    Values here are REAL: -342 and -285410 were observed on device S8AW2100 (2026-08-05), the extremes
    of 15 negatives across 61 066 samples. The first shipped revision of this parser read unsigned, and
    no test caught it because every fixture used small positives — so this one uses the bytes that
    actually appear on the wire.
    """
    recs = [(-342, -285410, 0), (1375820, 639833, 2)]
    body = b"".join(a.to_bytes(4, "little", signed=True) + b.to_bytes(4, "little", signed=True) + bytes([m])
                    for a, b, m in recs)
    got = oxyii.parse_rt_ppg(len(recs).to_bytes(2, "little") + body)
    assert got == recs, "negatives must survive the round trip"
    assert all(v > -2**31 for r in got for v in r[:2])
    # the specific failure mode: an unsigned read yields 2**32 + x, which is what wrecked the statistics
    assert got[0][0] == -342 and got[0][0] != 2**32 - 342


def test_parse_rt_ppg_output_stays_inside_24_bit_signed_range():
    """A guard on the WIRE FORMAT, not on our decode: every one of 61 066 real samples fit in 24-bit
    signed (max |v| = 285 410 « 8 388 607). A value outside that range means the layout assumption has
    broken — a shifted offset or a firmware change — and should be visible, not averaged in silently."""
    hi, lo = 8388607, -8388608
    body = hi.to_bytes(4, "little", signed=True) + lo.to_bytes(4, "little", signed=True) + bytes([0])
    got = oxyii.parse_rt_ppg((1).to_bytes(2, "little") + body)
    assert got == [(hi, lo, 0)], "the 24-bit signed extremes must decode exactly"


# ── Harvested read-only queries + Format-A trailer (nglessner/o2ring-s-protocol, byte-verified) ──────
def test_crc_fixture_from_upstream_doc():
    """The single anchor that proves upstream's protocol IS ours: their documented GET_INFO frame,
    `A5 E1 1E 00 02 00 00` with CRC `BF`, must be exactly what encode() produces. If this breaks, either
    crc8 changed or the frame envelope did, and every harvested parser below is suspect."""
    assert oxyii.crc8(bytes.fromhex("A5E11E00020000")) == 0xBF
    assert oxyii.encode(0xE1, b"", seq=2) == bytes.fromhex("a5e11e00020000bf")


def test_get_info_parses_firmware_and_serial():
    p = bytearray(60)
    p[9:17] = b"2D010002"
    p[37] = 10
    p[38:48] = b"25B2303210"
    got = oxyii.parse_get_info(bytes(p))
    assert got["firmware"] == "2D010002"
    assert got["serial"] == "25B2303210"
    assert oxyii.parse_get_info(b"\x00" * 40) is None          # too short → None, never a partial dict


def test_get_info_decodes_the_rtc_from_the_hardware_bytes():
    """Bytes [24:31] measured on device 2592302100 on 2026-08-19 19:48:26, four minutes after a 0xC0
    sync — the readback matched the host to the second. Layout is set_time_frame's write payload."""
    p = bytearray(60)
    p[24:31] = bytes([0xEA, 0x07, 0x08, 0x13, 0x13, 0x30, 0x1A])   # 2026-08-19 19:48:26
    rtc = oxyii.parse_get_info(bytes(p))["rtc"]
    assert rtc == {"year": 2026, "month": 8, "day": 19, "hour": 19, "minute": 48, "second": 26}


def test_get_info_rtc_roundtrips_set_time_frame():
    """Pull must invert push: decode(set_time_frame(dt)'s fields placed at [24:31]) == dt's components.
    If either side's layout moves, this is the test that names it."""
    import datetime as dt
    when = dt.datetime(2031, 12, 5, 23, 59, 58)
    frame = oxyii.set_time_frame(when)
    p = bytearray(60)
    p[24:31] = frame[7:14]               # the 7 time bytes of the 8-byte payload (skip the 0xCE tail)
    rtc = oxyii.parse_get_info(bytes(p))["rtc"]
    assert rtc == {"year": 2031, "month": 12, "day": 5, "hour": 23, "minute": 59, "second": 58}


def test_get_info_rtc_is_none_when_components_are_impossible():
    """Clock Contract §2.7: out-of-range components must be VISIBLE as absence, never rolled into a
    plausible wrong instant. An unset RTC region (all zeros: year 0, month 0) is the common case."""
    assert oxyii.parse_get_info(bytes(60))["rtc"] is None                    # zeros: unset
    p = bytearray(60)
    p[24:31] = bytes([0xEA, 0x07, 13, 19, 19, 48, 26])                       # month 13
    assert oxyii.parse_get_info(bytes(p))["rtc"] is None
    p[24:31] = bytes([0xEA, 0x07, 8, 19, 24, 0, 0])                          # hour 24
    assert oxyii.parse_get_info(bytes(p))["rtc"] is None
    p[24:31] = bytes([0xEA, 0x07, 8, 19, 19, 60, 0])                         # minute 60
    assert oxyii.parse_get_info(bytes(p))["rtc"] is None
    p[24:31] = bytes([0xEA, 0x07, 8, 32, 19, 48, 26])                        # day 32, alone
    assert oxyii.parse_get_info(bytes(p))["rtc"] is None
    p[24:31] = bytes([0xEA, 0x07, 8, 19, 19, 48, 60])                        # second 60, alone
    assert oxyii.parse_get_info(bytes(p))["rtc"] is None
    # CALENDAR-impossible: each component is in its own range but the DATE does not exist. The original
    # per-field guard (1 <= d <= 31) let these through — and the consumer ring_clock_offset_s then throws
    # datetime()'s "day is out of range for month", silently killing the RTC-offset telemetry.
    p[24:31] = bytes([0xEA, 0x07, 2, 31, 10, 0, 0])                           # Feb 31
    assert oxyii.parse_get_info(bytes(p))["rtc"] is None
    p[24:31] = bytes([0xEA, 0x07, 4, 31, 10, 0, 0])                           # Apr 31
    assert oxyii.parse_get_info(bytes(p))["rtc"] is None
    p[24:31] = bytes([0xEA, 0x07, 2, 30, 10, 0, 0])                           # Feb 30
    assert oxyii.parse_get_info(bytes(p))["rtc"] is None
    # and a REAL date still decodes (the guard rejects only the impossible)
    p[24:31] = bytes([0xEA, 0x07, 2, 28, 10, 0, 0])
    assert oxyii.parse_get_info(bytes(p))["rtc"] == {"year": 2026, "month": 2, "day": 28, "hour": 10, "minute": 0, "second": 0}


def test_set_config_frame_builds_the_documented_payload():
    """[field_index, 0, 0, 0, value, 0, 0, 0] per nglessner/o2ring-s-protocol — brightness is write-field
    9, motor 6 (a DIFFERENT enumeration from parse_config's read offsets 7 and 4)."""
    f = oxyii.set_config_frame("brightness", 2, seq=3)
    assert f[1] == oxyii.OP_SET_CONFIG == 0x01
    assert f[7:15] == bytes([9, 0, 0, 0, 2, 0, 0, 0])
    assert oxyii.set_config_frame("motor", 60)[7:15] == bytes([6, 0, 0, 0, 60, 0, 0, 0])


def test_set_config_frame_refuses_off_whitelist_and_out_of_range():
    """The whitelist IS the safety gate: 0x01's opcode neighbours are factory resets, so nothing off the
    list may produce a frame, and brightness's documented 0..2 range is enforced."""
    import pytest
    with pytest.raises(ValueError, match="unknown SET_CONFIG field"):
        oxyii.set_config_frame("factory_reset", 1)
    with pytest.raises(ValueError, match="out of range"):
        oxyii.set_config_frame("brightness", 3)
    with pytest.raises(ValueError, match="out of range"):
        oxyii.set_config_frame("motor", 256)
    with pytest.raises(ValueError, match="out of range"):
        oxyii.set_config_frame("motor", -1)


def test_config_parses_the_settings_struct():
    p = bytearray(40)
    p[1] = 88            # spo2_low
    p[7] = 2             # brightness
    p[8] = 4             # storage_interval
    p[17], p[18] = 0x10, 0x00
    got = oxyii.parse_config(bytes(p))
    assert got["spo2_low"] == 88 and got["brightness"] == 2 and got["storage_interval"] == 4
    assert got["invalid_signal_time_thr"] == 16
    assert oxyii.parse_config(b"\x00" * 10) is None


def test_battery_parse():
    assert oxyii.parse_battery(bytes([0x00, 0x5d])) == {"state": 0x00, "level": 0x5d}
    assert oxyii.parse_battery(b"\x00") is None


def _fmt_a_file(records, trailer_overrides=None, finalized=True):
    """Build a synthetic Format-A file: 10-byte header + 3-byte records + 48-byte trailer."""
    hdr = bytes([0x01, 0x03, 0, 0, 0, 0, 0, 0, 0x04, 0x00])
    body = b"".join(bytes(r) for r in records)
    t = bytearray(48)
    if finalized:
        t[4:8] = bytes([0x48, 0x12, 0x5A, 0xDA])
    n = len(records)
    t[12], t[13] = n & 0xFF, (n >> 8) & 0xFF
    t[34], t[35], t[36], t[37] = 96, 81, 17, 12
    t[39], t[40], t[41], t[42], t[47] = 48, 0, 3, 94, 49
    for k, v in (trailer_overrides or {}).items():
        t[k] = v
    return hdr + body + bytes(t)


def test_oxy_trailer_parses_session_stats():
    f = _fmt_a_file([(96, 50, 0)] * 300)
    tr = oxyii.parse_oxy_trailer(f)
    assert tr["finalized"] and tr["total_seconds"] == 300
    assert tr["avg_spo2"] == 96 and tr["min_spo2"] == 81
    assert tr["desat_ge3"] == 17 and tr["desat_ge4"] == 12
    assert tr["seconds_below_90"] == 48 and tr["episodes_below_90"] == 3
    assert tr["o2_score_x10"] == 94 and tr["avg_hr"] == 49


def test_oxy_trailer_start_time_is_a_FLOATING_wall_clock_epoch():
    """`T+8` is the recording start, and it is local civil time encoded as if it were UTC — the Clock
    Contract's canonical form (CLAUDE.md §🔒.1). Measured on six real stored files: read as UTC it equals
    the filename's LOCAL stamp to +0.00 h, so the ring does NOT apply the timezone we push.

    The plant that matters: a reader who "helpfully" converts this with a local-time function gets a
    different instant, and the point of a floating stamp is that it does not depend on the reader. So the
    round-trip is asserted through `utcfromtimestamp`, never `fromtimestamp`."""
    import calendar
    import datetime

    wall = datetime.datetime(2026, 7, 23, 22, 3, 22)               # the stamp a filename would carry
    epoch = int(calendar.timegm(wall.timetuple()))                 # civil time encoded AS IF UTC
    over = {8 + i: (epoch >> (8 * i)) & 0xFF for i in range(4)}
    tr = oxyii.parse_oxy_trailer(_fmt_a_file([(96, 50, 0)] * 300, over))
    assert tr["start_t_ms"] == epoch * 1000, "start_t_ms is seconds x 1000, unshifted"
    got = datetime.datetime.fromtimestamp(tr["start_t_ms"] / 1000, datetime.timezone.utc)
    assert got.replace(tzinfo=None) == wall, f"UTC read must reproduce the wall clock, got {got}"


def test_oxy_trailer_sample_count_is_u32_not_u16():
    """`T+12` is a u32 sample count; the old read took two bytes and called it `total_seconds`.

    NOT a live defect — all 30 real files have interval 1 and cap at 36 000 samples, below the u16 wrap
    at 65 536 (§5's 10 h cap). This pins the correct width so a ring with a longer cap cannot wrap
    silently."""
    tr = oxyii.parse_oxy_trailer(_fmt_a_file([(96, 50, 0)] * 4, {12: 0x00, 13: 0x00, 14: 0x01, 15: 0x00}))
    assert tr["sample_count"] == 65536, "the high half of the u32 must be read"
    assert tr["total_seconds"] == 65536, "the legacy key keeps its meaning at the corrected width"


def test_oxy_trailer_duration_is_count_times_interval_not_the_count():
    """`total_seconds` equals the sample count only while `interval` is 1 — true of every file we hold,
    and not a property of the format. `duration_s` is the one that stays right if that changes."""
    tr = oxyii.parse_oxy_trailer(_fmt_a_file([(96, 50, 0)] * 300, {16: 4}))
    assert tr["interval_s"] == 4 and tr["sample_count"] == 300
    assert tr["duration_s"] == 1200, "duration is count x interval"
    one = oxyii.parse_oxy_trailer(_fmt_a_file([(96, 50, 0)] * 300, {16: 1}))
    assert one["duration_s"] == one["total_seconds"] == 300, "the two agree exactly when interval is 1"


def test_oxy_trailer_surfaces_the_three_fields_upstream_calls_reserved():
    """`asleepTime`, `percentLessThan90` and `stepCounter` are marked "reserved (zero)" by the public
    reverse-engineering reference and are none of those things."""
    tr = oxyii.parse_oxy_trailer(
        _fmt_a_file([(96, 50, 0)] * 300, {32: 0x10, 33: 0x0E, 38: 71, 43: 0x2A, 44: 0x01, 45: 0, 46: 0})
    )
    assert tr["asleep_seconds"] == 0x0E10, "u16 LE at T+32"
    assert tr["pct_below_90"] == 71
    assert tr["steps"] == 0x012A, "u32 LE at T+43"


def test_oxy_trailer_preexisting_keys_are_byte_identical():
    """Additive change: every key this parser returned before keeps its name, type and value."""
    tr = oxyii.parse_oxy_trailer(_fmt_a_file([(96, 50, 0)] * 300))
    for k, v in {
        "finalized": True, "total_seconds": 300, "avg_spo2": 96, "min_spo2": 81,
        "desat_ge3": 17, "desat_ge4": 12, "seconds_below_90": 48, "episodes_below_90": 3,
        "o2_score_x10": 94, "avg_hr": 49,
    }.items():
        assert tr[k] == v, f"{k} changed"


def test_oxy_trailer_score_na_is_none_not_255():
    tr = oxyii.parse_oxy_trailer(_fmt_a_file([(96, 50, 0)] * 60, {42: 0xFF}))
    assert tr["o2_score_x10"] is None, "0xFF is the N/A sentinel and must not surface as a real score"


def test_oxy_trailer_finalization_predicate_gates_incomplete_files():
    """The reason this exists: cmd=0xF2 can report a file's full size BEFORE the trailer flushes, so
    size-equality is not 'complete'. A file without the sub-magic must parse to None (re-pull later),
    not a half-written summary read as real."""
    unfinal = _fmt_a_file([(96, 50, 0)] * 300, finalized=False)
    assert oxyii.oxy_is_finalized(unfinal) is False
    assert oxyii.parse_oxy_trailer(unfinal) is None
    assert oxyii.oxy_is_finalized(_fmt_a_file([(96, 50, 0)] * 300)) is True
    assert oxyii.parse_oxy_trailer(b"\x00" * 20) is None       # shorter than a trailer


def test_readonly_frame_builders_emit_valid_empty_payload_reads():
    """The three query frames are empty-payload reads; assert each is a well-formed frame for its opcode
    (decode round-trips) rather than just that the function runs."""
    for frame, op in ((oxyii.info_frame(2), oxyii.OP_GET_INFO),
                      (oxyii.config_frame(), oxyii.OP_GET_CONFIG),
                      (oxyii.battery_frame(), oxyii.OP_GET_BATTERY)):
        got_op, payload = oxyii.decode(frame)
        assert got_op == op and payload == b""
    assert oxyii.info_frame(2) == bytes.fromhex("a5e11e00020000bf")   # the byte-verified fixture


def test_pi_and_motion_cannot_be_swapped_section16():
    """§16 cannot-swap guard (OxyII G4 / charter §16). PI (payload[7]) and MOTION (payload[11]) must
    never be swapped again: the swap wrote PI into the SpO2 CSV's Motion column, and OxyDex excludes
    artifact samples with motion==0 — so a continuously-non-zero PI sitting there silently changed which
    samples were kept. Values chosen so a swap is UNAMBIGUOUS (PI high, motion zero — the real sleeping-
    subject shape). test_parse_live_offsets pins the offsets in general; this states the invariant."""
    p = bytearray(24)
    p[5], p[6] = 0x03, 97                          # worn, valid SpO2
    p[7], p[11] = 130, 0                           # PI raw 130 -> 13.0 % ; MOTION 0 (still subject)
    p[8:10] = (60).to_bytes(2, "little")
    v = oxyii.parse_live(bytes(p))
    assert v["pi"] == 13.0, "PI must come from payload[7]"
    assert v["motion"] == 0, "MOTION must come from payload[11]"
    # The exact bug shape if swapped: pi 0.0 in the reading, motion 130 written into the Motion column.
    assert not (v["pi"] == 0.0 and v["motion"] == 130), "PI/motion are swapped — the §16 data bug"


# ── the auth timestamp is a plain LE uint32, capture-verified ─────────────────────────────────────
# Settled 2026-08-30 against a USB capture of the real O2 Insight Pro. `auth_payload` had shifted by
# `>> 0,1,2,3` while its own docstring claimed "a faithful port of the vendor code — both sides
# match". Nobody had checked it against the vendor; it was neither.
def _key(payload):
    """Undo the constant XOR so the raw key bytes can be asserted."""
    return bytes(a ^ b for a, b in zip(payload, oxyii._LEPU))


def test_THE_AUTH_TIMESTAMP_IS_A_LITTLE_ENDIAN_UINT32():
    import struct
    ts = 1788096128
    assert _key(oxyii.auth_payload("1234", ts))[12:16] == struct.pack("<I", ts)


def test_THE_CAPTURE_DISCRIMINATOR_key13_IS_CONSTANT_ACROSS_A_SHORT_WINDOW():
    """🔴 THE EVIDENCE ITSELF, NOT A RESTATEMENT OF THE FIX.

    The two candidate encodings differ observably in exactly one place over a short window:

        >> 0,1,2,3  ->  key[13] = (ts>>1)&0xff, which ticks every 2 s: 14 values in 27 s
        LE uint32   ->  key[13] = (ts>>8)&0xff, which ticks every 256 s: CONSTANT

    The capture showed key[13:16] constant at `2e 94 6a` with only key[12] moving, which refutes the
    shift form outright. This test reproduces that measurement, so a regression to the shift form
    fails on the same evidence that settled it rather than on a hard-coded golden."""
    base = 1788096000
    keys = [_key(oxyii.auth_payload("0000", base + t)) for t in range(28)]
    assert len({k[13] for k in keys}) == 1, "key[13] moved — this is the shift form, not LE"
    assert len({k[12] for k in keys}) == 28, "key[12] must tick every second"


def test_THE_OBSERVED_BYTES_DECODE_TO_THE_CAPTURE_WINDOW():
    """Stronger than 'consistent with LE': the captured high bytes decode to a real wall-clock time.

    `2e 94 6a` as the top three bytes of an LE uint32 epoch is 2026-08-30 09:20–09:24 — when the
    capture was running. A wrong encoding does not produce the right time of day by accident."""
    import datetime as dt, struct
    ts = struct.unpack("<I", bytes([0x80, 0x2E, 0x94, 0x6A]))[0]
    when = dt.datetime.fromtimestamp(ts)
    assert (when.year, when.month, when.day) == (2026, 8, 30)
    assert _key(oxyii.auth_payload("0000", ts))[12:16] == bytes([0x80, 0x2E, 0x94, 0x6A])


def test_AN_OUT_OF_RANGE_TIMESTAMP_DOES_NOT_RAISE():
    # `struct.pack("<I", ...)` raises outside uint32; the old shift form silently truncated. An auth
    # frame must not become an exception in 2106, or on a box whose clock is nonsense.
    for ts in (2 ** 33, 0, 2 ** 32 - 1):
        assert len(oxyii.auth_payload("0000", ts)) == 16
