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
