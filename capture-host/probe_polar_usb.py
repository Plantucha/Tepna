#!/usr/bin/env python3
# tepna-capture — probe_polar_usb.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# PS-FTP RIDES POLAR'S USB HID PIPE. Proven on the real Verity Sense, 2026-08-02 — a read-only probe.
#
# WHY THIS MATTERS. Every onboard-recording pull today goes over BLE, and the repo has measured both of
# its costs: a Polar holds ONE BLE link, so pulling PAUSES live capture (POLAR-OFFLINE-DOWNLOAD §Known
# caveat), and "MTU stays 23 here", so transfers crawl at 20-byte air packets — the same brief calls
# that "slow for a large .REC". USB sidesteps both: it is a separate channel from the radio, so a pull
# could run WHILE capture continues, at 64-byte reports instead of 20. That is the single hardest
# constraint in POLAR-ONBOARD-BACKUP-2026-08-01, which is why this was worth chasing to the end.
#
# ── WHAT IS MEASURED AND CERTAIN ────────────────────────────────────────────────────────────────────
#
#   * The dock enumerates as `0da4:0008 Polar Electro Oy`, HID_NAME "Polar INW4J", HID_UNIQ = the
#     device serial (0C301E3F) — the sensor itself, not a charger. Interface class 3 (HID), two 64-byte
#     interrupt endpoints, `0x01 OUT` / `0x81 IN`, bInterval 1 — the exact layout v800_downloader drives.
#   * The pipe is a strict PING-PONG: every host write draws exactly ONE device reply. Measured by
#     contrast — a request with no follow-up ACK yields 1 packet then silence for 8 s; ACKing every
#     reply yields 4000 packets in the same 8 s.
#   * **A real PS-FTP directory listing came back over USB** for `/U/0/`:
#         0a0c 0a08 "DBDC.DAT"   1001     entry{ name:"DBDC.DAT",   size:1  }
#         0a0e 0a0a "USERID.BPB" 1046     entry{ name:"USERID.BPB", size:70 }
#         0a06 0a02 "S/"         1000     entry{ name:"S/",         dir    }
#         0a0d 0a09 "20260621/"  1000     entry{ name:"20260621/",  dir    }
#     A date-named session directory, served over the HID pipe. The transport question is ANSWERED, and
#     `polar_psftp`'s protobuf layer parses the payload unchanged — only the framing differs.
#
# ── THE TWO MISREADINGS THAT PRODUCED A FALSE "DEAD END" (recorded so nobody repeats them) ──────────
#
# An earlier revision of this file concluded USB served no files and told the reader not to spend more
# on it. That conclusion was WRONG, and both causes were off-by-one details in v800usb.cpp:
#
#   1. **The flag bit is inverted from the BLE meaning.** `is_end()` (v800usb.cpp:466) is
#      `(packet[1] & 0x03) == 1`. So flags==1 is END and flags==0 is MORE. Every reply here is
#      `11 04 ..` — flags 0 — which was read as a terminator ("success, empty payload") when it
#      actually means *"more follows, ACK me"*. A protocol that is politely asking for an ACK looks
#      exactly like a protocol that has nothing to say, if you invert one bit.
#   2. **The RFC60 length is `len + 4`, not `len`.** `generate_request()` (v800usb.cpp:439) writes
#      `packet[3] = request.length() + 4`. A bare length is accepted by the pipe and simply answered
#      with nothing, so the mistake is silent.
#
# The framing below is therefore NOT the BLE RFC76 one. Per request:
#     [0]    0x01                HID report id
#     [1]    (len + 8) << 2      size in the upper 6 bits, flags in the low 2
#     [2]    0x00                packet number
#     [3..4] len + 4             RFC60 length, little-endian
#     [5..]  08 00 12 <len> <path>   — the SAME PS-FTP protobuf polar_psftp already builds
# and the host must ACK each non-final reply with `01 05 <packet_num>`, incrementing and wrapping at
# 0xFF. On the reply, the FIRST packet carries 5 bytes of header and later ones carry 3.
#
# ── WHAT IS STILL OPEN: the server does not answer on demand ────────────────────────────────────────
#
# The listing above was obtained ONCE and has not reproduced since. Everything tried afterwards gets
# `11 04 00` — a 1-byte null payload — forever. Ruled OUT by measurement:
#
#   * NOT a desynced ACK counter — sweeping `01 05 <n>` across all 256 values unstuck nothing.
#   * NOT a stale handle — closing and reopening the node, with the 500 ms double-open ritual
#     v800_downloader performs, changes nothing.
#   * NOT a wrong path — `/`, `/U/`, `/U/0/`, `/SYS/` all behave identically.
#   * NOT a transient — 171 attempts at 1 Hz over 3 minutes returned 0 real replies.
#
# The surviving hypothesis, which fits every observation: the device serves a **window after USB
# re-enumeration** and is charge-only outside it. The successful run happened minutes after the dock
# re-enumerated (bus id 007 -> 009); nothing has re-enumerated since, and nothing has worked since.
# Testing it needs a re-enumeration, i.e. a physical replug or root (`authorized` toggle / usbreset).
#
# A second hypothesis is NOT yet excluded: that USB is refused while the BLE link is up. The 3-minute
# correlation run could not exercise it — the daemon's `link_epoch` held at 5 and `connected` stayed
# true throughout, so no BLE-down sample was ever taken. It does establish that with a STABLE BLE
# link, USB never serves.
#
# ⚠️ DO NOT SWEEP OPCODES. An exploratory sweep of byte1 across 0x00..0xFF caused the device to
# RE-ENUMERATE mid-run (and left the node in EIO). `polar_psftp._ALLOWED_QUERIES` exists because a
# wrong query id "would do something far worse than set a clock"; that hazard is identical on this
# transport, on hardware that may be nowhere near anyone who could recover it. Send GET and ACK only.
#
# ⚠️ READ-ONLY BY CONSTRUCTION. This sends GET and ACK, nothing else. It never writes to the device
# filesystem, never starts or stops a recording, and never touches firmware.
#
#   python probe_polar_usb.py --path /U/0/
#
# udev rule needed first (the node is root:root 0600 out of the box):
#   SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0da4", ATTRS{idProduct}=="0008", MODE="0660", GROUP="vigil"
#
# For the raw-libusb variant (bypassing hidraw, as v800_downloader does) a second rule is needed,
# because libusb writes to the bus node rather than the HID node:
#   SUBSYSTEM=="usb", ATTR{idVendor}=="0da4", ATTR{idProduct}=="0008", MODE="0660", GROUP="plugdev"

from __future__ import annotations

import argparse
import glob
import json
import os
import select
import time

import polar_psftp as ps

OUT_REPORT_ID = 0x01          # host -> device, per the decoded descriptor
IN_REPORT_ID = 0x11           # device -> host
REPORT_BYTES = 64             # 1 report id + 63 payload
IDLE_SIZE = 1                 # a size<=1 reply is the device's filler, not an answer

_HDR_FIRST = 5                # report id + size/flags + packet num + 2 RFC60 length bytes
_HDR_REST = 3                 # report id + size/flags + packet num


def find_device(vid: str = "0da4", pid: str = "0008") -> tuple[str, str] | None:
    """(hidraw path, HID_UNIQ) for the first matching Polar, or None.

    Matches on the USB ids from the uevent rather than a fixed /dev/hidraw0 — the node number moves
    with enumeration order, and binding to it is how a probe silently talks to the wrong device."""
    for node in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
        try:
            ue = open(os.path.join(node, "device", "uevent"), encoding="utf-8").read()
        except OSError:
            continue
        hid_id = next((l.split("=", 1)[1] for l in ue.splitlines() if l.startswith("HID_ID=")), "")
        if vid.lower() in hid_id.lower() and pid.lower() in hid_id.lower():
            uniq = next((l.split("=", 1)[1] for l in ue.splitlines() if l.startswith("HID_UNIQ=")), "")
            return f"/dev/{os.path.basename(node)}", uniq
    return None


def build_request(path: str) -> bytes:
    """One 64-byte OUTPUT report carrying a PS-FTP GET, in Polar's USB framing.

    The two constants here are the whole reason the first attempt failed: the length field is
    `len + 4` and the size/flags byte is `(len + 8) << 2` (v800usb.cpp:439). A bare length is accepted
    and answered with nothing, so a wrong value looks exactly like an unsupported transport."""
    p = path.encode()
    head = bytes([OUT_REPORT_ID, ((len(p) + 8) << 2) & 0xFF, 0x00, len(p) + 4, 0x00])
    return to_report(head + ps._encode_operation(ps.GET, path))


def build_ack(packet_num: int) -> bytes:
    """`01 05 <n>` — the host's obligation after every non-final reply (v800usb.cpp:455)."""
    return to_report(bytes([OUT_REPORT_ID, 0x05, packet_num & 0xFF]))


def next_ack(packet_num: int) -> int:
    """Packet numbers wrap at 0xFF rather than overflowing the byte."""
    return 0 if packet_num == 0xFF else packet_num + 1


def to_report(payload: bytes) -> bytes:
    """Zero-pad to the fixed report size — a HID report is fixed-length, and the device must be told
    how much of it is real via the size field rather than by the transfer length."""
    return bytes(payload) + b"\x00" * (REPORT_BYTES - len(payload))


def reply_size(rep: bytes) -> int:
    """Payload byte count, from the upper 6 bits of the size/flags byte."""
    return rep[1] >> 2


def reply_is_end(rep: bytes) -> bool:
    """flags == 1 means END. Note this is INVERTED from the BLE RFC76 reading — see the header."""
    return (rep[1] & 0x03) == 1


def reply_body(rep: bytes, initial: bool) -> bytes:
    """The first reply packet carries two extra leading bytes the later ones do not."""
    off = _HDR_FIRST if initial else _HDR_REST
    return rep[off:off + reply_size(rep)]


def fetch(dev: str, path: str, window: float = 8.0, max_packets: int = 400) -> dict:
    """Run one GET to completion, ACKing as the protocol requires. Returns a result dict.

    `idle` counts 1-byte filler replies. A run that is all idle is the "server not answering" state
    documented in the header, and is reported as such rather than as a transport failure — the
    difference matters, because one is a dead protocol and the other is a closed window."""
    try:
        fd = os.open(dev, os.O_RDWR | os.O_NONBLOCK)
    except PermissionError:
        return {"ok": False, "error": "permission denied — install the udev rule"}
    except OSError as e:
        return {"ok": False, "error": f"cannot open {dev}: {e.strerror}"}
    try:
        while select.select([fd], [], [], 0)[0]:            # drain anything stale
            os.read(fd, REPORT_BYTES)
        os.write(fd, build_request(path))
        body, pkt_num, initial, idle, real = bytearray(), 0, True, 0, 0
        deadline = time.monotonic() + window
        while real + idle < max_packets and time.monotonic() < deadline:
            r, _, _ = select.select([fd], [], [], max(0.0, deadline - time.monotonic()))
            if not r:
                break
            try:
                rep = os.read(fd, REPORT_BYTES)
            except OSError as e:
                return {"ok": False, "error": f"read failed: {e.strerror}", "idle": idle}
            if len(rep) < 2:
                continue
            if reply_size(rep) <= IDLE_SIZE and not reply_is_end(rep):
                idle += 1
                os.write(fd, build_ack(pkt_num))
                pkt_num = next_ack(pkt_num)
                continue
            real += 1
            body += reply_body(rep, initial)
            initial = False
            if reply_is_end(rep):
                break
            os.write(fd, build_ack(pkt_num))
            pkt_num = next_ack(pkt_num)
        if not real:
            return {"ok": False, "idle": idle, "real": 0,
                    "error": "device answered only 1-byte filler — the sync window is closed; "
                             "replug the dock (or re-enumerate as root) and retry immediately"}
        try:
            entries = ps._parse_directory(bytes(body))
        except Exception:
            # A truncated or non-directory payload must be reported as raw hex, not raised: the
            # protobuf reader indexes past the end on garbage, and a crash here would destroy the
            # one piece of evidence that says what the device actually sent.
            entries = []
        return {"ok": bool(entries), "idle": idle, "real": real, "bytes": len(body),
                "entries": entries[:40] if entries else None,
                "head": None if entries else bytes(body)[:48].hex()}
    finally:
        os.close(fd)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="PS-FTP over Polar's USB HID pipe (read-only)")
    ap.add_argument("--path", default="/U/0/", help="PS-FTP path to GET (a directory lists)")
    ap.add_argument("--device", default=None, help="hidraw node; default = autodetect by USB id")
    ap.add_argument("--window", type=float, default=8.0, help="seconds to wait for the reply")
    a = ap.parse_args(argv)

    found = (a.device, "?") if a.device else find_device()
    if not found:
        print(json.dumps({"error": "no Polar hidraw device found — is the dock on USB?"}, indent=2))
        return 1
    dev, uniq = found
    result = {"device": dev, "serial": uniq, "path": a.path}
    result.update(fetch(dev, a.path, window=a.window))
    result["verdict"] = ("PS-FTP works over USB HID — polar_psftp's layer is reusable, only the "
                         "framing changes" if result.get("ok") else result.get("error", "no answer"))
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
