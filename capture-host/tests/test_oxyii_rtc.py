# tepna-capture — tests/test_oxyii_rtc.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The O2Ring RTC re-sync policy. This exists because the previous policy — write the clock on EVERY
# connect — cost 359 GATT writes on the night of 2026-07-19, when a -83 dBm link made the ring reconnect
# every ~16 s. Each write was an extra round-trip ~1.4 s into an already-failing link, plus ~0.4 s of
# setup before the first sample. The clock had not moved; the LINK had.

import datetime as _dt
import capture
import oxyii


NOW = _dt.datetime(2026, 7, 19, 12, 0, 0)
SIX_H = 6 * 3600


def test_first_contact_syncs():
    assert capture.oxyii_rtc_due(None, NOW, False, SIX_H) == "first contact"


def test_a_bare_reconnect_does_NOT_sync():
    """THE regression this policy exists for. A reconnect is not an event the RTC cares about; on a bad
    link there can be hundreds of them in a night and none of them moves the ring's clock."""
    just_synced = NOW - _dt.timedelta(seconds=30)
    assert capture.oxyii_rtc_due(just_synced, NOW, False, SIX_H) is None


def test_359_reconnects_in_one_night_cost_ONE_sync():
    """Replays the real failure: first contact, then 358 reconnects at the measured 16 s median spacing.
    Under the old every-connect policy this was 359 writes."""
    last, writes = None, 0
    t = NOW
    for _ in range(359):
        why = capture.oxyii_rtc_due(last, t, False, SIX_H)
        if why:
            writes += 1
            last = t
        t += _dt.timedelta(seconds=16)      # measured median gap between segments
    assert writes == 1, f"a reconnect storm must cost exactly one clock write, got {writes}"


def test_new_recording_session_syncs_even_if_recent():
    """The .dat stamps a session at its START, so this is the one moment a wrong RTC gets baked into
    stored data. It must win over the 'synced recently' shortcut."""
    just_synced = NOW - _dt.timedelta(seconds=5)
    assert capture.oxyii_rtc_due(just_synced, NOW, True, SIX_H) == "new recording session"


def test_drift_backstop_fires_after_the_interval():
    assert capture.oxyii_rtc_due(NOW - _dt.timedelta(hours=5, minutes=59), NOW, False, SIX_H) is None
    why = capture.oxyii_rtc_due(NOW - _dt.timedelta(hours=6, seconds=1), NOW, False, SIX_H)
    assert why and why.startswith("drift backstop")


def test_backstop_interval_is_configurable():
    hour_old = NOW - _dt.timedelta(hours=1, seconds=1)
    assert capture.oxyii_rtc_due(hour_old, NOW, False, SIX_H) is None        # not due at 6 h
    assert capture.oxyii_rtc_due(hour_old, NOW, False, 3600) is not None     # due at 1 h


def test_session_restart_survives_a_dropout():
    """A session that restarts WHILE the link is down is only visible if the previous duration is carried
    across the gap — capture seeds _seq from the module-level _OXYII_LAST_DURATION for exactly this.
    Duration counts UP across a disconnect, so carrying it over cannot manufacture a false restart."""
    # link drops at 900 s into a session, comes back with the same session still running
    assert oxyii.session_restarted(900, 1500) is False
    # link drops at 900 s, comes back with a NEW session (duration reset) -> must be caught
    assert oxyii.session_restarted(900, 12) is True
    # blind reconnect (no carried duration) cannot see it — the bug the seeding fixes
    assert oxyii.session_restarted(None, 12) is False


def test_rtc_resync_sec_is_in_the_settings_schema():
    import settings_schema
    assert "o2ring.rtc_resync_sec" in settings_schema.SETTINGS


def test_the_clock_write_stays_behind_the_policy():
    """Source scan, in the house style (cf. build.mjs's forbidden-writer assert). The policy is only worth
    anything if EVERY clock write goes through it — one stray unconditional set_time_frame() in the
    connect path silently restores the 359-writes-a-night behaviour while all the unit tests above stay
    green, because they test the decision function rather than its callers."""
    import os
    src = open(os.path.join(os.path.dirname(__file__), "..", "capture.py"), encoding="utf-8").read()
    calls = [ln.strip() for ln in src.splitlines()
             if "set_time_frame(" in ln and not ln.strip().startswith("#")]
    assert len(calls) == 1, f"expected exactly one set_time_frame call site, found {len(calls)}: {calls}"
    # ...and it must sit inside the _rtc_sync helper, which is the only thing that records the write.
    helper = src.split("async def _rtc_sync(")[1].split("\n\n")[0]
    assert "set_time_frame(" in helper, "the clock write moved out of _rtc_sync — policy bypassed"
    assert "_OXYII_RTC_AT[addr]" in helper, "_rtc_sync must record the write, or the policy cannot age it"
