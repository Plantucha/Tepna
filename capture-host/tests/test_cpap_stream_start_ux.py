# tepna-capture — tests/test_cpap_stream_start_ux.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The interactive Start path: what a person waiting on a button is told, and what the shadow
detector does while they wait.

⚠️ WITNESSED HALF / UNWITNESSED HALF, stated plainly. The CPAP was NOT advertising on the night this
was written (empty scan, shadow poll device-not-found on a loop), so the UNREACHABLE path is the one
the owner actually hit and the SUCCESS path was exercised only against a fake transport. Nothing here
claims the happy path was seen on hardware.
"""

import asyncio

import cpap_stream as CS
from test_cpap_stream import _ControllerBus, _creds, _idle_devices, _idle_pump


def _run(c):
    return asyncio.run(c)


def _blocking_connect(gate):
    async def connect():
        await gate.wait()

        async def write(_f):
            pass

        async def recv_frame():
            await asyncio.sleep(3600)

        async def disconnect():
            pass

        return write, recv_frame, disconnect

    return connect


def test_the_shadow_DEFERS_from_start_INTENT_not_from_capturing():
    """🔴 The race the owner hit as `org.bluez.Error.InProgress`. `_running` is True only once the pump
    task exists, and that happens AFTER `await self._connect()` — so through the whole connect and
    key-exchange window the controller read as idle, the shadow poll fired, and both reached for the
    same AS11 on the same radio. The AS11 accepts ONE connection."""

    async def go():
        gate = asyncio.Event()
        c = CS.LiveStreamController(_ControllerBus(), _blocking_connect(gate), _creds, _idle_devices, pump=_idle_pump)
        assert c._busy() is False, "idle before anyone clicks"
        task = asyncio.create_task(c.op("start"))
        await asyncio.sleep(0)  # let the start reach the connect and block there
        assert c._running() is False, "the pump task does not exist yet — this is the window"
        assert c._busy() is True, "the shadow would have polled straight into the connect"
        gate.set()
        await task
        assert c._busy() is True and c._running() is True
        await c.op("stop")
        assert c._busy() is False

    _run(go())


def test_the_start_flag_is_cleared_when_the_start_FAILS():
    """A flag left set on the failure path would mute the shadow detector for the rest of the night —
    worse than the race it closes."""

    async def go():
        async def boom():
            raise RuntimeError("no radio")

        c = CS.LiveStreamController(_ControllerBus(), boom, _creds, _idle_devices, pump=_idle_pump)
        r = await c.op("start")
        assert r["ok"] is False
        assert c._busy() is False, "the detector would stay muted after a failed start"

    _run(go())


def test_a_RE_CLICK_answers_immediately_instead_of_queueing():
    """`op` holds the lock across the connect, so a second click used to block for the whole timeout
    and then run a start nobody wanted any more — N clicks became N connects."""

    async def go():
        gate = asyncio.Event()
        c = CS.LiveStreamController(_ControllerBus(), _blocking_connect(gate), _creds, _idle_devices, pump=_idle_pump)
        first = asyncio.create_task(c.op("start"))
        await asyncio.sleep(0)
        second = await asyncio.wait_for(c.op("start"), timeout=0.5)  # must NOT wait on the connect
        assert second["ok"] is True and second["starting"] is True and second["already"] is True
        assert "already in progress" in second["detail"]
        gate.set()
        await first
        await c.op("stop")

    _run(go())


def test_an_ABSENT_cpap_is_an_ORDINARY_ANSWER_not_a_500():
    """The owner's actual experience: ~36 s on 'starting…' then a bare 500 carrying a bleak class
    name. The device is either advertising or it is not — off, asleep, or the myAir app holding the
    AS11's one BLE link — and that is a sentence, not a fault."""

    async def go():
        class _NotFound(Exception):
            pass

        _NotFound.__name__ = "BleakDeviceNotFoundError"

        async def connect():
            raise _NotFound("04:CD:15:3A:0B:BD not found")

        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices, pump=_idle_pump)
        r = await c.op("start")
        assert r["ok"] is False and r["unreachable"] is True
        assert "myAir" in r["error"] and "one BLE link" in r["error"]
        assert "Bleak" not in r["error"], "a class name is not an answer for a person"

    _run(go())


def test_an_UNEXPECTED_connect_error_is_still_reported_as_itself():
    """The control: only a not-found becomes the friendly sentence. Anything else must keep its own
    identity rather than being flattened into 'the CPAP is off'."""

    async def go():
        async def connect():
            raise PermissionError("no adapter access")

        c = CS.LiveStreamController(_ControllerBus(), connect, _creds, _idle_devices, pump=_idle_pump)
        r = await c.op("start")
        assert r["ok"] is False and "unreachable" not in r
        assert "PermissionError" in r["error"]

    _run(go())


def test_stop_still_takes_the_lock_the_ordinary_way():
    """Only START got the try-acquire. A stop must still serialise, or a double-stop could
    double-tear-down the link."""

    async def go():
        c = CS.LiveStreamController(
            _ControllerBus(), _blocking_connect(asyncio.Event()), _creds, _idle_devices, pump=_idle_pump
        )
        r1, r2 = await asyncio.gather(c.op("stop"), c.op("stop"))
        assert r1 == {"ok": True, "streaming": False} and r2 == {"ok": True, "streaming": False}

    _run(go())
