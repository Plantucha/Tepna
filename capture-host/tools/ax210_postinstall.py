# tepna-capture — tools/ax210_postinstall.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Post-install verification for the Intel AX210 going into vigil — the DECISIONS, not the gathering.

An install checklist written as prose is a checklist nobody runs the same way twice, and one written
as a shell one-liner reports whatever the last command in the pipe felt like. So every verdict here
is a pure function over text the caller collected, each one able to say UNKNOWN, and UNKNOWN is never
folded into a pass.

🔴 THE WIFI CHECK READS THE DAEMON, NOT THE FILE, and that is the whole reason this module exists
rather than a `grep config.yaml`. `capture.py` reads its config EXACTLY ONCE at startup, and the
monitor's `_save()` re-emits the config it loaded at boot — so a key hand-added since is silently
dropped, with no error and no log line. A file check passes over exactly that failure. The daemon
publishes its effective interface into `STATUS['cpap'].wifi_iface`; that is the value to assert.

The AX210 enters UNMEASURED. Nothing here scores it as better than the radios already in the box: a
new adapter earns its affinity from >=3 nights of data or not at all, so this file verifies presence
and pins, never superiority.
"""

from __future__ import annotations

import re

__all__ = [
    "OK",
    "FAIL",
    "UNKNOWN",
    "expected_macs_present",
    "wifi_pin_intact",
    "bt_version_at_least",
    "adapters_from_hciconfig",
    "assess",
]

OK = "ok"
FAIL = "fail"
UNKNOWN = "unknown"

# The two MACs the config pins. Neither may stop resolving after the card shuffles hci enumeration —
# that is the entire reason both are pinned by MAC rather than by hciN.
SENA_MAC = "00:01:95:CC:53:02"  # wearables
UB500_MAC = "AC:A7:F1:29:9D:1D"  # CPAP

_HCI_RE = re.compile(r"^(hci\d+):", re.M)
_BD_RE = re.compile(r"BD Address:\s*([0-9A-Fa-f:]{17})")


def adapters_from_hciconfig(text):
    """`{hciN: BD_ADDR_UPPER}` from `hciconfig` output. Pure. `{}` when nothing parses.

    Deliberately tolerant of ordering and of extra adapters: the point of the MAC pins is that hciN
    numbering is allowed to shuffle, so a checker keyed on hci0/hci1/hci2 would fail the very
    situation it exists to bless."""
    out = {}
    name = None
    for line in str(text or "").splitlines():
        m = _HCI_RE.match(line.strip())
        if m:
            name = m.group(1)
            continue
        b = _BD_RE.search(line)
        if b and name:
            out[name] = b.group(1).upper()
            name = None
    return out


def expected_macs_present(adapters, expected=(SENA_MAC, UB500_MAC)):
    """`(state, detail)` — does every pinned MAC still resolve to some adapter? Pure.

    Answers the only question the pins actually make: not "is hci1 the Sena" but "is the Sena
    somewhere". An empty parse is UNKNOWN, never FAIL — we did not look, we failed to read."""
    if not adapters:
        return UNKNOWN, "no adapters parsed — hciconfig output missing or unreadable"
    have = {v.upper() for v in adapters.values()}
    missing = [m for m in expected if m.upper() not in have]
    if missing:
        return FAIL, f"pinned adapter(s) not present: {', '.join(missing)} (have {sorted(have)})"
    return OK, f"all {len(expected)} pinned adapter(s) resolve; {len(adapters)} adapter(s) total"


def wifi_pin_intact(status_cpap, want="wlp1s0"):
    """`(state, detail)` — is the RUNNING daemon using the pinned interface? Pure.

    `status_cpap` is `/api/state`'s `cpap` object. A MISSING key is UNKNOWN and not a pass: on a
    daemon predating the publish it simply cannot be answered here, and reporting OK would be the
    file-check mistake one layer up."""
    if not isinstance(status_cpap, dict):
        return UNKNOWN, "no cpap status object — daemon down, or /api/state unreadable"
    if "wifi_iface" not in status_cpap:
        return UNKNOWN, (
            "this daemon does not publish wifi_iface (predates the AX210 prep) — "
            "restart it on current code before trusting this check"
        )
    got = status_cpap.get("wifi_iface")
    if got != want:
        return FAIL, (
            f"the daemon is using {got!r}, not the pinned {want!r} — a monitor "
            f"'Save settings' before this restart drops a hand-added key silently"
        )
    return OK, f"the daemon is using the pinned interface {want!r}"


def bt_version_at_least(text, want=(5, 3)):
    """`(state, detail)` — does any adapter report at least Bluetooth `want`? Pure.

    Reads `hciconfig -a` / `btmgmt info`-style "HCI Version: 5.3 (0xc)". No version line at all is
    UNKNOWN: the AX210 may be present and simply not report through the command that was run."""
    vers = re.findall(r"HCI Version:\s*(\d+)\.(\d+)", str(text or ""))
    if not vers:
        return UNKNOWN, "no HCI Version line found — the probe did not read a version"
    best = max((int(a), int(b)) for a, b in vers)
    if best < tuple(want):
        return FAIL, f"highest adapter reports Bluetooth {best[0]}.{best[1]}, below {want[0]}.{want[1]}"
    return OK, f"Bluetooth {best[0]}.{best[1]} present (highest of {len(vers)} adapter(s))"


def assess(*, hciconfig="", status_cpap=None, hci_versions="", devices=None, want_iface="wlp1s0"):
    """The whole checklist as one record: `{ok, checks:[{name,state,detail}]}`. Pure.

    `ok` is True only when EVERY check is OK. An UNKNOWN keeps it False — an install verified by a
    probe that did not run is not verified, and this is the one place that distinction is cheap to
    honour and expensive to lose."""
    adapters = adapters_from_hciconfig(hciconfig)
    checks = [
        {"name": "pinned-adapters", **dict(zip(("state", "detail"), expected_macs_present(adapters)))},
        {"name": "wifi-pin", **dict(zip(("state", "detail"), wifi_pin_intact(status_cpap, want_iface)))},
        {"name": "bt-version", **dict(zip(("state", "detail"), bt_version_at_least(hci_versions)))},
    ]
    n = len(devices) if isinstance(devices, list) else None
    if n is None:
        checks.append({"name": "devices", "state": UNKNOWN, "detail": "no device list read"})
    elif n == 0:
        checks.append(
            {
                "name": "devices",
                "state": FAIL,
                "detail": "the daemon reports ZERO configured devices — config lost on restart",
            }
        )
    else:
        checks.append({"name": "devices", "state": OK, "detail": f"{n} configured device(s) present"})
    checks.append(
        {
            "name": "adapter-count",
            "state": OK if len(adapters) >= 4 else UNKNOWN,
            "detail": f"{len(adapters)} adapter(s) enumerated"
            + ("" if len(adapters) >= 4 else " — expected 4 after the AX210 install"),
        }
    )
    return {"ok": all(c["state"] == OK for c in checks), "checks": checks}
