# tepna-capture — link_rssi.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Read the CONNECTION RSSI of an already-connected BLE sensor — the RSSI side of the monitor's
# weak-signal warning (the stream-rate side lives in telemetry.py, needs no privileges).
#
# WHY A PRIVILEGED HELPER: on Linux/BlueZ, RSSI is only reported for *advertising* devices; a connected
# sensor doesn't advertise, so `bluetoothctl info` shows no RSSI (verified on our H10/Verity/O2Ring).
# The only way to read a live ACL link's RSSI is the HCI `Read RSSI` command, which needs CAP_NET_ADMIN.
# We mirror the clock helper's pattern: a tiny NOPASSWD-sudo shell script (`tepna-rssi.sh`), reached via
# `sudo -n`. Where the sudoers grant is absent (e.g. a dev desktop), every read returns None and the UI
# simply falls back to the stream-rate health — exactly the graceful degrade the hybrid design intends.
#
# sudoers (on the box):  tepna ALL=(root) NOPASSWD: /opt/tepna/capture-host/tepna-rssi.sh

from __future__ import annotations
import asyncio, os, re

_HELPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tepna-rssi.sh")
_HCI_CACHE: dict[str, str] = {}     # adapter BD_ADDR (upper) -> hciN


def parse_rssi(text: str) -> int | None:
    """Pull the signed dBm out of hcitool's `RSSI return value: -63` (or a bare number). None if absent."""
    if not text:
        return None
    m = re.search(r"RSSI\s+return\s+value:\s*(-?\d+)", text, re.I)
    if not m:
        m = re.search(r"(-?\d{1,3})", text.strip())      # helper may print just the number
    if not m:
        return None
    val = int(m.group(1))
    return val if -127 <= val <= 20 else None            # plausible BLE RSSI range; junk → None


def parse_hci_dev(text: str) -> dict[str, str]:
    """`hcitool dev` → {BD_ADDR_upper: hciN}. Lines look like `\\thci0\\tAC:A7:F1:29:9D:1D`."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        m = re.search(r"(hci\d+)\s+([0-9A-Fa-f:]{17})", line)
        if m:
            out[m.group(2).upper()] = m.group(1)
    return out


async def _run(cmd: list[str], timeout: float = 4.0) -> str | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        if proc.returncode != 0:
            return None
        return (out or b"").decode("utf-8", "replace")
    except (asyncio.TimeoutError, FileNotFoundError, OSError):
        return None


async def resolve_hci(adapter_mac: str | None, refresh: bool = False) -> str | None:
    """Map an adapter BD_ADDR to its hciN. None adapter → the first controller `hcitool dev` lists.

    `refresh=True` bypasses the cache — REQUIRED for anything that pins a connection, because hci
    indices RE-ENUMERATE: on 2026-07-18 a controller power-cycle swapped hci0/hci2, so a cached
    "hci0" silently pointed at a different radio. The lookup is one cheap subprocess."""
    key = (adapter_mac or "").upper()
    if not refresh and key in _HCI_CACHE:
        return _HCI_CACHE[key]
    devs = parse_hci_dev(await _run(["hcitool", "dev"]) or "")
    if not devs:
        return None
    hci = devs.get(key) if key else next(iter(devs.values()))
    if hci:
        _HCI_CACHE[key] = hci
    elif key in _HCI_CACHE:
        del _HCI_CACHE[key]          # configured adapter vanished — don't keep serving a stale index
    return hci


async def read_rssi(adapter_mac: str | None, dev_mac: str) -> int | None:
    """Connection RSSI (dBm) of a connected sensor, or None if it can't be read (no grant / not connected /
    helper missing). Never raises; safe to poll on a cadence."""
    if not dev_mac or not os.path.exists(_HELPER):
        return None
    hci = await resolve_hci(adapter_mac)
    if not hci:
        return None
    return parse_rssi(await _run(["sudo", "-n", _HELPER, hci, dev_mac]) or "")
