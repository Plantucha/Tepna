"""The daemon half of auto-start — the session-keyed record, the boot seed, the loop, and the wrapper
that is the only honest source of manual intent."""

import asyncio
import json
import os

import pytest

import capture
import cpap_live as L

# The nights these tests judge are 2026-08-29, and the journal rows must fall INSIDE that night —
# they did not before. A fixed epoch (2026-08-17) only ever worked because `therapy_minutes` summed
# the whole journal regardless of which night it was asked about; scoping it exposed the mismatch.
# Anchored here so the data states the night it belongs to.
import datetime as _d

T0 = _d.datetime.combine(_d.date(2026, 8, 29), _d.time(23, 0)).timestamp() * 1000.0
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


def _loop(tmp_path, therapy_seq, op_results, *, running=False, ticks=None,
          running_seq=None, paths=None, unlinked=None, unlink_fn=None):
    """Drive `_cpap_autostart_loop` for len(therapy_seq) cycles with a fake clock and op.

    `running_seq` scripts `is_running()` per tick (holding its last value) so a retention test can
    show a started stream ENDING; `paths`/`unlinked` wire the discard seam. The 30 s tick is the
    TEST clock's step, not the loop's poll_s — passed explicitly so the arithmetic below is
    unchanged from the gate era."""
    calls, t = [], {"ms": T0 + 20 * 30_000}
    seq = list(therapy_seq)
    res = list(op_results)
    rseq = list(running_seq or [])

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

    def is_running():
        if rseq:
            return rseq.pop(0) if len(rseq) > 1 else rseq[0]
        return running

    def unlink(p):
        (unlinked if unlinked is not None else []).append(p)

    unlink = unlink if unlink_fn is None else unlink_fn

    asyncio.run(
        capture._cpap_autostart_loop(
            root=str(tmp_path),
            op=op,
            is_running=is_running,
            retain_s=120.0,
            hold_s=120.0,
            max_attempts=3,
            get_last_paths=lambda: list(paths or []),
            poll_s=30.0,
            sleep=sleep,
            now_ms=lambda: t["ms"],
            get_therapy=therapy,
            unlink=unlink,
        )
    )
    return calls


def test_the_loop_starts_the_stream_at_the_first_sighting_and_only_once(tmp_path):
    """EAGER: one start, on the first tick that sees therapy — not after a gate."""
    _in_therapy(tmp_path)
    assert _loop(tmp_path, [True] * 8, [{"ok": True}], running_seq=[False, True]) == ["start"]


def test_a_FALSE_START_is_discarded_journalled_and_costs_an_attempt(tmp_path):
    """The retention half, end to end: our stream starts, ends 60 s later (< retain+hold = 240 s),
    and the loop deletes the fragment's files, saves the spent attempt, and leaves the session
    eligible for a bounded retry."""
    _in_therapy(tmp_path)
    gone = []
    # tick1: start (running False) · tick2: running True · tick3: ended -> judged · tick4+: therapy
    # over, so the (correctly permitted, budget-bounded) retry never re-fires in this fixture
    calls = _loop(tmp_path, [True, True, True, False, False, False], [{"ok": True}],
                  running_seq=[False, True, False, False],
                  paths=["/x/raw.jsonl", "/x/night.edf"], unlinked=gone)
    assert calls == ["start"]
    assert gone == ["/x/raw.jsonl", "/x/night.edf"], "the fragment must leave no orphan"
    rec = json.loads(open(capture._cpap_autostart_path(str(tmp_path))).read())
    assert rec["attempts"] == 1 and rec["last_error"].startswith("false start:")


def test_a_discard_survives_a_missing_file_and_NAMES_a_stubborn_one(tmp_path, caplog):
    """The two failure arms of the unlink: a file never written (or already gone) is silently fine —
    no orphan either way — while a file that CANNOT be removed is a real orphan the operator must
    hear about by name. Neither may kill the loop."""
    def unlink_fn(p):
        if "gone" in p:
            raise FileNotFoundError(p)
        raise OSError("permission denied")

    _in_therapy(tmp_path)
    with caplog.at_level("WARNING"):
        calls = _loop(tmp_path, [True, True, True, False, False, False], [{"ok": True}],
                      running_seq=[False, True, False, False],
                      paths=["/x/gone.edf", "/x/stuck.edf"], unlink_fn=unlink_fn)
    assert calls == ["start"]
    assert "could NOT be removed" in caplog.text and "/x/stuck.edf" in caplog.text
    assert "/x/gone.edf" not in caplog.text.split("could NOT")[1], "the missing file is not an orphan"
    rec = json.loads(open(capture._cpap_autostart_path(str(tmp_path))).read())
    assert rec["attempts"] == 1, "the judgment itself must survive both unlink failures"


def test_a_LONG_session_is_retained_and_spends_nothing(tmp_path):
    """The other direction: a stream that lives past retain+hold ends as a real session — no
    deletion, no attempt."""
    _in_therapy(tmp_path)
    gone = []
    # start at tick1; runs for 8 ticks (8*30 s = 240 s ≥ window) before ending
    calls = _loop(tmp_path, [True] * 12, [{"ok": True}],
                  running_seq=[False] + [True] * 8 + [False],
                  paths=["/x/raw.jsonl"], unlinked=gone)
    assert calls == ["start"] and gone == []
    rec = json.loads(open(capture._cpap_autostart_path(str(tmp_path))).read())
    assert rec["attempts"] == 0


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


# ── the watchdog tells a failed automation from a missed click ─────────────────────────────────

import cpap_stream_watch as W  # noqa: E402


def _edf(path, n_records, sec):
    path.parent.mkdir(parents=True, exist_ok=True)
    h = bytearray(b" " * 256)
    h[236:244] = f"{n_records:<8d}".encode()
    h[244:252] = f"{sec:<8g}".encode()
    path.write_bytes(bytes(h))


def test_a_FAILED_AUTOMATION_does_not_wear_the_missed_click_label(tmp_path):
    """🔴 On disk the two are byte-identical: an empty edf_dir beside a full therapy session. They
    demand OPPOSITE responses — one is a habit to fix, the other is a bug — so the distinction cannot
    be left to whoever reads the report."""
    _in_therapy(tmp_path, n=720)
    capture._cpap_autostart_save(str(tmp_path), float(T0), attempts=3, last_error="no link")
    got = capture._cpap_stream_watch_row(
        {"cpap": {"ble_stream": {"edf_dir": str(tmp_path / "edf")}}}, str(tmp_path), "2026-08-29"
    )
    assert got["state"] == W.AUTOSTART_FAILED
    assert got["attempts"] == 3 and "no link" in got["detail"]


def test_WITHOUT_a_record_the_same_night_is_still_NEVER_STARTED(tmp_path):
    """An unarmed box has no record, and "nobody clicked" is then the truth rather than a fallback."""
    _in_therapy(tmp_path, n=720)
    got = capture._cpap_stream_watch_row({}, str(tmp_path), "2026-08-29")
    assert got["state"] == W.NEVER_STARTED and "attempts" not in got


def test_a_record_from_a_DIFFERENT_night_cannot_relabel_this_one(tmp_path):
    """The record is keyed by therapy-start. A key outside this journal's own observed span belongs to
    a session these figures do not include — matched by KEY against the journal, not aged out."""
    _in_therapy(tmp_path, n=720)
    capture._cpap_autostart_save(str(tmp_path), float(T0 - 86_400_000), attempts=4, last_error="old")
    got = capture._cpap_stream_watch_row({}, str(tmp_path), "2026-08-29")
    assert got["state"] == W.NEVER_STARTED, "a previous night's failures relabelled tonight"


def test_a_record_does_not_override_a_stream_that_DID_run(tmp_path):
    """Attempts only explain an ABSENT stream. A stream that opened and died early is died-early
    whatever the earlier attempts were — otherwise a retry that eventually succeeded would be
    reported as a failure."""
    _in_therapy(tmp_path, n=720)
    capture._cpap_autostart_save(str(tmp_path), float(T0), attempts=2, last_error="transient")
    _edf(tmp_path / "edf" / "DATALOG" / "20260829" / "a_BRP.edf", 1, 60)
    got = capture._cpap_stream_watch_row(
        {"cpap": {"ble_stream": {"edf_dir": str(tmp_path / "edf")}}}, str(tmp_path), "2026-08-29"
    )
    assert got["state"] == W.DIED_EARLY


def test_a_CORRUPT_record_falls_back_to_never_started_rather_than_raising(tmp_path):
    _in_therapy(tmp_path, n=720)
    p = capture._cpap_autostart_path(str(tmp_path))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    for bad in ("{oops", "[1,2]", '{"attempts": "x"}'):
        open(p, "w").write(bad)
        assert capture._cpap_stream_watch_row({}, str(tmp_path), "2026-08-29")["state"] == W.NEVER_STARTED
