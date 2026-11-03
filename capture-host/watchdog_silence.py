# tepna-capture — watchdog_silence.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The decisions of the box watchdog (`tepna-watchdog.sh`), read off one `status.json`.

The box watchdog (`deploy/tepna-watchdog.sh`, run by cron every 30 min) restarts the daemon for a
connected device with no sample for 1200 s. Its only skip was a device that is not connected, so it also
restarted the daemon for a silence the daemon itself had caused and explained — an offline download, a
ring offline op, a device on charge or off the body (residue
`2026-11-02-the-box-watchdog-restarts-for-an-explained-silence`).

This module holds those decisions where a test can reach them. A connected device that is silent is
EXPLAINED, and never a fault, when:

* `alerts.explained_silence` names a state for it — `charging`, `not-worn`, or `offline-op` when its
  address is in `gates.polar_paused`. This is the ONE home #4242 gave those states; this module calls it
  and keeps no copy.
* `gates.offline_slot` names the device: it holds the single offline-download slot.
* `gates.oxyii_pause` is set and the device is the ring. The daemon sets that pause for the whole Oxy-II
  offline op, and only the ring publishes `oxy_lifecycle`.
* `gates.recover` is set: the daemon is recovering the radio, and every link is down by design.
* `gates.stop` is set: the daemon is shutting down.

An absent `gates` block explains nothing, so the 1200 s rule still decides — the watchdog stays as strict
as it was against an older daemon. Unknown is never an explanation (`alerts.explained_silence`).
"""

from __future__ import annotations

import datetime as _dt
import json
import sys

import alerts

SILENT_SEC = 1200


def _gates(status: dict) -> dict:
    g = status.get("gates")
    return g if isinstance(g, dict) else {}


def gate_explanation(name: str, st: dict, gates: dict) -> str | None:
    """Name the gate that explains why device `name` is silent, or None."""
    if gates.get("stop"):
        return "daemon-stopping"
    if gates.get("recover"):
        return "radio-recover"
    if gates.get("offline_slot") == name:
        return "offline-slot"
    if gates.get("oxyii_pause") and "oxy_lifecycle" in st:
        return "oxyii-pause"
    return None


def silent_devices(status: dict, now: _dt.datetime, threshold: float = SILENT_SEC) -> tuple[list[str], list[str]]:
    """Return (faults, explained) as `name=<age>s` and `name=<age>s:<why>` strings.

    A fault is a connected device whose `last_sample` is older than `threshold` and that nothing explains.
    A device that is not connected, has no `last_sample`, or has an unreadable one is neither."""
    gates = _gates(status)
    paused = gates.get("polar_paused") or ()
    faults: list[str] = []
    explained: list[str] = []
    for name, st in (status.get("devices") or {}).items():
        if not isinstance(st, dict) or not st.get("connected"):
            continue  # absent != faulty
        ls = st.get("last_sample")
        if not ls:
            continue
        try:
            age = (now - _dt.datetime.fromisoformat(ls)).total_seconds()
        except (TypeError, ValueError):  # an unreadable stamp is not judgeable: neither fault nor skip
            continue
        if age <= threshold:
            continue
        why = alerts.explained_silence(st, paused) or gate_explanation(name, st, gates)
        if why:
            explained.append(f"{name}={int(age)}s:{why}")
        else:
            faults.append(f"{name}={int(age)}s")
    return faults, explained


def wedged_devices(status: dict) -> list[str]:
    """Devices whose last error is BlueZ `InProgress`: an adapter wedge, not an absent device."""
    out = []
    for name, st in (status.get("devices") or {}).items():
        if isinstance(st, dict) and "InProgress" in str(st.get("last_error") or ""):
            out.append(name)
    return out


def summary(status: dict) -> str:
    """`<first word of name>:up|off` per device, for the watchdog's OK line."""
    parts = []
    for name, st in (status.get("devices") or {}).items():
        up = isinstance(st, dict) and st.get("connected")
        parts.append(f"{(name.split() or [name])[0]}:{'up' if up else 'off'}")
    return ", ".join(parts)


def main(argv: list[str], now: _dt.datetime | None = None) -> int:
    """`watchdog_silence.py silent|wedged|summary <status.json>`; prints one line, exits 0.

    `silent` prints the faults, then a TAB, then the explained silences, each `;`-joined. Exit 2 is a
    usage error, and the script then treats the cycle as having found nothing."""
    if len(argv) != 2 or argv[0] not in ("silent", "wedged", "summary"):
        print("usage: watchdog_silence.py silent|wedged|summary <status.json>", file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as fh:
        status = json.load(fh)
    if argv[0] == "wedged":
        print(";".join(wedged_devices(status)))
    elif argv[0] == "summary":
        print(summary(status))
    else:
        faults, explained = silent_devices(status, now or _dt.datetime.now())
        print(";".join(faults) + "\t" + ";".join(explained))
    return 0


if __name__ == "__main__":  # pragma: no cover - the script entry; main() is tested directly
    sys.exit(main(sys.argv[1:]))
