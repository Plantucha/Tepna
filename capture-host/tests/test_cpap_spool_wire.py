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
        assert capture._maybe_start_cpap_spool_pull({}, "cfg.yaml", str(tmp_path), object(),
                                                    tasks) is None
    assert tasks == []
    # The whole point of the arming line: `autopull_arming` exists because a path that never armed
    # printed NOTHING, and no gate can observe an absent line.
    assert "NOT armed" in caplog.text and "never inherits" in caplog.text


def test_a_window_colliding_with_the_harvest_refuses_at_the_WIRING(tmp_path, caplog):
    cfg = {"cpap": {"enabled": True, "at_hour": 13,
                    "spool_pull": {"enabled": True, "at_hour": 14}}}
    tasks = []
    with caplog.at_level("INFO"):
        assert capture._maybe_start_cpap_spool_pull(cfg, "cfg.yaml", str(tmp_path), object(),
                                                    tasks) is None
    assert tasks == [] and "14" in caplog.text


def test_armed_without_creds_is_a_noop_and_names_the_reason(tmp_path, caplog):
    tasks = []
    with caplog.at_level("INFO"):
        r = capture._maybe_start_cpap_spool_pull(ARMED, "cfg.yaml", str(tmp_path), object(), tasks,
                                                 load_creds=lambda _p: None)
    assert r is None and tasks == [] and "pair the AS11 first" in caplog.text


def test_armed_starts_the_task_labels_it_and_logs_the_window(tmp_path, caplog):
    made = []
    tasks = []

    # A UNIQUE OBJECT, never "TASK": `TASK_LABELS` is id()-keyed and CPython interns short string
    # literals, so a sibling test returning "TASK" collides on the same key.
    sentinel = object()

    def _create_task(coro):
        coro.close()                     # never run it here; this test is about the WIRING
        made.append(coro)
        return sentinel

    async def _connect():  # pragma: no cover — injected so the bleak edge is never built
        raise AssertionError

    with caplog.at_level("INFO"):
        r = capture._maybe_start_cpap_spool_pull(
            ARMED, "cfg.yaml", str(tmp_path), _Ctl(), tasks,
            load_creds=lambda _p: CREDS, connect_factory=_connect, create_task=_create_task)

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
    assert capture.resolve_spool_root("captures/cpap-spool", "/srv/tepna") \
        == "/srv/tepna/captures/cpap-spool"
    assert capture.resolve_spool_root("/mnt/big/spool", "/srv/tepna") == "/mnt/big/spool"


def test_an_absent_spool_root_keeps_the_documented_default():
    assert capture.resolve_spool_root(None, "/srv/tepna") == "/srv/tepna/cpap-spool"
    assert capture.resolve_spool_root("", "/srv/tepna") == "/srv/tepna/cpap-spool"


def test_the_armed_path_routes_through_the_resolver(tmp_path, caplog):
    """The wiring, not just the pure rule: an armed start with a relative configured root must LOG
    the resolved absolute path — the ARMED line is the one surface an operator checks."""
    cfg = {"cpap": {"enabled": True, "at_hour": 13,
                    "spool_pull": {"enabled": True, "at_hour": 10, "window_h": 2,
                                   "root": "captures/cpap-spool"}}}
    sentinel = object()

    def _create_task(coro):
        coro.close()
        return sentinel

    async def _connect():  # pragma: no cover — injected so the bleak edge is never built
        raise AssertionError

    with caplog.at_level("INFO"):
        capture._maybe_start_cpap_spool_pull(
            cfg, "cfg.yaml", str(tmp_path), _Ctl(), [],
            load_creds=lambda _p: CREDS, connect_factory=_connect, create_task=_create_task)
    assert str(tmp_path / "captures" / "cpap-spool") in caplog.text, caplog.text


# ── _cpap_spool_loop ─────────────────────────────────────────────────────────
def _drive(*, blocked_by=None, cycle=None, ticks=2, recovering=False):
    """Run the loop for `ticks` minutes of injected time, then stop it. Returns (calls, states)."""
    calls, states = [], []
    n = {"i": 0}

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
        asyncio.run(capture._cpap_spool_loop(
            at_hour=10, window_h=2, root="/tmp/r", creds=CREDS, connect_factory=None,
            epoch_start="2026-08-01T00:00:00.000Z", is_capturing=lambda: False,
            sleep=_sleep, now=lambda: _dt.datetime(2026, 8, 26, 10, 30),
            cycle=_cycle, st=lambda **kw: states.append(kw)))
    finally:
        capture._STOP.clear()
        capture._RECOVER.clear()
    return calls, states


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
        _drive(cycle=lambda: {"rounds_committed": 0, "cursor": "C", "stopped": "data-unavailable"},
               ticks=2)
    assert "stopped=data-unavailable" in caplog.text


def test_every_documented_spool_pull_key_is_actually_READ(tmp_path, caplog):
    """A key documented in config.example.yaml that no code reads is this repo's recurring defect —
    `cpap.wifi_profile` is the standing example (consulted ONLY on the nmcli backend, silently inert
    on the box that actually runs). `spool_type` shipped exactly that way in this very change: it was
    documented, and the wiring passed the function default instead. Caught here, so it stays caught."""
    seen = {}

    def _create_task(coro):
        coro.cr_frame  # noqa: B018 — touch it so a bad coroutine surfaces here, not at GC
        seen["kw"] = coro.cr_frame.f_locals
        coro.close()
        return "TASK"

    async def _connect():  # pragma: no cover — injected; the bleak edge is never built
        raise AssertionError

    cfg = {"cpap": {"spool_pull": {"enabled": True, "at_hour": 9, "window_h": 3,
                                   "spool_type": "Detail", "epoch_start": "2026-01-01T00:00:00.000Z",
                                   "root": str(tmp_path / "sp")}}}
    with caplog.at_level("INFO"):
        capture._maybe_start_cpap_spool_pull(cfg, "cfg.yaml", str(tmp_path), _Ctl(), [],
                                             load_creds=lambda _p: CREDS,
                                             connect_factory=_connect, create_task=_create_task)
    kw = seen["kw"]
    assert kw["spool_type"] == "Detail", "a documented key the wiring never reads is an inert setting"
    assert kw["epoch_start"] == "2026-01-01T00:00:00.000Z"
    assert kw["at_hour"] == 9 and kw["window_h"] == 3
    assert kw["root"] == str(tmp_path / "sp")
    assert "Detail spool" in caplog.text and "09:00-12:00" in caplog.text


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
        asyncio.run(capture._cpap_spool_loop(
            at_hour=10, window_h=2, root="/tmp/r", creds=CREDS, connect_factory=None,
            epoch_start="x", is_capturing=lambda: False, sleep=_sleep,
            now=lambda: _dt.datetime(2026, 8, 26, 10, 30), cycle=_cycle, st=lambda **kw: None))
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
    seen = {}

    async def _noop():
        pass

    # ⚠️ A PLAIN `def`, NOT `async def`. An async spy records NOTHING here: calling it only builds a
    # coroutine, its body runs on await, and `_create_task` below closes it unrun — so `seen` stays
    # empty and the assertion reds whether or not the fix is present. A test that fails in BOTH
    # directions proves nothing; this one was written that way first and caught in review.
    def _spy(**kw):                       # stands in for _cpap_spool_loop; records the kwargs
        seen.update(kw)
        return _noop()                    # a real coroutine for the caller to close

    monkeypatch.setattr(capture, "_cpap_spool_loop", _spy)

    def _create_task(coro):
        coro.close()
        return object()

    async def _connect():  # pragma: no cover — injected so the bleak edge is never built
        raise AssertionError

    before_cpap = capture.STATUS.get("cpap")
    capture.STATUS.pop("cpap_spool", None)
    try:
        capture._maybe_start_cpap_spool_pull(
            ARMED, "cfg.yaml", str(tmp_path), _Ctl(), [],
            load_creds=lambda _p: CREDS, connect_factory=_connect, create_task=_create_task)

        st = seen.get("st")
        assert callable(st), (
            "the production caller must pass `st` — without it the loop takes its own no-op default "
            "and every state it publishes is discarded, which is how this shipped")

        st(state="waiting", detail="streaming: H10")
        assert capture.STATUS.get("cpap_spool", {}).get("state") == "waiting", \
            "the writer must reach STATUS, where webmon can project it"
        assert capture.STATUS["cpap_spool"]["detail"] == "streaming: H10"

        # SEPARATE KEY, asserted. Merging into `cpap` would let the harvest actor's next write hide
        # this one, and "two actors both waiting" — OPERATIONAL-MATURITY-AUDIT §4(1)'s falsification
        # condition — is unobservable from a single shared slot.
        assert capture.STATUS.get("cpap") == before_cpap, \
            "the spool actor must not write into the harvest actor's block"
    finally:
        capture.STATUS.pop("cpap_spool", None)
        if before_cpap is not None:
            capture.STATUS["cpap"] = before_cpap
