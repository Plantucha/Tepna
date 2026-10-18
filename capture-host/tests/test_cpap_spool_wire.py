# tepna-capture — tests/test_cpap_spool_wire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The daemon wiring for the scheduled stored-spool pull: capture._maybe_start_cpap_spool_pull and
# capture._cpap_spool_loop. Sibling of test_as11_shadow_wire.py, same injected-seam discipline —
# no radio, no clock, no real sleep. The bleak connect closure is the only pragma'd edge.

import asyncio
import datetime as _dt

import capture

ARMED = {"cpap": {"spool_pull": {"enabled": True}}}
CREDS = {"masterPairKey": "aa" * 32, "clientId": "tepna", "ble_addr": "AA:BB:CC:DD:EE:FF"}


# ── _maybe_start_cpap_spool_pull ─────────────────────────────────────────────
def test_disabled_is_a_noop_but_SAYS_SO(tmp_path, caplog):
    tasks = []
    with caplog.at_level("INFO"):
        assert capture._maybe_start_cpap_spool_pull({}, "cfg.yaml", str(tmp_path), object(), tasks) is None
    assert tasks == []
    # The whole point of the arming line: `autopull_arming` exists because a path that never armed
    # printed NOTHING, and no gate can observe an absent line.
    assert "NOT armed" in caplog.text and "never inherits" in caplog.text


def test_a_window_colliding_with_the_harvest_refuses_at_the_WIRING(tmp_path, caplog):
    cfg = {"cpap": {"enabled": True, "at_hour": 13, "spool_pull": {"enabled": True, "at_hour": 14}}}
    tasks = []
    with caplog.at_level("INFO"):
        assert capture._maybe_start_cpap_spool_pull(cfg, "cfg.yaml", str(tmp_path), object(), tasks) is None
    assert tasks == [] and "14" in caplog.text


def test_armed_without_creds_is_a_noop_and_names_the_reason(tmp_path, caplog):
    tasks = []
    with caplog.at_level("INFO"):
        r = capture._maybe_start_cpap_spool_pull(
            ARMED, "cfg.yaml", str(tmp_path), object(), tasks, load_creds=lambda _p: None
        )
    assert r is None and tasks == [] and "pair the AS11 first" in caplog.text


def test_armed_starts_the_task_labels_it_and_logs_the_window(tmp_path, caplog):
    made = []
    tasks = []

    # A UNIQUE OBJECT, never "TASK": `TASK_LABELS` is id()-keyed and CPython interns short string
    # literals, so a sibling test returning "TASK" collides on the same key.
    sentinel = object()

    def _create_task(coro):
        coro.close()  # never run it here; this test is about the WIRING
        made.append(coro)
        return sentinel

    async def _connect():  # pragma: no cover — injected so the bleak edge is never built
        raise AssertionError

    with caplog.at_level("INFO"):
        r = capture._maybe_start_cpap_spool_pull(
            ARMED,
            "cfg.yaml",
            str(tmp_path),
            _Ctl(),
            tasks,
            load_creds=lambda _p: CREDS,
            connect_factory=_connect,
            create_task=_create_task,
        )

    assert r is sentinel and tasks == [sentinel]
    assert capture.TASK_LABELS[id(sentinel)] == "CPAP stored-spool pull"
    assert "ARMED" in caplog.text and "10:00-12:00" in caplog.text


class _Ctl:
    _running = staticmethod(lambda: False)


# ── resolve_spool_root — no data path may depend on the daemon's cwd ─────────────────────────────────
def test_a_RELATIVE_configured_spool_root_resolves_against_the_box_root():
    """🔴 THE 2026-09-01 VIGIL INCIDENT, pinned. The owner's config said `root: captures/cpap-spool`
    — the `dest_subdir` idiom one line below it — and the value was consumed verbatim, so the 10:00
    pull resolved it against the daemon's CWD and wrote the only copy of real AS11 rounds INTO the
    /opt/tepna checkout, which then blocked every hourly auto-deploy (tepna-update refuses a dirty
    tree). Both halves of the contract, asserted: relative → joined to the box root; absolute →
    honored verbatim."""
    assert capture.resolve_spool_root("captures/cpap-spool", "/srv/tepna") == "/srv/tepna/captures/cpap-spool"
    assert capture.resolve_spool_root("/mnt/big/spool", "/srv/tepna") == "/mnt/big/spool"


def test_an_absent_spool_root_keeps_the_documented_default():
    assert capture.resolve_spool_root(None, "/srv/tepna") == "/srv/tepna/cpap-spool"
    assert capture.resolve_spool_root("", "/srv/tepna") == "/srv/tepna/cpap-spool"


def test_the_armed_path_routes_through_the_resolver(tmp_path, caplog):
    """The wiring, not just the pure rule: an armed start with a relative configured root must LOG
    the resolved absolute path — the ARMED line is the one surface an operator checks."""
    cfg = {
        "cpap": {
            "enabled": True,
            "at_hour": 13,
            "spool_pull": {"enabled": True, "at_hour": 10, "window_h": 2, "root": "captures/cpap-spool"},
        }
    }
    sentinel = object()

    def _create_task(coro):
        coro.close()
        return sentinel

    async def _connect():  # pragma: no cover — injected so the bleak edge is never built
        raise AssertionError

    with caplog.at_level("INFO"):
        capture._maybe_start_cpap_spool_pull(
            cfg,
            "cfg.yaml",
            str(tmp_path),
            _Ctl(),
            [],
            load_creds=lambda _p: CREDS,
            connect_factory=_connect,
            create_task=_create_task,
        )
    assert str(tmp_path / "captures" / "cpap-spool") in caplog.text, caplog.text


# ── _cpap_spool_loop ─────────────────────────────────────────────────────────
def _drive(
    *,
    blocked_by=None,
    cycle=None,
    ticks=2,
    recovering=False,
    hour=10,
    end_mono=None,
    after_therapy_s=None,
    therapy=None,
    harvest_hours=frozenset(),
):
    """Run the loop for `ticks` minutes of injected time, then stop it. Returns (calls, states).

    The injected monotonic clock reads 1000 s; `end_mono` is when the last retained session ended."""
    calls, states = [], []
    n = {"i": 0}
    capture._CPAP_THERAPY_END["mono"] = end_mono

    async def _sleep(_s):
        n["i"] += 1
        if n["i"] > ticks:
            capture._STOP.set()

    async def _cycle(**kw):
        calls.append(kw)
        return (cycle or (lambda: {"rounds_committed": 1, "cursor": "C"}))()

    capture.STATUS["devices"] = blocked_by or {}
    if recovering:
        capture._RECOVER.set()
    try:
        asyncio.run(
            capture._cpap_spool_loop(
                at_hour=10,
                window_h=2,
                root="/tmp/r",
                creds=CREDS,
                connect_factory=None,
                epoch_start="2026-08-01T00:00:00.000Z",
                is_capturing=lambda: False,
                sleep=_sleep,
                now=lambda: _dt.datetime(2026, 8, 26, hour, 30),
                cycle=_cycle,
                st=lambda **kw: states.append(kw),
                after_therapy_s=after_therapy_s,
                harvest_hours=harvest_hours,
                mono=lambda: 1000.0,
                get_therapy=lambda: therapy,
            )
        )
    finally:
        capture._STOP.clear()
        capture._RECOVER.clear()
    return calls, states


def _cycles(*results):
    """A `cycle` that returns or raises each result in turn, then repeats the last."""
    q = list(results)

    def _next():
        r = q.pop(0) if len(q) > 1 else q[0]
        if isinstance(r, Exception):
            raise r
        return r

    return _next


OK = {"rounds_committed": 1, "cursor": "C"}


def test_a_retained_session_pulls_after_the_delay_OUTSIDE_the_window(caplog):
    with caplog.at_level("INFO"):
        calls, states = _drive(hour=6, end_mono=600.0, after_therapy_s=300.0, ticks=3)
    assert len(calls) == 1, "one pull per retained session, not one per minute"
    assert capture._CPAP_THERAPY_END["mono"] is None, "the pull consumes the trigger"
    assert "post-therapy trigger — the session ended 400 s ago" in caplog.text
    assert states[-1]["state"] == "idle"


def test_the_post_therapy_pull_waits_out_its_delay():
    calls, _ = _drive(hour=6, end_mono=800.0, after_therapy_s=300.0, ticks=3)
    assert calls == [], "200 s after the session is inside the 300 s the device needs"
    assert capture._CPAP_THERAPY_END["mono"] == 800.0


def test_the_post_therapy_pull_waits_while_the_detector_still_reads_THERAPY():
    calls, _ = _drive(hour=6, end_mono=0.0, after_therapy_s=300.0, therapy=True, ticks=3)
    assert calls == []
    calls, _ = _drive(hour=6, end_mono=0.0, after_therapy_s=300.0, therapy=False, ticks=1)
    assert len(calls) == 1, "out of Therapy, the pull runs"


def test_an_UNSEEN_machine_does_not_hold_the_post_therapy_pull():
    calls, _ = _drive(hour=6, end_mono=0.0, after_therapy_s=300.0, therapy=None, ticks=1)
    assert len(calls) == 1, "a detector that is off would otherwise hold the pull forever"


def test_the_post_therapy_pull_is_OFF_when_unset():
    calls, _ = _drive(hour=6, end_mono=0.0, after_therapy_s=None, ticks=2)
    assert calls == []


def test_no_retained_session_means_no_post_therapy_pull():
    calls, _ = _drive(hour=6, end_mono=None, after_therapy_s=300.0, ticks=2)
    assert calls == []


def test_the_post_therapy_pull_never_starts_inside_the_HARVEST_hours():
    calls, states = _drive(hour=13, end_mono=0.0, after_therapy_s=300.0, harvest_hours=frozenset({13, 14}), ticks=2)
    assert calls == []
    assert states[0] == {"state": "waiting", "detail": "the post-therapy pull waits out the Wi-Fi harvest hours"}
    assert capture._CPAP_THERAPY_END["mono"] == 0.0, "a deferral keeps the trigger"


def test_a_blocked_post_therapy_pull_KEEPS_the_trigger():
    calls, states = _drive(hour=6, end_mono=0.0, after_therapy_s=300.0, recovering=True, ticks=2)
    assert calls == [] and [s["state"] for s in states] == ["waiting"] * 2
    assert capture._CPAP_THERAPY_END["mono"] == 0.0


def test_a_window_pull_consumes_a_pending_trigger_too():
    calls, _ = _drive(hour=10, end_mono=0.0, after_therapy_s=300.0, ticks=3)
    assert len(calls) == 1, "the window pull reads the same page; a second pull would add nothing"
    assert capture._CPAP_THERAPY_END["mono"] is None


def test_a_BUSY_link_is_a_deferral_and_the_window_retries_next_minute(caplog):
    """2026-10-13: the shadow poll held the link at 10:00:46, and the day was lost with no retry."""
    import as11_link_guard

    busy = as11_link_guard.LinkBusy("shadow-poll")
    with caplog.at_level("INFO"):
        calls, states = _drive(cycle=_cycles(busy, OK), ticks=3)
    assert len(calls) == 2, "the busy minute gives the day back; the next minute pulls"
    assert states[1]["state"] == "waiting" and "shadow-poll" in states[1]["detail"]
    assert states[-1]["state"] == "idle"
    assert "CPAP spool pull deferred" in caplog.text


def test_a_BUSY_link_keeps_the_post_therapy_trigger():
    import as11_link_guard

    calls, _ = _drive(
        hour=6, end_mono=0.0, after_therapy_s=300.0, cycle=_cycles(as11_link_guard.LinkBusy("shadow-poll"), OK), ticks=3
    )
    assert len(calls) == 2
    assert capture._CPAP_THERAPY_END["mono"] is None


def test_post_therapy_due_reads_each_input():
    due = capture._post_therapy_pull_due
    assert due(0.0, 300.0, 300.0, False) is True, "the delay is inclusive"
    assert due(0.0, 300.0, 299.9, False) is False
    assert due(0.0, 300.0, 400.0, True) is False
    assert due(None, 300.0, 400.0, None) is False
    assert due(0.0, None, 400.0, None) is False


def test_after_therapy_seconds_reads_the_key():
    import cpap_spool_caller as C

    assert C.after_therapy_seconds({}) == 300.0
    assert C.after_therapy_seconds({"after_therapy_s": 60}) == 60.0
    assert C.after_therapy_seconds({"after_therapy_s": 0}) == 0.0
    for off in (None, False, True, -1, "300"):
        assert C.after_therapy_seconds({"after_therapy_s": off}) is None, off


def test_a_due_and_clear_window_pulls_exactly_once_per_day():
    calls, states = _drive(ticks=3)
    assert len(calls) == 1, "the day is consumed after the attempt — not once per minute"
    assert calls[0]["epoch_start"] == "2026-08-01T00:00:00.000Z"
    assert states[-1]["state"] == "idle"


def test_a_deferral_does_NOT_consume_the_day_and_retries():
    # The scar: a daily job that burns its one chance on a late-sleeping user silently skips days.
    calls, states = _drive(recovering=True, ticks=3)
    assert calls == [], "nothing may be pulled while the adapter is healing"
    assert [s["state"] for s in states] == ["waiting"] * 3, "it retried every minute, as designed"
    assert states[0]["detail"] == "adapter mid-recovery"


def test_a_failing_pull_is_survived_not_fatal(caplog):
    def _boom():
        raise RuntimeError("bleak said no")

    with caplog.at_level("WARNING"):
        calls, states = _drive(cycle=_boom, ticks=3)
    assert len(calls) == 1
    assert states[-1]["state"] == "error" and "bleak said no" in states[-1]["detail"]
    assert "CPAP spool pull failed" in caplog.text


def test_a_nonterminal_stop_is_reported_in_the_line(caplog):
    with caplog.at_level("INFO"):
        _drive(cycle=lambda: {"rounds_committed": 0, "cursor": "C", "stopped": "data-unavailable"}, ticks=2)
    assert "stopped=data-unavailable" in caplog.text


def _record_supervised_wiring(monkeypatch):
    """Record what `_maybe_start_cpap_spool_pull` hands to the supervisor and to the loop, by patching
    the module ATTRIBUTES `capture.keep_running` / `capture._cpap_spool_loop`.

    The pull is started as `keep_running(make_coro, label)` since
    RESOURCE-ORCHESTRATION-AUDIT-2026-09-05 §O2 — supervised, so a crash restarts it instead of ending
    the night's pull silently — and the wiring under test is what the FACTORY builds, so the factory is
    called here and what it passed is recorded.

    🔴 READ THIS BEFORE GOING BACK TO FRAME INTROSPECTION. This helper used to reach into the coroutine
    handed to `create_task` and read `coro.cr_frame.f_locals["make_coro"]`. That is correct on an
    unmutated tree and returns `None` the moment mutmut wraps `keep_running` in its trampoline: the
    coroutine `create_task` receives is then the wrapper's — `async def _trampoline_wrapper(*args,
    **kwargs)` — whose only locals are `args`/`kwargs`, and the wrapped coroutine does not exist until
    the first await. `_cpap_spool_loop` is wrapped the same way one level down, so the kwargs read off
    the inner frame vanished too. Both tests below therefore FAILED inside mutmut's stats pass, and
    `tools/mutate_diff.py` refused NOT_RUN on every capture.py diff before a single mutant ran
    (RESIDUE 2026-09-27-mutmut-stats-pass-fails-on-the-spool-wiring-test). Patching the attribute
    replaces the trampoline itself, so what is recorded here cannot depend on mutmut wrapping anything.
    """
    rec: dict = {}

    async def _unrun():
        pass

    # ⚠️ PLAIN `def`s, NOT `async def`. An async spy records NOTHING: calling it only builds a
    # coroutine, its body runs on await, and the caller closes it unrun — so `rec` stays empty and the
    # assertions red whether or not the wiring is right. A test that fails in BOTH directions proves
    # nothing; the STATUS-writer test below was written that way first and caught in review.
    def _loop_spy(**kw):  # stands in for _cpap_spool_loop; records the kwargs
        rec["loop_kwargs"] = kw
        return _unrun()  # a real coroutine for the caller to close

    def _keep_running_spy(make_coro, label, **kw):
        rec["make_coro"], rec["label"] = make_coro, label
        inner = make_coro()  # what the supervisor awaits — this is what runs `_loop_spy`
        inner.close()
        return _unrun()

    monkeypatch.setattr(capture, "_cpap_spool_loop", _loop_spy)
    monkeypatch.setattr(capture, "keep_running", _keep_running_spy)
    return rec


def _assert_supervised(rec):
    """The pull must go through the supervisor, not straight to `create_task`. Started bare, the spy is
    never called, `rec` stays empty and this fires — the same detection the frame read gave."""
    assert callable(rec.get("make_coro")), "the spool pull must be started under keep_running (supervised), not bare"
    assert isinstance(rec.get("label"), str) and rec["label"], (
        "a supervised task needs its label — TASK_LABELS keys the task table on it"
    )


def test_every_documented_spool_pull_key_is_actually_READ(tmp_path, caplog, monkeypatch):
    """A key documented in config.example.yaml that no code reads is this repo's recurring defect —
    `cpap.wifi_profile` is the standing example (consulted ONLY on the nmcli backend, silently inert
    on the box that actually runs). `spool_type` shipped exactly that way in this very change: it was
    documented, and the wiring passed the function default instead. Caught here, so it stays caught."""
    rec = _record_supervised_wiring(monkeypatch)

    def _create_task(coro):
        coro.close()
        return "TASK"

    async def _connect():  # pragma: no cover — injected; the bleak edge is never built
        raise AssertionError

    cfg = {
        "cpap": {
            "spool_pull": {
                "enabled": True,
                "at_hour": 9,
                "window_h": 3,
                "spool_type": "Detail",
                "epoch_start": "2026-01-01T00:00:00.000Z",
                "root": str(tmp_path / "sp"),
                "after_therapy_s": 90,
            },
            "enabled": True,
            "at_hour": 15,
        }
    }
    with caplog.at_level("INFO"):
        capture._maybe_start_cpap_spool_pull(
            cfg,
            "cfg.yaml",
            str(tmp_path),
            _Ctl(),
            [],
            load_creds=lambda _p: CREDS,
            connect_factory=_connect,
            create_task=_create_task,
        )
    _assert_supervised(rec)
    kw = rec["loop_kwargs"]
    assert kw["spool_type"] == "Detail", "a documented key the wiring never reads is an inert setting"
    assert kw["epoch_start"] == "2026-01-01T00:00:00.000Z"
    assert kw["at_hour"] == 9 and kw["window_h"] == 3
    assert kw["root"] == str(tmp_path / "sp")
    assert "Detail spool" in caplog.text and "09:00-12:00" in caplog.text
    assert kw["after_therapy_s"] == 90.0
    assert kw["harvest_hours"] == frozenset({15, 16}), "an ENABLED harvest's hours hold the post-therapy pull"
    assert "post-therapy pull 90 s after each retained session" in caplog.text


def test_a_DISABLED_harvest_holds_no_hours_and_OFF_says_so(tmp_path, caplog, monkeypatch):
    rec = _record_supervised_wiring(monkeypatch)

    def _create_task(coro):
        coro.close()
        return "TASK"

    cfg = {"cpap": {"spool_pull": {"enabled": True, "after_therapy_s": None}, "at_hour": 13}}
    with caplog.at_level("INFO"):
        capture._maybe_start_cpap_spool_pull(
            cfg, "cfg.yaml", str(tmp_path), _Ctl(), [], load_creds=lambda _p: CREDS, create_task=_create_task
        )
    kw = rec["loop_kwargs"]
    assert kw["harvest_hours"] == frozenset()
    assert kw["after_therapy_s"] is None
    assert "post-therapy pull OFF" in caplog.text


def test_a_loop_started_during_shutdown_does_nothing_at_all():
    """The `while not _STOP.is_set()` guard evaluated FALSE — the branch every other test skips.

    Each test above exits through the `break` after `sleep`, so the loop condition itself never sees
    a set flag. It can: the daemon builds its tasks and then shuts down, and a scheduled job that
    starts a pull while the process is tearing down would open a BLE link nothing will close."""
    calls = []

    async def _cycle(**kw):  # pragma: no cover — reaching it is the failure this asserts against
        calls.append(kw)

    async def _sleep(_s):  # pragma: no cover — the guard must refuse before the first sleep
        raise AssertionError("the loop slept instead of refusing to start")

    capture._STOP.set()
    try:
        asyncio.run(
            capture._cpap_spool_loop(
                at_hour=10,
                window_h=2,
                root="/tmp/r",
                creds=CREDS,
                connect_factory=None,
                epoch_start="x",
                is_capturing=lambda: False,
                sleep=_sleep,
                now=lambda: _dt.datetime(2026, 8, 26, 10, 30),
                cycle=_cycle,
                st=lambda **kw: None,
            )
        )
    finally:
        capture._STOP.clear()
    assert calls == []


# ── the PRODUCTION wiring hands the loop a real status writer ────────────────────────────────────────
# 🔴 THE TESTS ABOVE CANNOT CATCH THIS, AND THAT IS THE POINT. `_drive` injects
# `st=lambda **kw: states.append(kw)` and asserts on what it collected, so every state assertion in this
# file passed while the production call site omitted `st` entirely — the loop fell back to its own
# `st = st or (lambda **kw: None)` and published NOWHERE on the box. Covered machinery, inert in prod.
# So this test drives `_maybe_start_cpap_spool_pull` (the real caller) and inspects what it PASSED,
# rather than passing its own.
def test_the_production_wiring_hands_the_loop_a_working_STATUS_writer(tmp_path, monkeypatch):
    rec = _record_supervised_wiring(monkeypatch)

    def _create_task(coro):
        coro.close()  # the supervisor's coroutine; the factory already ran
        return object()

    async def _connect():  # pragma: no cover — injected so the bleak edge is never built
        raise AssertionError

    before_cpap = capture.STATUS.get("cpap")
    capture.STATUS.pop("cpap_spool", None)
    try:
        capture._maybe_start_cpap_spool_pull(
            ARMED,
            "cfg.yaml",
            str(tmp_path),
            _Ctl(),
            [],
            load_creds=lambda _p: CREDS,
            connect_factory=_connect,
            create_task=_create_task,
        )

        _assert_supervised(rec)
        st = rec["loop_kwargs"].get("st")
        assert callable(st), (
            "the production caller must pass `st` — without it the loop takes its own no-op default "
            "and every state it publishes is discarded, which is how this shipped"
        )

        st(state="waiting", detail="streaming: H10")
        assert capture.STATUS.get("cpap_spool", {}).get("state") == "waiting", (
            "the writer must reach STATUS, where webmon can project it"
        )
        assert capture.STATUS["cpap_spool"]["detail"] == "streaming: H10"

        # SEPARATE KEY, asserted. Merging into `cpap` would let the harvest actor's next write hide
        # this one, and "two actors both waiting" — OPERATIONAL-MATURITY-AUDIT §4(1)'s falsification
        # condition — is unobservable from a single shared slot.
        assert capture.STATUS.get("cpap") == before_cpap, (
            "the spool actor must not write into the harvest actor's block"
        )
    finally:
        capture.STATUS.pop("cpap_spool", None)
        if before_cpap is not None:
            capture.STATUS["cpap"] = before_cpap
