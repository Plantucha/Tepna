# tepna-capture — tests/test_radioclock.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The radio-clock collector's pure core. Every test here is one of two questions:
#
#   * Does a packet that is NOT what we are looking for get rejected, rather than decoded into a
#     plausible number? Most of this file is that question, because the failure mode of a binary
#     parser is not a crash — it is a well-formed value read from the wrong offset.
#   * Does an unmeasured quantity come back ABSENT? An anchor that cannot be attributed must be None
#     and render blank; the one thing this module must never do is pick between two candidates it
#     cannot tell apart.
#
# ⚠️ THE ANCHOR REPORT'S BYTES ARE CONSTRUCTED FROM A HEADER, NOT CAPTURED FROM THE AIR. The layout
# is `sdc_hci_vs.h`'s `SDC_HCI_SUBEVENT_VS_CONN_ANCHOR_POINT_UPDATE_REPORT` (subevent 0x82; u16
# conn_handle, u16 event_counter, u64 anchor_point_us; little-endian, packed) — the dongle was
# unflashed when this was written and no real report existed. This is a known-answer test against a
# SPECIFICATION, which is weaker than `test_polar_pmd.py`'s known-answer against a real frame.
# Replace `_anchor_event`'s bytes with the first real report the flashed dongle produces.

import struct

import radioclock as rc

H10 = "E4:22:F1:C2:23:2B"
VERITY = "A0:9E:1A:9C:3B:60"


def _addr_bytes(text):
    """Colon form → the six little-endian bytes an HCI event carries."""
    return bytes(int(b, 16) for b in reversed(text.split(":")))


def _le_conn_complete(handle, address, subevent=rc.LE_CONNECTION_COMPLETE, status=0x00):
    params = bytes([subevent, status]) + struct.pack("<H", handle) + b"\x00"
    params += b"\x00" + _addr_bytes(address) + b"\x18\x00\x00\x00\x2a\x00\x00"
    return bytes([rc.HCI_EVT_LE_META, len(params)]) + params


def _disconnect(handle):
    params = b"\x00" + struct.pack("<H", handle) + b"\x13"
    return bytes([rc.HCI_EVT_DISCONNECT_COMPLETE, len(params)]) + params


def _anchor_event(handle, counter, anchor_us, subevent=rc.VS_SUBEVENT_CONN_ANCHOR_POINT_UPDATE):
    """One anchor report. Parameter length is 0x0D = 13: subevent 1 + handle 2 + counter 2 + us 8,
    so the whole event is 15 bytes on the wire."""
    params = bytes([subevent]) + struct.pack("<HHQ", handle, counter, anchor_us)
    return bytes([rc.HCI_EVT_VENDOR, len(params)]) + params


def _pmd_acl(handle, meas, last_ns, n_samples=3, pb=0x02):
    """An ACL packet carrying a PMD notification, framed the way the controller delivers it."""
    frame = bytes([meas]) + struct.pack("<Q", last_ns) + b"\x00" + b"\x01\x02\x03" * n_samples
    att = bytes([rc.ATT_HANDLE_VALUE_NOTIFICATION]) + struct.pack("<H", 0x0025) + frame
    l2cap = struct.pack("<HH", len(att), rc.L2CAP_CID_ATT) + att
    return struct.pack("<HH", (pb << 12) | handle, len(l2cap)) + l2cap


# ─── the anchor report ────────────────────────────────────────────────────────────────────────────

def test_the_anchor_report_parses_at_the_layout_the_header_specifies():
    ev = _anchor_event(0x0021, 4242, 0x0000_00A1_B2C3_D4E5)
    assert ev[1] == 0x0D and len(ev) == 15, "13 parameter bytes, 15 on the wire"
    got = rc.parse_hci_event(ev)
    assert got == {"kind": "anchor", "handle": 0x21, "event_counter": 4242,
                   "anchor_us": 0x0000_00A1_B2C3_D4E5}


def test_a_vendor_event_that_is_not_the_anchor_subevent_is_not_an_anchor():
    """Vendor space is crowded and every other subevent has a different layout. Matching on the event
    code alone would decode an unrelated Nordic event into a confident microsecond value."""
    assert rc.parse_hci_event(_anchor_event(1, 2, 3, subevent=0x81)) is None
    assert rc.parse_anchor_report(b"") is None


def test_a_TRUNCATED_anchor_report_is_rejected_rather_than_read_short():
    """The socket hands us whatever arrived. A short buffer must not be unpacked from — that reads
    the next packet's bytes as this one's anchor, which is a large, precise, wrong number."""
    full = _anchor_event(0x0021, 7, 123456789)
    for cut in range(2, len(full)):
        assert rc.parse_hci_event(full[:cut]) is None, cut


def test_trailing_bytes_are_tolerated_so_a_later_firmware_field_does_not_break_the_parser():
    """Read by offset, not by exact length: an appended field is a compatible change, and pinning the
    length would make today's build the contract."""
    ev = _anchor_event(0x0021, 7, 999)
    grown = bytes([ev[0], ev[1] + 4]) + ev[2:] + b"\xde\xad\xbe\xef"
    assert rc.parse_hci_event(grown)["anchor_us"] == 999


def test_a_frame_whose_declared_length_exceeds_its_body_is_mis_framed_and_refused():
    ev = _anchor_event(0x0021, 7, 999)
    lying = bytes([ev[0], 0x40]) + ev[2:]
    assert rc.parse_hci_event(lying) is None


# ─── the handle ↔ address map ─────────────────────────────────────────────────────────────────────

def test_both_connection_complete_shapes_are_read_because_some_controllers_send_only_the_enhanced():
    for subevent in (rc.LE_CONNECTION_COMPLETE, rc.LE_ENHANCED_CONNECTION_COMPLETE):
        got = rc.parse_hci_event(_le_conn_complete(0x0040, H10, subevent=subevent))
        assert got == {"kind": "connect", "handle": 0x40, "address": H10}, subevent


def test_a_FAILED_connection_is_not_a_connection():
    """A failed attempt carries a handle field exactly like a successful one. Recording its address
    would put a peer on disk we never exchanged a byte with."""
    assert rc.parse_hci_event(_le_conn_complete(0x0040, H10, status=0x3E)) is None


def test_a_handle_is_dropped_on_disconnect_because_the_controller_REUSES_them():
    """The bug this prevents: handle 0x40 is the H10 tonight and the Verity twenty minutes later.
    Holding a stale entry writes one device's packets under the other's address."""
    m = rc.HandleMap()
    m.apply(rc.parse_hci_event(_le_conn_complete(0x0040, H10)))
    assert m.address(0x40) == H10 and len(m) == 1
    m.apply(rc.parse_hci_event(_disconnect(0x0040)))
    assert m.address(0x40) is None and len(m) == 0
    m.apply(rc.parse_hci_event(_le_conn_complete(0x0040, VERITY)))
    assert m.address(0x40) == VERITY


def test_an_unknown_handle_is_None_and_not_the_most_recent_device():
    """The collector may start mid-connection, so an unseen handle is a real state. None means the
    row is dropped; any fallback here invents an attribution."""
    m = rc.HandleMap()
    m.apply(rc.parse_hci_event(_le_conn_complete(0x0040, H10)))
    assert m.address(0x41) is None
    m.apply(None)                      # a stream event we did not recognise changes nothing
    m.apply({"kind": "anchor"})
    assert len(m) == 1


def test_an_unrelated_event_code_is_ignored_rather_than_misread():
    assert rc.parse_hci_event(b"\x0e\x04\x01\x03\x0c\x00") is None      # Command Complete
    assert rc.parse_hci_event(b"") is None
    assert rc.parse_hci_event(bytes([rc.HCI_EVT_LE_META, 0x01, 0x02])) is None   # LE Adv Report
    assert rc.parse_hci_event(bytes([rc.HCI_EVT_LE_META, 0x00])) is None
    assert rc.parse_hci_event(bytes([rc.HCI_EVT_DISCONNECT_COMPLETE, 0x01, 0x00])) is None
    short = _le_conn_complete(0x0040, H10)[:6]
    assert rc.parse_hci_event(bytes([short[0], 0x02]) + short[2:4]) is None


# ─── the join key ─────────────────────────────────────────────────────────────────────────────────

def test_the_join_key_is_the_LAST_sample_stamp_read_raw_from_the_packet():
    """🔴 The defect this collector was nearly built on. Bytes 1..9 are the LAST sample's ns — the
    `last_sensor_ns` column — and `first_sensor_ns` is a back-timed value that is not in the packet.
    Joining on the wrong one matches zero rows on every multi-sample frame, and an empty join looks
    exactly like a night with no correlated packets."""
    ns = 819_000_000_000_000
    got = rc.parse_acl_pmd(_pmd_acl(0x0040, 0x00, ns))
    assert got == (0x40, 0x00, ns)


def test_the_measurement_type_is_masked_because_bit_7_is_a_recording_flag():
    """`polar_pmd.py` masks with 0x3F for this reason; an unmasked compare fails to match a type the
    moment the offline-recording bit is set."""
    assert rc.parse_acl_pmd(_pmd_acl(0x0040, 0x80, 5))[1] == 0x00
    assert rc.parse_acl_pmd(_pmd_acl(0x0040, 0x82, 5))[1] == 0x02


def test_a_CONTINUATION_fragment_is_refused_because_it_carries_no_L2CAP_header():
    """A continuation's first bytes are payload. Treating one as a start reads a PMD header out of
    ECG samples and yields a plausible ns value — the precise shape of a silent wrong answer."""
    assert rc.parse_acl_pmd(_pmd_acl(0x0040, 0x00, 5, pb=0x01)) is None


def test_anything_that_is_not_an_ATT_notification_on_the_ATT_channel_is_refused():
    ns = 700_000_000_000
    good = _pmd_acl(0x0040, 0x00, ns)
    assert rc.parse_acl_pmd(good) is not None
    signalling = bytearray(good); signalling[6] = 0x05          # L2CAP CID → signalling channel
    assert rc.parse_acl_pmd(bytes(signalling)) is None
    write_req = bytearray(good); write_req[8] = 0x12            # ATT opcode → Write Request
    assert rc.parse_acl_pmd(bytes(write_req)) is None


def test_a_short_or_lying_ACL_packet_is_refused_at_every_length():
    full = _pmd_acl(0x0040, 0x00, 42)
    for cut in range(0, len(full)):
        assert rc.parse_acl_pmd(full[:cut]) is None, cut
    lying_l2cap = bytearray(full); lying_l2cap[4] = 0xF0
    assert rc.parse_acl_pmd(bytes(lying_l2cap)) is None
    tiny = struct.pack("<HH", 0x0040, 4) + struct.pack("<HH", 0, rc.L2CAP_CID_ATT)
    assert rc.parse_acl_pmd(tiny) is None
    hdr_only = struct.pack("<HH", 0x0040, 3) + b"\x1b\x25\x00"
    assert rc.parse_acl_pmd(hdr_only) is None


def test_a_WELL_FORMED_notification_too_short_to_be_a_PMD_frame_is_refused():
    """Not every notification on the link is PMD data. A battery level is one byte and the PMD
    CONTROL POINT answers on its own handle with a short reply — both arrive as perfectly valid ATT
    notifications. Unpacking eight bytes of `last_sensor_ns` out of one would read past the value into
    whatever the parser was handed, so the length is checked against the FRAME's shape, not the
    packet's."""
    for value in (b"\x63", b"\xf0\x01\x00\x00", b"\x00" + struct.pack("<Q", 5)):
        att = bytes([rc.ATT_HANDLE_VALUE_NOTIFICATION]) + struct.pack("<H", 0x0029) + value
        l2cap = struct.pack("<HH", len(att), rc.L2CAP_CID_ATT) + att
        packet = struct.pack("<HH", (0x02 << 12) | 0x0040, len(l2cap)) + l2cap
        assert rc.parse_acl_pmd(packet) is None, value.hex()


# ─── the offset and the association ───────────────────────────────────────────────────────────────

def test_the_offset_is_a_median_and_is_UNAVAILABLE_below_three_samples():
    """Under three points there is no offset — §🔒 §7's ≥3 rule applied to the association. The
    consequence is a blank anchor, never a zero one."""
    t = rc.OffsetTracker()
    assert t.offset is None and t.jitter is None and not t.ready and t.n == 0
    t.add(1_000_100.0, 1_000_000)
    t.add(2_000_120.0, 2_000_000)
    assert t.offset is None, "two points define a line through any jitter and cannot be checked"
    t.add(3_000_110.0, 3_000_000)
    assert t.ready and t.offset == 110.0


def test_the_median_ignores_a_single_wild_delivery_and_a_mean_would_not():
    """One 470 ms stall is the observed BLE delivery jitter. It must not move the offset — which is
    the whole reason this is a median and not a fit."""
    t = rc.OffsetTracker()
    for i in range(9):
        t.add(1_000_000 + i * 1000 + 100.0, 1_000_000 + i * 1000)
    t.add(1_009_000 + 470_000.0, 1_009_000)
    assert t.offset == 100.0
    assert sum(t._samples) / t.n > 40_000, "the mean IS dragged; this is what we avoided"


def test_the_window_holds_only_the_last_N_samples():
    t = rc.OffsetTracker(window=4)
    for offset in (10, 10, 10, 10, 90, 90, 90, 90):
        t.add(1000 + offset, 1000)
    assert t.n == 4 and t.offset == 90.0


def test_jitter_is_the_MEASURED_spread_of_the_window_not_a_constant():
    """And it is ROBUST, which is the point and also its most surprising behaviour: a MAD does not
    move for a minority of excursions. Two wild samples in seven leave it at zero, because the window
    still says the offset is steady. That is the honest reading — with a steady offset, two anchors
    separated by any non-zero interval ARE distinguishable — and it is why no floor is added here: a
    floor would be the tuned constant this estimator exists to avoid."""
    t = rc.OffsetTracker()
    for d in (100.0, 100.0, 100.0, 100.0, 100.0):
        t.add(1000 + d, 1000)
    assert t.jitter == 0.0, "a perfectly steady link has no ambiguity radius"
    for d in (60.0, 140.0):
        t.add(1000 + d, 1000)
    assert t.jitter == 0.0, "two excursions in seven do not move a MAD — that is what robust means"
    for d in (55.0, 145.0, 40.0):
        t.add(1000 + d, 1000)
    assert t.jitter > 0.0, "once the spread reaches the middle of the window it IS the measurement"


def test_an_ACL_packet_is_attributed_to_the_event_it_FOLLOWS():
    anchors = [(10, 1_000_000), (11, 1_050_000), (12, 1_100_000)]
    assert rc.associate(1_060_000 + 200.0, anchors, 200.0, 5.0) == (11, 1_050_000)
    assert rc.associate(1_100_000 + 200.0, anchors, 200.0, 5.0) == (12, 1_100_000)


def test_a_packet_BEFORE_every_anchor_is_unattributed_rather_than_assigned_the_first():
    anchors = [(10, 1_000_000), (11, 1_050_000)]
    assert rc.associate(900_000 + 200.0, anchors, 200.0, 5.0) == (None, None)


def test_TWO_indistinguishable_anchors_yield_a_BLANK_and_never_the_nearer_one():
    """🔴 The rule the sidecar's honesty rests on. When two anchors sit within the measured jitter of
    the target, the packet cannot be attributed to one connection event. Taking the nearer of two
    candidates we cannot tell apart manufactures a precise answer out of a measurement that does not
    contain one — invisibly, because the output looks identical either way."""
    anchors = [(10, 1_000_000), (11, 1_000_040)]
    assert rc.associate(1_000_020 + 200.0, anchors, 200.0, 60.0) == (None, None)
    # …the same geometry with a jitter small enough to separate them DOES attribute.
    assert rc.associate(1_000_020 + 200.0, anchors, 200.0, 5.0) == (10, 1_000_000)


def test_no_offset_no_anchors_and_no_jitter_each_yield_a_blank():
    anchors = [(10, 1_000_000)]
    assert rc.associate(1_000_200.0, anchors, None, 5.0) == (None, None)
    assert rc.associate(1_000_200.0, anchors, 200.0, None) == (None, None)
    assert rc.associate(1_000_200.0, [], 200.0, 5.0) == (None, None)


def test_the_whole_chain_end_to_end_on_a_synthetic_stream():
    """Three anchors and two ACL packets, exactly the §3 test: the expected event_counter per packet,
    and a blank on the ambiguous one."""
    m = rc.HandleMap()
    m.apply(rc.parse_hci_event(_le_conn_complete(0x0040, H10)))
    t = rc.OffsetTracker()
    anchors = []
    for counter, anchor_us in ((10, 1_000_000), (11, 1_050_000), (12, 1_100_000)):
        ev = rc.parse_hci_event(_anchor_event(0x0040, counter, anchor_us))
        anchors.append((ev["event_counter"], ev["anchor_us"]))
        t.add(anchor_us + 300.0, ev["anchor_us"])
    assert t.offset == 300.0 and t.jitter == 0.0

    handle, meas, ns = rc.parse_acl_pmd(_pmd_acl(0x0040, 0x00, 819_000_000_000_000))
    assert m.address(handle) == H10 and meas == 0x00
    assert rc.associate(1_051_000 + 300.0, anchors, t.offset, t.jitter) == (11, 1_050_000)

    t.add(1_100_000 + 340.0, 1_100_000)
    t.add(1_100_000 + 260.0, 1_100_000)
    close = [(20, 2_000_000), (21, 2_000_030)]
    assert rc.associate(2_000_020 + 300.0, close, t.offset, t.jitter or 40.0)[0] is None


# ─── the monitor channel and the row ──────────────────────────────────────────────────────────────

def test_a_monitor_datagram_splits_into_opcode_index_and_payload():
    body = _anchor_event(0x0040, 7, 900)
    dgram = struct.pack("<HHH", rc.MONITOR_OPCODE_EVENT, 1, len(body)) + body
    assert rc.parse_monitor_packet(dgram) == (rc.MONITOR_OPCODE_EVENT, 1, body)


def test_a_monitor_datagram_shorter_than_its_own_header_claims_is_refused():
    """Same rule as everywhere else in this file: a truncated frame is refused, not read short. The
    body would otherwise be whatever the socket buffer held next."""
    body = _anchor_event(0x0040, 7, 900)
    dgram = struct.pack("<HHH", rc.MONITOR_OPCODE_EVENT, 1, len(body) + 8) + body
    assert rc.parse_monitor_packet(dgram) is None
    assert rc.parse_monitor_packet(b"\x03\x00\x01") is None
    assert rc.parse_monitor_packet(b"") is None


class _FakeSocketModule:
    """Stands in for `socket`, so the two ways this platform can lack the capability are testable on a
    machine that HAS it — and on one that does not."""

    SOCK_RAW = 3

    def __init__(self, family=31, proto=1, fail=None):
        if family is not None:
            self.AF_BLUETOOTH = family
        if proto is not None:
            self.BTPROTO_HCI = proto
        self._fail = fail
        self.bound = None

    def socket(self, family, kind, proto):
        if self._fail:
            raise self._fail
        outer = self

        class _S:
            def bind(self, addr):
                outer.bound = addr

        return _S()


def test_a_python_without_AF_BLUETOOTH_is_UNAVAILABLE_and_not_a_crash():
    """🔴 The rig's own interpreter. `capture-host/.venv/bin/python` (3.13 standalone) has no
    Bluetooth address family, while vigil's (3.14.4) does — so this module must never touch
    `socket.AF_BLUETOOTH` at import time, or the test file becomes uncollectable on the machine it is
    written on. A missing family is one more way the capability is absent, handled like all the rest."""
    for mod in (_FakeSocketModule(family=None), _FakeSocketModule(proto=None)):
        try:
            rc.open_monitor_socket(socket_module=mod)
            raise AssertionError("should have refused")
        except rc.RadioClockUnavailable as exc:
            assert "AF_BLUETOOTH" in str(exc)


def test_a_refused_socket_is_UNAVAILABLE_rather_than_an_error_because_that_is_the_common_case():
    """No CAP_NET_RAW, no BlueZ, or a kernel without the monitor channel. The collector's answer to
    all three is the owner's §0.3: one line, exit 0, no file."""
    mod = _FakeSocketModule(fail=PermissionError(1, "Operation not permitted"))
    try:
        rc.open_monitor_socket(socket_module=mod)
        raise AssertionError("should have refused")
    except rc.RadioClockUnavailable as exc:
        assert "monitor channel" in str(exc)


def test_a_working_platform_binds_the_monitor_channel_for_every_adapter():
    mod = _FakeSocketModule()
    rc.open_monitor_socket(socket_module=mod)
    assert mod.bound == (rc.HCI_DEV_NONE, rc.HCI_CHANNEL_MONITOR)


def test_an_unmeasured_cell_is_BLANK_and_never_zero():
    """🔴 Zero is in-band for every numeric column here — a microsecond counter, an event counter and
    a nanosecond stamp can all legitimately read 0 — so a fabricated zero cannot be told from a
    measurement by any reader, ever. This is `writers._ns_col`'s argument applied to the sidecar."""
    row = rc.format_row("2026-09-07T03:14:15.926", H10, 0, 819_000_000_000_000, 0x40,
                        None, None, 1_700_000_000_000_000_000, None)
    assert row.rstrip("\n").split(";") == [
        "2026-09-07T03:14:15.926", H10, "0", "819000000000000", "64", "", "",
        "1700000000000000000", ""]
    assert len(row.rstrip("\n").split(";")) == len(rc.SIDECAR_HEADER.rstrip("\n").split(";"))
    assert ";0;" not in rc.format_row("t", H10, None, None, None, None, None, None, None)


def test_the_header_is_the_columns_the_brief_names_in_the_order_it_names_them():
    assert rc.SIDECAR_HEADER == ("Phone timestamp;device;meas;last_sensor_ns;conn_handle;"
                                 "event_counter;anchor_us;vs_rx_ns;acl_rx_ns\n")


# ─── the enable's outcome, as three distinguishable facts ─────────────────────────────────────────

def test_the_enable_reports_THREE_distinguishable_outcomes_not_one_failure():
    """🔴 "The controller cannot do this" and "we were not allowed to ask" have different fixes and
    reach the SAME safe exit — one line, exit 0, no file. Without distinct wording the first person to
    read the log on the flashed dongle cannot tell which happened, and the failure path being safe is
    precisely why it has to be legible."""
    assert rc.describe_enable(rc.HCI_STATUS_SUCCESS) == rc.ENABLE_ENABLED
    assert rc.describe_enable(rc.HCI_STATUS_UNKNOWN_COMMAND) == rc.ENABLE_NOT_THIS_IMAGE
    refused = rc.describe_enable(None, error=PermissionError(1, "Operation not permitted"))
    assert "send refused" in refused and "Operation not permitted" in refused
    three = {rc.describe_enable(rc.HCI_STATUS_SUCCESS),
             rc.describe_enable(rc.HCI_STATUS_UNKNOWN_COMMAND), refused}
    assert len(three) == 3, "the three outcomes must not collapse into one another"


def test_NO_REPLY_is_its_OWN_outcome_and_neither_a_success_nor_a_refusal():
    """🔴 Measured on vigil 2026-09-07: the Holyiot controller had been wedged since 20:31 and answered
    NO HCI command at all — both the version read and the enable left on the wire and returned silence.
    The send worked; the radio did not. Calling that "refused" sends the reader to check capabilities
    and permissions, which are fine, instead of to the controller, which is hung. Four facts, four
    strings, none collapsing into another."""
    assert rc.describe_enable(None) == rc.ENABLE_NO_REPLY
    assert rc.describe_enable(None) != rc.ENABLE_ENABLED
    assert "NO REPLY" in rc.describe_enable(None)
    assert "refused" not in rc.describe_enable(None), "silence is not a refused send"
    four = {rc.describe_enable(rc.HCI_STATUS_SUCCESS),
            rc.describe_enable(rc.HCI_STATUS_UNKNOWN_COMMAND),
            rc.describe_enable(None),
            rc.describe_enable(None, error=PermissionError(1, "nope"))}
    assert len(four) == 4
    assert "0x0C" in rc.describe_enable(0x0C), "an unexpected status names itself"


def test_a_command_reply_is_matched_to_ITS_OWN_opcode_in_both_shapes():
    """Command Complete and Command Status put `opcode` at different offsets. Reading one as the other
    returns a plausible status belonging to a different command."""
    op = rc.VS_OPCODE_CONN_ANCHOR_POINT_REPORT
    complete = bytes([rc.HCI_EVT_COMMAND_COMPLETE, 4, 1]) + struct.pack("<H", op) + b"\x00"
    assert rc.parse_command_complete(complete, op) == rc.HCI_STATUS_SUCCESS
    status = bytes([rc.HCI_EVT_COMMAND_STATUS, 4, 0x01, 1]) + struct.pack("<H", op)
    assert rc.parse_command_complete(status, op) == rc.HCI_STATUS_UNKNOWN_COMMAND
    other = bytes([rc.HCI_EVT_COMMAND_COMPLETE, 4, 1]) + struct.pack("<H", 0x0C03) + b"\x00"
    assert rc.parse_command_complete(other, op) is None, "another command's reply is not ours"
    other_status = bytes([rc.HCI_EVT_COMMAND_STATUS, 4, 0x00, 1]) + struct.pack("<H", 0x0C03)
    assert rc.parse_command_complete(other_status, op) is None
    for bad in (b"", b"\x0e", bytes([rc.HCI_EVT_COMMAND_COMPLETE, 9, 1]),
                bytes([rc.HCI_EVT_COMMAND_COMPLETE, 2, 1, 0]),
                bytes([rc.HCI_EVT_COMMAND_STATUS, 2, 1, 0]),
                bytes([rc.HCI_EVT_LE_META, 1, 2])):
        assert rc.parse_command_complete(bad, op) is None, bad.hex()


# ─── the collector: routing a whole monitor stream ───────────────────────────────────────────────

ADAPTER = 1


def _mon(opcode, payload, index=ADAPTER):
    return opcode, index, payload


def _collector(devices=(H10,)):
    return rc.Collector(ADAPTER, devices)


def test_a_row_is_emitted_ONLY_for_a_device_we_configured():
    """🔴 The monitor channel carries every connection the controller has, INCLUDING a neighbour's. An
    address we did not ask for must never reach the disk — this is a capture host in a bedroom, and
    recording the neighbour's watch is not a bug we get to fix after shipping."""
    c = _collector(devices=(H10,))
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0041, VERITY)), host_ns=2)
    for counter, us in ((10, 1_000_000), (11, 1_050_000), (12, 1_100_000)):
        c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _anchor_event(0x0040, counter, us)),
               host_ns=(us + 300) * 1000)

    ours = c.feed(*_mon(rc.MONITOR_OPCODE_ACL_RX, _pmd_acl(0x0040, 0x00, 819_000_000_000_000)),
                  host_ns=1_060_300_000)
    assert ours is not None and ours[0] == H10
    theirs = c.feed(*_mon(rc.MONITOR_OPCODE_ACL_RX, _pmd_acl(0x0041, 0x00, 5)), host_ns=1_060_300_000)
    assert theirs is None, "a configured-elsewhere device is not ours to record"
    assert c.rows == 1


def test_traffic_from_ANOTHER_ADAPTER_is_ignored():
    """The monitor channel is bound to HCI_DEV_NONE and carries every controller on the box — the
    Sena, the Holyiot, a phone tether. Only the one we were pointed at is ours."""
    c = _collector()
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10), index=ADAPTER + 1), host_ns=1)
    assert len(c.handles) == 0
    assert c.feed(*_mon(rc.MONITOR_OPCODE_ACL_RX, _pmd_acl(0x0040, 0x00, 5), index=ADAPTER + 1),
                  host_ns=2) is None


def test_an_UNKNOWN_handle_emits_nothing_rather_than_guessing_a_device():
    """The collector may start mid-connection. A packet whose handle we never saw connect cannot be
    attributed, and a row we cannot attribute is worse than no row."""
    c = _collector()
    assert c.feed(*_mon(rc.MONITOR_OPCODE_ACL_RX, _pmd_acl(0x0040, 0x00, 5)), host_ns=1) is None
    assert c.rows == 0


def test_a_DISCONNECT_drops_the_handle_AND_its_anchors():
    """Anchors belong to a connection, not to a number. The controller reuses handles, so keeping the
    old series would associate a new connection's packets with the previous one's events — the handle
    map's own trap, one level down."""
    c = _collector(devices=(H10, VERITY))
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    for counter, us in ((10, 1_000_000), (11, 1_050_000), (12, 1_100_000)):
        c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _anchor_event(0x0040, counter, us)),
               host_ns=(us + 300) * 1000)
    assert c._anchors[0x40]
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _disconnect(0x0040)), host_ns=9)
    assert 0x40 not in c._anchors

    # The same handle, now the Verity: its packet must not borrow the H10's anchors.
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, VERITY)), host_ns=10)
    row = c.feed(*_mon(rc.MONITOR_OPCODE_ACL_RX, _pmd_acl(0x0040, 0x01, 77)), host_ns=1_060_300_000)
    assert row[0] == VERITY
    assert row[4] is None and row[5] is None, "no anchors for this connection yet — blank, not the H10's"


def test_MISSED_anchors_are_COUNTED_and_never_interpolated():
    """The report is DISCARDABLE by design — the controller drops it under host-buffer pressure and
    overwrites it if the host does not read in time — so gaps in `event_counter` are expected, not
    corruption. They are telemetry. Inventing the missing anchors would be fabricating the very
    measurement this sidecar exists to provide."""
    c = _collector()
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    for counter in (10, 11, 15, 16):
        c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _anchor_event(0x0040, counter, counter * 1000)),
               host_ns=counter * 1_000_000)
    assert c.missed_anchors == 3, "12, 13 and 14 never arrived"
    assert len(c._anchors[0x40]) == 4, "and were not invented to fill the series"


def test_the_event_counter_WRAPS_at_0xFFFF_and_that_is_one_step_not_65535_misses():
    c = _collector()
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    for counter in (0xFFFE, 0xFFFF, 0x0000, 0x0001):
        c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _anchor_event(0x0040, counter, counter + 1)), host_ns=1)
    assert c.missed_anchors == 0


def test_the_anchor_series_is_BOUNDED_because_a_night_is_millions_of_events():
    c = _collector()
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    for counter in range(rc.ANCHOR_WINDOW + 50):
        c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _anchor_event(0x0040, counter, counter * 1000)),
               host_ns=counter * 1_000_000)
    assert len(c._anchors[0x40]) == rc.ANCHOR_WINDOW


def test_an_unrecognised_opcode_and_an_unparsable_event_change_nothing():
    c = _collector()
    assert c.feed(0x63, ADAPTER, b"\x00\x01\x02", host_ns=1) is None
    assert c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, b"\x0e\x04\x01\x03\x0c\x00"), host_ns=1) is None
    assert c.feed(*_mon(rc.MONITOR_OPCODE_ACL_TX, _pmd_acl(0x0040, 0x00, 5)), host_ns=1) is None
    assert len(c.handles) == 0 and c.rows == 0


def test_the_row_carries_the_association_and_blanks_what_was_not_measured():
    c = _collector()
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    for counter, us in ((10, 1_000_000), (11, 1_050_000), (12, 1_100_000)):
        c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _anchor_event(0x0040, counter, us)),
               host_ns=(us + 300) * 1000)
    address, meas, ns, handle, counter, anchor_us, vs_rx, acl_rx = c.feed(
        *_mon(rc.MONITOR_OPCODE_ACL_RX, _pmd_acl(0x0040, 0x00, 819_000_000_000_000)),
        host_ns=1_051_300_000)
    assert (address, meas, ns, handle) == (H10, 0x00, 819_000_000_000_000, 0x40)
    assert (counter, anchor_us) == (11, 1_050_000)
    assert acl_rx == 1_051_300_000
    row = rc.format_row("2026-09-07T03:00:00.000", address, meas, ns, handle, counter, anchor_us,
                        vs_rx, acl_rx)
    assert row.count(";") == 8 and ";;" in row, "the unmeasured vs_rx cell is blank, not zero"


def test_NON_PMD_traffic_on_our_own_link_emits_nothing():
    """Most of what crosses a live link is not PMD data: the control-point writes that start a stream,
    battery notifications, the CCCD enables. They arrive on the SAME handle, from a device we DID
    configure, so nothing upstream filters them — and a row for one would carry a `last_sensor_ns`
    read out of bytes that are not a timestamp."""
    c = _collector()
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    battery = bytes([rc.ATT_HANDLE_VALUE_NOTIFICATION]) + struct.pack("<H", 0x002B) + b"\x63"
    l2cap = struct.pack("<HH", len(battery), rc.L2CAP_CID_ATT) + battery
    packet = struct.pack("<HH", (0x02 << 12) | 0x0040, len(l2cap)) + l2cap
    assert c.feed(*_mon(rc.MONITOR_OPCODE_ACL_RX, packet), host_ns=5) is None
    assert c.feed(*_mon(rc.MONITOR_OPCODE_ACL_RX, b"\x40\x20\x02\x00\xff\xff"), host_ns=6) is None
    assert c.rows == 0, "a link we DO record still only yields rows for PMD frames"


# ─── the sidecar file ─────────────────────────────────────────────────────────────────────────────

def test_the_sidecar_is_named_by_ADDRESS_because_that_is_the_identity(tmp_path):
    """BLE identity is address-only — a local name is advertising data any device may claim, and this
    repo has a standing ruling on it. The colons go so the name is portable."""
    assert rc.sidecar_name("20260907T030000", "e4:22:f1:c2:23:2b") == \
        "20260907T030000_E4-22-F1-C2-23-2B_RADIOCLOCK.csv"


def test_a_new_file_gets_the_header_and_a_resumed_one_does_not(tmp_path):
    p = str(tmp_path / "s.csv")
    w = rc.SidecarWriter(p); w.write(rc.format_row("t", H10, 0, 5, 64, 11, 1_050_000, None, 7)); w.close()
    again = rc.SidecarWriter(p); again.write(rc.format_row("u", H10, 0, 6, 64, 12, 1_100_000, None, 8))
    again.close()
    lines = open(p, encoding="utf-8").read().splitlines()
    assert lines[0] == rc.SIDECAR_HEADER.rstrip("\n")
    assert len(lines) == 3, "a resumed capture appends and does NOT repeat the header"


def test_a_TORN_TAIL_from_a_power_cut_is_truncated_and_not_left_to_corrupt_the_next_row(tmp_path):
    """The capture host loses power mid-write. The half-line must go, or the row appended after it is
    silently glued onto the fragment and parses as neither."""
    p = tmp_path / "s.csv"
    p.write_text(rc.SIDECAR_HEADER + "t;%s;0;5;64;11;1050000;;7\nu;%s;0;6;64" % (H10, H10),
                 encoding="utf-8")
    w = rc.SidecarWriter(str(p)); w.write(rc.format_row("v", H10, 0, 7, 64, 13, 1_150_000, None, 9))
    w.close()
    lines = p.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 3
    assert lines[1].startswith("t;") and lines[2].startswith("v;")
    assert all(line.count(";") == 8 for line in lines[1:]), "every surviving row is whole"


def test_an_EMPTY_file_is_rewritten_with_a_header_rather_than_appended_to(tmp_path):
    p = tmp_path / "s.csv"; p.write_text("", encoding="utf-8")
    w = rc.SidecarWriter(str(p)); w.close()
    assert p.read_text(encoding="utf-8") == rc.SIDECAR_HEADER


def test_a_file_torn_before_its_FIRST_newline_is_truncated_to_nothing_and_re_headered(tmp_path):
    p = tmp_path / "s.csv"; p.write_text("Phone timestamp;device;me", encoding="utf-8")
    w = rc.SidecarWriter(str(p)); w.close()
    assert p.read_text(encoding="utf-8") == rc.SIDECAR_HEADER


def test_flush_and_close_never_raise_on_a_closed_handle(tmp_path):
    """Telemetry must never take the capture down with it — and this runs as its own unit precisely so
    it cannot, but the writer keeps the same discipline."""
    w = rc.SidecarWriter(str(tmp_path / "s.csv"))
    w.close()
    w.flush(); w.close()


def test_a_close_that_FAILS_is_swallowed_because_the_night_is_already_written(tmp_path):
    """The real case is ENOSPC on the final flush-to-disk, not a double close (which Python makes a
    no-op). By the time close() runs the rows are already out; raising here would turn a full disk into
    a traceback from a telemetry sidecar, which is precisely the blast radius this file must not have."""
    class _Failing:
        closed = False
        def flush(self): raise OSError(28, "No space left on device")
        def close(self): raise OSError(28, "No space left on device")
        def write(self, _): pass

    w = rc.SidecarWriter(str(tmp_path / "s.csv"))
    w._fh = _Failing()
    w.close()               # must not raise


# ─── the run loop ─────────────────────────────────────────────────────────────────────────────────

def _stream(anchors=((10, 1_000_000), (11, 1_050_000), (12, 1_100_000)), acls=((1_051_300_000,),)):
    """A synthetic monitor stream: one connect, some anchors, then some ACL packets."""
    out = [(rc.MONITOR_OPCODE_EVENT, ADAPTER, _le_conn_complete(0x0040, H10), 1)]
    for counter, us in anchors:
        out.append((rc.MONITOR_OPCODE_EVENT, ADAPTER, _anchor_event(0x0040, counter, us),
                    (us + 300) * 1000))
    for i, (host_ns,) in enumerate(acls):
        out.append((rc.MONITOR_OPCODE_ACL_RX, ADAPTER,
                    _pmd_acl(0x0040, 0x00, 819_000_000_000_000 + i), host_ns))
    return out


def test_run_writes_one_file_per_device_and_reports_its_telemetry(tmp_path):
    made = {}

    def open_writer(address):
        made[address] = rc.SidecarWriter(str(tmp_path / rc.sidecar_name("20260907T030000", address)))
        return made[address]

    got = rc.run(_stream(acls=((1_051_300_000,), (1_101_300_000,))), _collector(), open_writer)
    assert got["rows"] == 2 and got["devices"] == [H10]
    assert got["missed_anchors"] == 0 and got["offset_samples"] == 3
    body = (tmp_path / rc.sidecar_name("20260907T030000", H10)).read_text(encoding="utf-8")
    lines = body.splitlines()
    assert lines[0] == rc.SIDECAR_HEADER.rstrip("\n")
    assert len(lines) == 3
    assert all(line.count(";") == 8 for line in lines[1:])
    assert lines[1].split(";")[1] == H10


def test_a_device_that_sends_NO_PMD_FRAME_never_causes_a_file_to_exist(tmp_path):
    """🔴 §0.3 applied per device rather than only per box: absence is the absence of a FILE. An empty
    sidecar with a header would read as "we watched this device and it fell silent", which is a
    measurement — and a different, worse statement than "we have nothing on it"."""
    calls = []

    def open_writer(address):
        calls.append(address)
        raise AssertionError("must not be called")

    got = rc.run(_stream(acls=()), _collector(), open_writer)
    assert got["rows"] == 0 and got["devices"] == [] and calls == []
    assert list(tmp_path.iterdir()) == []


def test_the_writers_are_CLOSED_even_when_the_stream_raises(tmp_path):
    """A capture ends by being killed, so the finally is the normal path, not the exceptional one.
    Rows buffered and never flushed would lose the tail of every night."""
    opened = []

    def open_writer(address):
        w = rc.SidecarWriter(str(tmp_path / rc.sidecar_name("s", address)))
        opened.append(w)
        return w

    def exploding():
        yield from _stream()
        raise KeyboardInterrupt

    try:
        rc.run(exploding(), _collector(), open_writer)
    except KeyboardInterrupt:  # deliberate: the interrupt IS the subject — it must reach the caller
        pass                   # while `run`'s finally still closes the writers
    assert len(opened) == 1
    body = (tmp_path / rc.sidecar_name("s", H10)).read_text(encoding="utf-8")
    assert len(body.splitlines()) == 2, "the row written before the interrupt survived"


def test_run_flushes_periodically_so_a_kill_9_does_not_lose_the_whole_night(tmp_path):
    flushes = []

    class _Counting(rc.SidecarWriter):
        def flush(self):
            flushes.append(self.rows)
            super().flush()

    def open_writer(address):
        return _Counting(str(tmp_path / rc.sidecar_name("s", address)))

    acls = tuple((1_051_300_000 + i,) for i in range(5))
    rc.run(_stream(acls=acls), _collector(), open_writer, flush_every=2)
    assert flushes[:2] == [2, 4], "flushed on the interval, not only at the end"


def test_the_missed_anchor_count_reaches_the_caller_as_TELEMETRY(tmp_path):
    def open_writer(address):
        return rc.SidecarWriter(str(tmp_path / rc.sidecar_name("s", address)))

    got = rc.run(_stream(anchors=((10, 1_000_000), (11, 1_050_000), (15, 1_100_000))),
                 _collector(), open_writer)
    assert got["missed_anchors"] == 3, "12, 13, 14 — reported, never interpolated"


def test_phone_ts_matches_the_writer_the_rest_of_the_corpus_uses():
    """One formatter, not two: the column exists so a reader who only knows *_PMDARRIVAL.csv can read
    this file, and a second implementation would eventually disagree on a boundary."""
    import datetime as _dt

    import writers
    ns = 1_757_300_000_123_000_000
    assert rc.phone_ts(ns) == writers._phone_ts(_dt.datetime.fromtimestamp(ns / 1e9))


# ─── feature detection: every way this box cannot, named ─────────────────────────────────────────

def _sysfs(tmp_path, mapping):
    root = tmp_path / "bt"; root.mkdir(exist_ok=True)
    for name, addr in mapping.items():
        d = root / name; d.mkdir(exist_ok=True)
        (d / "address").write_text(addr + "\n", encoding="utf-8")
    return str(root)


CFG = {"adapter": "28:0C:50:0C:18:FD", "radio_clock": {"enabled": True},
       "devices": [{"address": H10, "name": "Polar H10"}]}


def test_the_adapter_is_resolved_by_ADDRESS_not_by_hciN(tmp_path):
    """🔴 The standing ruling: BLE identity is address-only. `hciN` is an enumeration order that
    changes when a dongle is re-plugged, so pinning by index is how a box records the wrong radio."""
    sysfs = _sysfs(tmp_path, {"hci0": "AA:BB:CC:DD:EE:FF", "hci1": "28:0C:50:0C:18:FD"})
    assert rc.adapter_index("28:0c:50:0c:18:fd", sysfs) == 1
    assert rc.adapter_index("AA:BB:CC:DD:EE:FF", sysfs) == 0
    assert rc.adapter_index("00:00:00:00:00:00", sysfs) is None
    assert rc.adapter_index("", sysfs) is None and rc.adapter_index(None, sysfs) is None
    assert rc.adapter_index(H10, str(tmp_path / "no-such-dir")) is None


def test_a_malformed_sysfs_entry_is_skipped_rather_than_raising(tmp_path):
    root = tmp_path / "bt"; root.mkdir()
    # `/sys/class/bluetooth` is not only controllers — a BNEP or a rfcomm node sits there too, and it
    # sorts before hci*, so it is the FIRST thing the scan sees on a real box.
    (root / "bnep0").mkdir()
    (root / "hcinotanumber").mkdir()
    (root / "hcinotanumber" / "address").write_text(H10 + "\n", encoding="utf-8")
    (root / "not-an-adapter").mkdir()
    (root / "hci9").mkdir()                       # no address file at all
    assert rc.adapter_index(H10, str(root)) is None


def test_DISABLED_by_default_is_the_first_thing_checked(tmp_path):
    """Default OFF, opt-in by config — §0.2. A box that never asked for this must not have its
    controller probed, so the flag is read before anything touches a radio."""
    sysfs = _sysfs(tmp_path, {"hci1": "28:0C:50:0C:18:FD"})
    def _never(_index):
        raise AssertionError("must not probe a box that did not opt in")
    index, devices, why = rc.decide({"radio_clock": {"enabled": False}}, sysfs, probe=_never)
    assert index is None and devices == [] and "enabled is false" in why
    assert rc.decide({}, sysfs, probe=_never)[2] is not None


def test_every_way_this_box_CANNOT_is_named_and_none_reads_like_another(tmp_path):
    """🔴 They all reach the same outcome — one line, exit 0, no file — so without distinct wording the
    reader cannot tell "this dongle is unplugged" from "this controller is not Nordic" from "the
    firmware does not have the command". Each has a different fix."""
    sysfs = _sysfs(tmp_path, {"hci1": "28:0C:50:0C:18:FD"})
    whys = set()

    _, _, why = rc.decide(dict(CFG, adapter="99:99:99:99:99:99"), sysfs,
                          probe=lambda i: (rc.NORDIC_COMPANY_ID, 0, None))
    assert "is present" in why; whys.add(why)

    _, _, why = rc.decide(dict(CFG, devices=[]), sysfs, probe=lambda i: (rc.NORDIC_COMPANY_ID, 0, None))
    assert "no devices" in why; whys.add(why)

    _, _, why = rc.decide(CFG, sysfs, probe=lambda i: (10, 0, None))
    assert "not Nordic" in why and "common case, not an error" in why; whys.add(why)

    _, _, why = rc.decide(CFG, sysfs,
                          probe=lambda i: (rc.NORDIC_COMPANY_ID, rc.HCI_STATUS_UNKNOWN_COMMAND, None))
    assert "not this image" in why; whys.add(why)

    _, _, why = rc.decide(CFG, sysfs, probe=lambda i: (rc.NORDIC_COMPANY_ID, None, None))
    assert "NO REPLY" in why, "a wedged controller is its own fact"; whys.add(why)

    def _refuse(_i):
        raise rc.RadioClockUnavailable("cannot open the HCI monitor channel: EPERM")
    _, _, why = rc.decide(CFG, sysfs, probe=_refuse)
    assert "unavailable" in why; whys.add(why)

    assert len(whys) == 6, "six distinct ways to be unable, six distinct lines"


def test_a_CAPABLE_box_returns_the_index_and_the_configured_devices(tmp_path):
    sysfs = _sysfs(tmp_path, {"hci0": "AA:BB:CC:DD:EE:FF", "hci1": "28:0C:50:0C:18:FD"})
    index, devices, why = rc.decide(CFG, sysfs, probe=lambda i: (rc.NORDIC_COMPANY_ID, 0, None))
    assert (index, devices, why) == (1, [H10], None)


def test_radio_clock_adapter_OVERRIDES_the_capture_adapter(tmp_path):
    """The radio clock may live on a different dongle from the one the daemon bonds through — the
    Holyiot is a timing part, the Sena is the permanent fixture. `radio_clock.adapter` wins."""
    sysfs = _sysfs(tmp_path, {"hci0": "AA:BB:CC:DD:EE:FF", "hci1": "28:0C:50:0C:18:FD"})
    cfg = dict(CFG, radio_clock={"enabled": True, "adapter": "AA:BB:CC:DD:EE:FF"})
    assert rc.decide(cfg, sysfs, probe=lambda i: (rc.NORDIC_COMPANY_ID, 0, None))[0] == 0


# ─── main: exit 0 and write nothing, however this box cannot ─────────────────────────────────────

def _cfg_file(tmp_path, mapping):
    import json
    p = tmp_path / "config.yaml"
    p.write_text(json.dumps(mapping), encoding="utf-8")   # JSON is valid YAML
    return str(p)


def test_main_exits_0_and_writes_NOTHING_on_every_way_this_box_cannot(tmp_path, caplog):
    """🔴 A non-Nordic controller is the COMMON case, not a fault. A unit that went `failed` for it
    would put a permanent red in `systemctl --failed` on most boxes, for a capability they never had —
    and the operator would learn to ignore the one place a real fault shows up."""
    sysfs = _sysfs(tmp_path, {"hci1": "28:0C:50:0C:18:FD"})
    cfg = _cfg_file(tmp_path, dict(CFG, root=str(tmp_path / "srv")))
    with caplog.at_level("INFO"):
        assert rc.main(["--config", cfg], sysfs, probe=lambda i: (10, 0, None)) == 0
    assert "not Nordic" in caplog.text
    assert not (tmp_path / "srv").exists(), "absence is the absence of a FILE"


def test_main_survives_an_unreadable_or_malformed_config(tmp_path, caplog):
    """The collector must never be the reason a box fails to boot its other units."""
    sysfs = _sysfs(tmp_path, {"hci1": "28:0C:50:0C:18:FD"})
    with caplog.at_level("INFO"):
        assert rc.main(["--config", str(tmp_path / "nope.yaml")], sysfs) == 0
        assert "cannot read" in caplog.text
        empty = tmp_path / "empty.yaml"; empty.write_text("", encoding="utf-8")
        caplog.clear()
        assert rc.main(["--config", str(empty)], sysfs) == 0
        assert "not a YAML mapping" in caplog.text


def test_main_runs_the_collector_and_reports_its_telemetry(tmp_path, caplog):
    sysfs = _sysfs(tmp_path, {"hci1": "28:0C:50:0C:18:FD"})
    root = tmp_path / "srv"
    cfg = _cfg_file(tmp_path, dict(CFG, root=str(root)))
    stream = _stream(anchors=((10, 1_000_000), (11, 1_050_000), (15, 1_100_000)),
                     acls=((1_051_300_000,),))
    with caplog.at_level("INFO"):
        assert rc.main(["--config", cfg], sysfs, probe=lambda i: (rc.NORDIC_COMPANY_ID, 0, None),
                       packets=stream) == 0
    assert "1 row(s)" in caplog.text and H10 in caplog.text
    assert "3 anchor(s) missed" in caplog.text, "reported as telemetry, never interpolated"
    written = list((root / "captures").rglob("*_RADIOCLOCK.csv"))
    assert len(written) == 1, "one sidecar, beside the night"
    body = written[0].read_text(encoding="utf-8").splitlines()
    assert body[0] == rc.SIDECAR_HEADER.rstrip("\n") and len(body) == 2


def test_main_with_a_capable_box_but_NO_TRAFFIC_still_writes_no_file(tmp_path, caplog):
    """A capable controller that saw nothing of ours is not the same as a night we recorded. No rows,
    no file — the per-device form of the same rule."""
    sysfs = _sysfs(tmp_path, {"hci1": "28:0C:50:0C:18:FD"})
    root = tmp_path / "srv"
    cfg = _cfg_file(tmp_path, dict(CFG, root=str(root)))
    with caplog.at_level("INFO"):
        assert rc.main(["--config", cfg], sysfs, probe=lambda i: (rc.NORDIC_COMPANY_ID, 0, None),
                       packets=[]) == 0
    assert "0 row(s)" in caplog.text and "no device" in caplog.text
    assert not root.exists()


def test_an_HCI_command_packet_is_built_the_way_a_raw_socket_wants_it():
    """Type byte, opcode little-endian, parameter LENGTH, then the parameters. Pinned as a
    known-answer because the send path itself cannot be tested off the box, and a wrong length byte
    here is a command the controller silently ignores — which presents as the NO REPLY outcome and
    sends the reader looking at the radio instead of at this line."""
    assert rc._command(rc.HCI_OPCODE_READ_LOCAL_VERSION) == b"\x01\x01\x10\x00"
    assert rc._command(rc.VS_OPCODE_CONN_ANCHOR_POINT_REPORT, b"\x01") == b"\x01\x1f\xfd\x01\x01"
    assert rc._command(0x0C03) == b"\x01\x03\x0c\x00", "HCI Reset, as a second witness on byte order"


def test_the_HCI_FILTER_struct_is_SIXTEEN_bytes_because_the_kernel_says_so():
    """⚠️ `struct hci_filter` is 14 bytes of fields padded to 16, and the box kernel returns EINVAL for
    a 14-byte setsockopt — measured on vigil 2026-09-07. Pinned because the failure is an errno from a
    socket call that reads like a permissions problem and is not."""
    assert len(rc._HCI_FILTER_EVENTS) == 16
    import struct as _s
    type_mask, ev_lo, ev_hi, opcode = _s.unpack("<IIIH2x", rc._HCI_FILTER_EVENTS)
    assert type_mask == 1 << rc.HCI_EVENT_PKT, "events only — we send commands, we read events"
    assert (ev_lo, ev_hi, opcode) == (0xFFFFFFFF, 0xFFFFFFFF, 0)


# ── the gaps the mutation audit found ────────────────────────────────────────────────────────────

def test_a_DISCONNECT_for_a_handle_we_never_saw_CONNECT_is_survivable():
    """🔴 Not hypothetical — it is the normal case on startup. The collector attaches to a monitor
    stream that is already running, so the first thing it may ever see for a live link is that link
    ENDING. Every drop here is a `.pop(key, None)`; without the default each of the three would raise
    KeyError and take the collector down on a packet that means "nothing to do"."""
    c = _collector()
    for _ in range(2):                       # twice: the second proves the first left no residue
        c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _disconnect(0x0055)), host_ns=1)
    assert len(c.handles) == 0 and c.rows == 0
    m = rc.HandleMap()
    m.apply(rc.parse_hci_event(_disconnect(0x0077)))
    assert m.address(0x77) is None
    # …and a disconnect for an unknown handle must not disturb a DIFFERENT live one.
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=2)
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _disconnect(0x0099)), host_ns=3)
    assert c.handles.address(0x40) == H10


def test_the_row_and_writer_counters_COUNT_rather_than_latch():
    """`+= 1` mutated to `= 1` is invisible until something produces a second row — and every count in
    this module is reported as telemetry, so a latched 1 would understate a whole night."""
    c = _collector()
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    for i in range(3):
        c.feed(*_mon(rc.MONITOR_OPCODE_ACL_RX, _pmd_acl(0x0040, 0x00, 100 + i)), host_ns=10 + i)
    assert c.rows == 3


def test_the_writer_counts_every_row_it_writes(tmp_path):
    w = rc.SidecarWriter(str(tmp_path / "s.csv"))
    for i in range(4):
        w.write(rc.format_row("t", H10, 0, i, 64, 1, 2, 3, 4))
    assert w.rows == 4
    w.close()


def test_every_column_lands_in_its_OWN_position_when_all_are_present():
    """The earlier row test carried several `None`s, so a cell replaced by `None` was indistinguishable
    from the real thing. With every field populated and distinct, a swapped or dropped column shows."""
    row = rc.format_row("2026-09-08T03:00:00.000", H10, 7, 819_000_000_000_000, 0x40, 4242,
                        1_050_000, 111, 222).rstrip("\n").split(";")
    assert row == ["2026-09-08T03:00:00.000", H10, "7", "819000000000000", "64", "4242",
                   "1050000", "111", "222"]
    header = rc.SIDECAR_HEADER.rstrip("\n").split(";")
    assert len(row) == len(header)
    assert header[5] == "event_counter" and row[5] == "4242"
    assert header[6] == "anchor_us" and row[6] == "1050000"


def test_the_monitor_socket_is_opened_with_the_BLUETOOTH_family_and_HCI_protocol():
    """A socket opened with the wrong family or protocol still constructs under a stub and then reads
    nothing on the box. The arguments are the contract, so they are asserted rather than assumed."""
    seen = {}

    class _Recording(_FakeSocketModule):
        def socket(self, family, kind, proto):
            seen.update(family=family, kind=kind, proto=proto)
            return super().socket(family, kind, proto)

    mod = _Recording()
    rc.open_monitor_socket(socket_module=mod)
    assert seen == {"family": mod.AF_BLUETOOTH, "kind": mod.SOCK_RAW, "proto": mod.BTPROTO_HCI}


def test_the_offset_window_drops_the_OLDEST_sample_not_the_second_oldest():
    """Trimming the wrong end keeps the oldest sample forever, so the window stops being a window and
    the median never forgets the start of the night."""
    t = rc.OffsetTracker(window=3)
    for d in (10.0, 20.0, 30.0, 40.0, 50.0):
        t.add(1000 + d, 1000)
    assert t.n == 3
    assert t.offset == 40.0, "the surviving window is the LAST three (30, 40, 50)"


def test_the_anchor_series_drops_the_OLDEST_anchor_not_the_second():
    c = _collector()
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    for counter in range(rc.ANCHOR_WINDOW + 3):
        c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _anchor_event(0x0040, counter, 1000 + counter)),
               host_ns=(1000 + counter) * 1000)
    kept = c._anchors[0x40]
    assert len(kept) == rc.ANCHOR_WINDOW
    assert kept[0][0] == 3, "the first three anchors were dropped, oldest first"
    assert kept[-1][0] == rc.ANCHOR_WINDOW + 2


def test_the_median_of_an_EVEN_sample_averages_the_two_MIDDLE_values():
    """An even-length window takes the mean of the pair either side of centre. Reaching for the wrong
    pair is invisible on a symmetric sample, so the values here are deliberately asymmetric."""
    assert rc._median([1.0, 2.0, 10.0, 100.0]) == 6.0
    assert rc._median([1.0, 2.0, 3.0]) == 2.0
    assert rc._median([5.0]) == 5.0
    assert rc._median([1.0, 2.0]) == 1.5


def test_the_nearest_anchor_is_chosen_by_TIME_even_after_the_counter_WRAPS():
    """🔴 The reason `max(...)` carries an explicit `key`. Without it, tuples compare `event_counter`
    FIRST — which tracks time only while the counter is monotonic. It is a u16 that wraps at 0xFFFF,
    and at a 50 ms connection interval that is roughly once an hour, several times a night. Across a
    wrap the highest counter is the OLDEST anchor, so a keyless `max` would attribute every packet
    after a wrap to an event from before it, silently and with a plausible-looking result."""
    wrapped = [(0xFFFE, 1_000_000), (0xFFFF, 1_050_000), (0x0000, 1_100_000), (0x0001, 1_150_000)]
    assert rc.associate(1_160_000 + 200.0, wrapped, 200.0, 5.0) == (0x0001, 1_150_000)
    assert rc.associate(1_110_000 + 200.0, wrapped, 200.0, 5.0) == (0x0000, 1_100_000)
    # Keyed on the counter instead, both of these would answer (0xFFFF, 1_050_000).


def test_a_configured_device_with_NO_address_is_dropped_not_carried_as_None(tmp_path):
    """BLE identity is the address. A device entry without one cannot be matched against anything, and
    carrying it through as `None` would put a null in the set every ACL packet is checked against."""
    sysfs = _sysfs(tmp_path, {"hci1": "28:0C:50:0C:18:FD"})
    cfg = dict(CFG, devices=[{"name": "no address here"}, {"address": H10}, {"address": ""}])
    index, devices, why = rc.decide(cfg, sysfs, probe=lambda i: (rc.NORDIC_COMPANY_ID, 0, None))
    assert devices == [H10] and why is None
    only_nameless = dict(CFG, devices=[{"name": "x"}])
    assert rc.decide(only_nameless, sysfs, probe=lambda i: (rc.NORDIC_COMPANY_ID, 0, None))[2] \
        is not None, "a config with no usable address records nothing and says so"


def test_the_offset_window_keeps_the_LAST_n_samples_and_the_choice_is_observable():
    """Chosen so trimming the wrong end changes the answer: with these values `del [0]` and `del [1]`
    leave different windows AND different medians, which a symmetric fixture cannot show."""
    t = rc.OffsetTracker(window=3)
    for d in (100.0, 50.0, 1.0, 2.0, 3.0):
        t.add(1000 + d, 1000)
    assert t.n == 3
    assert t.offset == 2.0, "the window is (1, 2, 3); dropping the second-oldest would leave (100,2,3)"


def test_the_probe_is_asked_about_the_RESOLVED_index_and_its_error_reaches_the_verdict(tmp_path):
    """Two arguments that are easy to drop and invisible when dropped: the adapter index the probe is
    asked about, and the error it hands back."""
    sysfs = _sysfs(tmp_path, {"hci0": "AA:BB:CC:DD:EE:FF", "hci1": "28:0C:50:0C:18:FD"})
    asked = []

    def _probe(index):
        asked.append(index)
        return rc.NORDIC_COMPANY_ID, None, "the socket said no"

    _, _, why = rc.decide(CFG, sysfs, probe=_probe)
    assert asked == [1], "the probe is asked about the adapter we resolved, not index 0"
    assert "the socket said no" in why, "the probe's own error reaches the operator's line"


def test_the_config_path_DEFAULTS_when_no_argument_is_given(tmp_path, caplog):
    """The unit passes --config explicitly, so a broken default is invisible there and only bites the
    operator running it by hand in the capture-host directory."""
    sysfs = _sysfs(tmp_path, {"hci1": "28:0C:50:0C:18:FD"})
    with caplog.at_level("INFO"):
        assert rc.main([], sysfs) == 0
    assert "config.yaml" in caplog.text, "the default names the file it looked for"


def test_a_RECONNECT_on_the_same_handle_starts_the_anchor_counter_afresh():
    """The per-connection counter is dropped with its handle on disconnect. Keeping it would compare
    the new connection's first counter against the old connection's last and charge the difference to
    `missed_anchors` — inventing thousands of missed anchors out of a reconnect."""
    c = _collector()
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _anchor_event(0x0040, 60000, 1_000_000)), host_ns=2)
    assert c.missed_anchors == 0
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _disconnect(0x0040)), host_ns=3)
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=4)
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _anchor_event(0x0040, 5, 2_000_000)), host_ns=5)
    assert c.missed_anchors == 0, "a reconnect is not 60000 missed anchors"


def test_the_host_stamp_is_converted_to_MICROSECONDS_exactly():
    """The anchor clock is microseconds and the monitor stamp is nanoseconds. A wrong divisor is a
    constant offset that no band would flag — it just quietly moves every association."""
    c = _collector()
    c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _le_conn_complete(0x0040, H10)), host_ns=1)
    for counter, us in ((10, 1_000_000), (11, 1_050_000), (12, 1_100_000)):
        c.feed(*_mon(rc.MONITOR_OPCODE_EVENT, _anchor_event(0x0040, counter, us)),
               host_ns=(us + 300) * 1000)
    assert c.offsets.offset == 300.0, "ns/1000 == us; any other divisor shifts this off 300"
