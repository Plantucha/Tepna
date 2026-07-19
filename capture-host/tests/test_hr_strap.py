# tepna-capture — tests/test_hr_strap.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The standard Bluetooth Heart Rate Measurement characteristic (0x2A37). Vendor-neutral by design, so it
# serves any strap — a Coospo HRM808S was probed on hardware 2026-07-19 and speaks exactly this and
# nothing else: no PMD service, therefore NO raw ECG. HR + RR only.
#
# The contact bit is the valuable part. A chest strap off the body does NOT go quiet — it streams
# electrode noise at full rate while its own HR algorithm keeps emitting a plausible number. Measured on
# an H10 (which does not report contact): off-chest ECG ran 24x normal amplitude, p2p 31 mV vs 1.3 mV,
# while RR came out at 335-833 ms within three seconds — physiologically impossible, individually
# believable, and undetectable downstream. A strap that reports contact makes that state knowable.

import capture

# Real frames captured from a Coospo HRM808S, 2026-07-19.
COOSPO_WORN = bytes.fromhex("16394404")      # flags 0x16, hr 57, rr 1092/1024 s
COOSPO_2    = bytes.fromhex("163c0504")      # flags 0x16, hr 60


def test_a_real_coospo_frame_decodes():
    bpm, rr, contact = capture._parse_hr(COOSPO_WORN)
    assert bpm == 57
    assert len(rr) == 1 and 1050 <= rr[0] <= 1080, rr
    assert contact is True


def test_rr_is_converted_from_1024ths_of_a_second():
    """The SIG unit is 1/1024 s, not milliseconds. Treating it as ms would put RR ~2.4 % low and every
    derived HRV metric with it."""
    frame = bytes([0x10, 60]) + (1024).to_bytes(2, "little")   # exactly 1.000 s
    _bpm, rr, _c = capture._parse_hr(frame)
    assert rr == [1000]


def test_contact_supported_but_absent_reads_false():
    """flags bit2 set (supported), bit1 clear (not detected) — the strap is powered but off the body."""
    _bpm, _rr, contact = capture._parse_hr(bytes([0x04, 57]))
    assert contact is False


def test_contact_unsupported_reads_None_not_False():
    """The H10 does not report contact. None must NOT collapse to False, or every H10 night would look
    like it was recorded off-body; nor to True, which would fabricate a worn claim."""
    _bpm, _rr, contact = capture._parse_hr(bytes([0x00, 57]))
    assert contact is None


def test_a_16_bit_heart_rate_is_read_correctly():
    """flags bit0 set = uint16 HR. Reading it as uint8 gives 44 instead of 300."""
    bpm, _rr, _c = capture._parse_hr(bytes([0x01]) + (300).to_bytes(2, "little"))
    assert bpm == 300


def test_energy_expended_is_skipped_before_the_rr_list():
    """flags bit3 inserts 2 bytes BEFORE the RR array. Not skipping them turns energy into a fake RR."""
    frame = bytes([0x18, 60]) + (500).to_bytes(2, "little") + (1024).to_bytes(2, "little")
    _bpm, rr, _c = capture._parse_hr(frame)
    assert rr == [1000], f"energy-expended leaked into RR: {rr}"


def test_multiple_rr_intervals_in_one_frame():
    frame = bytes([0x10, 60]) + (1024).to_bytes(2, "little") + (512).to_bytes(2, "little")
    _bpm, rr, _c = capture._parse_hr(frame)
    assert rr == [1000, 500]


def test_a_truncated_trailing_byte_is_ignored_not_misread():
    """A frame ending mid-RR must drop the partial value rather than read one byte as an interval."""
    frame = bytes([0x10, 60]) + (1024).to_bytes(2, "little") + b"\x07"
    _bpm, rr, _c = capture._parse_hr(frame)
    assert rr == [1000]


def test_a_frame_with_no_rr_yields_an_empty_list():
    bpm, rr, _c = capture._parse_hr(bytes([0x06, 57]))
    assert bpm == 57 and rr == []


def test_an_hr_only_strap_never_touches_pmd():
    """A Coospo has no PMD service. streams=['hr'] must leave `writers` empty so the whole PMD
    negotiation block is skipped — otherwise the session tears down on a device that is working fine."""
    src = open(__file__.replace("tests/test_hr_strap.py", "capture.py"), encoding="utf-8").read()
    body = src.split("for s in streams:")[1][:400]
    assert "if s in meas_of:" in body, "only PMD streams may open a PMD writer"
    assert '"hr"' not in body.split("if \"hr\" in streams")[0], "hr must not be routed through meas_of"


def test_the_scan_foregrounds_a_strap_named_only_by_its_model():
    """A Coospo advertises as '808S 0022265' — no vendor word anywhere, so the model number has to carry
    the match or it sorts in with the neighbours' speakers."""
    import bonding
    assert bonding._HEALTH_HINT.search("808S 0022265")
    assert bonding._HEALTH_HINT.search("COOSPO HRM808S")
    assert not bonding._HEALTH_HINT.search("Laser Carver")
    assert not bonding._HEALTH_HINT.search("Hum_Electric_5CC455")


def test_the_monitor_can_identify_a_coospo():
    html = open(__file__.replace("tests/test_hr_strap.py", "monitor.html"), encoding="utf-8").read()
    assert "Coospo" in html and "HRM808S" in html
    # NOT a fixed-width slice: adding a comment inside the function silently slid the Coospo line out
    # of a [:1400] window and the assertion stopped covering anything.
    guess = html.split("function guessDevice")[1].split("\nfunction ")[0]
    assert "streams=['hr']" in guess.replace('"', "'"), \
        "an HR-only strap must request hr alone — asking for ecg opens a writer that can never start"


# ── Polar-specific rituals must not run on a non-Polar strap ────────────────────────────────────────
def test_bonding_is_gated_on_actually_needing_pmd():
    """The bond exists because the H10 refuses PMD on an unauthenticated link. The SIG Heart Rate
    characteristic has no such requirement, and most third-party straps cannot pair at all — so bonding
    one fails and reports 'bond failed' for a device that was about to work fine."""
    src = open(__file__.replace("tests/test_hr_strap.py", "capture.py"), encoding="utf-8").read()
    assert "if needs_pmd:" in src
    head = src.split("async def run_polar")[1][:2600]
    assert head.index("needs_pmd") < head.index("ensure_bonded"), "the gate must precede the bond"


def test_the_clock_sync_is_gated_on_the_device_being_polar():
    """PS-FTP is Polar-specific. On a Coospo it fails on a missing characteristic — and costs an
    18-second GLOBAL capture pause to discover that, on every task start."""
    src = open(__file__.replace("tests/test_hr_strap.py", "capture.py"), encoding="utf-8").read()
    assert 'if is_polar and (_CFG.get("time") or {}).get("auto_sync_devices", True):' in src


def test_pmd_stream_set_covers_every_pmd_stream_and_excludes_hr():
    import capture as c
    assert c._PMD_STREAMS == {"ecg", "acc", "ppg", "gyro", "mag", "ppi"}
    assert "hr" not in c._PMD_STREAMS, "hr is SIG-standard, not PMD — gating it would disable HR straps"


def test_an_hr_only_device_needs_neither_bond_nor_pmd():
    assert not ({"hr"} & set(__import__("capture")._PMD_STREAMS))


def test_a_polar_with_ecg_still_bonds():
    """The gate must not disable bonding for the device it was written for."""
    import capture as c
    assert set(["ecg", "acc", "hr"]) & c._PMD_STREAMS


def test_remember_defaults_ask_for_every_stream_the_sensor_can_give():
    """A stream omitted from the Remember default is never captured, SILENTLY — nothing errors, the
    sensor streams what it was asked for, and the gap surfaces only when an analysis comes up short.
    An H10 re-added after a factory reset came back 'ecg' only and lost its RR (the HRV substrate) and
    its chest ACC (which apnea typing needs) for a whole session."""
    html = open(__file__.replace("tests/test_hr_strap.py", "monitor.html"), encoding="utf-8").read()
    guess = html.split("function guessDevice")[1].split("function ")[0].replace('"', "'")
    h10 = [ln for ln in guess.splitlines() if "'H10'" in ln][0]
    for want in ("'ecg'", "'acc'", "'hr'"):
        assert want in h10, f"the H10 default must request {want}: {h10.strip()}"
    verity = [ln for ln in guess.splitlines() if "'VeritySense'" in ln][0]
    for want in ("'ppg'", "'acc'", "'gyro'", "'mag'"):
        assert want in verity, f"the Verity default must request {want}: {verity.strip()}"


def test_an_untrusted_stream_does_not_render_a_number_or_a_clean_trace():
    """A chest strap off the body streams electrode noise at full rate, and the device's own HR algorithm
    keeps emitting a plausible ~58 bpm. The pill said 'not worn' correctly, but the big value kept ticking
    and the graph kept drawing — a glance reads that as a real heartbeat. The value and the trace must
    both defer to streamState().trust, which is false for charging / not-worn / no-data."""
    html = open(__file__.replace("tests/test_hr_strap.py", "monitor.html"), encoding="utf-8").read()
    ss = html.split("function streamState")[1].split("\nfunction ")[0]
    # every non-live state that carries no valid reading is trust:false; weak/live are trust:true
    assert "worn === false" in ss and "trust:false" in ss
    for line_key in ("charging", "not worn", "no data"):
        row = [ln for ln in ss.splitlines() if f"'{line_key}'" in ln]
        assert row and "trust:false" in row[0], f"{line_key!r} must be trust:false: {row}"
    for line_key in ("weak", "live"):
        row = [ln for ln in ss.splitlines() if f"txt:'{line_key}'" in ln or f"txt: '{line_key}'" in ln]
        assert row and "trust:true" in row[0], f"{line_key!r} must be trust:true: {row}"
    # the value readout blanks on !trust
    vals = html.split("function ovValues")[1].split("\nfunction ")[0]
    assert "!state.trust" in vals and 'class="big muted"' in vals, "value must blank when untrusted"
    assert "st.rate = null" in vals, "the smoothed HR must reset so it can't resume mid-number"
    # the graph dims on !trust
    draw = html.split("function ovDrawMini")[1].split("\nfunction ")[0]
    assert "globalAlpha = trusted" in draw, "the trace must dim when the stream is untrusted"
