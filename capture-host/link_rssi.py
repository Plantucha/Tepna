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
import proc_util

import helper_path

import logging

_log = logging.getLogger("tepna-capture")

# Prefer a ROOT-OWNED deployed copy: a NOPASSWD grant must point at a file this user cannot rewrite
# (this repo sits on a user-writable NTFS mount). See helper_path.py.
_HELPER = helper_path.resolve("tepna-rssi.sh")
_HCI_CACHE: dict[str, str] = {}     # adapter BD_ADDR (upper) -> hciN
_MODE: str | None = None            # 'direct' (ambient caps) | 'sudo' (dev fallback) | None (unknown)


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
    # Upper bound is -1, not +20. A receiver cannot measure a POSITIVE signal strength: on an LE link
    # HCI_Read_RSSI returns absolute dBm, and BlueZ hands back 0 (occasionally a small positive) when it
    # has no valid measurement — a stale handle, a link being torn down. The old +20 bound let those
    # sentinels through as if they were readings, so a night's RSSI record carried impossible values
    # (measured 2026-07-25: 0, +1 and +8 dBm across three devices) that then poison any min/max or
    # threshold computed over the column. Recording "unknown" is the honest answer, and this file's job
    # is to make link quality EVIDENCE — a fabricated -0 dBm is the opposite (VIGIL-PPG-GRID-AUDIT §4).
    return val if -127 <= val <= -1 else None            # plausible BLE RSSI range; junk → None


def parse_hci_dev(text: str) -> dict[str, str]:
    """`hcitool dev` → {BD_ADDR_upper: hciN}. Lines look like `\\thci0\\tAC:A7:F1:29:9D:1D`."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        m = re.search(r"(hci\d+)\s+([0-9A-Fa-f:]{17})", line)
        if m:
            out[m.group(2).upper()] = m.group(1)
    return out


ZERO_ADDR = "00:00:00:00:00:00"


async def dbus_hci() -> dict[str, str]:
    """Map controller BD_ADDR → hciN from BlueZ over D-Bus — {BD_ADDR_upper: hciN}.

    THE ONLY SOURCE THAT KNOWS A CONTROLLER WITH NO PUBLIC ADDRESS. sysfs and `hcitool dev` both read
    the controller's PUBLIC address, and an LE-only controller is entitled not to have one: a Raytac
    MDBT50Q running Zephyr's USB HCI reports 00:00:00:00:00:00 to both while BlueZ has given it the
    static-random identity C6:CF:3C:4E:75:F0 (top two bits set — that is what makes it static random).

    That identity is not cosmetic. It is the address BlueZ bonds with, the one `bluetoothctl` prints,
    and the one an operator would put in `adapter:`. Without this source resolve_hci returned None for
    it, capture logged "configured adapter not found — falling back to the BlueZ default", and dropped
    the pin — and on 2026-07-26 the BlueZ default WAS that same untested controller. A pin that fails
    open onto a different radio is worse than no pin, because the log says it fell back while the
    night's data says nothing at all.

    {} when busctl is absent or BlueZ is not up; the caller keeps whatever hcitool/sysfs gave it."""
    out: dict[str, str] = {}
    try:
        names = sorted(n for n in os.listdir("/sys/class/bluetooth") if re.fullmatch(r"hci\d+", n))
    except OSError:
        return out
    for name in names:
        txt = await _run(["busctl", "get-property", "org.bluez", f"/org/bluez/{name}",
                          "org.bluez.Adapter1", "Address"])
        if not txt:
            continue
        m = re.search(r"([0-9A-Fa-f:]{17})", txt)
        if m and m.group(1).upper() != ZERO_ADDR:
            out[m.group(1).upper()] = name
    return out


def sysfs_hci(base: str = "/sys/class/bluetooth") -> dict[str, str]:
    """Map controller BD_ADDR → hciN from sysfs — {BD_ADDR_upper: hciN}. Each
    /sys/class/bluetooth/hciN/address holds that controller's MAC. This is the DEPENDENCY-FREE resolver
    that works on any BlueZ box including the Pi 5 target, where `hcitool` is NOT installed by default and
    resolve_hci silently fell back to the BlueZ default radio — the 2026-07-18 deaf-onboard mis-pin
    (VIGIL-DEEP-ANALYSIS §1.3). {} if sysfs is unreadable (then resolve_hci falls back to hcitool)."""
    out: dict[str, str] = {}
    try:
        names = sorted(n for n in os.listdir(base) if re.fullmatch(r"hci\d+", n))
    except OSError:
        return out
    for name in names:
        try:
            with open(os.path.join(base, name, "address")) as f:
                addr = f.read().strip().upper()
        except OSError:
            # This adapter is now ABSENT from the address->hci map, so every RSSI reading from it
            # goes unattributed — which looks like a radio that reported nothing.
            _log.debug("link-rssi: %s has no readable address; it will not be attributed", name,
                       exc_info=True)
            continue
        if re.fullmatch(r"[0-9A-F:]{17}", addr):
            out[addr] = name
    return out


async def _run(cmd: list[str], timeout: float = 4.0) -> str | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await proc_util.communicate(proc, timeout)
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
    # sysfs FIRST (dependency-free, present on the Pi 5 where hcitool is absent); hcitool only as a
    # fallback (VIGIL-DEEP-ANALYSIS §1.3). Both yield {BD_ADDR_upper: hciN}.
    devs = sysfs_hci() or parse_hci_dev(await _run(["hcitool", "dev"]) or "")
    # OVERLAY BlueZ's own view. sysfs/hcitool report the PUBLIC address, so a controller that has only
    # a static-random identity is invisible to them — it shows up as 00:00:00:00:00:00 and cannot be
    # pinned. D-Bus is asked only when the cheap sources did not already answer for this key, so the
    # common case still costs one subprocess and the mapping stays authoritative where it exists.
    if key and key not in devs:
        devs = {**devs, **(await dbus_hci())}
    if not devs:
        return None
    hci = devs.get(key) if key else next(iter(devs.values()))
    if hci:
        _HCI_CACHE[key] = hci
    elif key in _HCI_CACHE:
        del _HCI_CACHE[key]          # configured adapter vanished — don't keep serving a stale index
    return hci


async def read_rssi(adapter_mac: str | None, dev_mac: str) -> int | None:
    """Connection RSSI (dBm) of a connected sensor, or None if it can't be read (no privilege / not
    connected / helper missing). Never raises; safe to poll on a cadence.

    TWO privilege paths, tried in order and then remembered:
      • DIRECT — the appliance case. The systemd unit grants the daemon
        `AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW`; ambient caps survive exec, so the helper's
        `hcitool` inherits them and needs no escalation. This is the ONLY path that can work on the Pi,
        because the unit also sets `NoNewPrivileges=true`, which forbids setuid sudo outright.
      • SUDO — the dev-workstation fallback, where there is no unit granting caps and a NOPASSWD
        sudoers entry points at the root-owned helper instead.
    The working mode is cached so we don't pay two subprocesses per poll, and cleared on failure so a
    capability or grant that appears later is picked up without a restart."""
    global _MODE
    if not dev_mac or not os.path.exists(_HELPER):
        return None
    hci = await resolve_hci(adapter_mac)
    if not hci:
        return None
    order = ([_MODE] if _MODE else []) + [m for m in ("direct", "sudo") if m != _MODE]
    for mode in order:
        cmd = [_HELPER, hci, dev_mac] if mode == "direct" else ["sudo", "-n", _HELPER, hci, dev_mac]
        val = parse_rssi(await _run(cmd) or "")
        if val is not None:
            _MODE = mode
            return val
    _MODE = None                 # both failed — re-probe both next time
    return None
