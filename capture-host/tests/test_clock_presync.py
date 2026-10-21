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

    for word in ("unreadable", "start-without-sync"):
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
