# tepna-capture — wifi_uplink.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The box's Wi-Fi UPLINK: scan, join, leave, status — plus the 0600 store for a remembered network.
# Every DECISION lives in `wifi_join` (pure, gate-backed); this file is the I/O around it.
#
# ⚠️ THIS IS NOT THE EZ-SHARE HARVEST LINK. `cpap_harvest` associates the SAME radio with the CPAP SD
# card's own access point, using its own supplicant and control directory. One radio cannot hold two
# associations, so the two are mutually exclusive by physics, not by policy — `suspend_plan` /
# `should_resume` in the pure core encode the handover and `webmon` wires it into the harvest.
#
# 🔴 WHAT "SAVED" MEANS, PRECISELY. The owner asked for the password to be "encrypted after saving".
# What is stored is the PBKDF2-SHA1 **derivation** (the WPA PSK), and that is a ONE-WAY function, not
# encryption — there is no key and nothing to decrypt. It is the honest option available here: a
# supplicant must present the PSK to associate, so anything reversible would need the reversing key on
# the same disk, which buys nothing. What it DOES buy is real and worth having: the plaintext the owner
# typed never touches the disk, so a passphrase reused on other accounts cannot be read back off this
# box. What it does NOT buy: the stored PSK still joins that network, so the file is a credential and
# is written 0600. Never describe it to the owner as "encrypted".

from __future__ import annotations

import asyncio
import json
import os

import helper_path
import wifi_join

__all__ = ["HELPER", "scan", "join", "leave", "status", "load_saved", "save_network",
           "forget_network", "public_view"]

HELPER = "tepna-wifi.sh"
# The privilege prefix, as a constant so the gate can exercise the REAL subprocess path against a
# stub helper. Without this the only tests possible are ones that inject past `_run` entirely — which
# would leave the code that actually invokes root as the one piece nothing ever ran.
SUDO = ("sudo", "-n")
SCAN_TIMEOUT = 25.0
JOIN_TIMEOUT = 75.0          # association can take ~30 s, then DHCP on top
LEAVE_TIMEOUT = 20.0
STATUS_TIMEOUT = 10.0


async def _run(action, args=(), stdin_text=None, timeout=STATUS_TIMEOUT, runner=None):
    """Invoke the privileged helper. Returns `(rc, stdout, stderr)`.

    The PSK travels on STDIN. It must never become an argv element: /proc/<pid>/cmdline is
    world-readable, so an argument is visible to every local user for the lifetime of the call."""
    if runner is not None:                        # tests inject; production never passes this
        return await runner(action, args, stdin_text)
    path = helper_path.resolve(HELPER)
    warn = helper_path.grant_warning(path)
    if warn:
        # Refusing rather than warning: running THIS script under sudo from a user-writable mount is a
        # root escalation, and it is the one failure mode a Wi-Fi feature must not introduce.
        return 126, "", warn
    proc = await asyncio.create_subprocess_exec(
        *SUDO, path, action, *[str(a) for a in args],
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(
            proc.communicate((stdin_text or "").encode()), timeout=timeout)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:                # it exited between the timeout and the kill
            pass
        return 124, "", f"{action} timed out after {timeout:.0f}s"
    return proc.returncode, out.decode(errors="replace"), err.decode(errors="replace")


async def scan(runner=None):
    """Visible networks, strongest first."""
    rc, out, err = await _run("scan", timeout=SCAN_TIMEOUT, runner=runner)
    if rc != 0:
        return {"ok": False, "error": err.strip() or f"scan failed (rc={rc})", "networks": []}
    return {"ok": True, "networks": wifi_join.parse_scan_results(out)}


async def join(ssid, passphrase, security=wifi_join.SECURED, runner=None):
    """Associate with `ssid`. The passphrase is derived here and sent on stdin; it is never logged,
    never stored, and never returned."""
    ok, error = wifi_join.validate_passphrase(ssid, passphrase, security)
    if not ok:
        return {"ok": False, "error": error}
    psk = "OPEN" if security == wifi_join.OPEN else wifi_join.derive_psk(ssid, passphrase)
    rc, out, err = await _run("join", [ssid], stdin_text=psk + "\n",
                              timeout=JOIN_TIMEOUT, runner=runner)
    if rc != 0:
        return {"ok": False, "error": err.strip() or f"could not join {ssid} (rc={rc})"}
    return {"ok": True, "ssid": ssid, "detail": out.strip()}


async def leave(runner=None):
    rc, out, err = await _run("leave", timeout=LEAVE_TIMEOUT, runner=runner)
    if rc != 0:
        return {"ok": False, "error": err.strip() or f"could not bring the uplink down (rc={rc})"}
    return {"ok": True, "detail": out.strip()}


async def status(runner=None):
    """Current uplink state. Never starts anything — see the helper's `status` branch."""
    rc, out, err = await _run("status", timeout=STATUS_TIMEOUT, runner=runner)
    if rc != 0:
        return {"ok": False, "state": "unknown", "error": err.strip() or f"rc={rc}"}
    st = {"ok": True, "state": "down", "ssid": None, "ip": None}
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("wpa_state="):
            st["state"] = "up" if line[10:] == "COMPLETED" else line[10:].lower()
        elif line.startswith("ssid="):
            st["ssid"] = line[5:] or None
        elif line.startswith("ip_address="):
            st["ip"] = line[11:] or None
    return st


# ── the remembered network ────────────────────────────────────────────────────────────────────────
def _store_path(root):
    return os.path.join(root, "wifi-uplink.json")


def load_saved(root):
    """The remembered network, or None. Includes the PSK — callers must not hand this to the UI."""
    try:
        with open(_store_path(root), encoding="utf-8") as fh:
            rec = json.load(fh)
    except (OSError, ValueError):
        # Absent is the normal state; corrupt is treated the same, because a half-written credential
        # file cannot be repaired and must not become a partial join attempt.
        return None
    return rec if isinstance(rec, dict) and rec.get("ssid") else None


def save_network(root, ssid, passphrase, security=wifi_join.SECURED):
    """Remember `ssid`, storing only the DERIVATION. Returns the public view."""
    ok, error = wifi_join.validate_passphrase(ssid, passphrase, security)
    if not ok:
        raise ValueError(error)
    rec = {"ssid": ssid, "security": security,
           "psk": None if security == wifi_join.OPEN else wifi_join.derive_psk(ssid, passphrase)}
    path = _store_path(root)
    # 0600 BEFORE the write, not after: a file created world-readable and chmod'd afterwards is
    # readable for the window in between, and that window is all an attacker needs.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(rec, fh)
    return public_view(rec)


def forget_network(root):
    try:
        os.unlink(_store_path(root))
    except OSError:
        return False
    return True


def public_view(rec):
    """What may cross the API boundary: never the PSK, only whether one is held."""
    if not rec:
        return None
    return {"ssid": rec.get("ssid"), "security": rec.get("security", wifi_join.SECURED),
            "has_credential": bool(rec.get("psk"))}
