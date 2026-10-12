# tepna-capture — anchor_points.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""CONTROLLER-SIDE connection anchor points — the radio's own clock, one layer below HCI.

WHAT THIS IS FOR. Every arrival stamp Tepna holds today is taken by the HOST, after the packet has
crossed USB and the kernel scheduler — which is exactly where the delivery jitter the drift work
fights gets added (measured Verity-minus-H10: -867 to +1321 ms across nights, against PAT's ~10 ms
budget). `ZEPHYR-INSTRUMENT-2026-08-23-BRIEF` names the prize in one line: *"Controller timestamps sit
one layer below kernel HCI timestamps."* This module is the host half of collecting them.

THE PRIMITIVE IS AN ANCHOR POINT, NOT A PACKET TIMESTAMP, and the distinction is not pedantry: the
HCI ACL data packet has NO timestamp field in the Core spec (only ISO data does), so "controller-side
ACL timestamping" cannot exist as stated. What Nordic's SoftDevice Controller exposes instead is the
CONNECTION ANCHOR POINT — the radio-time instant a connection event begins — as a vendor-specific
event. On a central it is emitted every connection interval, and the box is central for every
wearable. That is a better source than a per-packet stamp would have been: it is the SCHEDULED radio
instant, not the moment a packet happened to be handed up a stack.

🟢 THE CONTROLLER ALREADY SUPPORTS IT — no reflash. Probed 2026-09-10 on the dongle reporting USB
product `Zephyr USBD BT HCI anchor`: `hcitool -i hciN cmd 0x3f 0x11f 0x01` returned HCI event 0x0E
(Command Complete), opcode echo `1F FD`, status `00`. ⚠️ The FIRST probe used OCF `0x1f`, which
assembles to `0xFC1F` — a different, non-existent command — and returned "Unknown HCI Command". That
answer was correct about the wrong question and would have read identically on a fully supporting
controller. `check_opcode_echo` below exists so no reader repeats it.

HOW THE HOST GETS THESE. Not through BlueZ's D-Bus API, which has no VS surface, and NOT through
`HCI_CHANNEL_USER` — that takes exclusive control of the adapter and would evict the capture daemon
(disqualified for this repo). The read path is the HCI MONITOR channel, the same source `btmon` uses:
passive, concurrent with normal operation, and it sees vendor-specific events. This module is the
PARSER; opening the socket is the caller's business, so every branch here is testable without a radio.
"""
from __future__ import annotations

import struct
from typing import NamedTuple

# ── wire constants (SDC `sdc_hci_vs.h`, NCS v3.4.0) ──────────────────────────────────────────────
ENABLE_OPCODE = 0xFD1F              # SDC_HCI_OPCODE_CMD_VS_CONN_ANCHOR_POINT_UPDATE_EVENT_REPORT_ENABLE
VS_SUBEVENT_ANCHOR = 0x82           # SDC_HCI_SUBEVENT_VS_CONN_ANCHOR_POINT_UPDATE_REPORT
HCI_EVT_VENDOR = 0xFF               # Core spec: the vendor-specific event code
_ANCHOR_PAYLOAD_LEN = 12            # conn_handle u16 + event_counter u16 + anchor_point_us u64


class AnchorPoint(NamedTuple):
    """One connection event's anchor, as the CONTROLLER timed it.

    `anchor_point_us` is on the controller's own clock — it is NOT comparable to a host stamp without
    a pairing, and treating it as wall time would be the fabricated-timebase error the Clock Contract
    exists to prevent. Its value is the DIFFERENCE against the host arrival of the same connection
    event: that difference IS the delivery jitter, measured rather than inferred."""

    conn_handle: int
    event_counter: int
    anchor_point_us: int


def enable_payload(enable: bool = True) -> bytes:
    """The one-byte parameter for opcode `0xFD1F`.

    The SDC struct is a single `uint8_t enable` — no connection handle, so the command is issued ONCE
    per controller rather than per link. ⚠️ It is a runtime command, not a build setting, and it is
    NOT expected to survive a controller reset: a caller that sends it at startup and never again
    stops receiving anchors silently after any adapter bounce."""
    return bytes([1 if enable else 0])


def split_opcode(opcode: int) -> tuple[int, int]:
    """`opcode` → `(ogf, ocf)`, which is what `hcitool cmd` takes as two separate arguments.

    🔴 THIS EXISTS BECAUSE THE OBVIOUS SPLIT IS WRONG AND FAILS QUIETLY. `0xFD1F` looks like it ends
    in `0x1F`, and passing OCF `0x1f` assembles to `0xFC1F` — a real-looking opcode for a command
    that does not exist, whose "Unknown HCI Command" reply is indistinguishable from the answer you
    were probing for. OCF is TEN bits: `0xFD1F & 0x3FF` is `0x11F`."""
    return (opcode >> 10) & 0x3F, opcode & 0x03FF


def check_opcode_echo(event_params: bytes, expected: int) -> bool:
    """Did the controller's Command Complete echo the opcode we MEANT to send?

    The status byte alone cannot answer "was my command well-formed" — a mistyped opcode gets a
    perfectly valid rejection. Command Complete carries `[num_pkts u8][opcode u16 LE][status …]`, so
    the echo is available on every reply and is the only field that distinguishes "unsupported" from
    "I asked the wrong thing"."""
    if len(event_params) < 3:
        return False
    return struct.unpack_from("<H", event_params, 1)[0] == expected


def parse_anchor_event(packet: bytes) -> AnchorPoint | None:
    """One HCI EVENT packet → `AnchorPoint`, or `None` if it is not one.

    Expects the event packet WITHOUT the transport type byte: `[code u8][plen u8][params …]`.

    ∅ RETURNS None, NEVER A ZEROED RECORD. Every other event on the monitor stream reaches this
    function — connection completes, advertising reports, command completes — and an anchor with a
    fabricated handle would be worse than no anchor at all, because it would enter the timing join
    looking like a measurement. Anything that is not exactly a well-formed anchor report is not one."""
    if len(packet) < 2 or packet[0] != HCI_EVT_VENDOR:
        return None
    plen = packet[1]
    params = packet[2:2 + plen]
    if len(params) != plen:                       # truncated capture: refuse rather than pad
        return None
    if len(params) < 1 or params[0] != VS_SUBEVENT_ANCHOR:
        return None
    body = params[1:]
    if len(body) != _ANCHOR_PAYLOAD_LEN:
        # A length that is not exactly the struct means the controller sent something this build does
        # not model. Parsing the prefix anyway is how a silently-changed wire format becomes a wrong
        # number rather than an error.
        return None
    handle, counter, anchor_us = struct.unpack("<HHQ", body)
    return AnchorPoint(conn_handle=handle, event_counter=counter, anchor_point_us=anchor_us)


def anchor_intervals_us(points: list[AnchorPoint]) -> list[int]:
    """Successive anchor deltas for ONE connection, in controller microseconds.

    The connection interval as the RADIO scheduled it — the reference the host-side arrival spacing
    is measured against. ⚠️ Mixes nothing: a caller passing two connections' anchors gets nonsense, so
    this refuses rather than grouping silently (grouping is a decision about identity, and identity
    is the caller's)."""
    if len({p.conn_handle for p in points}) > 1:
        raise ValueError("anchor_intervals_us: points span more than one conn_handle — group first")
    ordered = sorted(points, key=lambda p: p.event_counter)
    return [b.anchor_point_us - a.anchor_point_us for a, b in zip(ordered, ordered[1:])]
