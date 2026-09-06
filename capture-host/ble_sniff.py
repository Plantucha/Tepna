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
#
# NIGHTLY AUDIT (VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05 D3). `tepna-sniff.sh` records an
# N-minute all-advertising capture every night and hands it here with `--expect-seconds`, `--config`
# and `--adapters`. `audit()` then answers the two questions D1 answered once by hand: did the sniffer
# actually run the window (F2's 2-h-of-7.4-h capture would fail it), and did any initiator that is
# NOT one of our adapters open a link to one of OUR devices (C1's impostor, measured on air rather
# than inferred). A failed audit exits 3 so the oneshot unit lands in `systemctl --failed` — the one
# place a box nobody logs into makes a finding visible.

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


#: A capture shorter than this fraction of the requested window is a sniffer that died early.
#: 0.8, not 0.95: the extcap spends its first seconds on firmware handshake + the SIGINT teardown
#: closes the file a little before the timeout, so a healthy 600 s run spans ~590 s; 2 h of 7.4 h
#: (F2) is 0.27. Anything between is a real shortfall worth a red.
WINDOW_MIN_FRACTION = 0.8


def _macs(csv: str | None) -> set[str]:
    return {m.strip().upper() for m in (csv or "").split(",") if m.strip()}


def device_addresses(config_path: str) -> set[str]:
    """Every `address:` under `devices:` in a capture-host config.yaml, upper-cased. Only the
    addresses: a config carries bond keys and passwords the audit has no business reading twice."""
    import yaml  # noqa: PLC0415 — the standalone report path must not need yaml
    with open(config_path, encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    out: set[str] = set()
    for dev in cfg.get("devices") or []:
        addr = (dev or {}).get("address")
        if addr:
            out.add(str(addr).strip().upper())
    return out


def audit(s: dict, expect_s: float | None, ours: set[str], adapters: set[str],
          ran_full_window: bool | None = None) -> dict:
    """The nightly verdict, pure. `ours` = our devices' MACs, `adapters` = our own radios' MACs.

    A CONNECT_IND to one of OUR devices from an initiator that is not one of OUR adapters is a
    foreign connect — the impostor/attacker shape C1 cannot see from the daemon's side. With an
    EMPTY adapter list every connect to our devices is unattributable and therefore reported as
    foreign: the honest reading of "we could not check", never a silent pass.

    `ran_full_window` says whether the CAPTURE PROCESS survived to the end of its window — the caller
    knows, because `timeout` exits 124 exactly when it ended the run on schedule. It changes no
    verdict (a short span fails either way) but it decides which FAULT the operator is sent after,
    and the two are nothing alike:

      * the process ended EARLY ⇒ "the sniffer died N s early": a crash, a LockedException, an unplug.
      * the process ran the FULL window ⇒ **it fell behind real time.** Measured on vigil 2026-09-06:
        the Nordic extcap pegs one core at 101 %, processes air at ~0.4x real time, and its newest
        packet advanced 44 s in 110 s of wall clock. A 900 s window then yields ~360 s of packets and
        the missing 60 % is ALWAYS THE END — a systematic blind spot, not sampling. An
        un-instrumented sniffer in busy RF captures the first 40 % of every window and reports
        nothing wrong; turning that into a red is the whole reason this check exists.

    Calling the second case "died early" names a fault that did not happen and hides one that did, so
    the discriminator is passed in rather than guessed from the bytes."""
    problems: list[str] = []
    span = s["duration_s"]
    window = None
    if expect_s is not None:
        if span is None:
            window = "no packets at all in a %.0f s window" % expect_s
        elif span < WINDOW_MIN_FRACTION * expect_s:
            window = ("captured %.1f s of %.0f s expected — %s"
                      % (span, expect_s,
                         ("the capture ran the whole window, so the sniffer FELL BEHIND real time; "
                          "the missing %.0f s is the END of the window" % (expect_s - span))
                         if ran_full_window else
                         ("the sniffer died %.0f s early" % (expect_s - span))))
        if window:
            problems.append("window: " + window)
    foreign = [(i, a) for i, a in s["connects"] if a in ours and i not in adapters]
    if foreign:
        problems.append("%d foreign connect(s) to our devices" % len(foreign))
    heard = {a for a in ours if a in s["advertisers"] or any(adv == a for _, adv in s["connects"])}
    # COVERAGE, published whether or not the window check passed. A clean foreign-connect verdict
    # means far less at cover=0.5 than at cover=1.0, and nothing else in this output lets the reader
    # infer which they are holding (measured on vigil 2026-09-06: 0.41 unfiltered, 0.51 with an
    # RSSI filter — this rig's normal state, not an incident).
    cover = (span / expect_s) if (expect_s and span is not None) else None
    return {
        "expect_s": expect_s,
        "cover": cover,
        "window": window,
        "foreign": foreign,
        "ours": sorted(ours),
        "adapters": sorted(adapters),
        "heard": sorted(heard),
        "problems": problems,
        "ok": not problems,
    }


def format_audit(a: dict) -> str:
    """Appended below the report. Every line states a count, even at zero (CLAUDE.md §4b)."""
    out = ["", "AIR AUDIT: " + ("OK" if a["ok"] else "FAILED — " + "; ".join(a["problems"]))]
    if a["expect_s"] is not None:
        # The fraction is stated on EVERY run, passing or failing — same rule as `foreign connects: 0`.
        # A verdict of "no foreign connects" is worth what its coverage is worth, and a reader who is
        # not told the coverage will read a half-captured window as the night.
        out.append("  coverage        : %s of %.0f s requested"
                   % ("%.2f (%.1f s)" % (a["cover"], a["cover"] * a["expect_s"])
                      if a["cover"] is not None else "no packets at all",
                      a["expect_s"]))
        out.append("  window          : %s" % (a["window"] or "span covers the requested window"))
    out.append("  our devices     : %d configured, %d heard on air" % (len(a["ours"]), len(a["heard"])))
    for m in a["heard"]:
        out.append("    heard %s" % m)
    if not a["adapters"]:
        out.append("  our adapters    : NONE listed — every connect to our devices counts as foreign")
    else:
        out.append("  our adapters    : %s" % ", ".join(a["adapters"]))
    out.append("  foreign connects: %d" % len(a["foreign"]))
    for initiator, advertiser in a["foreign"]:
        out.append("    %s -> %s  <-- NOT one of our adapters" % (initiator, advertiser))
    return "\n".join(out)


def _parse_argv(argv: list[str]) -> tuple[str, str | None, float | None, set[str], set[str],
                                          bool] | None:
    """`<pcap> [MAC] [--expect-seconds N] [--config path] [--ours A,B] [--adapters A,B]
    [--ran-full-window]`.
    Hand-rolled so the two-positional form the 2026-09-04 workflow uses stays byte-identical."""
    pos: list[str] = []
    expect: float | None = None
    ours: set[str] = set()
    adapters: set[str] = set()
    ran_full = False
    it = iter(argv)
    for arg in it:
        if arg == "--expect-seconds":
            expect = float(next(it))
        elif arg == "--config":
            ours |= device_addresses(next(it))
        elif arg == "--ours":
            ours |= _macs(next(it))
        elif arg == "--adapters":
            adapters |= _macs(next(it))
        elif arg == "--ran-full-window":
            # The CALLER knows this and the pcap does not: `timeout` exits 124 when it ended the
            # capture on schedule. Without it a CPU-starved sniffer is reported as one that crashed.
            ran_full = True
        else:
            pos.append(arg)
    if not pos or len(pos) > 2:
        return None
    return pos[0], (pos[1] if len(pos) > 1 else None), expect, ours, adapters, ran_full


def main(argv: list[str]) -> int:
    try:
        parsed = _parse_argv(argv)
    except (StopIteration, ValueError, OSError) as exc:
        print("ble_sniff: bad arguments: %r" % (exc,), file=sys.stderr)
        return 2
    if parsed is None:
        print("usage: ble_sniff.py <capture.pcap> [MAC-to-follow] [--expect-seconds N] "
              "[--config config.yaml] [--ours A,B] [--adapters A,B] [--ran-full-window]",
              file=sys.stderr)
        return 2
    path, follow, expect, ours, adapters, ran_full = parsed
    try:
        with open(path, "rb") as fh:
            data = fh.read()
        s = summarise(data, follow)
    except (OSError, SniffError) as exc:
        # Loudly, and named. A capture that could not be READ must never print like an empty one.
        print("ble_sniff: cannot read %s: %s" % (path, exc), file=sys.stderr)
        return 1
    print(format_report(s))
    if expect is None and not ours and not adapters:
        return 0
    a = audit(s, expect, ours, adapters, ran_full_window=ran_full)
    print(format_audit(a))
    return 0 if a["ok"] else 3


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv[1:]))
