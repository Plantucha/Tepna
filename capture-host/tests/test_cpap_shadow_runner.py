# tepna-capture — tests/test_cpap_shadow_runner.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Branch coverage for the daemon shadow runner: one poll cycle (read-success/fail combos, clock
# anchor present/absent, disconnect) and the loop (coexistence gate, both sidecar writers, connect
# failure, on_cycle seam). No radio — every seam is injected.

import asyncio


import as11_pull
import cpap_shadow_runner as R
from cpap_supervisor import CPAPSessionSupervisor, Observation, SessionState, TherapyState

CREDS = {"masterPairKey": "00ff", "clientId": "c1"}
THERAPY_GR = {"FGState": "Therapy", "MachineMetrics": {"LastTherapyUseDateTime": "2026-08-25T01:00:00Z"}}


def _run(coro):
    return asyncio.run(coro)


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
        return b"key"

    def cipher_factory(_k):
        return (lambda x: x), (lambda x: x)

    return connect, establish, cipher_factory


def _epochs(start=1000.0, step=30.0):
    t = {"s": start}

    def host_epoch():
        cur = t["s"]
        t["s"] = cur + step
        return cur

    return host_epoch


# --- poll_cycle -------------------------------------------------------------------------


def test_poll_cycle_full_success():
    calls = []
    connect, establish, cipher_factory = _seams(calls)

    async def get_items(*_a):
        return THERAPY_GR

    async def get_date_time(*_a):
        return "2026-08-25T01:21:00Z"

    sup = CPAPSessionSupervisor()
    decision, anchor, row = _run(
        R.poll_cycle(
            connect=connect,
            creds=CREDS,
            supervisor=sup,
            host_epoch=_epochs(),
            establish=establish,
            cipher_factory=cipher_factory,
            get_items=get_items,
            get_date_time=get_date_time,
        )
    )
    assert decision.transition == "start"  # FGState Therapy
    assert anchor is not None and anchor[1] is not None  # device epoch parsed
    assert row[1] == "2026-08-25T01:21:00Z"
    assert calls == ["disconnect"]


def test_poll_cycle_get_items_error_is_unreachable():
    calls = []
    connect, establish, cipher_factory = _seams(calls)

    async def get_items(*_a):
        raise as11_pull.As11Error("no reply")

    async def get_date_time(*_a):
        return "2026-08-25T01:00:00Z"

    sup = CPAPSessionSupervisor()
    decision, anchor, row = _run(
        R.poll_cycle(
            connect=connect,
            creds=CREDS,
            supervisor=sup,
            host_epoch=_epochs(),
            establish=establish,
            cipher_factory=cipher_factory,
            get_items=get_items,
            get_date_time=get_date_time,
        )
    )
    assert decision.trigger == "unreachable_hold"  # get_items failed -> reachable False
    assert anchor is not None  # but the clock read still succeeded
    assert calls == ["disconnect"]


def test_poll_cycle_clock_error_gives_no_anchor():
    calls = []
    connect, establish, cipher_factory = _seams(calls)

    async def get_items(*_a):
        return {"FGState": "Standby"}

    async def get_date_time(*_a):
        raise as11_pull.As11Error("clock unread")

    sup = CPAPSessionSupervisor()
    decision, anchor, row = _run(
        R.poll_cycle(
            connect=connect,
            creds=CREDS,
            supervisor=sup,
            host_epoch=_epochs(),
            establish=establish,
            cipher_factory=cipher_factory,
            get_items=get_items,
            get_date_time=get_date_time,
        )
    )
    assert anchor is None and row[1] is None and row[2] is None
    assert decision.state == SessionState.IDLE


# --- run_shadow_loop --------------------------------------------------------------------


class _Writer:
    def __init__(self):
        self.rows = []

    def write(self, *args):
        self.rows.append(args)


async def _no_sleep(_s):
    return None


def _stopper(n):
    c = {"i": 0}

    def should_stop():
        c["i"] += 1
        return c["i"] > n

    return should_stop


def test_loop_defers_while_capturing():
    sw, cw = _Writer(), _Writer()
    slept = []

    async def sleep(s):
        slept.append(s)

    async def fake_poll(**_kw):
        raise AssertionError("must not poll while capturing")

    _run(
        R.run_shadow_loop(
            connect=None,
            creds=CREDS,
            supervisor=None,
            is_capturing=lambda: True,
            session_writer=sw,
            clock_writer=cw,
            host_epoch=_epochs(),
            sleep=sleep,
            poll_interval_s=5.0,
            should_stop=_stopper(2),
            poll_cycle=fake_poll,
        )
    )
    assert slept == [5.0, 5.0]  # deferred twice, never polled
    assert sw.rows == [] and cw.rows == []


def test_loop_polls_writes_both_sidecars_and_on_cycle():
    sw, cw = _Writer(), _Writer()
    seen = []

    class _Dec:
        pass

    async def fake_poll(**_kw):
        return _Dec(), (1000.0, 2260.0), (1000.0, "2026-08-25T01:00:00Z", 2260.0)

    _run(
        R.run_shadow_loop(
            connect=None,
            creds=CREDS,
            supervisor=None,
            is_capturing=lambda: False,
            session_writer=sw,
            clock_writer=cw,
            host_epoch=_epochs(),
            sleep=_no_sleep,
            poll_interval_s=5.0,
            should_stop=_stopper(1),
            on_cycle=lambda d, a: seen.append(a),
            poll_cycle=fake_poll,
        )
    )
    assert len(sw.rows) == 1  # decision written
    assert len(cw.rows) == 1 and cw.rows[0][4] == 1000.0 - 2260.0  # offset = host - device
    assert seen == [(1000.0, 2260.0)]


def test_loop_clock_offset_none_when_device_unparsed():
    sw, cw = _Writer(), _Writer()

    async def fake_poll(**_kw):
        return object(), None, (1000.0, None, None)  # device epoch unparsed

    _run(
        R.run_shadow_loop(
            connect=None,
            creds=CREDS,
            supervisor=None,
            is_capturing=lambda: False,
            session_writer=sw,
            clock_writer=cw,
            host_epoch=_epochs(),
            sleep=_no_sleep,
            poll_interval_s=5.0,
            should_stop=_stopper(1),
            poll_cycle=fake_poll,
        )
    )
    assert cw.rows[0][4] is None  # offset None (no on_cycle passed -> that branch too)


def test_loop_connect_failure_skips_cycle():
    sw, cw = _Writer(), _Writer()

    async def fake_poll(**_kw):
        raise OSError("connect refused")

    _run(
        R.run_shadow_loop(
            connect=None,
            creds=CREDS,
            supervisor=None,
            is_capturing=lambda: False,
            session_writer=sw,
            clock_writer=cw,
            host_epoch=_epochs(),
            sleep=_no_sleep,
            poll_interval_s=5.0,
            should_stop=_stopper(1),
            poll_cycle=fake_poll,
        )
    )
    # ⚠️ THIS ASSERTION WAS INVERTED 2026-08-30, deliberately: it used to read `sw.rows == []`
    # ("nothing written on a failed connect"), which pinned the defect rather than a contract. A
    # journal that records only successes cannot distinguish CPAP-absent from detector-dead from
    # daemon-down, and on 2026-08-29 that ambiguity made eleven hours unknowable. An unreachable poll
    # is now DATA. The CLOCK writer still gets nothing — there was no device time to read.
    assert len(sw.rows) == 1 and cw.rows == []
    cells = sw.rows[0][0].as_row().split(";")  # _Writer stores the ARG TUPLE, not a rendered row
    assert cells[4] == "unreachable" and cells[7] == "False"
    assert cells[5] == "OSError"  # the error CLASS, so a persistent fault is identifiable
    assert cells[8] == "", "fg_state must be BLANK — it was not observed"


def test_poll_cycle_does_not_leak_the_link_on_a_bad_connect_contract():
    # THE 27-MINUTE WEDGE, 2026-08-25. Everything after the BLE link opens but before the caller holds
    # the `disconnect` callable is uncovered ground: a raise there leaks the link, the peripheral stops
    # advertising because it is CONNECTED, and every later poll dies BleakDeviceNotFoundError — forever.
    # Only a manual `bluetoothctl disconnect` revived the real box. Here the transport hands back a
    # MALFORMED tuple (the injectable stand-in for that class of failure): the cycle must still fail,
    # must NOT raise NameError out of the finally, and must not hang.
    calls = []

    async def bad_connect():
        async def disconnect():
            calls.append("disconnect")

        return ("only-one-of-three",)  # unpack will raise inside the try

    sup = CPAPSessionSupervisor()
    try:
        _run(
            R.poll_cycle(
                connect=bad_connect,
                creds=CREDS,
                supervisor=sup,
                host_epoch=_epochs(),
                establish=None,
                cipher_factory=None,
                get_items=None,
                get_date_time=None,
            )
        )
        raise AssertionError("expected the malformed contract to raise")
    except NameError:  # the pre-fix failure: `disconnect` unbound in the finally, real error buried
        raise AssertionError("finally raised NameError — the real error was masked") from None
    except (ValueError, TypeError):
        pass  # correct: the unpack error propagates, and the finally did not explode on top of it


def test_loop_unexpected_error_survives_and_logs(caplog):
    # A bleak connect raises BleakError/BleakDBusError subclasses that are NOT OSError; one such error
    # (org.bluez.Error.InProgress under adapter contention) silently killed the shadow task on
    # 2026-08-25. The loop must SURVIVE it, write nothing, log a warning, and keep polling.
    sw, cw = _Writer(), _Writer()

    class _FakeBleakError(Exception):  # stands in for bleak's BleakDBusError (not an OSError)
        pass

    calls = {"n": 0}

    async def fake_poll(**_kw):
        calls["n"] += 1
        raise _FakeBleakError("org.bluez.Error.InProgress")

    with caplog.at_level("WARNING"):
        _run(
            R.run_shadow_loop(
                connect=None,
                creds=CREDS,
                supervisor=None,
                is_capturing=lambda: False,
                session_writer=sw,
                clock_writer=cw,
                host_epoch=_epochs(),
                sleep=_no_sleep,
                poll_interval_s=5.0,
                should_stop=_stopper(2),
                poll_cycle=fake_poll,
            )
        )
    assert calls["n"] == 2  # survived the first failure and polled again — did not die
    # Same inversion as above, and for the same reason: the 2026-08-25 incident this branch exists
    # for ("enabled, armed, zero rows") produced the SAME emptiness as an absent device. Recording
    # the failure is what tells the two apart afterwards.
    assert len(sw.rows) == 2 and cw.rows == []  # one per failed poll
    rows = [r[0].as_row().split(";") for r in sw.rows]
    assert all(c[7] == "False" for c in rows)
    assert all(c[5] == "_FakeBleakError" for c in rows)
    assert any(
        "AS11 shadow poll failed" in r.message and "InProgress" in r.message for r in caplog.records
    )  # the fault is VISIBLE, not silent


def test_utc_iso():
    s = R._utc_iso(1787621756.0)
    assert s.startswith("2026-") and s.endswith("+00:00")


def test_session_sidecar_survives_a_restart_and_writes_one_header(tmp_path):
    # Sibling of the ClockSidecar restart test — mode "w" truncated the night's decisions on every
    # daemon restart (11 on 2026-08-25). Reopen must preserve, and must not re-emit the header.
    p = tmp_path / "SESSIONDETECT.csv"
    sup = CPAPSessionSupervisor()
    first = R.SessionSidecar(str(p))
    first.write(
        sup.observe(Observation(host_ms=1000, reachable=True, fg_state=TherapyState.THERAPY, last_therapy_use=5))
    )
    first.close()

    second = R.SessionSidecar(str(p))  # ← the restart
    second.write(
        sup.observe(Observation(host_ms=61000, reachable=True, fg_state=TherapyState.THERAPY, last_therapy_use=5))
    )
    second.close()

    lines = p.read_text().splitlines()
    hdr = ";".join(__import__("cpap_supervisor").Decision.ROW_FIELDS)
    assert lines.count(hdr) == 1  # one header across both runs
    assert len(lines) == 3  # header + both decisions — nothing truncated
    assert second.rows == 1  # per-instance counter, not a file total


def test_session_sidecar_row_reaches_disk_without_close(tmp_path):
    p = tmp_path / "SESSIONDETECT.csv"
    sup = CPAPSessionSupervisor()
    sc = R.SessionSidecar(str(p))
    sc.write(sup.observe(Observation(host_ms=1000, reachable=True, fg_state=TherapyState.THERAPY, last_therapy_use=5)))
    assert "start" in p.read_text()  # durable before close — line-buffered, not 64 KB
    sc.close()


def test_session_sidecar_writes_header_rows_and_closes(tmp_path):
    p = tmp_path / "SESSIONDETECT.csv"
    sc = R.SessionSidecar(str(p))
    sup = CPAPSessionSupervisor()
    sc.write(sup.observe(Observation(host_ms=1000, reachable=True, fg_state=TherapyState.THERAPY, last_therapy_use=5)))
    sc.close()
    sc.close()  # idempotent — second close swallows the closed-handle error
    lines = p.read_text().splitlines()
    assert lines[0].startswith("host_ms;prior_state;state;transition")
    assert "start" in lines[1]
    assert sc.rows == 1


# ── the unreachable row (2026-08-30) ────────────────────────────────────────────────────────────


def test_the_unreachable_row_matches_the_journal_schema_exactly():
    """It rides the same file as a real Decision, so a column-count mismatch would corrupt every
    downstream reader — and those read by INDEX."""
    from cpap_supervisor import Decision

    row = R.UnreachableRow(1787000000000, "BleakDeviceNotFoundError").as_row()
    assert len(row.split(";")) == len(Decision.ROW_FIELDS)


def test_the_observation_columns_are_BLANK_never_zero():
    """🔴 fg_state, last_therapy_use, mask_pressure and baseline_use were NOT observed. A zero there
    would be a measurement nobody made — the same fabrication `reachable=False` exists to prevent."""
    from cpap_supervisor import Decision

    cells = dict(zip(Decision.ROW_FIELDS, R.UnreachableRow(1, "X").as_row().split(";")))
    for f in ("fg_state", "last_therapy_use", "mask_pressure", "baseline_use"):
        assert cells[f] == "", f"{f} carried a value nothing observed"
    assert cells["reachable"] == "False" and cells["action"] == "unreachable"
    assert cells["host_ms"] == "1", "the row must still say WHEN we failed to look"


def test_recording_a_failure_can_never_become_a_second_failure():
    """The writer is a report about a failure. If it raises, it would take down the observer that is
    still trying — turning a diagnostic into an outage."""

    class _Boom:
        @staticmethod
        def write(_row):
            raise OSError("disk full")

    R._write_unreachable(_Boom(), lambda: 1787000000.0, ValueError("x"))  # must not raise


# ── the seam that tells the caller a poll RAN AND FAILED ──────────────────────────────────────────
def test_A_FAILED_POLL_NOTIFIES_THE_CALLER_WITH_THE_EXCEPTION():
    """The loop has three outcomes and only two were observable from outside.

    A DEFERRED cycle (a wearable is streaming, so we never looked) writes nothing and calls nothing.
    A SUCCESSFUL poll calls `on_cycle`. A poll that ran and FAILED wrote a journal row and then
    `continue`d before `on_cycle` — so STATUS saw successes only and could not tell "the machine did
    not answer" from "we did not ask". Those need opposite responses."""
    seen = []
    R._notify_unreachable(seen.append, OSError("boom"))
    assert len(seen) == 1 and isinstance(seen[0], OSError)


def test_NO_HOOK_IS_NOT_AN_ERROR():
    R._notify_unreachable(None, OSError("boom"))     # must simply return


def test_A_HOOK_THAT_RAISES_DOES_NOT_BECOME_A_SECOND_FAILURE():
    # A REPORT about a failure must never take the loop down with it — the same rule
    # `_write_unreachable` follows.
    def _boom(_exc):
        raise RuntimeError("hook exploded")

    R._notify_unreachable(_boom, OSError("boom"))    # must not raise
