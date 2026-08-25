# tepna-capture — tests/test_probe_as11_clock.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Covers run_clock's orchestration with every hardware seam injected: connect / establish / cipher /
# get_date_time / host_epoch (UTC) / sleep / sidecar. The bleak edges (_connect, _default_sidecar, main)
# are the pragma'd I/O; establish + get_date_time are covered in test_as11_pull.

import asyncio
import datetime

import pytest

import as11_pull
import probe_as11_clock as probe

CREDS = {"masterPairKey": "00ff", "clientId": "c1", "ble_addr": "AA:BB"}
BASE = 1787606080  # a whole-second UTC epoch


def _run(coro):
    return asyncio.run(coro)


class _Sidecar:
    def __init__(self, _path):
        self.rows = []
        self.closed = False

    def write(self, host_wall, host_epoch, device_iso, device_epoch, offset):
        self.rows.append((host_wall, host_epoch, device_iso, device_epoch, offset))

    def close(self):
        self.closed = True


def _seams(calls):
    async def connect():
        async def write(_f):
            return None

        async def recv():
            return (0, b"")

        async def disconnect():
            calls.append("disconnect")

        return write, recv, disconnect

    async def establish(_pk, _cid, _w, _r):
        return b"session-key"

    def cipher_factory(_key):
        return (lambda x: x), (lambda x: x)

    return connect, establish, cipher_factory


def _epochs(start, step_s):
    t = {"s": start}

    def host_epoch():
        cur = t["s"]
        t["s"] = cur + step_s
        return float(cur)

    return host_epoch


def _device_iso(host_s, ahead_s):
    """The device stamp the AS11 would return: host time + `ahead_s` (device runs fast), UTC-labelled."""
    return datetime.datetime.fromtimestamp(host_s + ahead_s, datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


async def _no_sleep(_s):
    return None


def test_run_clock_collects_anchors_and_reports_offset():
    calls = []
    connect, establish, cipher_factory = _seams(calls)
    sidecars = {}

    def make_sidecar(path):
        sc = _Sidecar(path)
        sidecars["sc"] = sc
        return sc

    # device runs 21 min (1260 s) ahead of UTC, flat → a real minute
    isos = iter([_device_iso(BASE + 30 * i, 1260) for i in range(3)])

    async def get_date_time(_w, _r, _s, _u):
        return next(isos)

    result = _run(
        probe.run_clock(
            connect=connect,
            creds=CREDS,
            out_path="AS11CLOCK.csv",
            interval_s=30.0,
            count=3,
            make_sidecar=make_sidecar,
            establish=establish,
            cipher_factory=cipher_factory,
            get_date_time=get_date_time,
            host_epoch=_epochs(BASE, 30),
            sleep=_no_sleep,
        )
    )
    assert result["ok"] is True
    assert round(result["offset_min"], 1) == -21.0  # device ahead of UTC → host−device negative
    assert result["minute_is_real"] is True
    assert sidecars["sc"].rows and sidecars["sc"].closed is True
    assert calls == ["disconnect"]


def test_run_clock_failed_read_writes_blank_and_skips_anchor():
    calls = []
    connect, establish, cipher_factory = _seams(calls)

    async def get_date_time(*_a):
        raise as11_pull.As11Error("no reply")

    sc = _Sidecar("x")
    result = _run(
        probe.run_clock(
            connect=connect,
            creds=CREDS,
            out_path="x",
            interval_s=1.0,
            count=1,
            make_sidecar=lambda _p: sc,
            establish=establish,
            cipher_factory=cipher_factory,
            get_date_time=get_date_time,
            host_epoch=_epochs(BASE, 30),
            sleep=_no_sleep,
        )
    )
    assert result["ok"] is False and result["reason"] == "too-few"  # no anchor collected
    assert len(sc.rows) == 1
    assert sc.rows[0][2] is None and sc.rows[0][4] is None  # device_iso + offset blank


def test_run_clock_count_none_until_interrupted():
    calls = []
    connect, establish, cipher_factory = _seams(calls)

    async def get_date_time(*_a):
        return "2026-08-25T01:35:00Z"

    async def sleep_boom(_s):
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        _run(
            probe.run_clock(
                connect=connect,
                creds=CREDS,
                out_path="x",
                interval_s=1.0,
                count=None,
                make_sidecar=lambda _p: _Sidecar(_p),
                establish=establish,
                cipher_factory=cipher_factory,
                get_date_time=get_date_time,
                host_epoch=_epochs(BASE, 30),
                sleep=sleep_boom,
            )
        )
    assert calls == ["disconnect"]


def test_run_clock_sidecar_none_when_establish_fails():
    calls = []
    connect, _establish, cipher_factory = _seams(calls)

    async def bad_establish(*_a):
        raise as11_pull.As11Error("handshake failed")

    with pytest.raises(as11_pull.As11Error):
        _run(
            probe.run_clock(
                connect=connect,
                creds=CREDS,
                out_path="x",
                interval_s=1.0,
                count=1,
                establish=bad_establish,
                cipher_factory=cipher_factory,
                get_date_time=lambda *_a: None,
                host_epoch=_epochs(BASE, 30),
                sleep=_no_sleep,
            )
        )
    assert calls == ["disconnect"]
