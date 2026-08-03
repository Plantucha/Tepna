#!/usr/bin/env python3
# tepna-capture — link_guard.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# ONE LINE THAT SAVES A BLE WINDOW: is the capture daemon holding the device's single link?
#
# A Polar grants exactly ONE connection. With `tepna-capture.service` up, a probe's connect appears to
# SUCCEED and then every GATT call fails — `Service Discovery has not been performed yet`, or a
# transfer that simply never completes. Both messages describe BlueZ's state and neither names the
# cause, which sends the reader after adapter resets, settle timers and GATT caches.
#
# Measured 2026-08-03: this cost FIVE separate runs across one session — four survey attempts and a
# system-file pull — including two where the probe had already started a recording and then could not
# deliver its stop. Each diagnosis was reasoned from the error text; none of them checked the one
# precondition that takes a single subprocess call.
#
# The deadman timer makes it worse rather than better: `tepna-restart.sh stop N` brings the daemon back
# by itself after N minutes, so a long probe silently loses the link PART WAY THROUGH and the failure
# lands in the middle of a run rather than at its start.
#
#   from link_guard import require_free_link
#   require_free_link()          # exits with the fix if the daemon is up
#
# Import it at the top of any probe that needs the radio. It is deliberately dependency-free and
# tolerant of not running on the box at all (no systemd -> nothing to hold the link -> proceed).

from __future__ import annotations

import subprocess
import sys

UNIT = "tepna-capture.service"
STOP_CMD = "sudo -n /usr/local/lib/tepna/tepna-restart.sh stop 30"


def daemon_holds_link(unit: str = UNIT) -> bool:
    """True when the capture daemon is active and therefore owns the device's single BLE link."""
    try:
        r = subprocess.run(["systemctl", "is-active", unit],
                           capture_output=True, text=True, timeout=10)
        return r.stdout.strip() == "active"
    except Exception:                                  # noqa: BLE001 — no systemd / not on the box
        return False


def require_free_link(unit: str = UNIT, exit_code: int = 3) -> None:
    """Refuse to start while the daemon holds the link, and say exactly how to fix it.

    Exits rather than warns: every failure mode downstream of this is confusing, and a probe that runs
    anyway produces a diagnostic about the wrong subsystem."""
    if daemon_holds_link(unit):
        print(f"REFUSING: {unit} is ACTIVE and holds the device's single BLE link.\n"
              f"Every call would fail with a message about BlueZ, not about this.\n"
              f"    {STOP_CMD}\n"
              f"(deadman-timed — it restarts itself, so a long probe can lose the link mid-run)",
              file=sys.stderr)
        raise SystemExit(exit_code)
