# tepna-capture — tests/test_capture_clock_and_health.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# capture._now() — the CLOCK_MONOTONIC-anchored wall clock every sample is stamped with — and
# classify_adapter_health, the pure decision the BLE watchdog turns on.
#
# _now() makes a THREE-WAY distinction that is exact rather than heuristic, and getting it wrong is
# invisible until it ruins a night:
#
#   normal drift  -> return the monotonic prediction (the fast path, runs at 130 Hz)
#   DST relabel   -> the zone's UTC offset moved by the SAME amount as the apparent drift. Absorb it and
#                    keep counting in the session's ORIGINAL offset. Re-anchoring here would rewind the
#                    file a full hour MID-NIGHT, colliding with the hour it already wrote — the Clock
#                    Contract's "overnight 22:00→06:00 = ~8 h monotonic" check fails on exactly one night
#                    a year, which is the definition of a bug nobody catches in testing.
#   NTP step      -> the clock moved with the offset UNCHANGED. Re-anchor.
#
# Driven by replacing capture._dt / capture._time / capture._utcoffset, so no real clock is touched and
# a DST transition can be exercised in a second.

import datetime as dt
import types

import pytest

import capture


class _Clock:
    """A controllable stand-in for the wall clock, the monotonic clock and the zone offset."""

    def __init__(self, wall: dt.datetime, mono: float = 1000.0, offset_hours: float = -4):
        self.wall, self.mono = wall, mono
        self.offset = dt.timedelta(hours=offset_hours)
        # A RECORDING IS IN PROGRESS. `_now()` may absorb a civil relabelling only to stop an OPEN file
        # rewinding (CAPTURE-HOST-DEEP-AUDIT §A1) — the transition tests below are all about such a
        # file, so they must say so. Set to 0 to model an idle box, which now follows civil time.
        self.writers_open = 1

    def advance(self, seconds: float):
        """Time passes normally — both clocks move together."""
        self.wall += dt.timedelta(seconds=seconds)
        self.mono += seconds

    def step_wall(self, seconds: float):
        """The WALL clock jumps without the monotonic clock — an NTP correction."""
        self.wall += dt.timedelta(seconds=seconds)

    def dst_transition(self, seconds: float):
        """Civil relabelling: the wall clock jumps AND the zone offset moves by the same amount."""
        self.wall += dt.timedelta(seconds=seconds)
        self.offset += dt.timedelta(seconds=seconds)


@pytest.fixture
def clock(monkeypatch):
    c = _Clock(dt.datetime(2026, 11, 1, 1, 30, 0))

    class FakeDatetime(dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return c.wall

    monkeypatch.setattr(capture, "_dt", types.SimpleNamespace(
        datetime=FakeDatetime, timedelta=dt.timedelta))
    monkeypatch.setattr(capture, "_time", types.SimpleNamespace(monotonic=lambda: c.mono))
    monkeypatch.setattr(capture, "_utcoffset", lambda _when: c.offset)
    # module-level anchor state must not leak between tests
    monkeypatch.setattr(capture, "_anchor_wall", None)
    monkeypatch.setattr(capture, "_anchor_mono", 0.0)
    monkeypatch.setattr(capture, "_anchor_utcoff", dt.timedelta(0))
    monkeypatch.setattr(capture, "_civil_shift", 0.0)
    monkeypatch.setattr(capture, "open_sample_writers", lambda: c.writers_open)
    return c


# ── the fast path ───────────────────────────────────────────────────────────────────────────────────
def test_first_call_anchors_and_returns_civil_time(clock):
    assert capture._now() == clock.wall
    assert capture._anchor_wall is not None, "the first call must pin the anchor"


def test_steady_state_tracks_the_monotonic_clock(clock):
    capture._now()
    clock.advance(10)
    assert capture._now() == clock.wall
    clock.advance(3600)
    assert capture._now() == clock.wall


def test_sub_threshold_wobble_is_ignored_and_the_prediction_wins(clock):
    """The wall clock jitters by less than the step threshold; stamps must keep coming off the monotonic
    prediction rather than following the noise."""
    capture._now()
    clock.advance(60)
    clock.step_wall(1.0)                      # under _STEP_THRESH_S
    got = capture._now()
    assert got == clock.wall - dt.timedelta(seconds=1.0), "prediction, not the wobbling wall clock"


# ── NTP steps ───────────────────────────────────────────────────────────────────────────────────────
def test_a_forward_ntp_step_re_anchors(clock):
    capture._now()
    clock.advance(60)
    clock.step_wall(30)                        # NTP correction, offset unchanged
    assert capture._now() == clock.wall
    clock.advance(5)
    assert capture._now() == clock.wall, "after re-anchoring it tracks the corrected clock"


def test_a_backward_ntp_step_re_anchors_when_nothing_is_being_written(clock):
    """The SIBLING of test_capture_clock.py's pair, kept in step with it (DEEP-AUDIT-FOLLOWUPS §3,
    2026-08-05). With no capture file open there is nothing to rewind, so a backward correction is
    applied — the same reasoning the DST arm uses for a relabelling."""
    clock.writers_open = 0
    capture._now()
    clock.advance(60)
    clock.step_wall(-30)
    assert capture._now() == clock.wall


def test_a_backward_ntp_step_is_absorbed_while_a_capture_file_is_open(clock):
    """And the half this file was missing. Measured before the change: a −30 s step with a writer open
    sent `_now()` backwards, rewinding the Phone column of a file being written — which breaks the
    strictly-increasing guarantee every parser depends on."""
    clock.writers_open = 1
    capture._now()
    clock.advance(60)
    before = capture._now()
    clock.step_wall(-30)
    assert capture._now() >= before, "an open recording must never have its stamps rewound"
    clock.advance(1)
    assert capture._now() > before, "…and real time must still advance across the absorbed step"


# ── DST: the case this whole path exists for ────────────────────────────────────────────────────────
def test_a_fall_back_transition_does_NOT_rewind_the_stamps(clock):
    """THE bug. At 02:00 on the autumn transition the civil clock goes back an hour. Re-anchoring would
    rewind capture stamps into an hour already written. Stamps must keep counting monotonically in the
    session's original offset instead."""
    t0 = capture._now()
    clock.advance(1800)                        # 30 min of real recording
    before = capture._now()
    clock.dst_transition(-3600)                # 02:00 -> 01:00, offset -4h -> -5h
    at_transition = capture._now()
    # No monotonic time passed across the relabelling, so the stamp must not move AT ALL — in particular
    # it must not rewind by the width of the transition, which is what re-anchoring would do.
    assert at_transition >= before, "stamps went BACKWARDS across a DST fall-back"
    assert (at_transition - before).total_seconds() == pytest.approx(0, abs=1), \
        "the hour is civil relabelling, not elapsed time — it must not appear in the stamps"
    # and recording continues to advance normally on the far side
    clock.advance(60)
    after = capture._now()
    assert (after - at_transition).total_seconds() == pytest.approx(60, abs=1)
    assert (after - t0).total_seconds() == pytest.approx(1860, abs=1), \
        "total elapsed must be real recording time, not real time minus the transition"


def test_a_spring_forward_transition_does_not_jump_the_stamps(clock):
    capture._now()
    clock.advance(600)
    before = capture._now()
    clock.dst_transition(3600)                 # 01:00 -> 03:00, offset -5h -> -4h
    after = capture._now()
    assert (after - before).total_seconds() == pytest.approx(0, abs=1), \
        "a spring-forward must not insert a fabricated hour of recording"


def test_stamps_stay_monotonic_across_a_transition_for_a_whole_night(clock):
    """The Clock Contract's own check: overnight 22:00→06:00 must be ~8 h monotonic, on the one night a
    year that contains a transition."""
    stamps = [capture._now()]
    for minute in range(8 * 60):
        clock.advance(60)
        if minute == 240:                      # 4 h in, fall back
            clock.dst_transition(-3600)
        stamps.append(capture._now())
    assert all(b > a for a, b in zip(stamps, stamps[1:])), "stamps must be strictly increasing"
    elapsed = (stamps[-1] - stamps[0]).total_seconds()
    assert elapsed == pytest.approx(8 * 3600, abs=5), f"~8 h expected, got {elapsed / 3600:.2f} h"


def test_an_ntp_step_after_a_transition_re_anchors_inside_the_original_offset_frame(clock):
    """The compound case the _civil_shift carry-forward exists for: once a transition has been absorbed,
    a genuine NTP correction must re-anchor WITHIN the session's original frame. Dropping back to plain
    civil time here would rewind the file by the width of the transition."""
    capture._now()
    clock.advance(600)
    clock.dst_transition(-3600)
    after_dst = capture._now()
    assert capture._civil_shift == pytest.approx(-3600, abs=1)
    clock.advance(300)
    clock.step_wall(20)                        # NTP correction, offset unchanged
    after_ntp = capture._now()
    assert after_ntp > after_dst, "stamps went backwards when NTP landed after a transition"
    assert capture._civil_shift == pytest.approx(-3600, abs=1), "the absorbed shift must carry forward"
    clock.advance(60)
    assert capture._now() > after_ntp


def test_civil_shift_is_recorded_only_once_per_transition(clock):
    capture._now()
    clock.advance(60)
    clock.dst_transition(-3600)
    capture._now()
    first = capture._civil_shift
    for _ in range(5):
        clock.advance(60)
        capture._now()
    assert capture._civil_shift == first, "a settled transition must not be re-absorbed every call"


# ── classify_adapter_health ─────────────────────────────────────────────────────────────────────────
def test_nothing_worn_is_benign_not_wedged():
    """The distinction the whole watchdog turns on. Yanking the adapter because the user took a sensor
    off is worse than the problem it would be 'fixing'."""
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False, "last_error": "not found"},
        {"name": "Ring", "address": "B", "connected": False, "last_error": None},
    ])
    assert h["wedged"] is False and h["reasons"] == [] and h["phantom"] == []


def test_in_progress_is_an_unambiguous_wedge():
    """A not-worn device fails cleanly with 'not found'; InProgress is adapter-level contention and can
    never be a not-worn state."""
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False,
         "last_error": "BleakDBusError('org.bluez.Error.InProgress', ...)"}])
    assert h["wedged"] is True and "H10: InProgress" in h["reasons"]
    assert h["phantom"] == [], "InProgress needs no targeted disconnect"


def test_a_phantom_link_is_wedged_and_names_the_address():
    """BlueZ says Connected while we say not — a stale link nobody can re-grab, because a 'connected'
    device stops advertising. The address is what the recovery ladder disconnects."""
    h = capture.classify_adapter_health([
        {"name": "Ring", "address": "D1:98:62:7C:92:B3", "connected": False, "bluez_connected": True}])
    assert h["wedged"] is True and h["phantom"] == ["D1:98:62:7C:92:B3"]
    assert "phantom BlueZ link" in h["reasons"][0]


def test_a_healthy_connected_device_is_not_a_phantom():
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": True, "bluez_connected": True}])
    assert h["wedged"] is False and h["phantom"] == []


def test_several_signals_with_a_live_device_report_only_the_real_wedge():
    # Verity is connected (the radio is serving a live link), so the H10's InProgress is benign device
    # contention and is NOT flagged (2026-07-20 false-wedge fix) — but the Ring's PHANTOM link is a real
    # wedge regardless, so `wedged` is still True and only the phantom is reported.
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False, "last_error": "InProgress"},
        {"name": "Ring", "address": "B", "connected": False, "bluez_connected": True},
        {"name": "Verity", "address": "C", "connected": True},
    ])
    assert h["wedged"] is True and len(h["reasons"]) == 1 and h["phantom"] == ["B"]


def test_an_empty_device_list_is_not_wedged():
    assert capture.classify_adapter_health([])["wedged"] is False


# ── adapter_up: the pinned-adapter-DOWN signal (VIGIL-OVERNIGHT-FINDINGS 2026-07-24) ──────────────────
# On 2026-07-23 the USB dongle wedged twice; every connect failed with a plain Timeout('connect timed
# out'), which is neither InProgress nor a phantom link — so classify read a DOWN radio as "not worn" and
# the watchdog logged "adapter healthy again" 25×+ over a dead adapter, resetting its escalation counter
# each time. adapter_up carries the adapter's ACTUAL state so a DOWN dongle is caught directly.
def test_pinned_adapter_down_with_nothing_connected_is_wedged():
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False,
         "last_error": "TimeoutError('connect timed out after 30s')"},
        {"name": "Verity", "address": "C", "connected": False,
         "last_error": "TimeoutError('connect timed out after 30s')"},
    ], adapter_up=False)
    assert h["wedged"] is True and "pinned adapter DOWN/not-found" in h["reasons"]


def test_pinned_adapter_down_is_ignored_while_a_device_is_connected():
    """A live link is proof the radio works — a False adapter_up (probe misread) must NEVER flag a wedge
    while a device streams, or it could power-cycle a working adapter."""
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": True},
    ], adapter_up=False)
    assert h["wedged"] is False and h["reasons"] == []


def test_adapter_up_true_adds_no_wedge_signal():
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False, "last_error": "not found"},
    ], adapter_up=True)
    assert h["wedged"] is False


def test_adapter_up_none_preserves_prior_behaviour():
    """Back-compat: callers that don't probe the adapter (adapter_up defaults None) get the exact
    pre-2026-07-24 classification — clean not-found benign, InProgress wedged."""
    assert capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False, "last_error": "not found"}])["wedged"] is False
    assert capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False, "last_error": "InProgress"}])["wedged"] is True


def test_inprogress_with_nobody_connected_is_suppressed_when_the_adapter_is_confirmed_up():
    """2026-07-24 09:46 false positive: the O2Ring auto-pull + every sensor going off-finger/on-charger at
    once left nobody connected while InProgress churned, and the watchdog power-cycled a hci0 that was
    UP RUNNING the whole time. A CONFIRMED-up adapter makes all-disconnected InProgress device churn, not a
    radio wedge — so it must NOT flag a wedge."""
    h = capture.classify_adapter_health([
        {"name": "H10", "address": "A", "connected": False, "last_error": "InProgress"},
        {"name": "Ring", "address": "B", "connected": False,
         "last_error": "BleakDeviceNotFoundError('not advertising')"},
    ], adapter_up=True)
    assert h["wedged"] is False and h["reasons"] == []


def test_inprogress_still_wedges_when_the_adapter_is_down_or_unknown():
    """The suppression is ONLY on positive proof the radio is up. adapter_up False (DOWN) or None
    (unprobed) still treats all-disconnected InProgress as a wedge — a real DOWN wedge is never masked."""
    for up in (False, None):
        h = capture.classify_adapter_health([
            {"name": "H10", "address": "A", "connected": False, "last_error": "InProgress"}], adapter_up=up)
        assert h["wedged"] is True, f"adapter_up={up!r} should still flag InProgress"


def test_a_phantom_link_is_a_wedge_even_when_the_adapter_is_up():
    """The adapter_up gate applies ONLY to the inferred InProgress signal. A phantom BlueZ link is a real
    stale link that needs clearing regardless of adapter state, so it still flags."""
    h = capture.classify_adapter_health([
        {"name": "Ring", "address": "B", "connected": False, "bluez_connected": True}], adapter_up=True)
    assert h["wedged"] is True and h["phantom"] == ["B"]


# ── defense_warnings: the startup self-test for disarmed wedge defenses (VIGIL-OVERNIGHT-FINDINGS §P1.4) ─
def test_all_defenses_armed_warns_nothing():
    # autosuspend off (the udev rule is installed) + CAP_NET_ADMIN present (non-zero CapEff).
    assert capture.defense_warnings("on", "0000000000000800") == []


ARMED = ("on", "0000000000000800")          # autosuspend off + CAP_NET_ADMIN present


def test_omitting_a_defense_is_NOT_the_same_as_it_being_disarmed():
    """The self-test must never report on something it did not look at.

    `usb_path=None` legitimately means "unset, therefore disarmed", so absence needs its own marker —
    otherwise every existing two-argument call would start announcing defenses disarmed that it never
    inspected. That is the same class of lie this whole check exists to catch, pointed the other way."""
    assert capture.defense_warnings(*ARMED) == []


def test_an_unset_usb_path_warns_that_the_last_rung_is_disabled(monkeypatch):
    """§P1.4 item (b). A soft power-cycle does not clear an RTL8761B firmware hang, so with usb_path unset
    a wedge that survives the cycle has no remaining fix. On 2026-07-24 the bus-port was already known
    (`11-1.2`) and recovery still could not use it, because the key was never written."""
    # Pinned, not inherited: since 2026-08-05 a SET usb_path is only silent when the rung can actually
    # run, and whether it can is a property of the host this test happens to run on.
    monkeypatch.setattr(capture, "usb_rebind_available", lambda: (True, ""))
    ws = capture.defense_warnings(*ARMED, usb_path=None)
    assert len(ws) == 1 and "usb_path is UNSET" in ws[0]
    assert capture.defense_warnings(*ARMED, usb_path="11-1.2") == []


def test_a_set_usb_path_whose_rung_cannot_run_is_worse_than_an_unset_one(monkeypatch):
    """The converse, and the one that actually bit. The warning above fires only on ABSENCE, so setting
    the key silenced the sole check on this path — while the rung stayed incapable of running, because
    the daemon is unprivileged and `/sys/bus/usb/drivers/usb/{unbind,bind}` is `--w------- root root`.

    Measured on the live box 2026-08-05: `usb_path: 1-2` set, `CapEff: 0000000000001000` (CAP_NET_ADMIN
    alone — no CAP_DAC_OVERRIDE), and no helper installed. Every unbind write raised PermissionError, was
    caught, and was logged at INFO as "skipped", so the ladder reported a wedge it could not clear. A
    configured-but-inoperable rung reads as armed, which is strictly worse than a disabled one."""
    monkeypatch.setattr(capture, "usb_rebind_available", lambda: (False, "no write access to /sys/…"))
    ws = capture.defense_warnings(*ARMED, usb_path="1-2")
    assert len(ws) == 1, ws
    assert "CANNOT RUN" in ws[0] and "1-2" in ws[0]
    # and it must not double-report: absence is the OTHER warning's job
    assert "UNSET" not in ws[0]


def test_the_rung_is_available_when_sysfs_is_writable(monkeypatch):
    """A box that granted the unit the capability writes /sys directly and needs no helper at all — the
    check must not insist on the sudo path it merely falls back to."""
    monkeypatch.setattr(capture.os, "access", lambda p, m: "drivers/usb" in str(p))
    ok, why = capture.usb_rebind_available()
    assert ok and why == ""


def test_the_rung_is_available_through_the_helper_when_sysfs_is_not(monkeypatch):
    monkeypatch.setattr(capture.os, "access", lambda p, m: p.endswith("tepna-btreset.sh"))
    monkeypatch.setattr(capture.helper_path, "resolve", lambda n: "/usr/local/lib/tepna/" + n)
    ok, why = capture.usb_rebind_available()
    assert ok and why == ""


def test_the_availability_probe_survives_a_raising_helper_path(monkeypatch):
    """This runs inside `startup_defense_check`. A probe that raises would abort the boot-time report of
    EVERY other defence — so an unresolvable helper must read as 'unavailable', never as an exception."""
    monkeypatch.setattr(capture.os, "access", lambda p, m: False)
    def boom(_n): raise RuntimeError("no such deploy root")
    monkeypatch.setattr(capture.helper_path, "resolve", boom)
    ok, why = capture.usb_rebind_available()
    assert not ok and "tepna-btreset.sh" in why


def test_the_rung_reports_unavailable_with_a_reason_naming_the_fix(monkeypatch):
    """An unavailability that does not say what to run is how this stayed invisible for a month."""
    monkeypatch.setattr(capture.os, "access", lambda p, m: False)
    ok, why = capture.usb_rebind_available()
    assert not ok
    assert "tepna-btreset.sh" in why and "enable-clock-control.sh" in why


# A `defense_warnings` case is about ONE defence, so every OTHER defence must be pinned rather than
# inherited from the machine. Since 2026-08-05 a SET `usb_path` consults `usb_rebind_available()`, which
# reads the real filesystem — and the answer differs between a developer's checkout and CI, because the
# in-repo helper's mode is whatever git recorded. That is a test asserting its environment: the two
# ARCHIVE tests below passed locally at mode 0755 and failed in CI at 0644, for a reason having nothing
# to do with archives.
def _rung_armed(monkeypatch):
    monkeypatch.setattr(capture, "usb_rebind_available", lambda: (True, ""))


def test_an_unconfigured_archive_warns_that_nights_never_leave(monkeypatch):
    """§P1.4 item (c). Measured on the live box 2026-08-04: 0 `.archived` markers across 11 nights, so
    every night existed in exactly one copy — and capture was working perfectly the whole time, which is
    why nothing surfaced it."""
    _rung_armed(monkeypatch)
    ws = capture.defense_warnings(*ARMED, usb_path="11-1.2", archive_enabled=False)
    assert len(ws) == 1 and "archive is NOT configured" in ws[0]


def test_an_enabled_archive_on_an_UNMOUNTED_dest_is_worse_than_none(monkeypatch):
    """`ismount`, not `isdir`: an unmounted mountpoint is a present, empty, writable directory on the BOOT
    disk, so the mirror reports success while ~350 MB/night lands on the wrong filesystem and the operator
    believes it is on the NAS. VIGIL-OFFLOAD-AND-RETENTION recorded exactly this — the dest was a removable
    disk, unmounted at the check."""
    _rung_armed(monkeypatch)
    ws = capture.defense_warnings(*ARMED, usb_path="x", archive_enabled=True, archive_dest_ready=False)
    assert len(ws) == 1 and "NOT ready (not mounted)" in ws[0]
    # ready, and unknown-because-unprobed, are both silent — the second deliberately
    assert capture.defense_warnings(*ARMED, usb_path="x", archive_enabled=True,
                                    archive_dest_ready=True) == []
    assert capture.defense_warnings(*ARMED, usb_path="x", archive_enabled=True,
                                    archive_dest_ready=None) == []


def test_every_disarmed_defense_is_reported_not_just_the_first():
    """A self-test that names one of four faults sends the operator round the loop three more times."""
    ws = capture.defense_warnings("auto", "0000000000000000", usb_path=None, archive_enabled=False)
    assert len(ws) == 4, ws


def test_autosuspend_auto_warns_about_the_wedge_prevention():
    ws = capture.defense_warnings("auto", "0000000000000800")
    assert len(ws) == 1 and "autosuspend is ENABLED" in ws[0] and "50-tepna-btdongle.rules" in ws[0]


def test_zero_capeff_warns_the_recovery_ladder_is_disarmed():
    ws = capture.defense_warnings("on", "0000000000000000")
    assert len(ws) == 1 and "CAP_NET_ADMIN" in ws[0]


def test_both_disarmed_warns_both():
    ws = capture.defense_warnings("auto", "0000000000000000")
    assert len(ws) == 2


def test_unknown_values_warn_nothing():
    """None (couldn't read the sysfs/proc value) must not fabricate a warning — a self-test that cries
    wolf on a read failure gets ignored. 'on' + unreadable CapEff → silent."""
    assert capture.defense_warnings(None, None) == []
    assert capture.defense_warnings("on", "notahexnumber") == []



# ── connected is not streaming (CAPTURE-HOST-DEEP-AUDIT §C3) ────────────────────────────────────
def test_a_docked_sensor_does_not_make_a_dead_adapter_look_healthy():
    """THE §C3 regression. Both suppression guards turned on `connected`, and a sensor on its charger
    reports connected=True while producing nothing — the Verity literally sets
    `last_error="charging — PMD streams unavailable"`. So ONE DOCKED SENSOR made a genuinely DOWN
    adapter classify as healthy.

    Same confusion, and the correct sibling was fixed the SAME DAY one module over:
    `cpap_harvest.blocking_devices` (commit 1f6bcdf, the CPAP interlock) computes actually-streaming as
    connected AND not charging AND worn is not False. `adapter_watchdog`'s own docstring already said
    the reset requires "a single connected+STREAMING device"; the classifier was never passed
    charging/worn, so it could not make the distinction it documented.

    Suppression-only: this can never cause a spurious power-cycle, only miss a real wedge."""
    docked = [{"name": "Verity", "address": "AA", "connected": True, "charging": True,
               "last_error": "charging — PMD streams unavailable"}]
    h = capture.classify_adapter_health(docked, adapter_up=False)
    assert h["wedged"] is True, "a charging device is not evidence the radio works"
    assert "pinned adapter DOWN/not-found" in h["reasons"]


def test_an_off_body_sensor_does_not_suppress_the_wedge_either():
    """`worn is False` is the ring's own report that it is off the finger. Explicitly False, not
    falsy — an absent `worn` (a device that cannot report it) must NOT be read as off-body."""
    off = [{"name": "Ring", "address": "AA", "connected": True, "worn": False}]
    assert capture.classify_adapter_health(off, adapter_up=False)["wedged"] is True
    unknown = [{"name": "H10", "address": "AA", "connected": True}]      # no `worn` key at all
    assert capture.classify_adapter_health(unknown, adapter_up=False)["wedged"] is False, \
        "a device that cannot report wear is assumed worn — absence is not evidence"


def test_a_genuinely_streaming_device_still_suppresses_the_wedge():
    """The control, and the reason the guard exists at all: a live STREAM is proof the radio works, so a
    probe misread must never power-cycle a demonstrably-working adapter. Removing the guard instead of
    correcting it would re-create the 2026-07-20 self-inflicted 25 min outage."""
    live = [{"name": "H10", "address": "AA", "connected": True, "charging": False, "worn": True}]
    assert capture.classify_adapter_health(live, adapter_up=False)["wedged"] is False
    # ...and the InProgress inference stays suppressed too
    mixed = live + [{"name": "Ring", "address": "BB", "connected": False,
                     "last_error": "org.bluez.Error.InProgress"}]
    assert capture.classify_adapter_health(mixed, adapter_up=None)["wedged"] is False


def test_a_phantom_link_is_still_a_wedge_while_another_device_streams():
    """The phantom branch is per-device and deliberately untouched: a stale BlueZ link nobody can
    re-grab is a wedge whether or not anything else is streaming."""
    devs = [{"name": "H10", "address": "AA", "connected": True, "charging": False, "worn": True},
            {"name": "Ring", "address": "BB", "connected": False, "bluez_connected": True}]
    h = capture.classify_adapter_health(devs, adapter_up=True)
    assert h["wedged"] is True and h["phantom"] == ["BB"]


# ── dual-radio failover: the pure parser + decision (VIGIL-OVERNIGHT-FINDINGS P1.5) ──────────────────
_HCICONFIG_A = """hci1:\tType: Primary  Bus: USB
\tBD Address: F0:D5:BF:1E:79:21  ACL MTU: 1021:4  SCO MTU: 96:6
\tUP RUNNING\x20
\tRX bytes:200530 acl:2105 sco:0 events:5714 errors:0
\tName: 'vigil'

hci0:\tType: Primary  Bus: USB
\tBD Address: AC:A7:F1:29:9D:1D  ACL MTU: 1021:6  SCO MTU: 255:12
\tUP RUNNING\x20
\tName: 'vigil #1'
"""


def test_parse_hciconfig_reads_both_controllers():
    a = capture.parse_hciconfig(_HCICONFIG_A)
    assert [x["hci"] for x in a] == ["hci1", "hci0"]
    assert a[0]["mac"] == "F0:D5:BF:1E:79:21" and a[0]["up"] is True
    assert a[1]["mac"] == "AC:A7:F1:29:9D:1D" and a[1]["up"] is True


def test_parse_hciconfig_marks_a_down_radio():
    text = "hci0:\tType: Primary  Bus: USB\n\tBD Address: AA:BB:CC:DD:EE:FF\n\tDOWN\n"
    a = capture.parse_hciconfig(text)
    assert a == [{"hci": "hci0", "mac": "AA:BB:CC:DD:EE:FF", "up": False}]


def test_parse_hciconfig_drops_a_block_with_no_address():
    # an adapter we cannot address is not a failover target — it must not appear
    text = "hci9:\tType: Primary\n\tUP RUNNING\n"
    assert capture.parse_hciconfig(text) == []


def test_parse_hciconfig_empty_input_is_empty():
    assert capture.parse_hciconfig("") == []


# REAL output, copied from the Zephyr/nRF52840 dongle (USB 2fe3:000b) on 2026-08-26. Not synthesised:
# that firmware has no PUBLIC address (Zephyr identifies by static-random; a host-side public pin is
# refused with 0x0c Not Supported), so `hciconfig` — the layer parse_hciconfig reads — prints zeros.
_HCICONFIG_NULL_ADDR = """hci1:\tType: Primary  Bus: USB
\tBD Address: 00:00:00:00:00:00  ACL MTU: 251:6  SCO MTU: 0:0
\tUP RUNNING\x20
\tName: 'zephyr'
"""


def test_parse_hciconfig_drops_the_null_bd_address():
    """17 chars and 5 colons — it passes the SHAPE test, which is exactly why it needed its own guard."""
    assert capture.parse_hciconfig(_HCICONFIG_NULL_ADDR) == []


def test_parse_hciconfig_drops_the_broadcast_bd_address():
    text = "hci4:\tType: Primary\n\tBD Address: FF:FF:FF:FF:FF:FF\n\tUP RUNNING\n"
    assert capture.parse_hciconfig(text) == []


def test_failover_target_never_picks_the_null_address_adapter():
    """THE POINT OF THE FIX. Before it, a wedged radio failed over onto an address no device can be
    reached on — silence dressed as recovery, and worse than staying on the wedged adapter."""
    text = _HCICONFIG_NULL_ADDR + """
hci0:\tType: Primary  Bus: USB
\tBD Address: AC:A7:F1:29:9D:1D  ACL MTU: 1021:6  SCO MTU: 255:12
\tUP RUNNING\x20
"""
    adapters = capture.parse_hciconfig(text)
    # the null-address dongle is FIRST in hciconfig order, so an unguarded scan returns it
    assert [a["mac"] for a in adapters] == ["AC:A7:F1:29:9D:1D"]
    assert capture.failover_target("00:01:95:CC:53:02", adapters) == "AC:A7:F1:29:9D:1D"


def test_addressable_accepts_an_ordinary_address():
    assert capture._addressable("f0:d5:bf:1e:79:21") is True


def test_failover_target_picks_a_healthy_spare():
    adapters = capture.parse_hciconfig(_HCICONFIG_A)
    # pinned = the wedged dongle hci0 → fail over to hci1
    assert capture.failover_target("AC:A7:F1:29:9D:1D", adapters) == "F0:D5:BF:1E:79:21"


def test_failover_target_never_returns_the_pinned_adapter():
    # only the pinned adapter is up → no spare, even though something is UP
    adapters = [{"hci": "hci0", "mac": "AA:BB:CC:DD:EE:FF", "up": True}]
    assert capture.failover_target("aa:bb:cc:dd:ee:ff", adapters) is None   # case-insensitive


def test_failover_target_skips_a_down_spare():
    adapters = [{"hci": "hci0", "mac": "PIN", "up": False},
                {"hci": "hci1", "mac": "SPARE", "up": False}]
    assert capture.failover_target("PIN", adapters) is None


def test_failover_target_skips_a_spare_with_no_mac():
    adapters = [{"hci": "hci1", "mac": None, "up": True}]
    assert capture.failover_target("PIN", adapters) is None


def test_failover_target_none_pin_still_finds_a_spare():
    adapters = [{"hci": "hci1", "mac": "SPARE", "up": True}]
    assert capture.failover_target(None, adapters) == "SPARE"


def test_parse_hciconfig_tolerates_leading_junk_and_a_malformed_address():
    text = ("Devices sorted by:\n"                      # a non-hci line BEFORE any block → cur is None
            "hci0:\tType: Primary\n"
            "\tBD Address: NOT-A-MAC here\n"             # malformed token → not captured
            "\tSome detail line\n"                       # a detail line with no UP RUNNING
            "\tBD Address: AA:BB:CC:DD:EE:FF\n"          # the real address, later in the block
            "\tUP RUNNING\n")
    assert capture.parse_hciconfig(text) == [{"hci": "hci0", "mac": "AA:BB:CC:DD:EE:FF", "up": True}]


# ── PER-ADAPTER INSTANCE PARTITION (PER-DEVICE-ADAPTER-PINNING §3.3b) ────────────────────────────────
_ICFG = {
    "adapter": "00:01:95:CC:53:02",
    "adapters": {"sena": "00:01:95:CC:53:02", "ub500": "AC:A7:F1:29:9D:1D",
                 "intel": "F0:D5:BF:1E:79:21"},
    "devices": [{"name": "H10"}, {"name": "Verity"},
                {"name": "Ring", "adapter": "ub500"},
                {"name": "Cpapish", "adapter": "AC:A7:F1:29:9D:1D"}],
}


def _names(ds):
    return [d["name"] for d in ds]


def test_instance_none_serves_every_device():
    """The single-daemon behaviour, and it is the DEFAULT on purpose: the split is opt-in per box, so
    upgrading the code alone can never silently strip devices from a running capture."""
    assert _names(capture.instance_devices(_ICFG, None)) == ["H10", "Verity", "Ring", "Cpapish"]


def test_instance_inherits_the_global_adapter():
    """Devices that pin nothing must still be owned — by the instance whose radio IS the global.
    Otherwise a config that pins nothing leaves every device owned by ZERO instances."""
    assert _names(capture.instance_devices(_ICFG, "sena")) == ["H10", "Verity"]


def test_instance_takes_pins_by_name_and_by_mac():
    assert _names(capture.instance_devices(_ICFG, "ub500")) == ["Ring", "Cpapish"]


def test_declared_instance_with_no_devices_is_empty_not_everything():
    """An instance nothing is pinned to serves NOTHING. The dangerous failure would be falling back to
    'all devices', which would have three daemons each capturing the same sensors."""
    assert capture.instance_devices(_ICFG, "intel") == []


def test_unknown_instance_name_serves_nothing_rather_than_the_default():
    """A typo'd instance must not resolve to 'the BlueZ default adapter' — that is how a device ends up
    on the onboard radio that cannot hear it, with nothing naming the cause."""
    assert capture.resolve_adapter_name(_ICFG, "tpyo") is None
    assert capture.instance_devices(_ICFG, "tpyo") == []


def test_the_partition_is_total_and_disjoint():
    """THE INVARIANT: every device owned by exactly one instance. A device owned by NONE is captured by
    nobody while every instance logs a healthy startup — invisible from inside any single process."""
    seen = []
    for inst in _ICFG["adapters"]:
        seen += _names(capture.instance_devices(_ICFG, inst))
    assert sorted(seen) == ["Cpapish", "H10", "Ring", "Verity"]
    assert len(seen) == len(set(seen))
    assert capture.unowned_devices(_ICFG) == []


def test_unowned_devices_names_a_device_no_instance_serves():
    """The whole point of unowned_devices(): make the invisible hole visible."""
    cfg = {"adapter": "00:01:95:CC:53:02",
           "adapters": {"sena": "00:01:95:CC:53:02"},
           "devices": [{"name": "H10"}, {"name": "Orphan", "adapter": "AC:A7:F1:29:9D:1D"}]}
    assert capture.unowned_devices(cfg) == ["Orphan"]


def test_resolve_adapter_name_passes_a_bare_mac_through():
    assert capture.resolve_adapter_name(_ICFG, "AC:A7:F1:29:9D:1D") == "AC:A7:F1:29:9D:1D"
    assert capture.resolve_adapter_name(_ICFG, None) is None


def test_apply_instance_returns_the_mac_and_pins_it(caplog):
    with caplog.at_level("INFO"):
        assert capture.apply_instance(_ICFG, "ub500") == "AC:A7:F1:29:9D:1D"
    assert "serving 2 of 4 device(s)" in caplog.text


def test_apply_instance_refuses_an_unrecognised_name(caplog):
    """A name resolving to nothing would serve NO devices while looking like a healthy daemon — a
    silent total capture failure. It must refuse to start, not start quietly."""
    import pytest as _p
    with _p.raises(SystemExit) as e:
        capture.apply_instance(_ICFG, "tpyo")
    assert "refusing to start" in str(e.value)


def test_apply_instance_announces_an_instance_that_owns_NOTHING(caplog):
    """Logged unconditionally, including zero. Printing only the non-empty case rebuilds exactly the
    blind spot this function exists to close."""
    with caplog.at_level("INFO"):
        capture.apply_instance(_ICFG, "intel")
    assert "serving 0 of 4 device(s): (NONE)" in caplog.text


def test_apply_instance_shouts_about_unowned_devices(caplog):
    """The hole no single instance can see: a device pinned to a radio nothing serves."""
    cfg = {"adapter": "00:01:95:CC:53:02",
           "adapters": {"sena": "00:01:95:CC:53:02"},
           "devices": [{"name": "H10"}, {"name": "Orphan", "adapter": "AC:A7:F1:29:9D:1D"}]}
    with caplog.at_level("ERROR"):
        capture.apply_instance(cfg, "sena")
    assert "UNOWNED DEVICES" in caplog.text and "Orphan" in caplog.text
