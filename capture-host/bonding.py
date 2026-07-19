# tepna-capture — bonding.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# BLE scan / bond / forget helpers, driven through `bluetoothctl`. Polar H10 (and several PMD
# peripherals) REFUSE the PMD service on an unauthenticated link and drop the connection ~1-2 s
# after connect (cf. bleak issue #1943, "Insufficient Authentication 0x05 on PMD Control write").
# The fix, verified on hardware 2026-07-16, is a one-time Just-Works bond BEFORE bleak connects:
# a single continuous bluetoothctl session that registers a NoInputNoOutput agent, scans, then
# trust + pair. Once `Bonded: yes` is stored, `BleakClient(addr)` connects in ~0.2 s and holds.
#
# These are async wrappers around bluetoothctl (the proven path) rather than bleak.pair(), because
# bleak's pairing still needs a system agent and the scripted bluetoothctl session is what we know
# works headless. Adapter-aware so a multi-radio host bonds on the intended dongle.

from __future__ import annotations
import asyncio, re
from dataclasses import dataclass, asdict

_ADDR_RE = re.compile(r"Device ([0-9A-F:]{17}) (.+)")
# bluetoothctl emits PROPERTY UPDATES in the same `Device <addr> <rest>` shape as announcements:
#     [NEW] Device 24:AC:AC:0C:30:1E Polar Sense 0C301E3F
#     [CHG] Device 24:AC:AC:0C:30:1E RSSI: 0xffffffd8 (-40)
# so a naive capture takes "RSSI: 0xffffffd8 (-40)" for the device's NAME. That is not cosmetic: the
# monitor infers vendor/model from the name, finds no match, and the identity gate then refuses to
# remember the sensor at all — "not recognised — needs vendor, model" for a device sitting at -40 dBm
# (observed 2026-07-19 on a Verity that BlueZ knew perfectly well as "Polar Sense 0C301E3F").
_PROP_RE = re.compile(r"^(RSSI|TxPower|ManufacturerData|ServiceData|UUIDs?|Connected|Paired|Bonded|"
                      r"Trusted|Blocked|LegacyPairing|Appearance|Icon|Adapter|Alias|Class|Modalias|"
                      r"AdvertisingFlags|WakeAllowed|ServicesResolved|Battery Percentage)\b\s*:",
                      re.I)
# A name bluetoothctl synthesises from the address ("24-AC-AC-0C-30-1E") carries no vendor information;
# a real one must be allowed to replace it when a later line supplies it.
_ADDR_NAME_RE = re.compile(r"^[0-9A-F]{2}([-:][0-9A-F]{2}){5}$", re.I)
_RSSI_LINE_RE = re.compile(r"Device ([0-9A-F:]{17}) RSSI:.*?\((-?\d+)\)", re.I)


def is_property_line(name: str) -> bool:
    """True when a captured `Device <addr> <rest>` tail is a property update, not a device name."""
    return bool(_PROP_RE.match((name or "").strip()))


def is_placeholder_name(name: str) -> bool:
    """True when the name carries no identifying information — empty, or the address restated."""
    n = (name or "").strip()
    return not n or bool(_ADDR_NAME_RE.match(n))
_HEALTH_HINT = re.compile(r"polar|verity|muse|o2ring|wellue|viatom|checkme|oxy|sense", re.I)


@dataclass
class Found:
    address: str
    name: str
    rssi: int | None = None
    bonded: bool = False
    connected: bool = False
    health: bool = False   # matches a known sensor name pattern (UI can foreground these)


async def _btctl(script: str, timeout: float = 20.0) -> str:
    """Feed a newline script to one bluetoothctl session; return combined stdout+stderr."""
    proc = await asyncio.create_subprocess_exec(
        "bluetoothctl", stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(script.encode()), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill(); out = b""
    return out.decode(errors="replace")


async def _delayed_script(lines: list[tuple[float, str]]) -> str:
    """Run bluetoothctl, emitting each (delay_before, command) with real waits between — needed so
    `scan on` has time to discover before `pair`, in ONE session (cross-session loses the cache)."""
    proc = await asyncio.create_subprocess_exec(
        "bluetoothctl", stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    chunks: list[bytes] = []

    async def drain():
        while True:
            b = await proc.stdout.read(4096)
            if not b:
                break
            chunks.append(b)
    reader = asyncio.create_task(drain())
    try:
        for delay, cmd in lines:
            if delay:
                await asyncio.sleep(delay)
            proc.stdin.write((cmd + "\n").encode())
            await proc.stdin.drain()
        await asyncio.sleep(0.5)
        proc.stdin.close()
        await asyncio.wait_for(proc.wait(), timeout=5)
    except (asyncio.TimeoutError, ProcessLookupError):
        proc.kill()
    await reader
    return b"".join(chunks).decode(errors="replace")


def _adapter_prefix(adapter_mac: str | None) -> list[tuple[float, str]]:
    return [(0, f"select {adapter_mac}")] if adapter_mac else []


async def scan(adapter_mac: str | None = None, seconds: float = 8.0) -> list[Found]:
    """Discover advertising devices on `adapter_mac` (or the default controller)."""
    script = _adapter_prefix(adapter_mac) + [
        (0.5, "scan on"), (seconds, "scan off"), (0.3, "devices"), (0.2, "quit")]
    out = await _delayed_script(script)
    seen: dict[str, Found] = {}
    for m in _ADDR_RE.finditer(out):
        addr, name = m.group(1), m.group(2).strip()
        if is_property_line(name):
            continue                       # a [CHG] property update, not an announcement
        cur = seen.get(addr)
        # LAST REAL NAME WINS, but a placeholder never overwrites a real one. First-wins lost the race
        # to whichever line bluetoothctl happened to print first.
        if cur is None or (is_placeholder_name(cur.name) and not is_placeholder_name(name)):
            seen[addr] = Found(address=addr, name=name, health=bool(_HEALTH_HINT.search(name)),
                               rssi=cur.rssi if cur else None)
    # RSSI comes from the SCAN STREAM, which is the only place it exists for a device we are not
    # connected to — `info` reports it only for a live connection, so the enrichment below returned
    # None for every discovered device while the value sat in the very lines discarded above.
    for m in _RSSI_LINE_RE.finditer(out):
        f = seen.get(m.group(1))
        if f:
            f.rssi = int(m.group(2))
    # Enrich with bonded / connected (and RSSI, when a live link makes `info` report it) from `info`.
    for addr, f in seen.items():
        info = await _btctl(f"info {addr}\nquit\n", timeout=8)
        f.bonded = "Bonded: yes" in info or "Paired: yes" in info
        f.connected = "Connected: yes" in info
        r = re.search(r"RSSI:.*\((-?\d+)\)", info)
        if r:
            f.rssi = int(r.group(1))
        nm = re.search(r"^\s*Name:\s*(.+)$", info, re.M)      # authoritative, and survives a bad scan line
        if nm and is_placeholder_name(f.name):
            f.name = nm.group(1).strip()
            f.health = bool(_HEALTH_HINT.search(f.name))
    return sorted(seen.values(), key=lambda d: (not d.health, d.rssi is None, -(d.rssi or -999)))


async def is_bonded(address: str, adapter_mac: str | None = None) -> bool:
    info = await _btctl(
        ("".join([f"select {adapter_mac}\n"] if adapter_mac else []) + f"info {address}\nquit\n"), timeout=8)
    return ("Bonded: yes" in info) or ("Paired: yes" in info)


# The signature of a bond the DEVICE has forgotten while the HOST still believes in it. A Polar accepts
# the connection, then drops it ~1-2 s later during service discovery because it no longer recognises the
# pairing (bleak #1943, "Insufficient Authentication 0x05 on PMD Control write").
# NOTE the spelling: BlueZ emits `org.bluez.Error.AuthenticationFailed` as ONE word, so a
# "authentication failed" pattern never matches it. bond() already relies on the same spelling.
_STALE_BOND_SIGNS = ("failed to discover services", "insufficient authentication",
                     "service discovery has not been performed", "not paired",
                     "authenticationfailed", "authentication failed")


def looks_like_a_stale_bond(exc_text: str) -> bool:
    """True when a connect failure is the shape of a one-sided bond rather than a missing/asleep device."""
    t = (exc_text or "").lower()
    return any(m in t for m in _STALE_BOND_SIGNS)


async def ensure_bonded(address: str, adapter_mac: str | None = None, *, force: bool = False) -> bool:
    """Bond only if not already bonded — safe to call before every connect attempt.

    `force=True` re-pairs even when the host thinks it is already bonded. Needed because is_bonded() reads
    `bluetoothctl info`, which is the HOST's view ONLY. A device-side factory reset (Polar Flow offers one)
    wipes the sensor's half while BlueZ still reports `Bonded: yes` — so the fast path returns True forever,
    the strap keeps dropping service discovery, and nothing re-pairs. Observed 2026-07-19: an H10 reset from
    the phone app went permanently unusable, and the only cure was a manual `bluetoothctl remove`.
    Removing the host record first is what makes the re-pair meaningful; pairing over a stale record is a
    no-op."""
    if force:
        await forget(address, adapter_mac)
    elif await is_bonded(address, adapter_mac):
        return True
    return (await bond(address, adapter_mac))["ok"]


async def bond(address: str, adapter_mac: str | None = None) -> dict:
    """Just-Works bond (trust + pair) in one timed session. Returns {ok, detail}."""
    script = _adapter_prefix(adapter_mac) + [
        (0.5, "agent NoInputNoOutput"), (0.5, "default-agent"),
        (0.5, "scan on"), (9.0, f"trust {address}"),
        (0.8, f"pair {address}"), (11.0, "scan off"), (0.5, "quit")]
    out = await _delayed_script(script)
    ok = ("Pairing successful" in out) or ("Bonded: yes" in out)
    detail = "paired" if ok else (
        "auth-failed" if "AuthenticationFailed" in out else
        "not-found" if "not available" in out else "failed")
    return {"ok": ok, "detail": detail, "address": address}


async def forget(address: str, adapter_mac: str | None = None) -> dict:
    out = await _btctl("".join(
        [f"select {adapter_mac}\n"] if adapter_mac else []) + f"remove {address}\nquit\n")
    return {"ok": ("Device has been removed" in out) or ("removed" in out.lower()), "address": address}


# CLI: python bonding.py scan|bond|forget [address] [--adapter MAC]
if __name__ == "__main__":
    import argparse, json, sys
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["scan", "bond", "forget"])
    ap.add_argument("address", nargs="?")
    ap.add_argument("--adapter")
    a = ap.parse_args()

    async def go():
        if a.action == "scan":
            return [asdict(x) for x in await scan(a.adapter)]
        if not a.address:
            sys.exit("address required for bond/forget")
        return await (bond if a.action == "bond" else forget)(a.address, a.adapter)
    print(json.dumps(asyncio.run(go()), indent=2))
