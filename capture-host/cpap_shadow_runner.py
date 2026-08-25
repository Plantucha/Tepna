# tepna-capture — cpap_shadow_runner.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The daemon-side runner that drives the AS11 session detector + clock discipline in SHADOW mode,
# from ONE short-connect poll. It ties together the tested pure cores — cpap_supervisor (the
# state machine), cpap_detect (get_items → Observation), as11_clock (device-clock anchor) — behind
# injected seams, so the whole poll cycle is unit-tested without a radio.
#
# COEXISTENCE (the lesson of 2026-08-25): a separate poll must NOT compete with the CPAP live-stream
# controller for the AS11 — one BLE device, one connection. `is_capturing()` (bound to the
# controller's _running) gates the poll: while the controller streams, the runner defers entirely
# and takes NO connection. It polls only while the controller is idle — exactly the "poll only while
# INACTIVE" ruling.
#
# READ-ONLY: only establish + get_items (Get) + get_date_time — never Set/Enter*/SetDateTime. Shadow:
# it writes SESSIONDETECT.csv (would-have decisions) + AS11CLOCK.csv (offset/rate anchors) and drives
# nothing. Clock Contract untouched (the device stamp is parsed at the ingest boundary by regex).

from __future__ import annotations

import logging
import os

from cpap_detect import extract_fields
from cpap_supervisor import Observation

import as11_clock
import as11_cipher
import as11_pull

__all__ = ["poll_cycle", "run_shadow_loop", "SessionSidecar", "POLL_ITEMS"]

log = logging.getLogger(__name__)

# The read-only DataItems each poll needs: explicit therapy state, the mask corroborator, and the
# MachineMetrics subtree carrying the LastTherapyUseDateTime device-verdict marker.
POLL_ITEMS = ["FGState", "MaskPressure", "MachineMetrics"]


async def poll_cycle(
    *,
    connect,
    creds,
    supervisor,
    host_epoch,
    establish=as11_pull.establish,
    cipher_factory=as11_cipher.make_cipher,
    get_items=as11_pull.get_items,
    get_date_time=as11_pull.get_date_time,
    poll_items=POLL_ITEMS,
):
    """One short-connect poll → `(decision, anchor, clock_row)`.

    `decision` is the supervisor's classification of this observation; `anchor` is a
    `(host_epoch_s, device_epoch_s)` clock pair or None (unread/unparseable); `clock_row` is
    `(host_epoch_s, device_iso, device_epoch_s)` for the AS11CLOCK.csv sidecar. A failed device
    read yields an UNREACHABLE observation (never a fabricated state) and a None anchor. The link
    is always disconnected in the `finally`."""
    write, recv_frame, disconnect = await connect()
    try:
        key = await establish(bytes.fromhex(creds["masterPairKey"]), creds["clientId"], write, recv_frame)
        seal, unseal = cipher_factory(key)
        host_s = float(host_epoch())
        try:
            get_result = await get_items(write, recv_frame, seal, unseal, poll_items)
        except as11_pull.As11Error:
            get_result = None
        try:
            device_iso = await get_date_time(write, recv_frame, seal, unseal)
        except as11_pull.As11Error:
            device_iso = None

        host_ms = int(host_s * 1000)
        if get_result is None:
            obs = Observation(host_ms=host_ms, reachable=False)
        else:
            fg, use, mask = extract_fields(get_result)
            obs = Observation(
                host_ms=host_ms, reachable=True, fg_state=fg, last_therapy_use=use, mask_pressure=mask
            )
        decision = supervisor.observe(obs)

        device_epoch = as11_clock.parse_device_epoch_s(device_iso)
        anchor = (host_s, device_epoch) if device_epoch is not None else None
        return decision, anchor, (host_s, device_iso, device_epoch)
    finally:
        await disconnect()


async def run_shadow_loop(
    *,
    connect,
    creds,
    supervisor,
    is_capturing,
    session_writer,
    clock_writer,
    host_epoch,
    sleep,
    poll_interval_s,
    should_stop,
    on_cycle=None,
    poll_cycle=poll_cycle,
):
    """Poll the AS11 in shadow mode until `should_stop()`; write both sidecars each cycle.

    `is_capturing()` gates the poll — while the CPAP controller streams, the runner takes NO
    connection (it must not fight the controller for the one AS11 link) and just sleeps. When idle,
    it runs one `poll_cycle`, writes the decision to `session_writer` (SESSIONDETECT.csv) and the
    clock row to `clock_writer` (AS11CLOCK.csv), and — on a device read that failed at the
    connection level — records nothing but the unreachable decision. `on_cycle`, if given, receives
    each `(decision, anchor)` (the seam a caller uses to accumulate anchors for as11_clock.analyze)."""
    while not should_stop():
        if is_capturing():
            await sleep(poll_interval_s)
            continue
        try:
            decision, anchor, clock_row = await poll_cycle(
                connect=connect, creds=creds, supervisor=supervisor, host_epoch=host_epoch
            )
        except (OSError, as11_pull.As11Error):
            # connect/establish failed outright — a link we could not open, not a device verdict.
            # Expected and frequent (the AS11 is off, or the controller holds it), so kept quiet.
            await sleep(poll_interval_s)
            continue
        except Exception as e:
            # A shadow OBSERVER must survive ANY poll failure — never let one crash the loop. The
            # bleak connect (an injected seam) raises BleakError/BleakDBusError subclasses that are
            # NOT OSError — e.g. `org.bluez.Error.InProgress` when the adapter is contended by the
            # wearable captures — and one such error silently killed this task on 2026-08-25 (enabled,
            # armed, zero rows). Log it so a persistent fault is VISIBLE rather than invisible, then
            # keep polling. (CancelledError is a BaseException, so a clean shutdown still propagates.)
            log.warning("AS11 shadow poll failed (%s: %s) — skipping cycle", type(e).__name__, e)
            await sleep(poll_interval_s)
            continue
        session_writer.write(decision)
        host_s, device_iso, device_epoch = clock_row
        offset = (host_s - device_epoch) if device_epoch is not None else None
        clock_writer.write(_utc_iso(host_s), host_s, device_iso, device_epoch, offset)
        if on_cycle is not None:
            on_cycle(decision, anchor)
        await sleep(poll_interval_s)


def _utc_iso(epoch_s: float) -> str:
    import datetime

    return datetime.datetime.fromtimestamp(epoch_s, datetime.timezone.utc).isoformat(timespec="seconds")


class SessionSidecar:
    """The SESSIONDETECT.csv sidecar — one row per shadow decision, duck-typed on Decision.as_row()
    (the RingClock/OxyLife idiom). Owns the file + header; Decision owns the row schema."""

    def __init__(self, path: str):
        from cpap_supervisor import Decision

        self.path = path
        # APPEND + line-buffered, never truncating "w" at 64 KB — see the identical note on
        # as11_clock.ClockSidecar. A daemon restart must not cost the night's decisions, and a
        # decision row must reach disk when it is made, not when 64 KB has accumulated.
        fresh = not os.path.exists(path) or os.path.getsize(path) == 0
        self._fh = open(path, "a", buffering=1, newline="\n")
        if fresh:
            self._fh.write(";".join(Decision.ROW_FIELDS) + "\n")
        self.rows = 0

    def write(self, decision) -> None:
        self._fh.write(decision.as_row() + "\n")
        self.rows += 1

    def close(self) -> None:
        try:
            self._fh.flush()
            self._fh.close()
        except (OSError, ValueError):
            pass
