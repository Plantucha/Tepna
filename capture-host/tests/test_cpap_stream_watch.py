# tepna-capture — tests/test_cpap_stream_watch.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`cpap_stream_watch` — therapy ran and nothing recorded it.

The 2026-08-26 night: a full session, `edf_dir` empty, and no warning anywhere. The harm was the
SILENCE, not the missed click — absence produces no event unless something is built to notice it."""

import cpap_stream_watch as W


def test_a_full_session_with_NO_stream_is_the_08_26_case():
    r = W.assess(therapy_min=380.0, stream_min=0.0)
    assert r["state"] == W.NEVER_STARTED
    assert r["cover"] == 0.0
    assert "never opened" in r["detail"]
    # the detail names the CAUSE a reader should check first, because the stream is operator-initiated
    assert "started it" in r["detail"]


def test_a_one_minute_stream_over_a_six_hour_session_is_the_08_27_case():
    """Started 23:35:47, stopped 23:35:48 — a double-click. One 60 s record for a 380 min session."""
    r = W.assess(therapy_min=380.0, stream_min=1.0)
    assert r["state"] == W.DIED_EARLY
    assert r["cover"] == round(1.0 / 380.0, 3)
    assert "stopped early" in r["detail"]


def test_a_covered_session_is_OK():
    r = W.assess(therapy_min=380.0, stream_min=375.0)
    assert r["state"] == W.OK and r["cover"] > 0.98


def test_a_late_manual_start_is_NOT_a_finding():
    """The stream is started BY HAND after the machine, so some therapy always precedes it. A few
    minutes of head-start is normal; half a session is not."""
    assert W.assess(therapy_min=380.0, stream_min=370.0)["state"] == W.OK
    assert W.assess(therapy_min=380.0, stream_min=200.0)["state"] == W.OK      # 53 %, above the floor
    assert W.assess(therapy_min=380.0, stream_min=180.0)["state"] == W.DIED_EARLY  # 47 %, below it


def test_a_SHORT_session_is_never_a_finding():
    """A machine switched on to check a setting, or a mask fitted and removed, legitimately produces
    minutes of Therapy and no stream. Real sessions on this box are 233-521 min."""
    for t in (0.0, 5.0, 29.9):
        r = W.assess(therapy_min=t, stream_min=0.0)
        assert r["state"] == W.OK, f"{t} min was reported as a missed capture"
        assert "below the" in r["detail"]


def test_an_UNMEASURED_therapy_duration_REFUSES_rather_than_reporting_ok():
    """🔴 THE PROPERTY THAT KEEPS THIS WATCHDOG HONEST. `therapy_min` is None when the shadow detector
    is off or its journal is missing. Treating that as zero therapy would report OK for a night nobody
    watched — the watchdog would go quiet exactly when its own input broke, which is the failure it
    exists to catch, one level up."""
    r = W.assess(therapy_min=None, stream_min=0.0)
    assert r["state"] == W.UNKNOWN
    assert r["state"] != W.OK, "an unmeasured night was reported as fine"
    assert "not evidence" in r["detail"]


def test_unusable_durations_refuse_rather_than_crash_or_guess():
    for t, s in (("x", 0.0), (380.0, "y"), (None, None)):
        assert W.assess(therapy_min=t, stream_min=s)["state"] == W.UNKNOWN


def test_the_thresholds_are_parameters_because_they_are_per_device():
    """The floor and the coverage ratio are properties of a machine's usage pattern, not universals —
    the same reason `flow_eps_lpm` is config-overridable."""
    assert W.assess(380.0, 0.0, min_therapy_min=500.0)["state"] == W.OK
    assert W.assess(380.0, 200.0, min_cover=0.9)["state"] == W.DIED_EARLY


# ── the parsers: measurement vs absence-of-measurement ──────────────────────────────────────────

def _row(ms, fg):
    return f"{ms};idle;idle;;;idle_steady;fgstate_only;True;{fg};0;0.1;"


_HDR = "host_ms;prior_state;state;transition;action;trigger;confidence;reachable;fg_state;last_therapy_use;mask_pressure;baseline_use"


def test_therapy_minutes_sums_what_each_observation_COVERS():
    """Four 30 s-spaced Therapy rows cover 3 intervals = 90 s."""
    t0 = 1_787_000_000_000
    text = "\n".join([_HDR] + [_row(t0 + i * 30_000, "Therapy") for i in range(4)])
    assert abs(W.therapy_minutes(text) - 1.5) < 1e-6


def test_a_session_that_ENDS_and_RESTARTS_does_not_count_the_idle_middle():
    """Span-from-first-to-last would credit the gap as treatment. It is not treatment."""
    t0 = 1_787_000_000_000
    rows = [_row(t0, "Therapy"), _row(t0 + 30_000, "Therapy"),
            _row(t0 + 60_000, "Standby"), _row(t0 + 3_600_000, "Standby"),
            _row(t0 + 3_630_000, "Therapy"), _row(t0 + 3_660_000, "Therapy")]
    got = W.therapy_minutes("\n".join([_HDR] + rows))
    assert abs(got - 1.5) < 1e-6, "the idle hour between two sessions was counted as therapy"


def test_a_DETECTOR_OUTAGE_is_not_credited_as_therapy():
    """🔴 41 BleakDeviceNotFoundError in one night on this box, so consecutive rows can be minutes
    apart. Crediting the whole gap would turn a dead link into recorded treatment — the watchdog would
    report a well-covered night precisely when the detector had stopped looking."""
    t0 = 1_787_000_000_000
    rows = [_row(t0, "Therapy"), _row(t0 + 3_600_000, "Therapy"), _row(t0 + 3_630_000, "Therapy")]
    got = W.therapy_minutes("\n".join([_HDR] + rows))
    assert got < 1.1, f"a 60-minute detector outage was credited as therapy ({got:.1f} min)"


def test_an_unreadable_journal_is_None_NOT_zero():
    """None means 'this journal cannot tell us' — a claim about the evidence. Zero would mean 'no
    therapy ran' — a claim about the machine. Conflating them makes a broken detector look quiet."""
    for bad in ("", _HDR, "garbage", None, _HDR + "\n" + _row(1, "Therapy")):
        assert W.therapy_minutes(bad) is None
    assert W.assess(therapy_min=W.therapy_minutes(""), stream_min=0.0)["state"] == W.UNKNOWN


def test_stream_minutes_zero_IS_a_measurement_unlike_therapy_None():
    """`edf_dir` read and holding no EDF is evidence of absence. Not the same as a journal that could
    not be read — absence from a source that WAS read is evidence; absence of a reading is not."""
    assert W.stream_minutes([]) == 0.0
    assert W.stream_minutes([(1, 60.0)]) == 1.0          # the 08-27 one-record file
    assert W.stream_minutes([(315, 60.0), (233, 60.0)]) == 548.0
    assert W.stream_minutes([(0, 60.0), ("x", "y"), None]) == 0.0


def test_a_DUPLICATE_or_out_of_order_stamp_covers_no_time():
    """Two rows sharing one host_ms cover zero seconds between them. The journal is appended to by a
    poller that can retry, so repeated stamps are expected rather than corrupt."""
    t0 = 1_787_000_000_000
    rows = [_row(t0, "Therapy"), _row(t0, "Therapy"), _row(t0 + 30_000, "Therapy")]
    assert abs(W.therapy_minutes("\n".join([_HDR] + rows)) - 0.5) < 1e-6
