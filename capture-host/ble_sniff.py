# tepna-capture — ble_sniff.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Read an nRF Sniffer pcap and say what BLE traffic it ACTUALLY contains.
#
# WHY THIS EXISTS. On 2026-09-04 six sniffer captures were analysed with throwaway inline Python,
# once per question, and the throwaway got it wrong twice in ways that mattered:
#
#   1. `tshark -r <file>` printed nothing and was read as "the capture is empty". It was a PERMISSION
#      error; the file held 10850 packets. A count of zero and a refusal to look are the same output.
#   2. A crude "is this packet type 5?" scan reported 21 CONNECT_INDs where a correct parse found 4,
#      because it matched the advertising access address anywhere in the record instead of anchoring
#      the header to it.
#
# Both are this repo's dominant defect — a check that ran, examined nothing (or the wrong thing) and
# reported success. So the parse lives here, with tests, instead of being retyped per question.
#
# And then this module committed the same defect a third time (VIGIL-BLUETOOTH-ADAPTERS-2026-09-05
# F1/F2, measured on the box):
#
#   3. It never read the nRF pseudo-header's CRC flag, so 14 % of the overnight capture's records —
#      bit-flip noise — entered every counter. It reported 262 CONNECT_INDs; tshark with crcok==1
#      found 12. And it reported no time span, so a capture whose sniffer died 2 h into a 7.4 h
#      window read as "the night" by file mtime. Both are now first-class: CRC-bad records are
#      counted and EXCLUDED (stated in the report, even at zero), and the report opens with the
#      first->last packet span in UTC.
#
# WHAT IT ANSWERS. The question a sniffer capture exists to answer is almost never "how many packets"
# — it is "did we capture a CONNECTION, i.e. is there GATT in here?" A BLE sniffer can only follow a
# link if it caught the CONNECT_IND that opened it, so a capture can be enormous and still contain
# nothing but advertising. `summarise()` reports the data-channel count FIRST and `format_report()`
# states it as an explicit verdict with its reason, never as a silent absence.

from __future__ import annotations

import struct
import sys
from collections import Counter
from datetime import datetime, timezone

#: Advertising-channel access address (BLE core spec) — constant on every advertising PDU.
ADV_ACCESS_ADDRESS = bytes.fromhex("d6be898e")

_PCAP_GLOBAL_HEADER_LEN = 24
_PCAP_RECORD_HEADER_LEN = 16
_ADDR_LEN = 6

#: Advertising PDU types, low nibble of the header's first octet (BLE 5.x).
PDU_NAMES = {
    0x0: "ADV_IND",
    0x1: "ADV_DIRECT_IND",
    0x2: "ADV_NONCONN_IND",
    0x3: "SCAN_REQ",
    0x4: "SCAN_RSP",
    0x5: "CONNECT_IND",
    0x6: "ADV_SCAN_IND",
    0x7: "ADV_EXT_IND",
    0x8: "AUX_CONNECT_RSP",
}

CONNECT_IND = 0x5


class SniffError(Exception):
    """The capture cannot be read as a pcap. Raised rather than returning a short count.

    A truncated file that yields 900 of its 1000 packets is indistinguishable from a 900-packet
    file unless the shortfall is raised, and 'fewer packets than expected' is precisely the
    conclusion a sniffer analysis must never reach silently.
    """


def mac(raw: bytes) -> str:
    """Wire order (little-endian) -> the printed MAC. `bd0b3a15cd04` -> `04:CD:15:3A:0B:BD`."""
    return ":".join("%02X" % b for b in reversed(raw))


def iter_records(data: bytes):
    """Yield each record as `(ts, payload)` — ts in epoch seconds (float). Raises SniffError on a
    truncated or headerless file."""
    if len(data) < _PCAP_GLOBAL_HEADER_LEN:
        raise SniffError("not a pcap: %d bytes, need at least %d for the global header"
                         % (len(data), _PCAP_GLOBAL_HEADER_LEN))
    off = _PCAP_GLOBAL_HEADER_LEN
    while off < len(data):
        if off + _PCAP_RECORD_HEADER_LEN > len(data):
            raise SniffError("truncated record header at byte %d" % off)
        ts_sec, ts_usec, caplen = struct.unpack_from("<III", data, off)
        off += _PCAP_RECORD_HEADER_LEN
        if off + caplen > len(data):
            raise SniffError("truncated packet at byte %d: header claims %d bytes, %d remain"
                             % (off, caplen, len(data) - off))
        yield ts_sec + ts_usec / 1e6, data[off:off + caplen]
        off += caplen


def iter_packets(data: bytes):
    """Yield each record's payload bytes (the pre-span contract; `iter_records` adds the time)."""
    for _, pkt in iter_records(data):
        yield pkt


def crc_ok(pkt: bytes) -> bool | None:
    """The nRF pseudo-header's CRC verdict: True/False, or None when the record does not parse as
    an nRF Sniffer v2 EVENT record and therefore carries no CRC claim to read.

    The layout was derived from a real capture and verified against tshark on all 20,824 of its
    records (the crc-bad count matched exactly): a 7-byte prefix — board id, LE16 payload length,
    protocol version 2, LE16 packet counter, packet id 6 (EVENT) — then a payload header whose
    second octet is the flags, bit0 = CRC-ok. All three header facts are checked, payload length
    included, so a foreign pcap whose bytes merely resemble the prefix keeps its records: a
    misread flags octet must discard nothing (the near-miss is tested per field)."""
    if len(pkt) < 11 or pkt[3] != 2 or pkt[6] != 6:
        return None
    if struct.unpack_from("<H", pkt, 1)[0] != len(pkt) - 7:
        return None
    return bool(pkt[8] & 0x01)


def summarise(data: bytes, follow: str | None = None) -> dict:
    """Classify every packet. `follow` is a MAC to single out (the device we meant to follow).

    A packet carrying the advertising access address is an advertising-channel PDU; anything else
    was captured on a data channel, which is where GATT lives. That is the whole discriminator, and
    it is why `data_channel` is the number to read first.
    """
    total = adv = data_channel = crc_bad = 0
    first_ts: float | None = None
    last_ts: float | None = None
    pdus: Counter = Counter()
    advertisers: Counter = Counter()
    connects: list[tuple[str, str]] = []
    want = follow.upper() if follow else None

    for ts, pkt in iter_records(data):
        total += 1
        # min/max, not first/last-seen: the span exists to expose a capture that died early, and a
        # writer that flushed out of order must not be able to shrink it. CRC-bad records still
        # extend it — a corrupted record is still a record in time.
        first_ts = ts if first_ts is None else min(first_ts, ts)
        last_ts = ts if last_ts is None else max(last_ts, ts)
        if crc_ok(pkt) is False:
            # A failed CRC means the BYTES are noise — excluding the record from every content
            # counter is the fix for the 262-vs-12 CONNECT_IND over-count. `None` (no nRF header)
            # is not `False`: a record with no CRC claim is counted, never guessed at.
            crc_bad += 1
            continue
        at = pkt.find(ADV_ACCESS_ADDRESS)
        if at < 0:
            data_channel += 1
            continue
        adv += 1
        # Only the PDU-type octet is read, so only its presence is required. Slicing the full
        # 2-octet header and checking `len(...) < 2` looked more careful and was not: the length
        # octet was never used, so a bound over it asserted nothing.
        if at + 4 >= len(pkt):
            continue
        pdu = pkt[at + 4] & 0x0F
        pdus[pdu] += 1
        body = pkt[at + 6:]
        if pdu == CONNECT_IND:
            if len(body) >= 2 * _ADDR_LEN:
                connects.append((mac(body[:_ADDR_LEN]),
                                 mac(body[_ADDR_LEN:2 * _ADDR_LEN])))
        elif len(body) >= _ADDR_LEN:
            advertisers[mac(body[:_ADDR_LEN])] += 1

    followed = sum(1 for _, advertiser in connects if advertiser == want) if want else 0
    return {
        "total": total,
        "crc_bad": crc_bad,
        "first_ts": first_ts,
        "last_ts": last_ts,
        "duration_s": None if first_ts is None or last_ts is None else last_ts - first_ts,
        "adv_channel": adv,
        "data_channel": data_channel,
        "pdus": dict(pdus),
        "advertisers": dict(advertisers),
        "connects": connects,
        "follow": want,
        "follow_adv_packets": advertisers.get(want, 0) if want else 0,
        "follow_connects": followed,
    }


def _verdict(s: dict) -> list[str]:
    """The headline. Says what is absent, and why, rather than omitting it."""
    if s["data_channel"]:
        return ["VERDICT: %d data-channel packet(s) — a connection WAS followed; GATT is present."
                % s["data_channel"]]
    lines = ["VERDICT: 0 data-channel packets — NO connection was followed, so there is no GATT here."]
    if s["follow"]:
        if s["follow_connects"]:
            lines.append("  %d CONNECT_IND(s) targeted %s but no data channel followed — the sniffer"
                         % (s["follow_connects"], s["follow"]))
            lines.append("  saw the link open and did not track it (wrong PHY, or it lost the hop).")
        elif s["follow_adv_packets"]:
            lines.append("  %s advertised %d time(s) and nothing connected to it during this capture."
                         % (s["follow"], s["follow_adv_packets"]))
            lines.append("  A sniffer can only follow a link it sees OPEN: capture across a fresh connect.")
        else:
            lines.append("  %s was never seen advertising — wrong address, out of range, or already"
                         % s["follow"])
            lines.append("  connected (a connected peripheral stops advertising).")
    return lines


def _utc(ts: float) -> str:
    """Epoch seconds -> `2026-09-05T13:13:43Z`. UTC always (Clock Contract: display via UTC), so
    the same capture prints the same span on any machine."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def format_report(s: dict) -> str:
    out = list(_verdict(s))
    out.append("")
    if s["duration_s"] is None:
        out.append("capture span      : no packets")
    else:
        # The line that would have exposed F2: a 7.4 h-by-mtime file whose packets span 2 h.
        out.append("capture span      : %.1f s (%s -> %s)"
                   % (s["duration_s"], _utc(s["first_ts"]), _utc(s["last_ts"])))
    out.append("packets           : %d" % s["total"])
    # Stated even at zero: an absent line and a zero are different facts (CLAUDE.md §4b).
    out.append("  crc-bad excluded: %d" % s["crc_bad"])
    out.append("  advertising-ch  : %d" % s["adv_channel"])
    out.append("  data-channel    : %d" % s["data_channel"])
    if s["pdus"]:
        out.append("PDU types:")
        for pdu, n in sorted(s["pdus"].items(), key=lambda kv: -kv[1]):
            out.append("  %-16s %d" % (PDU_NAMES.get(pdu, "reserved-0x%X" % pdu), n))
    out.append("CONNECT_IND: %d" % len(s["connects"]))
    for initiator, advertiser in s["connects"]:
        star = "  <-- followed device" if advertiser == s["follow"] else ""
        out.append("  %s -> %s%s" % (initiator, advertiser, star))
    if s["advertisers"]:
        out.append("top advertisers:")
        for addr, n in sorted(s["advertisers"].items(), key=lambda kv: -kv[1])[:8]:
            star = "  <-- followed device" if addr == s["follow"] else ""
            out.append("  %s %d%s" % (addr, n, star))
    return "\n".join(out)


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: ble_sniff.py <capture.pcap> [MAC-to-follow]", file=sys.stderr)
        return 2
    follow = argv[1] if len(argv) > 1 else None
    try:
        with open(argv[0], "rb") as fh:
            data = fh.read()
        print(format_report(summarise(data, follow)))
    except (OSError, SniffError) as exc:
        # Loudly, and named. A capture that could not be READ must never print like an empty one.
        print("ble_sniff: cannot read %s: %s" % (argv[0], exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv[1:]))
