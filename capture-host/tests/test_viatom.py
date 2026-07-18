# tepna-capture — tests/test_viatom.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Known-answer tests for the Viatom / Wellue O2Ring real-time packet decoder (viatom.decode_packet).
# viatom.py is PURE (no bleak) — the reverse-engineered offsets + physiologic guards are exactly the
# kind of thing that must not drift silently. Was 0% covered (CAPTURE-HOST-FOLLOWUPS-III test-coverage).

import viatom


def _pkt(spo2=97, pr=60, batt=80, motion=2, pi10=15, worn=1, length=19):
    """Build a real-time notification frame with the ecostech/viatom-ble offsets."""
    b = bytearray(length)
    if length >= 19:
        b[7] = spo2
        b[8] = pr
        b[14] = batt
        b[16] = motion
        b[17] = pi10
        b[18] = worn
    return bytes(b)


def test_decodes_a_valid_frame():
    d = viatom.decode_packet(_pkt(spo2=97, pr=60, batt=80, motion=2, pi10=15, worn=1))
    assert d == {"spo2": 97, "pr": 60, "batt": 80, "motion": 2, "pi": 1.5, "worn": True}


def test_perfusion_index_scales_by_ten():
    assert viatom.decode_packet(_pkt(pi10=34))["pi"] == 3.4


def test_worn_flag_false_when_off_finger():
    assert viatom.decode_packet(_pkt(worn=0))["worn"] is False


def test_short_packet_returns_none():
    assert viatom.decode_packet(_pkt(length=18)) is None
    assert viatom.decode_packet(b"") is None
    assert viatom.decode_packet(None) is None


def test_invalid_spo2_becomes_none_not_fabricated():
    # 0 and 255 are the invalid sentinels; anything <50 is implausible.
    assert viatom.decode_packet(_pkt(spo2=0))["spo2"] is None
    assert viatom.decode_packet(_pkt(spo2=255))["spo2"] is None
    assert viatom.decode_packet(_pkt(spo2=49))["spo2"] is None
    # a plausible value survives
    assert viatom.decode_packet(_pkt(spo2=88))["spo2"] == 88


def test_invalid_pulse_rate_becomes_none():
    assert viatom.decode_packet(_pkt(pr=20))["pr"] is None   # 20 is the exclusive floor
    assert viatom.decode_packet(_pkt(pr=255))["pr"] is None
    assert viatom.decode_packet(_pkt(pr=21))["pr"] == 21


def test_spo2_and_pr_independent():
    # a valid SpO2 with an invalid pulse still reports the SpO2 (never all-or-nothing).
    d = viatom.decode_packet(_pkt(spo2=95, pr=0))
    assert d["spo2"] == 95 and d["pr"] is None
