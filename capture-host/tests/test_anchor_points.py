# tepna-capture — tests/test_anchor_points.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Controller anchor points — the parser, against the wire shapes it will actually meet.

No radio is needed: the module is deliberately the pure half, so every refusal branch is reachable
from bytes. The cases that matter most are the NEGATIVE ones — this parser sits on a monitor stream
carrying every HCI event on the box, so "is not an anchor report" is its commonest correct answer.
"""
import os
import struct
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from anchor_points import (  # noqa: E402
    ENABLE_OPCODE, HCI_EVT_VENDOR, VS_SUBEVENT_ANCHOR, AnchorPoint, anchor_intervals_us,
    check_opcode_echo, enable_payload, parse_anchor_event, split_opcode,
)


def _anchor(handle=0x0040, counter=7, us=123_456_789_012):
    body = struct.pack("<HHQ", handle, counter, us)
    return bytes([HCI_EVT_VENDOR, 1 + len(body), VS_SUBEVENT_ANCHOR]) + body


# ── the opcode split, which is where the live probe went wrong ──────────────────────────────────
def test_THE_OPCODE_SPLIT_IS_TEN_BITS_NOT_EIGHT():
    """🔴 THE MISTAKE, pinned. `0xFD1F` looks like it ends in `0x1F`, and OCF `0x1f` assembles to
    `0xFC1F` — a different command that does not exist, whose "Unknown HCI Command" reply is
    indistinguishable from the answer being probed for. Measured live 2026-09-10: the wrong split
    returned a confident, wrong negative."""
    assert split_opcode(ENABLE_OPCODE) == (0x3F, 0x11F)
    ogf, ocf = split_opcode(ENABLE_OPCODE)
    assert (ogf << 10) | ocf == ENABLE_OPCODE, "the split must round-trip"
    assert ocf != 0x1F, "0x1f is the eight-bit misread that cost a probe"


def test_the_command_echo_distinguishes_unsupported_from_misaddressed():
    """A status byte cannot tell you your command was well-formed. Command Complete carries the
    opcode it is answering, and that echo is the only field that separates "this controller lacks the
    feature" from "I asked the wrong thing"."""
    good = bytes([0x01]) + struct.pack("<H", ENABLE_OPCODE) + bytes([0x00])
    wrong = bytes([0x01]) + struct.pack("<H", 0xFC1F) + bytes([0x01])
    assert check_opcode_echo(good, ENABLE_OPCODE) is True
    assert check_opcode_echo(wrong, ENABLE_OPCODE) is False, "the FC1F probe must not read as ours"
    assert check_opcode_echo(b"\x01\x1f", ENABLE_OPCODE) is False, "a truncated reply proves nothing"


def test_the_enable_parameter_is_one_byte():
    """The SDC struct is a single `uint8_t enable` — no connection handle, so the command is issued
    once per CONTROLLER, not per link. A handle-carrying variant would be a different command."""
    assert enable_payload(True) == b"\x01" and enable_payload(False) == b"\x00"
    assert len(enable_payload()) == 1


# ── the parser ──────────────────────────────────────────────────────────────────────────────────
def test_a_well_formed_anchor_report_parses_with_a_64_bit_clock():
    """`anchor_point_us` is u64 and will exceed 32 bits in normal operation — a controller that has
    been up for 72 min already passes 2^32 µs, so a 32-bit read would wrap silently mid-night."""
    big = 2**33 + 5
    got = parse_anchor_event(_anchor(handle=0x0041, counter=65535, us=big))
    assert got == AnchorPoint(conn_handle=0x0041, event_counter=65535, anchor_point_us=big)


@pytest.mark.parametrize("packet,why", [
    (b"", "empty"),
    (b"\x3e", "truncated header"),
    (bytes([0x3E, 13, VS_SUBEVENT_ANCHOR]) + struct.pack("<HHQ", 1, 2, 3), "LE Meta, not vendor"),
    (bytes([HCI_EVT_VENDOR, 13, 0x80]) + struct.pack("<HHQ", 1, 2, 3), "VS QoS report, not anchor"),
    (bytes([HCI_EVT_VENDOR, 13, VS_SUBEVENT_ANCHOR]) + struct.pack("<HHQ", 1, 2, 3)[:-2], "short body"),
    (bytes([HCI_EVT_VENDOR, 99, VS_SUBEVENT_ANCHOR]) + struct.pack("<HHQ", 1, 2, 3), "plen lies"),
    (bytes([HCI_EVT_VENDOR, 1, VS_SUBEVENT_ANCHOR]), "subevent only, no body"),
])
def test_EVERYTHING_THAT_IS_NOT_AN_ANCHOR_RETURNS_NONE(packet, why):
    """∅ This parser sits on a stream carrying EVERY HCI event on the box, so "not an anchor" is its
    commonest correct answer. A zeroed record here would enter the timing join looking like a
    measurement — worse than no anchor at all.

    The `plen lies` case is the one to keep: a declared length longer than the bytes present is what a
    truncated capture looks like, and padding it would invent a timestamp."""
    assert parse_anchor_event(packet) is None, why


def test_a_longer_body_is_refused_rather_than_prefix_parsed():
    """A future controller adding a field must not silently yield a right-looking number. Parsing the
    prefix is how a changed wire format becomes a wrong value instead of an error."""
    body = struct.pack("<HHQ", 1, 2, 3) + b"\x99\x99"
    pkt = bytes([HCI_EVT_VENDOR, 1 + len(body), VS_SUBEVENT_ANCHOR]) + body
    assert parse_anchor_event(pkt) is None


# ── intervals ───────────────────────────────────────────────────────────────────────────────────
def test_intervals_are_ordered_by_event_counter_not_arrival():
    """The monitor stream can reorder; the event counter is the controller's own sequence and is the
    only ordering that means anything."""
    pts = [AnchorPoint(1, 3, 3000), AnchorPoint(1, 1, 1000), AnchorPoint(1, 2, 2000)]
    assert anchor_intervals_us(pts) == [1000, 1000]


def test_MIXING_TWO_CONNECTIONS_RAISES_RATHER_THAN_AVERAGING():
    """🔴 Two links have unrelated anchors, and subtracting across them yields a number that looks
    like an interval and is noise. Grouping is a decision about identity, so it belongs to the caller
    — silently grouping here would put the error one layer further from whoever could see it."""
    with pytest.raises(ValueError, match="more than one conn_handle"):
        anchor_intervals_us([AnchorPoint(1, 1, 1000), AnchorPoint(2, 2, 2000)])


def test_fewer_than_two_anchors_is_no_interval_not_zero():
    """∅ One anchor has no successor. Zero would read as a 0 µs connection interval."""
    assert anchor_intervals_us([]) == []
    assert anchor_intervals_us([AnchorPoint(1, 1, 1000)]) == []
