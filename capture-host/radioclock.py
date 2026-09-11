# tepna-capture — radioclock.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# RADIO CLOCK — the controller's own connection-event anchor points, as an OPTIONAL second clock.
#
# WHY. Today the second clock on a box capture is the HOST ARRIVAL STAMP of each PMD packet, which
# reaches Python through USB → kernel → BlueZ → D-Bus → bleak. `hostAxis` measures its spread at
# 102–5124 ms on box nights, and that spread is the reason the H10↔Verity offset is only good to
# ~0.2 s. A Nordic controller can report the anchor point of every connection event on its own clock,
# below all of that. This module records those anchors beside the night; it does not use them.
#
# 🔴 FOUR INVARIANTS FROM THE OWNER — "not everybody will have same ability so original functionality
# must be kept" (RADIO-CLOCK-SIDECAR-2026-09-07-BRIEF §0). Each is enforced here, not just intended:
#
#   1. `capture.py` IS NOT TOUCHED. This is a separate process on a separate unit. The join key lives
#      inside the ACL packet, so the capture daemon needs no hook and does not know this runs.
#   2. DEFAULT OFF, opt-in by `radio_clock.enabled`.
#   3. FEATURE-DETECTED, NEVER ASSUMED. A non-Nordic controller is the COMMON CASE, not an error: the
#      collector proves the capability before it opens a file, and on any miss it logs one line, exits
#      0 and writes NOTHING. **Absence is the absence of a file** — never an empty one, never a
#      zero-filled one. (CLAUDE.md §∅.)
#   4. CONSUMERS ARE UNCHANGED WHEN THE SIDECAR IS ABSENT. Nothing here writes into any existing file.
#
# 🔴 THE SIDECAR IS TELEMETRY, NEVER A METRIC. It carries no evidence badge and no consumer may treat
# it as a measurement of anything until the §4 bands admit it.
#
# ⚠️ WHAT IS PINNED FROM A HEADER AND NOT YET FROM THE AIR. The anchor report's layout is read from
# `sdc_hci_vs.h` (SoftDevice Controller), not from a capture — the dongle is unflashed as of
# 2026-09-07 and no real report exists yet. `parse_anchor_report` is therefore pinned to a frame
# CONSTRUCTED from that struct, and its test says so. Replace those bytes with the first real report,
# and do not let the constructed fixture outlive the hardware being silent.

from __future__ import annotations

import os
import struct

#: HCI event codes we care about. Everything else on the monitor stream is ignored.
HCI_EVT_DISCONNECT_COMPLETE = 0x05
HCI_EVT_LE_META = 0x3E
HCI_EVT_VENDOR = 0xFF

#: LE Meta subevents carrying a new connection. Both shapes exist in the wild and both must be read:
#: an adapter that supports extended advertising reports the ENHANCED form and only that one.
LE_CONNECTION_COMPLETE = 0x01
LE_ENHANCED_CONNECTION_COMPLETE = 0x0A

#: Nordic's vendor-specific subevent for the anchor report (SDC_HCI_SUBEVENT_VS_CONN_ANCHOR_POINT_-
#: UPDATE_REPORT). `hci_driver.c` routes exactly this byte under CONFIG_BT_CTLR_SDC_CONN_ANCHOR_-
#: POINT_REPORT.
VS_SUBEVENT_CONN_ANCHOR_POINT_UPDATE = 0x82

#: The anchor report's parameters after the event header: subevent u8, conn_handle u16,
#: event_counter u16, anchor_point_us u64 — all little-endian, packed, alignment 1.
_ANCHOR_MIN_PARAMS = 13

#: HCI Read Local Version Information's company identifier for Nordic Semiconductor (Bluetooth SIG
#: assigned number 89). The feature detection's second gate; the third is the enable command itself.
NORDIC_COMPANY_ID = 89

#: Vendor opcode that turns the anchor reports on. One u8 parameter (1 enable / 0 disable), answered
#: by a Command Complete. ⚠️ It is CLEARED BY HCI RESET — a collector that assumes an earlier success
#: still holds will read a stream that silently stopped carrying anchors.
VS_OPCODE_CONN_ANCHOR_POINT_REPORT = 0xFD1F

#: L2CAP channel identifier for ATT, and the ATT opcode for a Handle Value Notification. A PMD data
#: frame reaches us as the VALUE of one of these; nothing else on the ACL stream is of interest.
L2CAP_CID_ATT = 0x0004
ATT_HANDLE_VALUE_NOTIFICATION = 0x1B

#: How many `(vs_rx − anchor)` samples the controller↔host offset is taken over. 64 mirrors the
#: brief; the estimator is a MEDIAN for the same reason `hostAxis` uses one — delivery jitter must not
#: be interpolated into the result. See `OffsetTracker`.
OFFSET_WINDOW = 64

#: The offset window must hold at least this many samples before an association is attempted. Fewer
#: than three points cannot show curvature and cannot be checked — CLAUDE.md §🔒 §7's ≥3-anchor
#: contract, applied here to the ASSOCIATION rather than to a rate.
OFFSET_MIN_SAMPLES = 3


def _median(values: list[float]) -> float:
    """Median of a non-empty list. Local so this module imports nothing but `struct`."""
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[mid])
    return (float(ordered[mid - 1]) + float(ordered[mid])) / 2.0


def parse_anchor_report(params: bytes) -> tuple[int, int, int] | None:
    """`(conn_handle, event_counter, anchor_point_us)` from a vendor event's parameters, or None.

    `params` is everything AFTER the HCI event header, so `params[0]` is the vendor subevent byte.

    Reads by offset and tolerates trailing bytes: a future firmware that appends a field must not
    break this, and pinning an exact length would encode today's build as a contract. What it will
    not do is read a SHORT buffer — a truncated event yields None rather than fields unpacked from
    whatever followed it in the socket buffer.

    ⚠️ `anchor_point_us` is an OPAQUE COUNTER on the controller's own timebase. Its epoch is not
    specified anywhere and is not promised to survive a controller reset. Only DIFFERENCES between
    anchors mean anything; a backwards jump is a new clock, not a negative interval.
    """
    if len(params) < _ANCHOR_MIN_PARAMS or params[0] != VS_SUBEVENT_CONN_ANCHOR_POINT_UPDATE:
        return None
    handle, counter, anchor_us = struct.unpack_from("<HHQ", params, 1)
    return handle & 0x0FFF, counter, anchor_us


def parse_hci_event(payload: bytes) -> dict | None:
    """One HCI event packet → a small dict describing it, or None when it is not one we act on.

    Recognised: `connect` (either Connection Complete shape), `disconnect`, and `anchor`. Everything
    else on the monitor stream — and there is a great deal of it — returns None.

    The declared parameter length is checked against the buffer. That is a FRAMING check, not a
    length assertion about any particular event: a monitor packet whose header disagrees with its own
    body has been truncated or mis-framed, and parsing it would produce well-formed nonsense.
    """
    if len(payload) < 2:
        return None
    code, plen = payload[0], payload[1]
    params = payload[2:]
    if len(params) < plen:                      # truncated: the header promises more than we hold
        return None
    params = params[:plen]
    if code == HCI_EVT_VENDOR:
        got = parse_anchor_report(params)
        if got is None:
            return None
        handle, counter, anchor_us = got
        return {"kind": "anchor", "handle": handle, "event_counter": counter, "anchor_us": anchor_us}
    if code == HCI_EVT_DISCONNECT_COMPLETE:
        if len(params) < 3:
            return None
        handle = struct.unpack_from("<H", params, 1)[0] & 0x0FFF
        return {"kind": "disconnect", "handle": handle}
    if code == HCI_EVT_LE_META:
        return _parse_le_meta(params)
    return None


def _parse_le_meta(params: bytes) -> dict | None:
    """LE Meta event parameters → a `connect` dict, or None.

    Both Connection Complete shapes place `status · handle · role · peer_addr_type · peer_addr` at
    the same offsets; the Enhanced form only appends fields (the local and peer RPAs). So one reader
    serves both, and a controller that reports only the enhanced form is not a special case.

    A NON-ZERO STATUS IS NOT A CONNECTION. A failed attempt carries a handle field like a successful
    one, and recording its address would put a peer on disk that we never talked to.
    """
    if len(params) < 1:
        return None
    subevent = params[0]
    if subevent not in (LE_CONNECTION_COMPLETE, LE_ENHANCED_CONNECTION_COMPLETE):
        return None
    if len(params) < 13:
        return None
    status = params[1]
    if status != 0x00:
        return None
    handle = struct.unpack_from("<H", params, 2)[0] & 0x0FFF
    return {"kind": "connect", "handle": handle, "address": _address(params[6:12])}


def _address(raw: bytes) -> str:
    """Six little-endian bytes → the uppercase colon form BlueZ prints. Identity is the ADDRESS."""
    return ":".join("%02X" % b for b in reversed(raw))


def parse_acl_pmd(payload: bytes) -> tuple[int, int, int] | None:
    """`(conn_handle, meas_type, last_sensor_ns)` from one ACL packet, or None if it is not a PMD frame.

    🔴 THE JOIN KEY IS `last_sensor_ns`, AND THAT NAME IS LOAD-BEARING. Bytes 1..9 of a PMD data frame
    are the ns stamp of the frame's **LAST** sample (`polar_pmd.py` `last_ns`), which is what
    `PmdArrivalLogWriter` records in its `last_sensor_ns` column (`capture.py` writes
    `samples[-1].sensor_ns`). The sibling column `first_sensor_ns` is `samples[0].sensor_ns`, a value
    the decoder BACK-TIMES from `fs` and the previous frame — it is not in the packet at all.
    Measured 2026-09-07 on a 3-sample H10 frame: the raw field equals `samples[-1]`, and differs from
    `samples[0]` by two sample periods. A collector joining on the first-sample key would match ZERO
    rows on every multi-sample frame, and an empty join reads exactly like a night with no correlated
    packets. Read the raw 8 bytes. Decode nothing. Do not reimplement the back-timing to recover the
    other key.

    Only continuation-free start fragments are read. A reassembled frame's first fragment carries the
    header we need; a continuation carries no L2CAP header at all, and treating one as a start yields
    a plausible ns value from payload bytes — the failure this docstring exists to prevent.
    """
    if len(payload) < 4:
        return None
    handle_flags, data_len = struct.unpack_from("<HH", payload, 0)
    handle = handle_flags & 0x0FFF
    pb_flag = (handle_flags >> 12) & 0x03
    if pb_flag not in (0x00, 0x02):             # 0b01 is a continuation: no L2CAP header follows
        return None
    body = payload[4:]
    if len(body) < data_len:
        return None
    body = body[:data_len]
    if len(body) < 4:
        return None
    l2_len, cid = struct.unpack_from("<HH", body, 0)
    if cid != L2CAP_CID_ATT:
        return None
    att = body[4:]
    if len(att) < l2_len:                       # a fragmented ATT PDU; its tail is a continuation
        return None
    att = att[:l2_len]
    if len(att) < 3 or att[0] != ATT_HANDLE_VALUE_NOTIFICATION:
        return None
    value = att[3:]
    if len(value) < 10:                         # meas u8 + ns u64 + frame_type u8
        return None
    meas = value[0] & 0x3F                      # bits 6–7 are recording-type flags (polar_pmd.py)
    last_sensor_ns = struct.unpack_from("<Q", value, 1)[0]
    return handle, meas, last_sensor_ns


class HandleMap:
    """Which peer address a connection handle refers to, right now.

    A handle is only meaningful between its Connection Complete and its Disconnection Complete, and
    the controller REUSES handles. Holding one past its disconnect is how a later connection's
    packets get written under an earlier device's address — so a disconnect DROPS the entry rather
    than marking it stale, and an unknown handle is unknown rather than "probably the last one".
    """

    def __init__(self) -> None:
        self._by_handle: dict[int, str] = {}

    def apply(self, event: dict | None) -> None:
        """Feed every parsed HCI event through here; it takes the two kinds it cares about."""
        if not event:
            return
        if event.get("kind") == "connect":
            self._by_handle[event["handle"]] = event["address"]
        elif event.get("kind") == "disconnect":
            self._by_handle.pop(event["handle"], None)

    def address(self, handle: int) -> str | None:
        """The peer address for a live handle, or None. None is a real answer: it means we never saw
        the connect (the collector started mid-connection), and a row we cannot attribute is dropped
        rather than guessed."""
        return self._by_handle.get(handle)

    def __len__(self) -> int:
        return len(self._by_handle)


class OffsetTracker:
    """The controller↔host offset, as a running median of `(vs_rx_us − anchor_us)`.

    A MEDIAN, NOT A FIT, for the same reason `hostAxis` uses one: the vendor event's own arrival is
    jittered by the same USB/kernel path the anchors exist to bypass, and interpolating that jitter
    into the association would put it straight back in. The window is the last `OFFSET_WINDOW`
    samples.

    `jitter` is the MEDIAN ABSOLUTE DEVIATION of that same window — a MEASURED spread rather than a
    tuned constant, which matters because it is the radius that decides an association is ambiguous.
    A threshold chosen by hand would decide that question by assertion.
    """

    def __init__(self, window: int = OFFSET_WINDOW) -> None:
        self._window = window
        self._samples: list[float] = []

    def add(self, vs_rx_us: float, anchor_us: int) -> None:
        self._samples.append(float(vs_rx_us) - float(anchor_us))
        if len(self._samples) > self._window:
            del self._samples[0]

    @property
    def n(self) -> int:
        return len(self._samples)

    @property
    def ready(self) -> bool:
        """Whether an association may be attempted at all. Under `OFFSET_MIN_SAMPLES` there is no
        offset — and no offset means a blank `anchor_us`, never a zero one."""
        return len(self._samples) >= OFFSET_MIN_SAMPLES

    @property
    def offset(self) -> float | None:
        return _median(self._samples) if self.ready else None

    @property
    def jitter(self) -> float | None:
        """MAD of the window: the ambiguity radius. None when the offset itself is not available.

        ⚠️ A MAD is ROBUST, so it does NOT move for a minority of excursions and can legitimately be
        **zero** — a window that is mostly one value says the offset is steady, and with a steady
        offset two anchors separated by any non-zero interval really are distinguishable. No floor is
        added: a floor would be exactly the hand-chosen constant a measured radius exists to avoid,
        and it would widen the blanking rule on nights where the link was in fact clean.
        """
        if not self.ready:
            return None
        centre = _median(self._samples)
        return _median([abs(s - centre) for s in self._samples])


def associate(pkt_rx_us: float, anchors: list[tuple[int, int]],
              offset: float | None, jitter: float | None) -> tuple[int | None, int | None]:
    """Pick the connection event an ACL packet belongs to → `(event_counter, anchor_us)`.

    `anchors` is `[(event_counter, anchor_us), …]` for ONE handle, in arrival order. The rule is the
    brief's: translate the packet's host stamp onto the controller's timebase (`pkt_rx_us − offset`)
    and take the nearest anchor at or before it — a packet is sent during the event it follows.

    🔴 AMBIGUOUS IS ABSENT, NOT GUESSED. If two or more anchors fall within `jitter` of the target,
    the packet cannot be attributed to one event and BOTH fields come back None, which the writer
    renders as blank cells. The alternative — taking the nearer of two indistinguishable candidates —
    would manufacture a precise answer out of a measurement that does not contain one, and it would
    do so invisibly, because the output looks identical either way.

    Returns `(None, None)` when there is no offset yet, when no anchor precedes the packet, or when
    the choice is ambiguous. All three are the same statement: not measured.
    """
    if offset is None or jitter is None or not anchors:
        return None, None
    target = float(pkt_rx_us) - float(offset)
    candidates = [(counter, us) for counter, us in anchors if float(us) <= target]
    if not candidates:
        return None, None
    if sum(1 for _, us in anchors if abs(float(us) - target) <= float(jitter)) >= 2:
        return None, None
    counter, anchor_us = max(candidates, key=lambda pair: pair[1])
    return counter, anchor_us


# ══════════════════════════════════════════════════════════════════════════════════════════════════
# THE I/O HALF. Everything above is pure and fully tested; everything below touches a socket, a clock
# or a file, and is kept as thin as it can be for exactly that reason.
# ══════════════════════════════════════════════════════════════════════════════════════════════════

#: Monitor-channel opcodes (`hci_mon_hdr.opcode`) — the same framing `btmon` reads.
MONITOR_OPCODE_NEW_INDEX = 0x00
MONITOR_OPCODE_DEL_INDEX = 0x01
MONITOR_OPCODE_EVENT = 0x03
MONITOR_OPCODE_ACL_TX = 0x04
MONITOR_OPCODE_ACL_RX = 0x05
MONITOR_OPCODE_OPEN_INDEX = 0x08
MONITOR_OPCODE_CLOSE_INDEX = 0x09

#: `HCI_Reset`. Its Command Complete is one of the two things that means the anchor enable is gone.
HCI_OPCODE_RESET = 0x0C03

#: `bind()` targets for the monitor channel. HCI_DEV_NONE takes every adapter; the per-adapter filter
#: is applied to the header's `index` field, because the monitor channel does not bind per-index.
HCI_DEV_NONE = 0xFFFF
HCI_CHANNEL_MONITOR = 2

#: `hci_mon_hdr`: opcode u16, index u16, len u16 — little-endian, 6 bytes.
_MONITOR_HDR = struct.Struct("<HHH")
MONITOR_HDR_LEN = _MONITOR_HDR.size

SIDECAR_HEADER = ("Phone timestamp;device;meas;last_sensor_ns;conn_handle;event_counter;"
                  "anchor_us;vs_rx_ns;acl_rx_ns\n")


def parse_monitor_packet(buf: bytes) -> tuple[int, int, bytes] | None:
    """One monitor-channel datagram → `(opcode, adapter_index, payload)`, or None if malformed.

    The header's own length field is checked against the buffer. A datagram shorter than it claims is
    truncated, and parsing its body would read fields out of whatever the socket happened to hold.
    """
    if len(buf) < MONITOR_HDR_LEN:
        return None
    opcode, index, plen = _MONITOR_HDR.unpack_from(buf, 0)
    body = buf[MONITOR_HDR_LEN:]
    if len(body) < plen:
        return None
    return opcode, index, body[:plen]


class RadioClockUnavailable(Exception):
    """The controller cannot do this, or the platform cannot ask it.

    🔴 NOT AN ERROR — the common case. A non-Nordic adapter is most adapters. The caller logs one
    line, exits 0, and writes NO FILE: absence is the absence of a file, never an empty one.
    """


def open_monitor_socket(socket_module=None):
    """A bound HCI monitor socket, or `RadioClockUnavailable` if this Python cannot open one.

    ⚠️ `socket.AF_BLUETOOTH` IS RESOLVED AT CALL TIME, NEVER AT IMPORT. The interpreter that runs the
    tests is not always the one that runs the collector: measured 2026-09-07, vigil's venv is CPython
    3.14.4 WITH the Bluetooth address family, while the development rig's is a 3.13 standalone build
    that reports `AF_BLUETOOTH` ABSENT. Touching the attribute at import time would make this module
    unimportable — and therefore the whole test file uncollectable — on the machine it is written on.
    A missing family is just one more way the capability is unavailable.
    """
    import socket as _socket
    sock_mod = socket_module or _socket
    family = getattr(sock_mod, "AF_BLUETOOTH", None)
    proto = getattr(sock_mod, "BTPROTO_HCI", None)
    if family is None or proto is None:
        raise RadioClockUnavailable("this Python has no AF_BLUETOOTH support")
    try:
        sock = sock_mod.socket(family, sock_mod.SOCK_RAW, proto)
        sock.bind((HCI_DEV_NONE, HCI_CHANNEL_MONITOR))
    except (OSError, AttributeError, TypeError) as exc:
        # Permission (no CAP_NET_RAW), no BlueZ, or a kernel without the monitor channel. Each is the
        # same answer to the only question being asked: can this box do it.
        raise RadioClockUnavailable("cannot open the HCI monitor channel: %s" % (exc,)) from exc
    return sock


def format_row(phone_ts: str, device: str, meas, last_sensor_ns, conn_handle,
               event_counter, anchor_us, vs_rx_ns, acl_rx_ns) -> str:
    """One sidecar line. **A blank cell is `not measured`; nothing here is ever defaulted to 0.**

    `0` is in-band for every numeric column on this row — a microsecond counter, an event counter and
    a nanosecond stamp can all legitimately read zero — so a fabricated zero is indistinguishable
    from a measurement, forever, to every reader. `writers._ns_col` makes the same argument for the
    vendor streams; this is that rule applied to the sidecar.
    """
    def cell(value):
        return "" if value is None else str(value)

    return ";".join([phone_ts, device, cell(meas), cell(last_sensor_ns), cell(conn_handle),
                     cell(event_counter), cell(anchor_us), cell(vs_rx_ns), cell(acl_rx_ns)]) + "\n"


#: HCI Command Complete / Command Status event codes, and the "Unknown HCI Command" status. The
#: current dongle image answers `0xfd1f` with 0x01, which is a USEFUL answer: it proves the send path
#: works while proving the feature is absent.
HCI_EVT_COMMAND_COMPLETE = 0x0E
HCI_EVT_COMMAND_STATUS = 0x0F
HCI_STATUS_SUCCESS = 0x00
HCI_STATUS_UNKNOWN_COMMAND = 0x01

#: The three outcomes of the enable, as three DISTINGUISHABLE strings. This is a mechanism, not a
#: convention: "the controller cannot do this" and "we were not allowed to ask" are different facts
#: with different fixes, and they reach the same §0.3 exit — one line, exit 0, no file — so without
#: distinct wording the first person to read the log cannot tell which happened. The failure path
#: being safe is exactly why it must also be legible.
ENABLE_ENABLED = "sent, status 0 (anchors enabled)"
ENABLE_NOT_THIS_IMAGE = "sent, Unknown Command (not this image)"
ENABLE_REFUSED = "send refused: %s (socket/caps)"
#: A FOURTH outcome, and it is not a refusal: the command went out and nothing came back. Measured on
#: vigil 2026-09-07 — the Holyiot controller had been wedged since 20:31 and answered no HCI command
#: at all (99 kernel "command tx timeout" lines), so both the version read and the enable left on the
#: wire and returned silence. Folding that into "refused" would say the send failed when it did not,
#: and would point the reader at capabilities when the fault is the radio.
ENABLE_NO_REPLY = "sent, NO REPLY (controller not answering — wedged, or reset mid-command)"


def parse_command_complete(payload: bytes, opcode: int) -> int | None:
    """The status byte of a Command Complete/Status for `opcode`, or None if this is not that reply.

    Both shapes are read because a controller may answer a vendor command with either. Their layouts
    differ — Command Complete is `num_hci_cmd u8 · opcode u16 · status u8`, Command Status is
    `status u8 · num_hci_cmd u8 · opcode u16` — and reading one as the other yields a plausible status
    for the wrong command, which is the whole failure family this module guards against.
    """
    if len(payload) < 2:
        return None
    code, plen = payload[0], payload[1]
    params = payload[2:]
    if len(params) < plen:
        return None
    params = params[:plen]
    if code == HCI_EVT_COMMAND_COMPLETE:
        if len(params) < 4 or struct.unpack_from("<H", params, 1)[0] != opcode:
            return None
        return params[3]
    if code == HCI_EVT_COMMAND_STATUS:
        if len(params) < 4 or struct.unpack_from("<H", params, 2)[0] != opcode:
            return None
        return params[0]
    return None


def describe_enable(status: int | None, error: object | None = None) -> str:
    """One of the three strings above, from the enable's outcome.

    Four outcomes, because there are four distinct facts and each has a different fix:
      * enabled            — the controller can do it and now is.
      * not this image     — it answered, and the command is unknown to this firmware.
      * no reply           — the command went out and NOTHING came back. Measured on vigil: a wedged
                             controller answers no HCI command at all. The send worked; the radio did
                             not. Reporting this as "refused" would point the reader at capabilities.
      * refused            — the send itself never happened (no capability, no socket, a refusing
                             kernel), or the controller returned some other status.

    An absent reply is never a status of zero, and none of the four collapses into another.
    """
    if error is not None:
        return ENABLE_REFUSED % (error,)
    if status is None:
        return ENABLE_NO_REPLY
    if status == HCI_STATUS_SUCCESS:
        return ENABLE_ENABLED
    if status == HCI_STATUS_UNKNOWN_COMMAND:
        return ENABLE_NOT_THIS_IMAGE
    return ENABLE_REFUSED % ("status 0x%02X" % status,)


#: How many anchors are retained per connection handle. The association only ever looks backwards a
#: short way (a packet belongs to the event it follows), so this is a ring, not a history — and it is
#: bounded because a night is ~8 h at one anchor per connection interval, which would otherwise be
#: millions of tuples in memory for no gain.
ANCHOR_WINDOW = 256


class Collector:
    """Routes one monitor stream into sidecar rows. **Pure: no socket, no clock, no file.**

    `feed()` takes what a reader pulled off the monitor channel and returns either a finished row or
    None. Everything that can be decided without I/O is decided here, so the socket loop below has
    nothing in it worth testing and this has everything.

    🔴 A ROW IS ONLY EMITTED FOR A DEVICE WE CONFIGURED. The monitor channel carries every connection
    the controller has, including a neighbour's — so the address is checked against `devices` before
    anything is written, and an unknown handle is dropped rather than guessed. No address we did not
    ask for reaches the disk.
    """

    def __init__(self, adapter_index: int, devices, offset_window: int = OFFSET_WINDOW,
                 adapter_address: str | None = None) -> None:
        #: The index is a CACHE and the address is the identity. `hciN` reorders across a reflash or a
        #: replug, so the index is re-resolved whenever the adapter returns and the address is what
        #: that resolution is keyed on. Optional only for back-compat with callers that predate it.
        self.adapter_index = adapter_index
        self.adapter_address = adapter_address
        #: Matched case-insensitively: BlueZ prints uppercase, configs are written by humans.
        self.devices = {str(a).upper() for a in (devices or [])}
        self.handles = HandleMap()
        self.offsets = OffsetTracker(offset_window)
        self._anchors: dict[int, list[tuple[int, int]]] = {}
        #: Anchors the controller never delivered. The report is DISCARDABLE by design and is dropped
        #: under host-buffer pressure, so a gap in `event_counter` is expected — it is counted as
        #: telemetry and NEVER interpolated. An anchor that was not delivered did not happen for us.
        self.missed_anchors = 0
        self.rows = 0
        self._last_counter: dict[int, int] = {}

    def feed(self, opcode: int, index: int, payload: bytes, host_ns: int):
        """One monitor packet in; a row tuple out, or None.

        The row is `(device, meas, last_sensor_ns, handle, event_counter, anchor_us, vs_rx_ns,
        acl_rx_ns)` with None for anything not measured — never a zero.
        """
        if index != self.adapter_index:
            return None                     # another controller's traffic; not ours to record
        if opcode == MONITOR_OPCODE_EVENT:
            self._event(payload, host_ns)
            return None
        if opcode == MONITOR_OPCODE_ACL_RX:
            return self._acl(payload, host_ns)
        return None

    def _event(self, payload: bytes, host_ns: int) -> None:
        event = parse_hci_event(payload)
        if not event:
            return
        self.handles.apply(event)
        if event.get("kind") == "disconnect":
            # The handle is gone, so its anchors are about a connection that no longer exists. Keeping
            # them would let a REUSED handle associate a new connection's packets with the old one's
            # events — the same trap the handle map itself guards, one level down.
            self._anchors.pop(event["handle"], None)
            self._last_counter.pop(event["handle"], None)
            return
        if event.get("kind") != "anchor":
            return
        handle, counter, anchor_us = event["handle"], event["event_counter"], event["anchor_us"]
        prev = self._last_counter.get(handle)
        if prev is not None:
            # The counter is a per-connection u16 that wraps at 0xFFFF; the gap is computed modulo that
            # so a wrap reads as one step rather than as 65535 missed anchors.
            self.missed_anchors += (counter - prev - 1) & 0xFFFF
        self._last_counter[handle] = counter
        series = self._anchors.setdefault(handle, [])
        series.append((counter, anchor_us))
        if len(series) > ANCHOR_WINDOW:
            del series[0]
        self.offsets.add(host_ns / 1000.0, anchor_us)

    def _acl(self, payload: bytes, host_ns: int):
        got = parse_acl_pmd(payload)
        if got is None:
            return None
        handle, meas, last_sensor_ns = got
        address = self.handles.address(handle)
        if address is None or address.upper() not in self.devices:
            return None
        counter, anchor_us = associate(host_ns / 1000.0, self._anchors.get(handle, []),
                                       self.offsets.offset, self.offsets.jitter)
        self.rows += 1
        return (address, meas, last_sensor_ns, handle, counter, anchor_us, None, host_ns)


class SidecarWriter:
    """`<night>/<stamp>_<DEVICE>_RADIOCLOCK.csv`, one file per device per night.

    Torn-tail handling and the resume rule are copied from `writers.PmdArrivalLogWriter` deliberately:
    a resumed capture reuses the name, so the file is APPENDED to and the header kept, and a partial
    final line from a power cut is truncated back to the last newline rather than left to corrupt the
    row after it.

    🔴 IT IS TELEMETRY, NEVER A METRIC, and it is a SIDECAR for the reason the arrival log is one: the
    vendor `*_ECG.txt` / `*_PPG.txt` layouts are a POSITIONAL contract that the DSPs parse by index,
    and adding a field to them silently corrupted consumers once already. One extra file cannot.
    """

    def __init__(self, path: str) -> None:
        self.path = path
        self.rows = 0
        resume = False
        if os.path.exists(path) and os.path.getsize(path) > 0:
            with open(path, "rb+") as fh:
                fh.seek(-1, 2)
                if fh.read(1) != b"\n":
                    fh.seek(0)
                    data = fh.read()
                    cut = data.rfind(b"\n")
                    fh.truncate(cut + 1 if cut >= 0 else 0)
            resume = os.path.getsize(path) > 0
        self._fh = open(path, "a" if resume else "w", buffering=1 << 16, newline="\n")
        if not resume:
            self._fh.write(SIDECAR_HEADER)

    def write(self, line: str) -> None:
        self._fh.write(line)
        self.rows += 1

    def flush(self) -> None:
        try:
            self._fh.flush()
        except (OSError, ValueError):  # deliberate: a full disk or a closed handle must not raise out
            pass                            # of a TELEMETRY sidecar and end the night's other work

    def close(self) -> None:
        self.flush()
        try:
            self._fh.close()
        except (OSError, ValueError):  # deliberate: by here the rows are written; a failing close is
            pass                       # ENOSPC on the final flush, and raising would lose nothing but
                                       # would turn a full disk into a traceback


def sidecar_name(stamp: str, address: str) -> str:
    """`<stamp>_<DEVICE>_RADIOCLOCK.csv`. The address is the identity (BLE identity is address-only),
    with the colons dropped so the name is portable."""
    return "%s_%s_RADIOCLOCK.csv" % (stamp, address.upper().replace(":", "-"))


def phone_ts(host_ns: int) -> str:
    """A `CLOCK_REALTIME` nanosecond stamp → the vendor `Phone timestamp` string.

    Delegates to `writers._phone_ts`, which owns the format, rather than carrying a second copy: the
    whole point of the column is that a reader who only knows `*_PMDARRIVAL.csv` can read this file
    too, and two formatters would eventually disagree about a boundary case. Imported inside the
    function so this module stays importable — and its tests collectable — without pulling the whole
    writer stack in.
    """
    import datetime as _dt

    import writers
    return writers._phone_ts(_dt.datetime.fromtimestamp(host_ns / 1e9))


def read_monitor(sock, bufsize: int = 4096):     # pragma: no cover — a raw socket read, nothing else
    """Yield `(opcode, index, payload, host_ns)` off a bound monitor socket, forever.

    Deliberately the ONLY untested function in this file, and deliberately empty of decisions: it reads
    bytes, stamps them, hands them to `parse_monitor_packet`, and yields. Everything that could be
    wrong lives in `Collector.feed`, which is pure and fully covered. A malformed datagram is skipped
    rather than raised on — a monitor stream is shared with every other consumer on the box, and one
    unparsable packet must not end the night's telemetry.
    """
    import time as _time
    while True:
        try:
            buf = sock.recv(bufsize)
        except OSError:
            return
        host_ns = _time.time_ns()
        got = parse_monitor_packet(buf)
        if got is None:
            continue
        opcode, index, payload = got
        yield opcode, index, payload, host_ns


def parse_new_index(payload: bytes) -> str | None:
    """The BD ADDRESS out of a New Index packet, or None.

    `hci_mon_new_index` is `{ u8 type; u8 bus; bdaddr_t bdaddr; char name[8] }`, so the address is six
    little-endian bytes at offset 2. This matters because New Index is the ONE re-arm trigger that
    carries an identity: everything else we can only key on the index, and the index is precisely what
    is unstable across this event.
    """
    if len(payload) < 8:
        return None
    return _address(payload[2:8])


def rearm_needed(opcode: int, index: int, payload: bytes, adapter_index: int,
                 adapter_address: str | None = None) -> bool:
    """Has this packet invalidated the anchor enable on our adapter?

    🔴 THE ENABLE IS A RUNTIME COMMAND AND DOES NOT SURVIVE A CONTROLLER RESET. `0xfd1f` is not a build
    setting — it is sent to a live controller, and any reset clears it. A collector that sends it once
    at startup therefore stops receiving anchors **silently**: no error, no refusal, no log line, just
    an absence that looks exactly like a quiet night. That is the failure this whole module is written
    against, arriving through the one door it had left open (measured by Kestrel on three reflashed
    nRF52840s, 2026-09-11).

    Two packets mean the enable is gone, and both are visible on the monitor stream we already read:
      * **New/Open Index** for our adapter — it has just come up, so nothing has been enabled on it yet.
        This also covers the case the startup probe cannot: an adapter that appears *after* we started.
      * a **Command Complete for `HCI_Reset`** on our adapter — BlueZ resets on power-cycle and on some
        suspend/resume paths, and the controller comes back with the flag cleared.

    Deliberately NOT triggered by Del/Close Index: the adapter is going away, there is nothing to arm,
    and re-arming into a disappearing controller is how a retry loop is born.
    """
    # 🔴 NEW INDEX IS MATCHED ON THE ADDRESS, NOT THE INDEX, and that is the whole point of this
    # branch. `hciN` is assigned at enumeration and REORDERS across exactly the event we re-arm on —
    # measured on three dongles across a reflash (Kestrel, 2026-09-11), and the brief already records
    # a unit moving hci3 → hci0 the moment another dongle was pulled. Keying the return of our adapter
    # on a remembered integer would miss it when it comes back under a new number AND fire when a
    # neighbour inherits the old one. The packet carries the address; use it.
    if opcode == MONITOR_OPCODE_NEW_INDEX:
        seen = parse_new_index(payload)
        if adapter_address and seen:
            return seen.upper() == adapter_address.upper()
        return index == adapter_index          # no address to compare — fall back, and say so upstream
    if index != adapter_index:
        return False
    if opcode == MONITOR_OPCODE_OPEN_INDEX:
        return True
    if opcode == MONITOR_OPCODE_EVENT:
        return parse_command_complete(payload, HCI_OPCODE_RESET) is not None
    return False


def run(packets, collector: Collector, open_writer, flush_every: int = 64, rearm=None) -> dict:
    """Drive `collector` over an iterable of monitor packets, writing rows through `open_writer`.

    `open_writer(address) -> SidecarWriter`, called once per device and cached by the caller — a device
    that never sends a PMD frame therefore never causes a file to exist, which is §0.3's rule applied
    per device rather than only per box: **absence is the absence of a file.**

    Returns the run's telemetry. `missed_anchors` is reported, never interpolated.
    """
    writers_by_device: dict[str, SidecarWriter] = {}
    written = 0
    rearmed = 0
    try:
        for opcode, index, payload, host_ns in packets:
            # BEFORE feeding: an adapter that just came up has no anchors enabled, so the sooner the
            # command goes out the fewer connection events are missed.
            if rearm is not None and rearm_needed(opcode, index, payload, collector.adapter_index,
                                                  collector.adapter_address):
                rearmed += 1
                rearm()
            row = collector.feed(opcode, index, payload, host_ns)
            if row is None:
                continue
            address = row[0]
            sink = writers_by_device.get(address)
            if sink is None:
                sink = writers_by_device[address] = open_writer(address)
            sink.write(format_row(phone_ts(row[7]), *row))
            written += 1
            if written % flush_every == 0:
                sink.flush()
    finally:
        for sink in writers_by_device.values():
            sink.close()
    return {"rows": written, "devices": sorted(writers_by_device),
            "missed_anchors": collector.missed_anchors,
            "offset_samples": collector.offsets.n,
            "rearmed": rearmed}


#: Where BlueZ publishes each controller's address. Read rather than assumed, because **BLE identity is
#: ADDRESS-ONLY** in this repo (standing ruling) and `hciN` is an enumeration order that changes when a
#: dongle is re-plugged — pinning the bedside radio by index is how you end up recording the wrong one.
SYSFS_BLUETOOTH = "/sys/class/bluetooth"


def adapter_index(address: str | None, sysfs: str = SYSFS_BLUETOOTH) -> int | None:
    """`hciN` → N for the controller with this ADDRESS, or None if it is not present.

    None is a real answer and the caller treats it as §0.3's "unavailable": a box whose configured
    dongle is unplugged has no radio clock, which is not an error.
    """
    want = str(address or "").upper()
    if not want:
        return None
    try:
        names = sorted(os.listdir(sysfs))
    except OSError:
        return None
    for name in names:
        if not name.startswith("hci"):
            continue
        try:
            with open(os.path.join(sysfs, name, "address"), encoding="utf-8") as fh:
                got = fh.read().strip().upper()
        except OSError:  # deliberate: an entry with no readable address is not the controller we are
            continue     # looking for, and a sysfs tree we cannot fully read is not an error here
        if got == want:
            try:
                return int(name[3:])
            except ValueError:
                return None
    return None


#: `HCI_Read_Local_Version_Information` (OGF 0x04, OCF 0x01) and the socket option that filters a raw
#: HCI socket down to events.
HCI_OPCODE_READ_LOCAL_VERSION = 0x1001
HCI_COMMAND_PKT = 0x01
HCI_EVENT_PKT = 0x04
SOL_HCI, HCI_FILTER = 0, 2
#: ⚠️ THE FILTER IS 16 BYTES, NOT 14. `struct hci_filter` is `{u32 type_mask; u32 event_mask[2];
#: u16 opcode;}` — 14 bytes of fields, padded to 16 — and the box kernel returns EINVAL for anything
#: shorter (measured on vigil 2026-09-07). The `2x` is the padding, and it is why this is written out
#: rather than assembled from the field list.
_HCI_FILTER_EVENTS = struct.pack("<IIIH2x", 1 << HCI_EVENT_PKT, 0xFFFFFFFF, 0xFFFFFFFF, 0)

#: How long to wait for a controller to answer one command. A HUNG controller answers nothing at all
#: (measured: 15 minutes of `command tx timeout` on a wedged Holyiot), and that must present as the
#: NO REPLY outcome rather than as a process that never starts.
PROBE_TIMEOUT_S = 2.0


def _command(opcode: int, params: bytes = b"") -> bytes:
    """One HCI command packet as a raw socket wants it: type byte, opcode, parameter length, params."""
    return bytes([HCI_COMMAND_PKT]) + struct.pack("<H", opcode) + bytes([len(params)]) + params


def probe_controller(index: int, socket_module=None):   # pragma: no cover — raw HCI command I/O
    """`(manufacturer, enable_status, error)` for controller `index`. The one privileged step.

    Measured on vigil 2026-09-07: a vendor-OGF command goes out on a **RAW** HCI socket from an
    unprivileged uid holding **CAP_NET_RAW alone**, with bluetoothd keeping the adapter — the enable
    returned Command Complete status 0x00 in 0.8 ms. CAP_NET_ADMIN was tested and is NOT needed for the
    send; it only marks the socket privileged in btmon. `HCI_CHANNEL_USER` is disqualified outright: it
    takes the adapter away from BlueZ, which on this box is the capture daemon losing its links.

    ⚠️ The enable is CLEARED BY HCI RESET, so a controller that resets stops producing anchors with no
    error anywhere. Re-probe after any reset rather than trusting an earlier success.

    Untested by construction — it is socket calls and nothing else. Every decision made on its result
    lives in `decide`, which is pure and fully covered.
    """
    import socket as _socket
    sock_mod = socket_module or _socket
    family = getattr(sock_mod, "AF_BLUETOOTH", None)
    proto = getattr(sock_mod, "BTPROTO_HCI", None)
    if family is None or proto is None:
        raise RadioClockUnavailable("this Python has no AF_BLUETOOTH support")
    try:
        sock = sock_mod.socket(family, sock_mod.SOCK_RAW, proto)
        sock.setsockopt(SOL_HCI, HCI_FILTER, _HCI_FILTER_EVENTS)
        sock.bind((index,))
        sock.settimeout(PROBE_TIMEOUT_S)
    except OSError as exc:
        raise RadioClockUnavailable("cannot open a raw HCI socket on hci%d: %s" % (index, exc)) from exc

    def _ask(opcode: int, params: bytes = b"") -> bytes | None:
        """Send, then read events until this opcode's reply arrives or the controller stays silent."""
        try:
            sock.send(_command(opcode, params))
        except OSError as exc:
            raise RadioClockUnavailable("cannot send on hci%d: %s" % (index, exc)) from exc
        deadline = PROBE_TIMEOUT_S
        while deadline > 0:
            try:
                buf = sock.recv(260)
            except OSError:
                return None                  # timeout: a wedged controller answers nothing at all
            if buf[:1] == bytes([HCI_EVENT_PKT]) and parse_command_complete(buf[1:], opcode) is not None:
                return buf[1:]
            deadline -= 0.1
        return None

    try:
        version = _ask(HCI_OPCODE_READ_LOCAL_VERSION)
        if version is None:
            return None, None, None          # no reply at all — the NO REPLY outcome
        params = version[2:]
        if len(params) < 10 or params[3] != HCI_STATUS_SUCCESS:
            return None, None, "Read Local Version returned status %s" % (
                params[3] if len(params) > 3 else "nothing",)
        manufacturer = struct.unpack_from("<H", params, 8)[0]
        if manufacturer != NORDIC_COMPANY_ID:
            return manufacturer, None, None  # not ours to enable; `decide` says so in its own words
        reply = _ask(VS_OPCODE_CONN_ANCHOR_POINT_REPORT, b"\x01")
        if reply is None:
            return manufacturer, None, None
        return manufacturer, parse_command_complete(reply, VS_OPCODE_CONN_ANCHOR_POINT_REPORT), None
    finally:
        try:
            sock.close()
        except OSError:  # deliberate: a probe that cannot close its socket has still answered
            pass


def decide(cfg: dict, sysfs: str = SYSFS_BLUETOOTH, probe=probe_controller):
    """Everything the collector must know before it opens a file → `(index, devices, why)`.

    `why` is None when the box can do this. Otherwise it is the ONE line that gets logged before the
    process exits 0 having written nothing — and it names WHICH of the ways this box cannot, because
    §0.3's outcomes are all the same exit and would otherwise be indistinguishable to a reader.
    """
    rc_cfg = (cfg or {}).get("radio_clock") or {}
    if not rc_cfg.get("enabled"):
        return None, [], "radio_clock.enabled is false — nothing to do"
    address = rc_cfg.get("adapter") or (cfg or {}).get("adapter")
    index = adapter_index(address, sysfs)
    if index is None:
        return None, [], "no controller with address %r is present" % (address,)
    devices = [d.get("address") for d in ((cfg or {}).get("devices") or [])
               if isinstance(d, dict) and d.get("address")]
    if not devices:
        return None, [], "no devices with addresses are configured — nothing could be recorded"
    try:
        manufacturer, status, error = probe(index)
    except RadioClockUnavailable as exc:
        return None, [], "radio clock unavailable on %s: %s" % (address, exc)
    if manufacturer != NORDIC_COMPANY_ID:
        return None, [], ("controller %s reports manufacturer %s, not Nordic (%d) — this is the common "
                          "case, not an error" % (address, manufacturer, NORDIC_COMPANY_ID))
    outcome = describe_enable(status, error)
    if outcome != ENABLE_ENABLED:
        return None, [], "anchor reports not enabled on %s: %s" % (address, outcome)
    return index, devices, None


def main(argv: list[str], sysfs: str = SYSFS_BLUETOOTH, probe=probe_controller,
         socket_module=None, packets=None) -> int:
    """`radioclock.py --config config.yaml` — the collector's entry point.

    🔴 EXIT 0 AND WRITE NOTHING is the answer to every way this box cannot do it. A non-Nordic
    controller is the COMMON case, not an error, and a unit that went `failed` for it would put a
    permanent red in `systemctl --failed` on most boxes for a capability they never had. The one line
    it logs first says WHICH way, because the outcomes are otherwise indistinguishable.
    """
    import argparse
    import logging

    ap = argparse.ArgumentParser(description="Nordic connection-event anchors as a second clock")
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args(argv)
    log = logging.getLogger("radioclock")

    try:
        import yaml  # type: ignore[import-untyped]
        with open(args.config, encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh)
    except (OSError, ValueError, ImportError) as exc:
        log.info("radio clock unavailable: cannot read %s (%s)", args.config, exc)
        return 0
    if not isinstance(cfg, dict):
        log.info("radio clock unavailable: %s is empty or not a YAML mapping", args.config)
        return 0

    index, devices, why = decide(cfg, sysfs, probe)
    if why is not None:
        log.info("%s", why)
        return 0

    root = cfg.get("root") or "/srv/tepna"
    rc_cfg = (cfg or {}).get("radio_clock") or {}
    address = rc_cfg.get("adapter") or cfg.get("adapter")
    collector = Collector(index, devices, adapter_address=address)
    if packets is None:                      # pragma: no cover — the socket path, exercised on the box
        packets = read_monitor(open_monitor_socket(socket_module))

    import datetime as _dt

    def open_writer(address: str) -> SidecarWriter:
        # The night directory is `writers.night_dir`'s, so the sidecar lands BESIDE the streams it
        # joins to rather than in a tree of its own.
        import writers
        night = writers.night_dir(root, _dt.datetime.now())
        stamp = _dt.datetime.now().strftime("%Y%m%dT%H%M%S")
        return SidecarWriter(os.path.join(night, sidecar_name(stamp, address)))

    def _rearm() -> None:
        """Re-send the enable after the adapter came up or was reset. Reported, never silent: the
        whole point is that a cleared flag is otherwise invisible, so a FAILED re-arm must not be."""
        # 🔴 RE-RESOLVE THE INDEX FROM THE ADDRESS. Never re-arm a remembered integer: `hciN` is
        # assigned at enumeration and reorders across precisely this event, so a cached index can send
        # a vendor command to a DIFFERENT adapter than the one we were pointed at — the neighbour
        # safety this function exists for, inverted.
        now_index = adapter_index(address, sysfs)
        if now_index is None:
            log.warning("radio clock: %s is not present after the reset — nothing to re-arm", address)
            return
        if now_index != collector.adapter_index:
            log.info("radio clock: %s moved hci%d → hci%d; following the address, not the index",
                     address, collector.adapter_index, now_index)
            collector.adapter_index = now_index
        try:
            _m, status, error = probe(now_index)
        except RadioClockUnavailable as exc:
            log.warning("radio clock: re-arm failed on the adapter that just came up: %s", exc)
            return
        outcome = describe_enable(status, error)
        if outcome == ENABLE_ENABLED:
            log.info("radio clock: anchors re-enabled after an adapter reset")
        else:
            log.warning("radio clock: anchors NOT re-enabled after an adapter reset: %s", outcome)

    got = run(packets, collector, open_writer, rearm=_rearm)
    log.info("radio clock: %d row(s) for %s, %d anchor(s) missed (discardable by design), "
             "%d offset sample(s), %d re-arm(s)", got["rows"], ", ".join(got["devices"]) or "no device",
             got["missed_anchors"], got["offset_samples"], got["rearmed"])
    return 0


if __name__ == "__main__":                   # pragma: no cover — exercised via main(argv)
    import sys
    raise SystemExit(main(sys.argv[1:]))
