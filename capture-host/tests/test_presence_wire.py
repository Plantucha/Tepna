# tepna-capture — tests/test_presence_wire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The daemon half of the PRESENCE trigger (O2RING-AUTONOMOUS-HARVEST §5/§14/§20/§21):
# capture.presence_fold + capture._presence_scan_loop + the scope entry. No radio, no clock, no sleep.

import asyncio

import capture
import oxy_presence as P
from oxy_presence import OxyPresState as S

A = "AA:BB:CC:DD:EE:FF"
B = "11:22:33:44:55:66"


# ── presence_fold ────────────────────────────────────────────────────────────
def test_fold_iterates_CONFIGURED_addresses_not_sightings():
    """The asymmetry that IS the function. Folding only what was seen means a ring that stopped
    advertising is never updated — its Presence sits at PRESENT forever, because nothing ever calls
    observe() with a silent tick for it. Absence is only observable by asking about a no-show."""
    present = P.Presence(S.PRESENT, 2, 100.0, "")
    out = capture.presence_fold({A: present}, {}, [A], 100.0 + P.ABSENT_AFTER_S)
    assert out[A].state is S.ABSENT, "a ring that went quiet must be able to become ABSENT"


def test_fold_reports_a_device_it_has_never_seen_as_UNKNOWN_not_ABSENT():
    out = capture.presence_fold({}, {}, [B], 500.0)
    assert out[B].state is S.UNKNOWN


def test_fold_takes_prev_as_a_PARAMETER_and_touches_no_global():
    before = dict(capture._PRESENCE)
    capture.presence_fold({}, {A: 10.0}, [A], 10.0)
    assert capture._PRESENCE == before, "a function advertising purity must not write module state"


def test_fold_debounces_across_two_windows():
    st = capture.presence_fold({}, {A: 10.0}, [A], 10.0)
    assert st[A].state is S.UNKNOWN
    st = capture.presence_fold(st, {A: 11.0}, [A], 11.0)
    assert st[A].state is S.PRESENT


# ── the scan loop ────────────────────────────────────────────────────────────
def _run_loop(scans, addresses=(A,)):
    """Drive the loop over a scripted list of scan results, then stop it."""
    calls = {"n": 0}

    async def _scan(_w):
        i = calls["n"]
        calls["n"] += 1
        r = scans[i]
        if isinstance(r, Exception):
            raise r
        return r

    async def _sleep(_s):
        if calls["n"] >= len(scans):
            capture._STOP.set()

    t = {"v": 0.0}

    def _mono():
        t["v"] += 1.0
        return t["v"]

    capture._PRESENCE.clear()   # the latch is the CALLER's to set — clearing it here silently
    try:                        # defeated two tests that set it up beforehand

        asyncio.run(capture._presence_scan_loop(
            addresses=list(addresses), window_s=1.0, scan=_scan, sleep=_sleep, mono=_mono))
    finally:
        capture._STOP.clear()
    return dict(capture._PRESENCE)


def _run_loop_from_state(scans, addresses, start_mono):
    """Like _run_loop but KEEPS the existing _PRESENCE and starts the monotonic clock at `start_mono`,
    so a silence window can actually elapse."""
    calls = {"n": 0}

    async def _scan(_w):
        calls["n"] += 1
        return scans[calls["n"] - 1]

    async def _sleep(_s):
        if calls["n"] >= len(scans):
            capture._STOP.set()

    t = {"v": start_mono}

    def _mono():
        t["v"] += 1.0
        return t["v"]

    try:
        asyncio.run(capture._presence_scan_loop(
            addresses=list(addresses), window_s=1.0, scan=_scan, sleep=_sleep, mono=_mono))
    finally:
        capture._STOP.clear()


def test_a_scan_failure_does_not_take_the_daemon_down_and_leaves_the_observation_alone(caplog):
    with caplog.at_level("INFO"):
        out = _run_loop([RuntimeError("adapter busy")])
    assert out[A].state is S.UNKNOWN, "a failed scan is not a sighting and is not an absence"
    assert "presence scan failed" in caplog.text


def test_two_windows_of_sightings_reach_PRESENT():
    out = _run_loop([{A: 1.0}, {A: 2.0}])
    assert out[A].state is S.PRESENT


def test_a_STILL_PRESENT_ring_does_not_re_arm_the_once_per_session_latch():
    capture._PRESENCE_PULLED.clear()
    capture._PRESENCE_PULLED.add(A)
    try:
        _run_loop([{A: 1.0}, {A: 2.0}])      # reaches PRESENT
        assert A in capture._PRESENCE_PULLED, "still present: the pull must not repeat"
    finally:
        capture._PRESENCE_PULLED.clear()


def test_a_DEPARTURE_re_arms_the_latch_so_the_next_session_can_pull():
    capture._PRESENCE_PULLED.clear()
    capture._PRESENCE_PULLED.add(A)
    try:
        # Two sightings to reach PRESENT, then silence past the window → ABSENT.
        prev = capture.presence_fold({}, {A: 1.0}, [A], 1.0)
        prev = capture.presence_fold(prev, {A: 2.0}, [A], 2.0)
        capture._PRESENCE.update(prev)
        _run_loop_from_state([{}], addresses=(A,), start_mono=2.0 + P.ABSENT_AFTER_S)
        assert capture._PRESENCE[A].state is S.ABSENT
        assert A not in capture._PRESENCE_PULLED, "a genuine departure must re-arm the next session"
    finally:
        capture._PRESENCE_PULLED.clear()


def test_UNKNOWN_never_re_arms_the_latch():
    """Keyed on ABSENT, never on 'not PRESENT'. A scanner that goes blind reports UNKNOWN, and
    re-arming on that would silently re-enable a pull that already happened."""
    capture._PRESENCE_PULLED.clear()
    capture._PRESENCE_PULLED.add(B)
    try:
        _run_loop([{}], addresses=(B,))
        assert capture._PRESENCE[B].state is S.UNKNOWN
        assert B in capture._PRESENCE_PULLED, "UNKNOWN must not re-arm"
    finally:
        capture._PRESENCE_PULLED.clear()


# ── §14b the scope ───────────────────────────────────────────────────────────
def test_presence_takes_the_narrow_scope_like_a_doff():
    assert capture.pull_scope_for("presence") == "latest"
    assert capture.pull_scope_for("charger") == "all", "the existing ruling is untouched"


# ── _maybe_start_presence_scan ───────────────────────────────────────────────
ARMED_CFG = {
    "o2ring": {"presence_harvest": {"enabled": True, "scan_coexistence_verified": True}},
    "devices": [{"name": "O2Ring", "vendor": "Wellue", "address": A}],
}


def _start(cfg):
    made = []

    # ⚠️ A UNIQUE OBJECT, never the string "TASK". `TASK_LABELS` is keyed by `id()`, and CPython
    # INTERNS a short string literal — so two tests in different files that both return "TASK" write
    # the SAME key, and whichever runs second wins. Invisible while the two features lived on separate
    # branches; it surfaced the moment spool and presence shared a tree.
    sentinel = object()

    def _ct(coro):
        coro.close()
        made.append(coro)
        return sentinel

    async def _scan(_w):  # pragma: no cover — injected so the bleak edge is never built
        return {}

    tasks = []
    r = capture._maybe_start_presence_scan(cfg, tasks, create_task=_ct, scan_factory=_scan)
    return r, tasks


def test_off_starts_nothing_and_says_off(caplog):
    with caplog.at_level("INFO"):
        r, tasks = _start({})
    assert r is None and tasks == []
    assert "presence scan: off" in caplog.text and "never inherits" in caplog.text


def test_ENABLED_BUT_NOT_ARMED_is_reported_as_its_OWN_state(caplog):
    """The state that actually exists tonight. Collapsing it into 'off' would hide a configured
    feature that is deliberately not running."""
    cfg = {"o2ring": {"presence_harvest": {"enabled": True}},
           "devices": [{"vendor": "Wellue", "address": A}]}
    with caplog.at_level("INFO"):
        r, tasks = _start(cfg)
    assert r is None and tasks == []
    assert "ENABLED but NOT ARMED" in caplog.text
    assert "coexistence matrix has not been run" in caplog.text


def test_armed_with_a_ring_starts_the_observer_and_says_it_pulls_nothing(caplog):
    with caplog.at_level("INFO"):
        r, tasks = _start(ARMED_CFG)
    assert r is not None and tasks == [r]
    assert capture.TASK_LABELS[id(r)] == "O2Ring presence scan"
    assert "opens no connection and pulls no bytes" in caplog.text


def test_the_device_key_is_address_NOT_addr(caplog):
    """🔴 THE DEFECT THIS CATCHES, shipped and caught during this change: the starter read
    `d.get("addr")`. Every Tepna device config uses `address`, so it found ZERO rings, logged
    'nothing to observe', and started nothing — a feature that is armed, silent, and dead. The failure
    is invisible because the log line it prints is a legitimate one."""
    cfg = dict(ARMED_CFG, devices=[{"vendor": "Wellue", "addr": A}])   # the WRONG key
    with caplog.at_level("INFO"):
        r, _ = _start(cfg)
    assert r is None and "nothing to observe" in caplog.text
    # and the right key does start it
    assert _start(ARMED_CFG)[0] is not None


def test_a_non_ring_device_is_not_observed():
    cfg = dict(ARMED_CFG, devices=[{"vendor": "Polar", "address": A}])
    assert _start(cfg)[0] is None, "only Wellue/Viatom rings are the subject of this scan"


# ── §14 THE DISPATCH WIRING — not the decision, the wiring ───────────────────
def _ring_cfg():
    return {
        "pull": {"auto": True, "ftype": 0},
        "o2ring": {"presence_harvest": {"enabled": True, "scan_coexistence_verified": True}},
        # device_id + streams are REQUIRED: `missing_identity` filters an incomplete entry out of
        # `devices` entirely, so a hand-built config without them dispatches nothing and the test
        # passes for the wrong reason — it would read as "presence never fires".
        "devices": [{"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "address": A,
                     "device_id": "12345678", "streams": ["spo2"]}],
    }


def _arm_presence(rec_state=None):
    capture.STATUS["devices"]["Ring"] = {"worn": True, "charging": False}
    if rec_state is not None:
        capture.STATUS["devices"]["Ring"]["oxy_recording"] = rec_state
    capture._PRESENCE[A] = P.Presence(S.PRESENT, 2, 1.0, "")
    capture._PRESENCE_PULLED.discard(A)
    capture._PRESENCE_PROBED.pop(A, None)


def _drive_dispatch(monkeypatch, cfg, ticks=3):
    pulls = []

    async def fake_pull(dev, root, which="latest", ftype=0):
        pulls.append((dev["name"], which, ftype))
        return {"new_files": ["a.dat"]}

    monkeypatch.setattr(capture, "pull_oxyii_session", fake_pull)
    n = {"i": 0}
    real_sleep = capture.asyncio.sleep

    async def _sleep(_s):
        n["i"] += 1
        if n["i"] >= ticks:
            capture._STOP.set()
        await real_sleep(0)

    monkeypatch.setattr(capture.asyncio, "sleep", _sleep)
    try:
        asyncio.run(capture.charger_pull_poller(cfg, "/tmp"))
    finally:
        capture._STOP.clear()
        capture._PRESENCE.clear()
        capture._PRESENCE_PULLED.discard(A)
        capture._PRESENCE_PROBED.pop(A, None)
        capture.STATUS["devices"].pop("Ring", None)
    return pulls


def test_a_PRESENCE_triggered_pull_reaches_pull_oxyii_session_as_LATEST(monkeypatch):
    """🔴 THE WIRING, not the decision. `pull_scope_for("presence") == "latest"` proves nothing if the
    dispatch ignores it, and `probe_justified` being correct proves nothing if no `by_*` term reads it.
    This is the only assertion that fails when the trigger is disconnected from the harvest."""
    _arm_presence()
    pulls = _drive_dispatch(monkeypatch, _ring_cfg())
    # THE FIRST DISPATCH IS STILL THE NARROW ONE, and that is the invariant this test exists for:
    # the event pull races the ring's post-drop tail, so widening it trades a measured scope for an
    # unmeasured bound. A SECOND `new` dispatch follows it (2026-09-06) to drain the fragments the
    # narrow scope leaves — it runs only after the ring has already answered, so it races nothing.
    assert pulls[0] == ("Ring", "latest", 0), "presence must dispatch FIRST at the narrow scope"
    assert [p[1] for p in pulls] == ["latest", "new"], "the follow-on drain must be the ledger diff"


def test_a_RECORDING_ring_is_NOT_pulled_by_the_presence_trigger(monkeypatch):
    """§6/§11 — and the defect this catches is a WIRING one, shipped in an earlier draft: the term
    read `dev.get("rec_state")` off the CONFIG dict, which is always None, so this guard could never
    fire. Runtime state lives in `STATUS["devices"][name]` under `oxy_recording`."""
    _arm_presence(rec_state="recording")
    assert _drive_dispatch(monkeypatch, _ring_cfg()) == [], "a mid-session ring must not be harvested"


def test_an_UNARMED_presence_config_dispatches_nothing(monkeypatch):
    cfg = _ring_cfg()
    cfg["o2ring"]["presence_harvest"]["scan_coexistence_verified"] = False
    _arm_presence()
    assert _drive_dispatch(monkeypatch, cfg) == [], "enabled-but-unarmed must not pull"


def test_the_scan_loop_started_during_shutdown_does_nothing():
    """The `while not _STOP.is_set()` guard evaluated FALSE — the branch every other loop test skips,
    because they all exit through the break after sleep. Same gap the CPAP spool loop had."""
    async def _scan(_w):  # pragma: no cover — the guard must refuse before the first scan
        raise AssertionError("scanned instead of refusing to start")

    capture._STOP.set()
    try:
        asyncio.run(capture._presence_scan_loop(
            addresses=[A], window_s=1.0, scan=_scan, sleep=None, mono=None))
    finally:
        capture._STOP.clear()


def test_the_ONCE_PER_SESSION_latch_is_load_bearing_with_the_rate_limit_disabled(monkeypatch):
    """🔴 THIS TEST EXISTS BECAUSE A PLANTED CONTROL SURVIVED. Deleting `_PRESENCE_PULLED.add(addr)`
    passed the whole suite: the §11 rate limit (`min_probe_interval_sec`, default 300 s) independently
    suppressed ticks 2 and 3, so the latch looked tested and was not. Two guards with different
    lifetimes — the latch is once per PRESENCE SESSION (released only on a genuine departure), the
    rate limit is a frequency bound — and a test that cannot separate them tests neither.

    Setting the interval to 0 removes the frequency guard, so only the latch can prevent a repeat."""
    cfg = _ring_cfg()
    cfg["o2ring"]["presence_harvest"]["min_probe_interval_sec"] = 0
    _arm_presence()
    pulls = _drive_dispatch(monkeypatch, cfg, ticks=3)
    assert pulls[:1] == [("Ring", "latest", 0)], (
        "the ring stayed present across three ticks — without the latch this pulls every tick")


# ── §19/§20 the witness, published through all three layers ─────────────────
def test_the_scan_loop_PUBLISHES_presence_and_the_witness_per_device():
    """§20 — via `_set`, so `find_unwired` scan 1 enumerates the keys and REDS if nothing consumes
    them. A witness written into a dict nobody reads is the hollow artifact §19 exists to forbid."""
    capture._PRESENCE_NAMES[A] = "Ring"
    capture.STATUS["devices"].pop("Ring", None)
    try:
        _run_loop([{A: 1.0}, {A: 2.0}])
        st = capture.STATUS["devices"]["Ring"]
        assert st["presence"] == "pres_present"
        assert st["presence_reason"]
        assert "stops at" in st["presence_witness"], "a cold chain must SAY where it stops"
    finally:
        capture._PRESENCE_NAMES.pop(A, None)
        capture.STATUS["devices"].pop("Ring", None)


def test_a_device_with_no_name_is_skipped_rather_than_keyed_by_None():
    capture._PRESENCE_NAMES.pop(A, None)
    _run_loop([{A: 1.0}, {A: 2.0}])
    assert None not in capture.STATUS["devices"], "a nameless row would collide across devices"


def test_enabled_and_observer_armed_are_stamped_only_when_the_TASK_starts(tmp_path):
    """Not at config-read time. `enabled` was true at `arming`; `observer_armed` is honest only once
    the observer is about to exist. Stamping earlier makes the chain report progress not yet made."""
    capture._WITNESS.pop(A, None)
    cfg = {"o2ring": {"presence_harvest": {"enabled": True}},
           "devices": [{"vendor": "Wellue", "address": A}]}
    _start(cfg)                       # enabled but NOT armed → no task
    assert A not in capture._WITNESS, "an unarmed observer has not armed"
    _start(ARMED_CFG)
    assert set(capture._WITNESS[A]) == {"enabled", "observer_armed"}
    capture._WITNESS.pop(A, None)
    capture._PRESENCE_NAMES.pop(A, None)


def test_artifact_committed_is_stamped_ONLY_when_a_FILE_was_produced(monkeypatch):
    """🔴 The one link that means DATA SURVIVED. A zero-file pull must not claim it, or the chain
    reads "complete" for a night that retrieved nothing — §19's exact anti-claim."""
    capture._WITNESS.pop(A, None)
    _arm_presence()

    async def empty_pull(dev, root, which="latest", ftype=0):
        return {"new_files": []}

    monkeypatch.setattr(capture, "pull_oxyii_session", empty_pull)
    n = {"i": 0}
    real = capture.asyncio.sleep

    async def _sleep(_s):
        n["i"] += 1
        if n["i"] >= 2:
            capture._STOP.set()
        await real(0)

    monkeypatch.setattr(capture.asyncio, "sleep", _sleep)
    try:
        asyncio.run(capture.charger_pull_poller(_ring_cfg(), "/tmp"))
    finally:
        capture._STOP.clear()
    w = capture._WITNESS.get(A, {})
    assert "pull_started" in w, "the pull was dispatched"
    assert "artifact_committed" not in w, "no file — the chain must NOT read complete"
    capture._WITNESS.pop(A, None)
    capture._PRESENCE.clear()
    capture._PRESENCE_PULLED.discard(A)
    capture.STATUS["devices"].pop("Ring", None)
