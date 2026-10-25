# tepna-capture — tests/test_clock_presync.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# SET EVERY DEVICE CLOCK BEFORE ITS RECORDING STARTS — the night of 2026-10-20, replayed.
#
# The H10 came off the dock on its 2019-01-01 firmware default and the night's verdict is UNKNOWN:
# "clock-sets too dense to attribute … -2.46e+08 s persistent shift at 21:38:38". Five machine steps
# produced that, each of them individually reasonable:
#
#   21:33:55  `deferred-after-pause;;attempt 1 (TimeoutError)` — ONE timeout stopped the pre-start ladder
#   21:34:22  PMD START on the 2019 clock — with nothing recorded about the clock it started on
#   21:34:54  reconnect, no sync — the cooldown that one timeout had just earned
#   21:35:18  `uncorrectable;-246245660.720;after 3 re-syncs` — FALSE: zero re-syncs had run
#   21:38:17  the owner's manual sync landed on ATTEMPT 1 — the clock was settable the whole time
#
# The owner's framing (2026-10-20) is what makes the sequence a defect rather than a bad night: "There is
# no feedback, normal user just put on chest strap and go to sleep." Nobody is watching the monitor, so
# a manual sync is never part of the remedy and every bound above has to be right unattended.
#
# The transferable law under four of the five rows: A BOUND MUST BE DENOMINATED IN WHAT IT SPENDS. The
# after-pause deferral and the cross-ladder backoff both price a pause of LIVE capture, and before PMD
# START there is no live capture to pause — so they were spending nothing and buying nothing. The
# give-up verdict priced its sentence in the give-up CONSTANT rather than in corrections that ran, so it
# reported three attempts that never happened. Each of these tests pins one denominator.

import asyncio
import glob
import os

import pytest

import capture
import writers


@pytest.fixture(autouse=True)
def _clean_stop():
    """The same reset `test_clocksync_sidecar` uses, and for the same reason: the runners mutate
    process-wide state, and a module-level asyncio.Event binds to the first loop that awaits it."""
    capture._STOP = asyncio.Event()
    capture._RECOVER = asyncio.Event()
    capture._OXYII_PAUSE = asyncio.Event()
    capture._CONNECT_LOCK = asyncio.Lock()
    capture._POLAR_PAUSED.clear()
    capture._CLOCK_FRESHLY_SYNCED.clear()
    capture._CLOCK_SYNC_COOLDOWN.clear()
    capture._CLOCK_SYNC_LAST_OK.clear()
    capture._CFG.clear()
    capture.STATUS.clear()
    capture.STATUS["devices"] = {}
    yield
    capture._STOP.set()
    capture._STOP.clear()
    capture._CLOCK_FRESHLY_SYNCED.clear()


@pytest.fixture
def _no_sleep(monkeypatch):
    real_sleep = asyncio.sleep
    monkeypatch.setattr(capture.asyncio, "sleep", lambda *_a, **_k: real_sleep(0))
    monkeypatch.setattr(capture, "_set", lambda name, **kw: None)


def _run(coro):
    return asyncio.run(coro)


def _rows(root):
    """Every CLOCKSYNC row across the tree, header excluded."""
    out = []
    for p in sorted(glob.glob(os.path.join(root, "captures", "*", writers.CLOCKSYNC_NAME))):
        with open(p, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        out.extend(lines[1:])
    return out


def _ladder(outcomes):
    """A `sync_device_time` that TAKES THE DEVICE and then applies the next outcome.

    Going through the real `polar_offline_op` is the whole point: that is what increments the
    `offline_op` counter, and a MOVE in that counter is how the ladder detects "this attempt took the
    device and live capture stopped". A stub that raised without taking the device would exercise the
    cheap arm instead, which is the arm that was never in question."""
    seq = list(outcomes)
    tries = []

    async def sync(addr):
        async def op():
            o = seq[min(len(tries), len(seq) - 1)]
            tries.append(o)
            if isinstance(o, BaseException):
                raise o
            return o

        return await capture.polar_offline_op(addr, op, timeout=5.0)

    return sync, tries


# ── 1 · the ladder before START is not bounded in signal it cannot lose ──────────────────────────────


def test_the_PRESTART_ladder_retries_past_a_timeout_that_took_the_device(tmp_path, monkeypatch, _no_sleep):
    """21:33:55. One TimeoutError stopped the ladder, and the retry that would have worked never ran.

    The deferral it hit is correct DURING capture — a retry that already paid a pause is a second
    outage, measured at 66 of 146 attempts on vigil over 18 h. It is incorrect before PMD START, where
    the device is not streaming and the pause costs zero samples. Same code, same error, different
    denominator."""
    sync, tries = _ladder([TimeoutError(), None])
    monkeypatch.setattr(capture, "sync_device_time", sync)

    assert _run(capture.auto_sync_clock("H10", "AA:BB", str(tmp_path), live=False)) is True
    assert len(tries) == 2, "the pre-start ladder must retry past one timeout, not stop on it"
    assert not [r for r in _rows(str(tmp_path)) if ";deferred-after-pause;" in r], (
        "nothing was streaming, so there was no pause to defer for"
    )


def test_the_SAME_timeout_DURING_capture_still_defers_after_one_pause(tmp_path, monkeypatch, _no_sleep):
    """The control that makes the test above mean something. Identical sequence, `live` left at its
    default: the deferral must still fire, because here the pause really did cost signal. Without this
    leg the change would read the same as deleting the deferral outright."""
    sync, tries = _ladder([TimeoutError(), None])
    monkeypatch.setattr(capture, "sync_device_time", sync)

    assert _run(capture.auto_sync_clock("H10", "CC:DD", str(tmp_path))) is False
    assert len(tries) == 1, "during capture the second attempt buys a second outage at the same price"
    assert [r for r in _rows(str(tmp_path)) if ";deferred-after-pause;" in r]


def test_a_PRESTART_failure_is_not_charged_a_CROSS_LADDER_backoff(tmp_path, monkeypatch, _no_sleep):
    """21:34:54, one level up: the cooldown is armed by `_clock_sync_note_outcome` only when the ladder
    PAID A PAUSE, and the pre-start ladder cannot. Arming it there is what skipped the reconnect sync on
    a clock that was settable — a bound spending signal that was never lost."""
    sync, _tries = _ladder([TimeoutError(), TimeoutError(), TimeoutError()])
    monkeypatch.setattr(capture, "sync_device_time", sync)

    assert _run(capture.auto_sync_clock("H10", "EE:FF", str(tmp_path), live=False)) is False
    assert "EE:FF" not in capture._CLOCK_SYNC_COOLDOWN, "a pause that cost nothing must cost no backoff"


def test_a_LIVE_failure_IS_charged_one(tmp_path, monkeypatch, _no_sleep):
    """The paired control. The backoff is the measured remedy for 80 ladders in 18 h, every one paying a
    pause, so `live=False` must narrow it rather than remove it."""
    sync, _tries = _ladder([TimeoutError(), TimeoutError(), TimeoutError()])
    monkeypatch.setattr(capture, "sync_device_time", sync)

    assert _run(capture.auto_sync_clock("H10", "11:22", str(tmp_path))) is False
    assert "11:22" in capture._CLOCK_SYNC_COOLDOWN, "during capture the backoff still earns its place"


# ── 2 · START happens anyway, and the night records what it started on ───────────────────────────────


def _runner(monkeypatch, sync, iterations=1):
    """Drive the real `run_polar` with a refused link, `iterations` times round the loop.

    The link is refused deliberately: a successful session runs its own sleep loop and would exhaust the
    stop budget before the outer loop came round again, so a passing connection can never reach a second
    iteration under this harness (the reason `test_clock_resync_on_reconnect` gives for the same trick)."""
    from tests.test_capture_runners import _pdev, _polar_common, _stop_after

    _polar_common(monkeypatch)
    capture._CFG.clear()
    capture._CFG.update({"time": {"auto_sync_devices": True}})

    def refuse(addr, *a, **k):
        raise OSError("le-connection-abort-by-local")

    monkeypatch.setattr(capture, "sync_device_time", sync)
    monkeypatch.setattr(capture, "_connect", refuse)
    _stop_after(monkeypatch, iterations)
    return _pdev()


def test_a_failed_PRESTART_sync_STILL_STARTS_the_night_and_says_so(tmp_path, monkeypatch):
    """21:34:22. START must not be gated on the sync — refusing to start would trade a night with a bad
    clock for no night at all, and absence of a clock is not absence of signal. What was missing is the
    RECORD: the night's own files said nothing about the clock it started on, which is the same gap that
    hid 84 nights on the 2019 default for two months."""

    async def never(addr):
        raise RuntimeError("no such characteristic")

    dev = _runner(monkeypatch, never)
    asyncio.run(capture.run_polar(dev, str(tmp_path)))

    rows = _rows(str(tmp_path))
    assert [r for r in rows if ";start-without-sync;" in r], rows


def test_a_SUCCESSFUL_prestart_sync_writes_no_such_row(tmp_path, monkeypatch):
    """The inverse control: the row must name a real failure, not every night that starts."""

    async def fine(addr):
        return None

    dev = _runner(monkeypatch, fine)
    asyncio.run(capture.run_polar(dev, str(tmp_path)))

    rows = _rows(str(tmp_path))
    assert [r for r in rows if ";synced;" in r], rows
    assert not [r for r in rows if ";start-without-sync;" in r], rows


def test_a_firmware_default_clock_is_RESYNCED_on_reconnect_despite_the_cooldown(tmp_path, monkeypatch):
    """21:34:54, end to end. The pre-start failure arms nothing now, but a LIVE failure still can, and a
    device sitting on its 2019 clock must be re-asked anyway: the backoff's own docstring prices waiting
    at "72 ms per hour", which is true of a clock that is nearly right and wrong by nine orders of
    magnitude of this one."""
    calls = []

    async def always_fails(addr):
        calls.append(addr)
        raise RuntimeError("charging — PMD streams unavailable")

    dev = _runner(monkeypatch, always_fails, iterations=3)
    capture._CLOCK_SYNC_COOLDOWN[dev["address"]] = (4, 1e18)  # deep inside a backoff window
    capture.STATUS["devices"]["H10"] = {"clock_skew_floor_sec": -2.46e8}
    asyncio.run(capture.run_polar(dev, str(tmp_path)))

    assert len(calls) >= 2, "a clock at its firmware default outranks the repetition bounds"


def test_a_MERELY_WRONG_clock_is_left_to_the_cooldown(tmp_path, monkeypatch):
    """The discriminator, not the plumbing. Same harness, same cooldown, a skew of -1.3 s instead of
    -2.46e+08: the backoff must still hold, or this change is just a deletion of it. -1.3 s is the real
    neighbouring value — every one of the 22 measured bad reads sat between skews of -1.1..-1.9 s."""
    calls = []

    async def always_fails(addr):
        calls.append(addr)
        raise RuntimeError("charging — PMD streams unavailable")

    dev = _runner(monkeypatch, always_fails, iterations=3)
    capture._CLOCK_SYNC_COOLDOWN[dev["address"]] = (4, 1e18)
    capture.STATUS["devices"]["H10"] = {"clock_skew_floor_sec": -1.3}
    asyncio.run(capture.run_polar(dev, str(tmp_path)))

    assert len(calls) == 1, "only the pre-start sync; the cooldown still bounds an ordinary wrong clock"


# ── 3 · the give-up verdict quotes corrections that RAN ──────────────────────────────────────────────


def test_the_2026_10_20_SKEW_is_UNREADABLE_not_UNCORRECTABLE():
    """21:35:18, the false row. `clock_resync_reason` declined because the skew was past the plausible
    bound, so the adrift arm — the only place corrections are counted — was never reached; the caller
    then printed the give-up sentence with CLOCK_ADRIFT_GIVEUP in it. Two causes, one word, and a count
    that was not measured (§∅)."""
    word, ran = capture.clock_decline_verdict(-246245660.72, None, 0, capture.CLOCK_TOLERANCE_S)
    assert word == "unreadable"
    assert ran == 0, "nothing had been attempted, so the honest count is zero"


def test_a_SPENT_GIVE_UP_BUDGET_reports_the_number_of_corrections_that_ran():
    """The other cause, with its real count. `ran` is `failed_adrift`, which counts corrections that
    were attempted AND left the skew where it was — so the sentence stays true if the constant moves."""
    assert capture.clock_decline_verdict(99.0, 98.0, 3, 2.0, giveup=3) == ("uncorrectable", 3)
    assert capture.clock_decline_verdict(99.0, 98.0, 7, 2.0, giveup=3) == ("uncorrectable", 7)
    assert capture.clock_decline_verdict(99.0, 98.0, 2, 2.0, giveup=3) is None, "still trying is not a verdict"


def test_a_CLOCK_INSIDE_TOLERANCE_gets_no_verdict_at_all():
    """§∅ in its usual direction: the watchdog declines on every quiet cycle too, and a quiet cycle is
    not a finding. `skew is None` is the same answer — an absent reading decides nothing."""
    assert capture.clock_decline_verdict(0.4, 0.3, 0, 2.0) is None
    assert capture.clock_decline_verdict(2.0, 0.3, 9, 2.0) is None, "at the boundary, inside it"
    assert capture.clock_decline_verdict(None, 0.3, 9, 2.0) is None


def test_a_PERSISTENT_beyond_the_bound_skew_with_a_SPENT_budget_is_uncorrectable():
    """A reset clock that will not take the write is a real give-up, and it must not be mistaken for the
    single-read case: both prev and skew are past the bound, so persistence is established, and the
    budget is spent. The count is measured, as above."""
    assert capture.clock_decline_verdict(-2.46e8, -2.46e8, 3, 2.0, giveup=3) == ("uncorrectable", 3)


# ── 4 · PERSISTENCE separates the two populations, MAGNITUDE does not ────────────────────────────────


def test_an_ISOLATED_beyond_the_bound_read_still_triggers_NOTHING():
    """The guard this change had to keep. A zero `sensor_ns` resolves to `_POLAR_EPOCH + 0` — a real
    instant 26.7 years back — so an ABSENT stamp is indistinguishable by value from a very slow clock,
    and 22 such reads drove `sync_device_time` and dropped the link mid-capture. All 22 were ISOLATED,
    each bracketed by a sane skew of -1.1..-1.9 s."""
    jump, tol = 30.0, capture.CLOCK_TOLERANCE_S
    assert capture.clock_resync_reason(-842505658.4, -1.3, jump, tol) is None
    assert capture.clock_resync_reason(-2.46e8, -1.3, jump, tol) is None
    assert capture.clock_resync_reason(-2.46e8, None, jump, tol) is None, "a first sighting decides nothing"


def test_a_PERSISTENT_beyond_the_bound_read_IS_a_reset_clock():
    """And the H10 half, which the night of 2026-10-20 refutes the old rule with: the read repeated,
    and the clock then took a manual write on attempt 1. Two beyond-the-bound reads in a row cannot be
    two absent stamps bracketing each other — that is the whole content of the discriminator."""
    jump, tol = 30.0, capture.CLOCK_TOLERANCE_S
    assert capture.clock_resync_reason(-2.46e8, -2.46e8, jump, tol) == "reset"
    assert capture.clock_resync_reason(-2.46e8, -2.46e8, jump, tol, capture.CLOCK_ADRIFT_GIVEUP) is None, (
        "and it is still bounded — a reset clock that will not take the write is not retried forever"
    )


def test_the_RESET_rung_is_PURE():
    """Called from a loop that runs every five minutes all night; the same inputs must decide the same
    thing however often it is asked."""
    for _ in range(3):
        assert capture.clock_resync_reason(-2.46e8, -2.47e8, 30.0, 2.0, 0) == "reset"


# ── 5 · the firmware-default override, as a predicate ────────────────────────────────────────────────


def test_clock_reads_reset_is_the_BOUND_and_nothing_else():
    assert capture.clock_reads_reset(-2.46e8) is True
    assert capture.clock_reads_reset(capture.CLOCK_IMPLAUSIBLE_S + 1) is True
    assert capture.clock_reads_reset(capture.CLOCK_IMPLAUSIBLE_S) is False, "at the bound, inside it"
    assert capture.clock_reads_reset(-1.3) is False
    assert capture.clock_reads_reset(None) is False, "§∅ — an absent reading is not a reset clock"


def test_a_RESET_clock_outranks_BOTH_repetition_bounds():
    """`cooling` says "this device keeps refusing the write"; `synced_age_s` says "we wrote it N seconds
    ago". A device that has reset since that write has not got the clock we wrote, so both are reasoning
    about a clock that no longer exists."""
    assert capture.clock_sync_due(True, True, False, False, cooling=True) is False
    assert capture.clock_sync_due(True, True, False, False, cooling=True, reset=True) is True
    assert capture.clock_sync_due(True, True, False, False, synced_age_s=1.0) is False
    assert capture.clock_sync_due(True, True, False, False, synced_age_s=1.0, reset=True) is True
    assert capture.clock_sync_due(True, True, False, True, reset=True) is True, (
        "a firmware default right after the pre-loop sync is new information, not a repeat"
    )


def test_a_RESET_clock_does_NOT_outrank_the_ELIGIBILITY_bounds():
    """The three that are not about repetition. A docked Polar refuses the write outright (status 0x0D),
    so asking only burns the give-up budget — the measured 2026-07-29 failure — and being reset does not
    make a docked device settable."""
    assert capture.clock_sync_due(True, True, True, False, reset=True) is False, "charging still binds"
    assert capture.clock_sync_due(False, True, False, False, reset=True) is False, "nor does it grant PS-FTP"
    assert capture.clock_sync_due(True, False, False, False, reset=True) is False, "nor override the config"


# ── 6 · the two new words record NO clock write, and a seam may not borrow one ───────────────────────


def test_neither_new_WORD_can_excuse_a_SEAM_in_the_axis(tmp_path):
    """An invisible coupling, pinned from the side that can see it. `solid_night_inputs._seam_cause`
    names a clock event as a step's cause by SUBSTRING over the whole row, so a word spelled
    `unsynced-start` would have excused a step on the strength of a sync that never happened — and
    `_A5_NON_RECORD_EVENTS` is the other half of the same rule for the A5 band. Neither of these
    events moved a device clock, so neither is a record of the step a band is asking about."""
    import solid_night_inputs as sni

    for word in ("unreadable", "start-without-sync", "released-to-set"):
        night = tmp_path / word
        night.mkdir()
        (night / "CLOCKSYNC.csv").write_text(
            "Phone timestamp;device;address;event;skew_sec;detail\n"
            f"2026-10-20T21:35:18;H10;AA:BB;{word};-246245660.720;0 corrections attempted\n",
            encoding="utf-8",
        )
        assert sni._seam_cause(str(night)) is None, word
        assert word in sni._A5_NON_RECORD_EVENTS, word

    # The positive control: a row that DID move a clock still names the cause it always did.
    night = tmp_path / "resynced"
    night.mkdir()
    (night / "CLOCKSYNC.csv").write_text(
        "Phone timestamp;device;address;event;skew_sec;detail\n2026-10-20T21:38:17;H10;AA:BB;resynced;-1.3;adrift\n",
        encoding="utf-8",
    )
    assert sni._seam_cause(str(night)) is not None


# ---------------------------------------------------------------- 7 · the watchdog's two decline arms
#
# `clock_decline_verdict` is tested purely above. These two drive the watchdog itself, because the arms
# that CONSUME the verdict are where a wrong word reaches the night's file and the operator's log.


def _watchdog(monkeypatch, root, skew, cycles, sync=None):
    """Run the watchdog `cycles` polls against one connected Polar holding a constant skew.

    Shaped after `tests/test_clocksync_sidecar._drive`, with `_set` CAPTURED rather than discarded: the
    `unreadable` arm's whole claim is that it leaves STATUS alone, and a no-op stub cannot show that."""
    sets = []
    monkeypatch.setattr(capture, "_set", lambda name, **kw: sets.append((name, kw)))
    calls = []

    async def _ok(addr):
        calls.append(addr)

    monkeypatch.setattr(capture, "sync_device_time", sync or _ok)
    dev = [{"name": "H10", "address": "AA:BB:CC:DD:EE:FF", "vendor": "Polar"}]
    capture.STATUS["devices"] = {"H10": {"clock_skew_sec": skew, "clock_skew_floor_sec": skew, "connected": True}}
    n = {"i": 0}

    async def fake_sleep(_s):
        n["i"] += 1
        if n["i"] >= cycles:
            capture._STOP.set()

    monkeypatch.setattr(capture.asyncio, "sleep", fake_sleep)
    capture._STOP.clear()
    try:
        _run(capture.clock_watchdog({"devices": dev, "time": {"drift_check_sec": 0}}, str(root)))
    finally:
        capture._STOP.set()
    return sets, calls


def test_ONE_beyond_the_bound_read_lands_UNREADABLE_and_claims_nothing(tmp_path, monkeypatch, _no_sleep):
    """The 2026-10-20 skew on its FIRST cycle. The row says what was read and what was attempted, and
    nothing else moves: `uncorrectable` would name corrections that never ran, and clearing
    `clock_synced` would erase when the last real sync happened on the strength of one unreadable
    sample."""
    sets, calls = _watchdog(monkeypatch, tmp_path, skew=-246245660.72, cycles=1)
    rows = _rows(str(tmp_path))
    unr = [r for r in rows if ";unreadable;" in r]
    assert len(unr) == 1, rows
    assert ";H10;AA:BB:CC:DD:EE:FF;unreadable;-246245660.720;one read past the plausible bound" in unr[0]
    assert not [r for r in rows if ";uncorrectable;" in r], "nothing was attempted, so nothing gave up"
    assert calls == [], "one read past the bound must not grab the link"
    assert not [kw for _n, kw in sets if "clock_synced" in kw], sets


def test_the_SECOND_such_read_re_syncs_the_clock_as_a_RESET(tmp_path, monkeypatch, _no_sleep):
    """THE CONTROL on the test above, and the whole point of the persistence rung. The same constant
    skew, one cycle later: now a `prev` past the bound exists, so the read is a reset clock rather than
    an absent stamp, and the watchdog corrects it."""
    sets, calls = _watchdog(monkeypatch, tmp_path, skew=-246245660.72, cycles=2)
    rows = _rows(str(tmp_path))
    assert len([r for r in rows if ";unreadable;" in r]) == 1, rows
    res = [r for r in rows if ";resynced;" in r]
    assert len(res) == 1, rows
    assert res[0].endswith(";reset"), res
    assert calls == ["AA:BB:CC:DD:EE:FF"], calls
    assert ("H10", {"clock_synced": None}) in sets, sets


# ── 4 · a device that comes up on a clock no sync has set is synced before START ────────────────────
#
# 2026-10-24, after a battery swap: the pre-start scan missed the H10 at 22:24:06, the loop's scan missed
# it at 22:25:04, the connect found it at 22:25:12, and streaming ran on the 2019 clock until a manual
# sync at 22:29:47. The connect proved the device was back; nothing acted on it.


def _up_runner(monkeypatch, sync, connects, sleeps=1):
    """Drive the real `run_polar` with a `_connect` that SUCCEEDS on the first call and refuses after.

    The released link never reaches a writer or PMD, so the dummy client is never touched; a session
    that does go on to START meets the refusal instead, which ends the iteration in the error backoff."""
    import contextlib

    from tests.test_capture_runners import _pdev, _polar_common, _stop_after

    _polar_common(monkeypatch)
    capture._CFG.clear()
    capture._CFG.update({"time": {"auto_sync_devices": True}})

    @contextlib.asynccontextmanager
    async def connect(addr, *a, **k):
        connects.append(addr)
        if len(connects) > 1:
            raise OSError("le-connection-abort-by-local")
        yield object()

    monkeypatch.setattr(capture, "sync_device_time", sync)
    monkeypatch.setattr(capture, "_connect", connect)
    _stop_after(monkeypatch, sleeps)
    return _pdev()


def _absent_then(outcomes):
    """A `sync_device_time` whose scan misses the device, then applies `outcomes` in order."""
    seq = list(outcomes)
    calls = []

    async def sync(addr):
        o = seq[min(len(calls), len(seq) - 1)]
        calls.append(o)
        if isinstance(o, BaseException):
            raise o
        return o

    return sync, calls


def test_a_device_UP_on_an_unsynced_clock_is_released_and_synced_before_START(tmp_path, monkeypatch):
    """22:25:12 replayed: pre-start sync absent, the first connect succeeds. The link is released, the
    next iteration syncs (in spite of `first_attempt`), and only then does the loop connect again."""
    absent = capture.DeviceNotAdvertising("not advertising")
    assert capture.device_absent_error(absent), "the plant must take the deferred-absent arm"
    sync, calls = _absent_then([absent, None])
    connects = []
    dev = _up_runner(monkeypatch, sync, connects)
    asyncio.run(capture.run_polar(dev, str(tmp_path)))

    assert len(calls) == 2, f"the pre-start sync, then the sync after the release: {calls}"
    assert len(connects) == 2, "released the first link, then connected again after the sync"
    rows = _rows(str(tmp_path))
    kinds = [r.split(";")[3] for r in rows]
    assert kinds == ["deferred-absent", "start-without-sync", "released-to-set", "synced"], kinds


def test_a_device_UP_whose_clock_IS_set_is_not_released(tmp_path, monkeypatch):
    """The control: a pre-start sync that landed owes nothing, so the first connect goes on to START."""
    sync, calls = _absent_then([None])
    connects = []
    dev = _up_runner(monkeypatch, sync, connects)
    asyncio.run(capture.run_polar(dev, str(tmp_path)))

    assert len(calls) == 1
    assert not [r for r in _rows(str(tmp_path)) if ";released-to-set;" in r]


def test_a_sync_that_LANDED_ELSEWHERE_settles_the_debt(tmp_path, monkeypatch):
    """The watchdog or the monitor's button can set the clock between the failure and the connect. That
    write is newer in `_CLOCK_SYNC_LAST_OK`, so the connect must not release the link for it."""
    absent = capture.DeviceNotAdvertising("not advertising")
    sync, calls = _absent_then([absent])
    connects = []
    dev = _up_runner(monkeypatch, sync, connects)
    real_gate = capture._clock_gate

    def gate_and_land(name, addr, is_polar):
        if calls:  # after the pre-start failure: another path writes the clock
            capture._CLOCK_SYNC_LAST_OK[addr] = capture._time.monotonic() + 1.0
        return real_gate(name, addr, is_polar)

    monkeypatch.setattr(capture, "_clock_gate", gate_and_land)
    asyncio.run(capture.run_polar(dev, str(tmp_path)))

    assert not [r for r in _rows(str(tmp_path)) if ";released-to-set;" in r]


def test_the_release_is_BOUNDED_for_a_device_the_sync_scan_never_finds(tmp_path, monkeypatch):
    """Connect works, the sync scan never does: three releases, then START on the unsynced clock. Without
    the bound this cycles all night with no START at all."""
    import contextlib

    absent = capture.DeviceNotAdvertising("not advertising")
    sync, calls = _absent_then([absent])
    connects = []
    dev = _up_runner(monkeypatch, sync, connects)

    @contextlib.asynccontextmanager
    async def always_up(addr, *a, **k):
        connects.append(addr)
        if len(connects) > capture._CLOCK_SYNC_UP_RELEASES:
            raise OSError("le-connection-abort-by-local")  # the START that follows the last release
        yield object()

    monkeypatch.setattr(capture, "_connect", always_up)
    asyncio.run(capture.run_polar(dev, str(tmp_path)))

    released = [r for r in _rows(str(tmp_path)) if ";released-to-set;" in r]
    assert len(released) == capture._CLOCK_SYNC_UP_RELEASES, released
    assert len(connects) == capture._CLOCK_SYNC_UP_RELEASES + 1


def test_clock_sync_owed_on_connect_is_PURE_and_each_bound_binds():
    f = capture.clock_sync_owed_on_connect
    assert f(True, True, True, False, False, 0, 3) is True
    assert f(False, True, True, False, False, 0, 3) is False, "nothing owed"
    assert f(True, False, True, False, False, 0, 3) is False, "cannot take the write"
    assert f(True, True, False, False, False, 0, 3) is False, "sync disabled"
    assert f(True, True, True, True, False, 0, 3) is False, "docked"
    assert f(True, True, True, None, False, 0, 3) is True, "charging unknown is not charging"
    assert f(True, True, True, False, True, 0, 3) is False, "inside its backoff"
    assert f(True, True, True, False, False, 2, 3) is True
    assert f(True, True, True, False, False, 3, 3) is False, "the bound"
