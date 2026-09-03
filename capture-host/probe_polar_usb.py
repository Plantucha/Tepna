#!/usr/bin/env python3
# tepna-capture — probe_polar_usb.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# PS-FTP RIDES POLAR'S USB HID PIPE — but the window is ONE REQUEST WIDE, so it can never pull a file.
# Read-only probe. Both halves of that sentence were measured on the real Verity Sense, 2026-08-02.
#
# WHY IT WAS WORTH CHASING. Every onboard-recording pull goes over BLE, and the repo has measured both
# of its costs: a Polar holds ONE BLE link, so pulling PAUSES live capture (POLAR-OFFLINE-DOWNLOAD
# §Known caveat), and "MTU stays 23 here", so transfers crawl at 20-byte air packets — the same brief
# calls that "slow for a large .REC". USB is a separate channel from the radio, so a pull over it could
# have run WHILE capture continued, at 64-byte reports instead of 20 — the single hardest constraint in
# POLAR-ONBOARD-BACKUP-2026-08-01.
#
# WHY IT IS NOT THE ANSWER. See "SETTLED" below: the device answers exactly ONE request per USB
# re-enumeration, and a multi-packet reply needs host ACKs, which are themselves requests. So the
# transport tops out at a single 64-byte report. It is a fast directory lister with real diagnostic
# value and no future as a pull path. Keep the file for that, and for the framing, which took two
# wrong turns to get right.
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
# ── INDEPENDENTLY CORROBORATED, and under a better licence (2026-08-02) ─────────────────────────────
#
# `rsc-dev/loophole` (MIT, Python) documents the SAME constants for the same wire format, and for an
# Apache-2.0 repo it is a better citation than v800_downloader (GPL-3.0) — protocol facts are not
# copyrightable and this implementation is our own, but pointing at MIT is belt-and-braces:
#     p.append(total + 8 << 2)              # our (len + 8) << 2 size/flags byte
#     p.append(len(path) + 4)               # our len + 4 RFC60 length
#     return [01, 05, packet_no] + [0]*61   # our build_ack, byte for byte
# It targets the A360 / **Loop** / M400 — and `0da4:0008` is literally the *Loop* product id this dock
# enumerates as. Its `init()` is only "open the HID device, find the output report": NO handshake and
# no magic sequence. So there is no init to reverse, which SUPPORTS the enumeration-window finding
# below rather than contradicting it. See `THIRD-PARTY.md` § Device protocols.
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
# ── SETTLED: the window is ONE REQUEST WIDE, so this can never be a pull path ───────────────────────
#
# Measured 2026-08-02 16:16 by bursting requests the instant the dock re-enumerated:
#
#     16:16:52 REPLUG
#       +0.09s OK /U/0/           -> DBDC.DAT(1) · USERID.BPB(70) · S/ · 20260621/
#       +0.30s -- /U/0/USERID.BPB       the 70-byte FILE: nothing
#       +0.51s -- /U/0/20260621/        a DIRECTORY: nothing
#       … 38 further requests, all nothing      => 1 successful request in this window
#
# Not a short TIME slice — exactly one request. It closed within 210 ms of the first reply, and request
# #2 fails whether it asks for a file or a directory, so it is not a file-vs-directory distinction.
# And because a multi-packet reply obliges the host to ACK every packet — and each ACK is itself a
# write — NOTHING LARGER THAN ONE 64-BYTE REPORT CAN EVER COMPLETE here. A "re-enumerate -> one GET"
# pull loop would need a physical re-enumeration per PACKET.
#
# So: USB is a fast lister for one small directory, and nothing more. Its remaining value is
# diagnostic — it reads the device tree in ~90 ms without touching the BLE link, and that is how the
# unpruned-walk bug (#710) was found. BLE is the only pull path; do not spend more on USB.
#
# ── AMENDED 2026-08-09: "a fast lister" WAS TOO GENEROUS — the one report is SILENTLY TRUNCATED ─────
#
# Two corrections to the paragraph above, both measured on the same unit.
#
# 1. **`tepna-usbreset.sh` IS deployed now** — the line below saying it is not was true in August's
#    first week and is not any more. `sudo -n /usr/local/lib/tepna/tepna-usbreset.sh 0da4:0008` on the
#    box returns `re-enumerated: 1-1 devnum 12 -> 13`, and the very next GET succeeds. So the window
#    is openable in software and every measurement here is now REPRODUCIBLE without a human at the
#    dock. It still cannot become a pull path (the one-request limit is unchanged), but "run it twice
#    and compare" is finally cheap.
#
# 2. **The single reply is CUT MID-RECORD and the device flags it END anyway.** Raw frame, 2026-08-09:
#
#        #1  id=0x11 size=62 flags=1 pktnum=0    <- flags==1 is END (see is_end above)
#        body: … 0a0d 0a09 "20260621/" 1000  0a0d 0a09 "20"
#                                                       ^^ an entry promising a 9-byte name, 2 delivered
#
#    The BLE mirror of the SAME device lists six entries in `/U/0/`; USB returned four plus that stub.
#    `20260802/` was corrupted into a file named `"20"` and `20260803/` — the directory holding 22
#    PPG/ACC/GYRO/MAG `.REC` recordings — did not appear at all. The old reader reported `ok: true`
#    and five entries, because a Python slice past the end of a buffer returns the short remainder
#    instead of raising. Fixed in `polar_psftp.TruncatedProtobuf` / `_parse_directory_ex`; this probe
#    now publishes `truncated` and leads its verdict with it.
#
#    ⚠️ So the FIRST listing this file ever recorded — line 78 above — was itself already truncated;
#    it just happened to be cut at a record boundary, which is why nobody noticed. **Never cite a USB
#    listing as the device's filesystem.** `polar_mirror.py` over BLE is the only complete answer, and
#    POLAR-VERITY-DEVICE-SURFACE §6 is fine precisely because it used the mirror (43 files, 37 dirs).
#    The two transports disagreed for a week in a direction only one of them could be wrong in, and
#    nothing compared them.
#
# ── HOW THAT WAS NARROWED (kept: each of these looks like "USB doesn't work") ────────────────────────
#
# Before the replug test, the listing had been obtained ONCE and everything afterwards got
# `11 04 00` — a 1-byte null payload — forever. Ruled OUT by measurement:
#
#   * NOT a desynced ACK counter — sweeping `01 05 <n>` across all 256 values unstuck nothing.
#   * NOT a stale handle — closing and reopening the node, with the 500 ms double-open ritual
#     v800_downloader performs, changes nothing.
#   * NOT a wrong path — `/`, `/U/`, `/U/0/`, `/SYS/` all behave identically.
#   * NOT a transient — 171 attempts at 1 Hz over 3 minutes returned 0 real replies.
#
# What was left standing — and then confirmed twice by replug — is that the device serves a window
# opened by USB RE-ENUMERATION and is charge-only outside it. The first success happened minutes after
# the dock re-enumerated (bus id 007 -> 009); the second and third came 0.09 s after a deliberate
# physical replug by the operator. `tepna-usbreset.sh` was written to open that window in software and
# was NOT DEPLOYED at the time, so every measurement in THIS paragraph came from a human at the dock.
# ⚠️ That is no longer true — see the 2026-08-09 amendment above: the helper is installed root-owned in
# `/usr/local/lib/tepna/` and covered by the box's sudoers grant, and it opens the window on demand.
#
# One hypothesis was never excluded, and no longer needs to be: that USB is refused while the BLE link
# is up. The 3-minute correlation run could not exercise it — `link_epoch` held at 5 and `connected`
# stayed true throughout, so no BLE-down sample was taken. It is moot now: the successful replug bursts
# happened WITH the BLE link up, so BLE state plainly does not gate the window.
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
            continue   # a node that vanished mid-walk (hotplug) or exposes no uevent is not a
                       # candidate; the caller reports finding nothing, which is the honest answer
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
            entries, truncated = ps._parse_directory_ex(bytes(body))
        except Exception:
            # A non-directory payload must be reported as raw hex, not raised: a crash here would
            # destroy the one piece of evidence that says what the device actually sent.
            entries, truncated = [], False
        return {"ok": bool(entries), "complete": bool(entries) and not truncated,
                "truncated": truncated, "idle": idle, "real": real, "bytes": len(body),
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
    # THE VERDICT LEADS WITH THE TRUNCATION, because `ok` is true in that case and reading `ok` alone
    # is exactly how a 4-of-6 listing was cited as the device's filesystem for a week.
    result["verdict"] = (
        f"⚠️ TRUNCATED — {len(result.get('entries') or [])} complete entries came back and the payload "
        "was cut mid-record. This listing is a SUBSET; the USB pipe caps a reply at one 64-byte report "
        "and flags it END regardless. Use the BLE mirror (polar_mirror.py) for a complete answer."
        if result.get("truncated") else
        "PS-FTP works over USB HID — polar_psftp's layer is reusable, only the framing changes"
        if result.get("ok") else result.get("error", "no answer"))
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
