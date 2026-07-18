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
    p = bytearray(24)
    p[5], p[6], p[7], p[8], p[13] = 0x03, 97, 5, 62, 88
    v = oxyii.parse_live(bytes(p))
    # Pin the OFFSETS, not the exact dict: parse_live is allowed to gain fields (the contract is
    # additive — new data goes in a NEW key, per CLAUDE.md §🧪), and asserting equality would red on
    # every additive change. `seq` was added this way for frame-drop detection.
    for k, exp in {"spo2": 97, "pr": 62, "motion": 5, "batt": 88, "contact": 0x03, "worn": True}.items():
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


def test_file_list_and_end_frames_empty():
    assert oxyii.decode(oxyii.file_list_frame()) == (oxyii.OP_FILE_LIST, b"")
    assert oxyii.decode(oxyii.file_end_frame()) == (oxyii.OP_FILE_END, b"")


def test_frame_gap_counts_dropped_live_frames():
    """The ring's [0] byte is a frame counter that wraps at 256. Without it a dropped frame looks
    identical to the ring pausing. Measured over 271 real frames 2026-07-18: 262 exact +1 steps, 5
    repeats, 3 double-steps — so both loss and duplication genuinely occur."""
    assert oxyii.frame_gap(10, 11) == 0        # consecutive
    assert oxyii.frame_gap(10, 13) == 2        # two lost
    assert oxyii.frame_gap(255, 0) == 0        # wrap is NOT a 255-frame loss
    assert oxyii.frame_gap(254, 1) == 2        # wrap with real loss
    assert oxyii.frame_gap(10, 10) == -1       # duplicate
    assert oxyii.frame_gap(None, 7) == 0       # first frame establishes the baseline


def test_parse_live_exposes_the_sequence_counter():
    hdr = bytes([42, 104, 0, 0, 2, 1, 98, 12, 55, 0, 199, 0, 0, 41]) + bytes(10)
    live = oxyii.parse_live(hdr)
    assert live["seq"] == 42
    assert live["spo2"] == 98 and live["pr"] == 55 and live["batt"] == 41
