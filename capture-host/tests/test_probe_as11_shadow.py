# tepna-capture — tests/test_probe_as11_shadow.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Covers the shadow probe's orchestration glue (run_shadow) with every hardware seam injected:
# connect / establish / cipher / get_items / clock / sleep / writer. The bleak edges (_connect,
# _default_writer, main) are the pragma'd I/O; establish + get_items themselves are covered in
# test_as11_pull.

import asyncio

import pytest

import as11_pull
import probe_as11_shadow as probe
from cpap_supervisor import CPAPSessionSupervisor, SessionState

CREDS = {"masterPairKey": "00ff", "clientId": "c1", "ble_addr": "AA:BB"}


def _run(coro):
    return asyncio.run(coro)


class _Writer:
    def __init__(self, _path):
        self.rows = []
        self.closed = False

    def write(self, decision):
        self.rows.append(decision.as_row())

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
        return (lambda x: x), (lambda x: x)  # identity

    return connect, establish, cipher_factory


def _make_reader(sequence):
    it = iter(sequence)

    async def get_items(_w, _r, _s, _u, _names):
        item = next(it)
        if isinstance(item, Exception):
            raise item
        return item

    return get_items


async def _no_sleep(_s):
    return None


def test_run_shadow_polls_and_journals_then_stops_on_count():
    calls = []
    connect, establish, cipher_factory = _seams(calls)
    writers = {}

    def make_writer(path):
        w = _Writer(path)
        writers["w"] = w
        return w

    reader = _make_reader(
        [
            {"FGState": "Therapy", "MachineMetrics": {"LastTherapyUseDateTime": "2026-08-24T21:00:00Z"}},
            {"FGState": "Therapy", "MachineMetrics": {"LastTherapyUseDateTime": "2026-08-24T23:00:00Z"}},
        ]
    )
    sup = CPAPSessionSupervisor()
    _run(
        probe.run_shadow(
            connect=connect,
            creds=CREDS,
            out_path="x.csv",
            interval_s=5.0,
            count=2,
            make_writer=make_writer,
            supervisor=sup,
            establish=establish,
            cipher_factory=cipher_factory,
            get_items=reader,
            mono=lambda: 1.0,
            sleep=_no_sleep,
        )
    )
    w = writers["w"]
    assert len(w.rows) == 2  # two polls journalled
    assert w.closed is True  # writer closed in finally
    assert calls == ["disconnect"]  # link closed in finally
    # start then device-verdict stop across the two polls
    assert sup.state == SessionState.IDLE


def test_run_shadow_read_error_becomes_unreachable():
    calls = []
    connect, establish, cipher_factory = _seams(calls)
    reader = _make_reader([as11_pull.As11Error("boom")])
    rows = []

    class W:
        def __init__(self, _p):
            pass

        def write(self, d):
            rows.append(d.trigger)

        def close(self):
            pass

    _run(
        probe.run_shadow(
            connect=connect,
            creds=CREDS,
            out_path="x.csv",
            interval_s=1.0,
            count=1,
            make_writer=W,
            establish=establish,
            cipher_factory=cipher_factory,
            get_items=reader,
            mono=lambda: 0.0,
            sleep=_no_sleep,
        )
    )
    assert rows == ["unreachable_hold"]


def test_run_shadow_count_none_loops_until_interrupted():
    # count=None → should_stop always False; a sleep that raises breaks the otherwise-infinite loop
    # after exactly one poll, exercising the count-is-None branch and the finally.
    calls = []
    connect, establish, cipher_factory = _seams(calls)
    reader = _make_reader([{"FGState": "Standby"}])

    async def sleep_boom(_s):
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        _run(
            probe.run_shadow(
                connect=connect,
                creds=CREDS,
                out_path="x.csv",
                interval_s=1.0,
                count=None,
                make_writer=_Writer,
                establish=establish,
                cipher_factory=cipher_factory,
                get_items=reader,
                mono=lambda: 0.0,
                sleep=sleep_boom,
            )
        )
    assert calls == ["disconnect"]  # finally still ran


def test_run_shadow_writer_none_when_establish_fails():
    # establish raises before the writer is built → finally must skip writer.close but still
    # disconnect (covers the `if writer is not None` False arm).
    calls = []
    connect, _establish, cipher_factory = _seams(calls)

    async def bad_establish(*_a):
        raise as11_pull.As11Error("handshake failed")

    with pytest.raises(as11_pull.As11Error):
        _run(
            probe.run_shadow(
                connect=connect,
                creds=CREDS,
                out_path="x.csv",
                interval_s=1.0,
                count=1,
                establish=bad_establish,
                cipher_factory=cipher_factory,
                get_items=_make_reader([]),
                mono=lambda: 0.0,
                sleep=_no_sleep,
            )
        )
    assert calls == ["disconnect"]
