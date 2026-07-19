# tepna-capture — tests/test_offline_op_deadlock.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Regression for a PRODUCTION deadlock, 2026-07-19. A routine clock re-sync (the H10 had drifted 11 s)
# ran through polar_offline_op against devices carried out of range. The PS-FTP op never returned, and
# because this call holds BOTH _POLAR_PAUSED and _CONNECT_LOCK for its whole life, every capture task
# idled and no device could reconnect.
#
# 58 minutes, ZERO bytes written. The monitor sat frozen showing connected=True / 12-of-12 streams —
# all stale state from before the pause. Nothing logged an error; the log's last word was "live capture
# paused". SIGTERM could not cancel it; it took SIGKILL. On restart it reproduced within one second.
#
# Three things made it unrecoverable rather than merely slow:
#   * adapter_watchdog, clock_watchdog and rssi_poller ALL skip while _POLAR_PAUSED is non-empty, so the
#     one mechanism built to unwedge a stuck radio is disabled by exactly the condition that wedges it.
#   * bleak's own timeouts did not bound it — find_device_by_address(timeout=15) and
#     BleakClient(timeout=25) were both in the path. A wedged BlueZ leaves the D-Bus call outstanding.
#   * the pause is invisible: STATUS keeps reporting the last-known-good device state.
# So the bound has to live at the point that holds the locks.

import asyncio as _aio

import pytest

import capture


# ── polar_offline_op — the pause must never be permanent ────────────────────────────────────────────
# 2026-07-19: a routine clock re-sync against an out-of-range device hung inside this call. It holds
# _POLAR_PAUSED and _CONNECT_LOCK for its whole life, so every capture task idled and no device could
# reconnect — 58 minutes, zero bytes written, monitor frozen on stale state, no error logged. The
# watchdogs could not help: all three skip while _POLAR_PAUSED is non-empty.



def _run_async(coro):
    return _aio.run(coro)


def _clear_pause(monkeypatch):
    monkeypatch.setattr(capture, "_POLAR_PAUSED", set())
    monkeypatch.setattr(capture, "STATUS", {"devices": {}})


def test_offline_op_returns_its_result_and_releases_the_pause(monkeypatch):
    _clear_pause(monkeypatch)

    async def op():
        return {"ok": True}
    assert _run_async(capture.polar_offline_op("AA:BB", op)) == {"ok": True}
    assert capture._POLAR_PAUSED == set(), "the pause must be released on success"


def test_offline_op_releases_the_pause_when_the_op_raises(monkeypatch):
    _clear_pause(monkeypatch)

    async def op():
        raise RuntimeError("psftp refused")
    with pytest.raises(RuntimeError):
        _run_async(capture.polar_offline_op("AA:BB", op))
    assert capture._POLAR_PAUSED == set()


def test_a_HUNG_offline_op_cannot_wedge_capture_forever(monkeypatch):
    """THE regression. Without the timeout this never returns, and neither does the capture daemon."""
    _clear_pause(monkeypatch)
    monkeypatch.setattr(capture, "_OFFLINE_OP_TIMEOUT_S", 0.05)

    async def hangs_forever():
        await _aio.sleep(3600)
    with pytest.raises(_aio.TimeoutError):
        _run_async(capture.polar_offline_op("AA:BB", hangs_forever))
    assert capture._POLAR_PAUSED == set(), "a hung op MUST still release the pause"
    assert not capture._CONNECT_LOCK.locked(), "and must not leave the connect lock held"


def test_the_timeout_is_finite_and_generous_enough_for_a_real_pull(monkeypatch):
    """A stored-session pull allows 180 s for a single file, so the ceiling must sit above that or a
    legitimate download would be killed mid-transfer."""
    assert 180 < capture._OFFLINE_OP_TIMEOUT_S < 3600
