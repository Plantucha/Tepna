# tepna-capture — offline_lock.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# ONE onboard-recording download at a time, across ALL devices.
#
# WHY: every offline pull (O2Ring `.dat` over OxyII, Polar recordings over PS-FTP) has to take over the
# host radio — it pauses that device's live capture, drops its link, re-scans, and holds the adapter's
# connect lock. Two of those at once fight for the single controller and BOTH lose. This is not
# hypothetical: on 2026-07-18 09:00 three offline ops were fired within 11 s (H10 recordings, Verity
# recordings, O2Ring pull) and the O2Ring pull died with org.bluez.Error.InProgress.
#
# DESIGN — fail fast, do NOT queue. A queued second pull would sit there while the browser spins, and by
# the time it ran the user's intent (and the device's state) may have moved on. Instead the second caller
# gets OfflineBusy naming the holder, and the UI can say "X is downloading" immediately.
#
# Race-free without a Lock: asyncio is single-threaded and there is no await between the check and the
# set, so two coroutines cannot both observe a free slot.

from __future__ import annotations
import contextlib

_busy: str | None = None          # label of the device currently holding the single download slot


class OfflineBusy(RuntimeError):
    """Raised when an offline download is already running for another device.
    `holder` is the label of whoever owns the slot, for a useful UI message."""

    def __init__(self, holder: str):
        super().__init__(f"another device is downloading ({holder}) — try again when it finishes")
        self.holder = holder


def busy_with() -> str | None:
    """Label of the device currently downloading, or None when the slot is free."""
    return _busy


@contextlib.asynccontextmanager
async def slot(who: str):
    """Hold the single offline-download slot for `who`, or raise OfflineBusy immediately if taken.
    Always releases, however the body ends."""
    global _busy
    if _busy is not None:
        raise OfflineBusy(_busy)
    _busy = who
    try:
        yield
    finally:
        _busy = None
