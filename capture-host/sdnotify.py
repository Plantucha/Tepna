# tepna-capture — sdnotify.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# systemd service-notification (sd_notify) — pure stdlib, zero dependency. Two jobs:
#
#   • Tell systemd the daemon is READY (Type=notify), so `systemctl start` blocks until capture is truly
#     up rather than returning the instant the process forks.
#   • WATCHDOG heartbeat. This box's signature failure is HUNG-BUT-ALIVE — a wedged BLE stack leaves the
#     process running while it captures nothing, and `Restart=always` never fires because nothing crashed.
#     A periodic WATCHDOG=1 ping from a live-event-loop task lets systemd (WatchdogSec=) detect the wedge
#     and kill+restart it. The ping proves the async loop is still turning, which is exactly the liveness
#     that matters here.
#
# Every function is a safe no-op when not run under systemd (NOTIFY_SOCKET unset) — so the daemon runs
# identically from a plain shell or a test.
from __future__ import annotations

import os
import socket


def sd_notify(state: str) -> bool:
    """Send one datagram (e.g. "READY=1", "WATCHDOG=1", "STOPPING=1", "STATUS=…") to systemd's
    $NOTIFY_SOCKET. Returns True if sent, False if there is no socket or the send failed — never raises."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return False
    if addr[0] == "@":                       # Linux abstract-namespace socket → leading NUL
        addr = "\0" + addr[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sock:
            sock.connect(addr)
            sock.sendall(state.encode("utf-8"))
        return True
    except OSError:
        return False


def watchdog_period_sec() -> float | None:
    """A safe ping cadence = HALF the WatchdogSec systemd configured (via WATCHDOG_USEC), so a ping is
    never late even with scheduling jitter. None when the unit set no watchdog (nothing to ping)."""
    usec = os.environ.get("WATCHDOG_USEC")
    if not usec or not usec.isdigit():
        return None
    return max(1.0, int(usec) / 1_000_000 / 2)
