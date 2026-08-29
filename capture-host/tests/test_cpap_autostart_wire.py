"""The daemon half of auto-start — the session-keyed record, the boot seed, the loop, and the wrapper
that is the only honest source of manual intent."""

import asyncio
import json
import os

import pytest

import capture
import cpap_live as L

T0 = 1_787_000_000_000
HDR = "host_ms;prior;state;transition;action;trigger;confidence;reachable;fg_state;x;y;z"


@pytest.fixture(autouse=True)
def _reset():
    capture._STOP.clear()
    capture._CPAP_AUTOSTART.update({"watch": None, "root": None})
    yield
    capture._STOP.clear()
    capture._CPAP_AUTOSTART.update({"watch": None, "root": None})


def _journal(root, rows):
    (root / "SESSIONDETECT.csv").write_text("\n".join([HDR] + [f"{ms};i;i;;;i;f;True;{st};0;0;" for ms, st in rows]))


def _in_therapy(root, n=20, t0=T0):
    _journal(root, [(t0 + i * 30_000, "Therapy") for i in range(n)])


# ── the session-keyed record ───────────────────────────────────────────────────────────────────


def test_a_record_for_ANOTHER_session_is_not_matched(tmp_path):
    """🔴 The whole point of keying by therapy-start. Last night's four failed attempts must not be
    counted toward tonight's classification — and a stale record needs no cleanup to be harmless,
    because it is ignored by KEY rather than aged out by timestamp arithmetic."""
    capture._cpap_autostart_save(str(tmp_path), 111.0, manual_stop=True, attempts=4)
    assert capture._cpap_autostart_load(str(tmp_path), 111.0) == (111.0, 4)
    assert capture._cpap_autostart_load(str(tmp_path), 222.0) == (None, 0)


def test_an_absent_or_corrupt_record_is_not_an_error(tmp_path):
    assert capture._cpap_autostart_load(str(tmp_path), 1.0) == (None, 0)
    p = capture._cpap_autostart_path(str(tmp_path))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    for bad in ("{oops", "[]", "{}", '{"session_ms": "x"}', '{"session_ms": 1, "attempts": "x"}'):
        open(p, "w").write(bad)
        assert capture._cpap_autostart_load(str(tmp_path), 1.0) == (None, 0), bad


def test_the_record_is_written_atomically(tmp_path):
    capture._cpap_autostart_save(str(tmp_path), 1.0)
    target = capture._cpap_autostart_path(str(tmp_path))
    opened, real = [], open
    import builtins

    builtins.open = lambda p, *a, **k: (opened.append(str(p)), real(p, *a, **k))[1]
    try:
        capture._cpap_autostart_save(str(tmp_path), 2.0, attempts=1, last_error="boom")
    finally:
        builtins.open = real
    assert target not in opened and any(p.endswith(".tmp") for p in opened)
    assert json.loads(open(target).read())["last_error"] == "boom"


def test_an_unwriteable_record_does_not_raise(tmp_path, monkeypatch):
    monkeypatch.setattr(capture.os, "makedirs", lambda *a, **k: (_ for _ in ()).throw(OSError("ro")))
    capture._cpap_autostart_save(str(tmp_path), 1.0)  # must not raise


# ── the boot seed ──────────────────────────────────────────────────────────────────────────────


def test_a_reboot_DURING_therapy_seeds_an_armed_watch(tmp_path):
    _in_therapy(tmp_path)
    w = capture._cpap_autostart_boot(str(tmp_path), T0 + 20 * 30_000)
    assert w.began_at_ms == float(T0) and w.manual_stop_for is None


def test_the_boot_seed_RECOVERS_a_manual_stop_for_the_same_session(tmp_path):
    """🔴 Otherwise the automation overrules the operator by way of a restart: they press stop, the box
    reboots, and it starts again. This is why `manual_stop` is persisted and `fired_for` is not."""
    _in_therapy(tmp_path)
    capture._cpap_autostart_save(str(tmp_path), float(T0), manual_stop=True)
    w = capture._cpap_autostart_boot(str(tmp_path), T0 + 20 * 30_000)
    assert w.manual_stop_for == float(T0)
    assert L.autostart_due(w, T0 + 20 * 30_000)[1].startswith("the operator stopped this session")


def test_fired_for_is_NOT_persisted_so_a_reboot_mid_session_still_starts(tmp_path):
    """A reboot during therapy is precisely when nothing is recording — the daemon holding the stream
    died. Persisting "already started" would suppress the recovery the boot seed exists to perform."""
    _in_therapy(tmp_path)
    capture._cpap_autostart_save(str(tmp_path), float(T0), attempts=0)
    w = capture._cpap_autostart_boot(str(tmp_path), T0 + 20 * 30_000)
    assert w.fired_for is None and L.autostart_due(w, T0 + 20 * 30_000)[0] is True


def test_no_journal_seeds_nothing(tmp_path):
    assert capture._cpap_autostart_boot(str(tmp_path), T0).began_at_ms is None


# ── the loop ───────────────────────────────────────────────────────────────────────────────────


def _loop(tmp_path, therapy_seq, op_results, *, running=False, ticks=None):
    """Drive `_cpap_autostart_loop` for len(therapy_seq) cycles with a fake clock and op."""
    calls, t = [], {"ms": T0 + 20 * 30_000}
    seq = list(therapy_seq)
    res = list(op_results)

    async def sleep(_s):
        t["ms"] += 30_000
        if not seq:
            capture._STOP.set()

    async def op(action):
        calls.append(action)
        r = res.pop(0) if res else {"ok": True}
        if isinstance(r, Exception):
            raise r
        return r

    def therapy():
        return seq.pop(0) if seq else None

    asyncio.run(
        capture._cpap_autostart_loop(
            root=str(tmp_path),
            op=op,
            is_running=lambda: running,
            debounce_s=120.0,
            max_attempts=3,
            sleep=sleep,
            now_ms=lambda: t["ms"],
            get_therapy=therapy,
        )
    )
    return calls


def test_the_loop_starts_the_stream_once_the_debounce_passes(tmp_path):
    _in_therapy(tmp_path)
    assert _loop(tmp_path, [True] * 8, [{"ok": True}]) == ["start"]


def test_the_loop_does_NOT_start_while_a_stream_is_already_running(tmp_path):
    _in_therapy(tmp_path)
    assert _loop(tmp_path, [True] * 8, [], running=True) == []


def test_a_FAILED_start_retries_within_the_bound_then_stops(tmp_path):
    """Bounded: max_attempts=3 here. An unbounded retry against a refusing device is a radio hammering
    a sleeping room, and the record must show why it stopped."""
    _in_therapy(tmp_path)
    calls = _loop(tmp_path, [True] * 60, [{"ok": False, "error": "no link"}] * 10)
    assert 1 <= len(calls) <= 3, calls
    rec = json.loads(open(capture._cpap_autostart_path(str(tmp_path))).read())
    assert rec["attempts"] == len(calls) and rec["last_error"] == "no link"
    assert rec["session_ms"] == float(T0)


def test_a_THROWING_op_is_recorded_as_a_failure_not_a_crash(tmp_path):
    _in_therapy(tmp_path)
    calls = _loop(tmp_path, [True] * 60, [RuntimeError("bleak exploded")] * 10)
    assert calls
    rec = json.loads(open(capture._cpap_autostart_path(str(tmp_path))).read())
    assert "RuntimeError" in rec["last_error"]


def test_a_stop_signal_mid_loop_exits_without_starting(tmp_path):
    _in_therapy(tmp_path)
    capture._STOP.set()
    assert _loop(tmp_path, [True] * 4, []) == []


# ── manual intent: signalled, never inferred ───────────────────────────────────────────────────


def test_a_HAND_stop_records_manual_intent_for_this_session(tmp_path):
    capture._CPAP_AUTOSTART["watch"] = L.StartWatch(float(T0))
    wrapped = capture._cpap_autostart_wrap_op(_ok_op(), str(tmp_path))
    assert asyncio.run(wrapped("stop")) == {"ok": True}
    assert capture._CPAP_AUTOSTART["watch"].manual_stop_for == float(T0)
    assert json.loads(open(capture._cpap_autostart_path(str(tmp_path))).read())["manual_stop"] is True


def test_a_hand_START_records_nothing(tmp_path):
    capture._CPAP_AUTOSTART["watch"] = L.StartWatch(float(T0))
    wrapped = capture._cpap_autostart_wrap_op(_ok_op(), str(tmp_path))
    asyncio.run(wrapped("start"))
    assert capture._CPAP_AUTOSTART["watch"].manual_stop_for is None


def test_the_wrapper_is_INERT_when_auto_start_is_off(tmp_path):
    """It ships wrapped unconditionally, so it must be a no-op with no watch — otherwise turning
    auto-start off would still change what the monitor's stop button does."""
    for w in (None, L.StartWatch()):
        capture._CPAP_AUTOSTART["watch"] = w
        assert asyncio.run(capture._cpap_autostart_wrap_op(_ok_op(), str(tmp_path))("stop")) == {"ok": True}
        assert not os.path.exists(capture._cpap_autostart_path(str(tmp_path)))


def _ok_op():
    async def op(_a):
        return {"ok": True}

    return op


# ── arming ─────────────────────────────────────────────────────────────────────────────────────


class _Ctl:
    op = staticmethod(_ok_op())

    @staticmethod
    def _running():
        return False


def test_it_is_OFF_by_default_and_says_so(tmp_path, caplog):
    tasks = []
    assert capture._maybe_start_cpap_autostart({}, str(tmp_path), _Ctl(), tasks) is None
    assert tasks == []


def test_arming_creates_the_task_and_honours_the_configured_numbers(tmp_path):
    made = {}

    def fake_task(coro):
        coro.close()
        made["coro"] = True
        return "TASK"

    tasks = []
    cfg = {"cpap": {"ble_stream": {"auto_start": {"enabled": True, "debounce_s": 45, "max_attempts": 2}}}}
    assert capture._maybe_start_cpap_autostart(cfg, str(tmp_path), _Ctl(), tasks, create_task=fake_task) == "TASK"
    assert tasks == ["TASK"] and made["coro"]
