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
# WHAT IT ANSWERS. The question a sniffer capture exists to answer is almost never "how many packets"
# — it is "did we capture a CONNECTION, i.e. is there GATT in here?" A BLE sniffer can only follow a
# link if it caught the CONNECT_IND that opened it, so a capture can be enormous and still contain
# nothing but advertising. `summarise()` reports the data-channel count FIRST and `format_report()`
# states it as an explicit verdict with its reason, never as a silent absence.

from __future__ import annotations

import struct
import sys
from collections import Counter

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


def iter_packets(data: bytes):
    """Yield each record's payload bytes. Raises SniffError on a truncated or headerless file."""
    if len(data) < _PCAP_GLOBAL_HEADER_LEN:
        raise SniffError("not a pcap: %d bytes, need at least %d for the global header"
                         % (len(data), _PCAP_GLOBAL_HEADER_LEN))
    off = _PCAP_GLOBAL_HEADER_LEN
    while off < len(data):
        if off + _PCAP_RECORD_HEADER_LEN > len(data):
            raise SniffError("truncated record header at byte %d" % off)
        caplen = struct.unpack_from("<I", data, off + 8)[0]
        off += _PCAP_RECORD_HEADER_LEN
        if off + caplen > len(data):
            raise SniffError("truncated packet at byte %d: header claims %d bytes, %d remain"
                             % (off, caplen, len(data) - off))
        yield data[off:off + caplen]
        off += caplen


def summarise(data: bytes, follow: str | None = None) -> dict:
    """Classify every packet. `follow` is a MAC to single out (the device we meant to follow).

    A packet carrying the advertising access address is an advertising-channel PDU; anything else
    was captured on a data channel, which is where GATT lives. That is the whole discriminator, and
    it is why `data_channel` is the number to read first.
    """
    total = adv = data_channel = 0
    pdus: Counter = Counter()
    advertisers: Counter = Counter()
    connects: list[tuple[str, str]] = []
    want = follow.upper() if follow else None

    for pkt in iter_packets(data):
        total += 1
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


def format_report(s: dict) -> str:
    out = list(_verdict(s))
    out.append("")
    out.append("packets           : %d" % s["total"])
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
