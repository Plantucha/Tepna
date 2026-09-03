# tepna-capture — tests/test_monitor_pi_card.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The perfusion index must reach the monitor, and must not be confused with motion again.

PI and motion were SWAPPED once (`oxyii.parse_live`, corrected 2026-07-18): `[7]` was written into the
SpO2 sidecar's `Motion` column, and OxyDex drops artifact samples on `r.motion === 0`, so on
vigil-captured files that filter kept ~0.1 % of samples. The fix put `pi = [7]/10` and `motion = [11]`
in the right places — but only in the FILE. Nothing published `pi` live, so the one field that says
*why* an SpO2 reading is poor was visible only after the fact.

This module pins the whole chain rather than either end: the parser's offsets, the live push, and the
monitor's stream classification. The chain is what the swap broke, and a test on one end alone would
have passed throughout the period when the data was wrong.
"""

import os
import re

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(HERE, "monitor.html")
CAP = os.path.join(HERE, "capture.py")
OXY = os.path.join(HERE, "oxyii.py")


def _read(p):
    return open(p, encoding="utf-8").read()


# ── the offsets, which are the thing that was wrong ──────────────────────────────────────────────────

def test_pi_is_byte_7_over_ten_and_motion_is_byte_11():
    """The swap, pinned at its source. `[7]` is a perfusion index in tenths of a percent; `[11]` is
    motion. If these ever trade places again, everything below is labelled correctly and reports the
    wrong quantity — which is exactly how the first bug survived."""
    import oxyii

    body = bytearray(24)
    body[7] = 136          # PI 13.6 tenths => 13.6 %
    body[11] = 42          # motion
    body[6], body[8], body[9] = 97, 60, 0
    live = oxyii.parse_live(bytes(body))
    assert live["pi"] == 13.6, "pi is [7] divided by ten, in percent"
    assert live["motion"] == 42, "motion is [11] raw"


def test_pi_and_motion_are_read_from_different_bytes():
    """A regression that set both from one offset would satisfy the values above only by coincidence.
    Moving [7] alone must move pi alone."""
    import oxyii

    a = bytearray(24)
    a[7], a[11] = 10, 10
    b = bytearray(a)
    b[7] = 200
    la, lb = oxyii.parse_live(bytes(a)), oxyii.parse_live(bytes(b))
    assert la["motion"] == lb["motion"] == 10, "changing [7] must not move motion"
    assert la["pi"] != lb["pi"], "changing [7] must move pi"


# ── the live push, which is what was missing ─────────────────────────────────────────────────────────

def test_capture_publishes_pi_on_the_bus():
    """`pi` was parsed and written to the sidecar but never pushed, so no card could exist."""
    cap = _read(CAP)
    assert 'BUS.push("pi_o2"' in cap, "capture.py must publish pi as a live stream"


def test_pi_is_pushed_wherever_motion_is():
    """The ring keeps reporting on the charger, so there are two push sites — the worn path and the
    not-worn path. A `pi` published on only one of them produces a card that goes silent for reasons a
    reader would attribute to the sensor rather than to us."""
    cap = _read(CAP)
    assert cap.count('BUS.push("motion_o2"') == cap.count('BUS.push("pi_o2"') == 2, (
        "pi must be published at every site motion is, or the card dies on the charger path"
    )


def test_pi_needs_no_none_guard_because_parse_live_always_returns_a_float():
    """The inverse of the assertion that used to be here. A `is not None` guard was added, tested, and
    then flagged by the coverage floor as a branch that can never be false — `parse_live` computes
    `[7]/10.0` unconditionally. Pinning the REASON, so nobody re-adds the guard and nobody deletes the
    push thinking it can yield None."""
    import oxyii

    body = bytearray(24)
    body[5] = body[10] = 0x01
    for v in (0, 1, 255):
        body[7] = v
        assert isinstance(oxyii.parse_live(bytes(body))["pi"], float), "pi is always a float, never None"


# ── the monitor, which has to recognise it ───────────────────────────────────────────────────────────

def test_monitor_treats_pi_as_an_o2ring_derived_stream():
    """`pi_o2` resolves to base `pi`. Without it in O2_DERIVED the card renders with no device, losing
    its RSSI and battery chips AND — the reason this matters — skipping the charging / not-worn checks,
    which is the exact false 'live' reading `streamState` exists to prevent."""
    mon = _read(MON)
    assert re.search(r"O2_DERIVED\s*=\s*\[[^\]]*'pi'", mon), "pi must be an O2-derived stream"


def test_monitor_labels_and_classifies_pi():
    mon = _read(MON)
    assert re.search(r"\bpi:\s*'perfusion index", mon), "the card needs a label naming its unit"
    assert "if(key==='pi')" in mon, "pi needs a status band or it renders uncoloured"


def test_pi_bands_are_the_rings_observed_range_not_a_clinical_cutoff():
    """The comment matters more than the numbers: we have no validation for a medical PI threshold, and
    inventing one in a monitor would be exactly the fabricated authority the evidence ladder forbids."""
    mon = _read(MON)
    assert "not a clinical threshold" in mon or "against a medical cutoff" in mon, (
        "the band must say it is the observed range, not a validated cutoff"
    )


# ── the ring's 3-axis accelerometer (0x14), which is opt-in and must stay that way ────────────────────

def test_setup_frame_default_is_unchanged_and_disables_every_push():
    """`0x10` payload `0x00` is what every existing recording was captured under. The default must not
    move: a caller that does not opt in has to produce the identical byte it always did."""
    import oxyii

    assert oxyii.setup_frame() == oxyii.setup_frame(0x00), "the default must be explicit-zero"
    assert oxyii.setup_frame()[7] == 0x00, "payload byte is the AUTO_RT_SWITCH bitfield"


def test_setup_frame_bits_are_the_vendors_four_switches():
    import oxyii

    assert (oxyii.RT_PUSH_PARAM, oxyii.RT_PUSH_WAVE, oxyii.RT_PUSH_PPG, oxyii.RT_PUSH_ACC) == (1, 2, 4, 8)
    assert oxyii.setup_frame(oxyii.RT_PUSH_ACC)[7] == 0x08
    import pytest

    for bad in (-1, 0x10, 0xFF):
        with pytest.raises(ValueError):
            oxyii.setup_frame(bad)


def test_rt_acc_axes_are_signed():
    """The sibling `parse_rt_ppg` shipped reading unsigned and its statistics were an order of magnitude
    wrong. An accelerometer sits at +/-1 g on one axis, so unsigned turns every downward tilt into a
    huge positive that still looks like data."""
    import oxyii

    payload = bytes([1, 0]) + (-2000).to_bytes(2, "little", signed=True) + \
        (16).to_bytes(2, "little", signed=True) + (1000).to_bytes(2, "little", signed=True)
    assert oxyii.parse_rt_acc(payload) == [(-2000, 16, 1000)]


def test_rt_acc_is_bounded_by_the_buffer_not_the_declared_count():
    """A truncated frame must yield the records that are actually present, never read past the end."""
    import oxyii

    payload = bytes([9, 0]) + bytes(6)          # claims 9 records, carries 1
    assert len(oxyii.parse_rt_acc(payload)) == 1
    assert oxyii.parse_rt_acc(b"\x01") == []


def test_acc_push_is_opt_in_via_the_same_streams_list_the_h10_uses():
    """Asking for 'acc' in the device's `streams` is how the H10 gets its chest ACC; the ring uses the
    same switch, so a reader configures both the same way — and a ring that was not asked keeps the
    byte-identical handshake it has always sent."""
    cap = _read(CAP)
    assert 'oxyii.RT_PUSH_ACC if "acc" in (dev.get("streams") or [])' in cap, (
        "the push bit must come from the device's streams list, not a separate config key"
    )


def test_acc_is_declared_with_three_channels_and_no_invented_unit():
    """The Polar straps declare mg because Polar publishes a scale. The vendor publishes none for this
    ring and no ring here has ever pushed this stream, so the unit must stay raw — a fabricated mg would
    be a number on a card that nothing measured."""
    cap = _read(CAP)
    m = re.search(r'BUS\.register\("acc_o2",\s*"[^"]+",\s*"([^"]+)",\s*0,\s*chans=(\d)', cap)
    assert m, "acc_o2 must be registered before it is pushed — the bus treats shape as declared"
    assert m.group(1) == "raw", f'unit must be raw, not {m.group(1)!r}'
    assert m.group(2) == "3", "three axes, like the H10's"


def test_an_unrequested_acc_push_is_logged_once_and_not_parsed():
    """A frame nobody asked for is a fact about the ring worth seeing. Parsing it anyway would make a
    stream nobody enabled into data nobody can explain."""
    cap = _read(CAP)
    assert "_acc_unexpected = [False]" in cap, "the warn-once latch must exist, or this logs every frame"
    assert re.search(r'elif not _acc_unexpected\[0\]:', cap), "unrequested frames take the warn path"
