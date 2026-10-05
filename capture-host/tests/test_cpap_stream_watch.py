# tepna-capture — tests/test_cpap_stream_watch.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`cpap_stream_watch` — therapy ran and nothing recorded it.

The 2026-08-26 night: a full session, `edf_dir` empty, and no warning anywhere. The harm was the
SILENCE, not the missed click — absence produces no event unless something is built to notice it."""

import pytest

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
    """⚠️ NUMBERS CORRECTED 2026-08-31 — the old pair was physically impossible.

    It read `therapy_min=380, stream_min=375`, which assumes `therapy_minutes` returns the WHOLE
    session. It cannot: the shadow detector holds the one AS11 link only while the stream does not,
    so it observes exactly the therapy that was NOT streamed. 380 minutes observed alongside 375
    streamed would mean the detector polled straight through a running capture.

    The real shape, measured 2026-08-30: a 429-minute EDF alongside 1.7 minutes of observed therapy.
    So a covered session is a SMALL observed head-start plus a long stream."""
    r = W.assess(therapy_min=5.0, stream_min=375.0)
    assert r["state"] == W.OK and r["cover"] > 0.98


def test_a_late_manual_start_is_NOT_a_finding():
    """The stream is started BY HAND after the machine, so some therapy always precedes it. A few
    minutes of head-start is normal; half a session is not.

    The observed figure is the head-start ITSELF (plus any therapy after the stream ends), not the
    session — see `test_a_covered_session_is_OK`. So the ratio is streamed / (head-start + streamed),
    and a late start shows up as a bigger head-start rather than a smaller stream."""
    assert W.assess(therapy_min=10.0, stream_min=370.0)["state"] == W.OK  # 97 %
    assert W.assess(therapy_min=180.0, stream_min=200.0)["state"] == W.OK  # 53 %, above the floor
    assert W.assess(therapy_min=200.0, stream_min=180.0)["state"] == W.DIED_EARLY  # 47 %, below it


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
    rows = [
        _row(t0, "Therapy"),
        _row(t0 + 30_000, "Therapy"),
        _row(t0 + 60_000, "Standby"),
        _row(t0 + 3_600_000, "Standby"),
        _row(t0 + 3_630_000, "Therapy"),
        _row(t0 + 3_660_000, "Therapy"),
    ]
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
    assert W.stream_minutes([(1, 60.0)]) == 1.0  # the 08-27 one-record file
    assert W.stream_minutes([(315, 60.0), (233, 60.0)]) == 548.0
    assert W.stream_minutes([(0, 60.0), ("x", "y"), None]) == 0.0


def test_a_DUPLICATE_or_out_of_order_stamp_covers_no_time():
    """Two rows sharing one host_ms cover zero seconds between them. The journal is appended to by a
    poller that can retry, so repeated stamps are expected rather than corrupt."""
    t0 = 1_787_000_000_000
    rows = [_row(t0, "Therapy"), _row(t0, "Therapy"), _row(t0 + 30_000, "Therapy")]
    assert abs(W.therapy_minutes("\n".join([_HDR] + rows)) - 0.5) < 1e-6


def test_a_NON_NUMERIC_attempt_count_is_not_a_failed_automation():
    """`assess` is the contract, so its guards are tested here rather than through a caller — the
    daemon's own range check happens to filter such a record out first, which would leave this branch
    covered by nothing while looking covered.

    A record it cannot read is not evidence that the automation tried. Reporting AUTOSTART_FAILED on
    an unparseable count would invent an attempt, and the whole point of the state is to be believed."""
    for bad in ("x", object(), [1], {}):
        got = W.assess(therapy_min=400.0, stream_min=0.0, attempts=bad)
        assert got["state"] == W.NEVER_STARTED, bad
    assert W.assess(400.0, 0.0, attempts=3)["state"] == W.AUTOSTART_FAILED
    assert W.assess(400.0, 0.0, attempts=0)["state"] == W.NEVER_STARTED


# ── an UNOBSERVED window must refuse, not measure zero (2026-08-30) ─────────────────────────────


def _unreach(ms, err="BleakDeviceNotFoundError"):
    """The row the shadow runner now writes when it could not reach the machine."""
    return f"{ms};;;;unreachable;{err};;False;;;;"


def test_an_unreachable_row_is_NOT_counted_as_standby():
    """🔴 The whole point. Before the runner wrote these, a failed poll left NOTHING and the night was
    silent. Writing them and then reading them as "not in therapy" would be strictly WORSE than that
    silence: the night would read as MEASURED, and measured as fine."""
    t0 = 1_787_000_000_000
    rows = [_row(t0 + i * 30_000, "Therapy") for i in range(80)]
    rows += [_unreach(t0 + (80 + i) * 30_000) for i in range(10)]
    got = W.therapy_minutes("\n".join([_HDR] + rows))
    assert abs(got - 39.5) < 0.6, got  # the 79 real gaps, and none from the unreachable tail


def test_a_MOSTLY_UNOBSERVED_journal_refuses_rather_than_reporting_a_calm_night():
    """2026-08-30: eleven hours of failing polls. A few surviving observations must not be summed into
    a confident short night — `assess` needs UNKNOWN, and UNKNOWN only comes from None here."""
    t0 = 1_787_000_000_000
    rows = [_row(t0, "Standby"), _row(t0 + 30_000, "Standby"), _row(t0 + 60_000, "Standby")]
    rows += [_unreach(t0 + (2 + i) * 30_000) for i in range(1300)]  # ~11 h of failures
    assert W.therapy_minutes("\n".join([_HDR] + rows)) is None
    assert W.assess(therapy_min=None, stream_min=0.0)["state"] == W.UNKNOWN


def test_ORDINARY_dropout_still_yields_a_measurement():
    """The control, and the reason the bound is lenient. 41 BleakDeviceNotFoundError in one night is
    NORMAL here — a threshold that refused on that would refuse on every real night."""
    t0 = 1_787_000_000_000
    rows = [_row(t0 + i * 30_000, "Therapy") for i in range(720)]
    rows += [_unreach(t0 + (720 + i) * 30_000) for i in range(41)]
    got = W.therapy_minutes("\n".join([_HDR] + rows))
    assert got is not None and got > 300, got


def test_a_journal_of_NOTHING_BUT_unreachable_rows_refuses():
    """The 2026-08-30 shape exactly: the detector ran all night and reached the machine zero times."""
    t0 = 1_787_000_000_000
    rows = [_unreach(t0 + i * 30_000) for i in range(1300)]
    assert W.therapy_minutes("\n".join([_HDR] + rows)) is None


# ── F2's journal half: WHY the journal could not be read ──────────────────────────────────────────
# `UnreachableRow` has recorded the exception class in `trigger` (parts[5]) since 2026-08-30, and
# nothing consumed it — so a night the machine was OFF and a night the RADIO could not answer were
# byte-identical UNKNOWNs, though they need opposite responses (wait vs reset bluez).
def _unreach_rows(*classes, reachable="False"):
    head = "host_ms;prior_state;state;transition;action;trigger;confidence;reachable;fg_state;u;p;b"
    rows = [f"{1000 + i};idle;idle;;unreachable;{c};;{reachable};;;;" for i, c in enumerate(classes)]
    return "\n".join([head] + rows)


def test_A_MACHINE_NOT_FOUND_NIGHT_AND_A_JAMMED_NIGHT_STOP_READING_ALIKE():
    gone = W.unreachable_reason(_unreach_rows(*["BleakDeviceNotFoundError"] * 5))
    jammed = W.unreachable_reason(_unreach_rows("BleakError", "BleakError", "BleakDeviceNotFoundError"))
    assert gone["unanimous_absent"] is True and gone["dominant"] == "BleakDeviceNotFoundError"
    assert jammed["unanimous_absent"] is False and jammed["dominant"] == "BleakError"
    assert W.assess(None, 0.0, unreachable=gone)["detail"] != W.assess(None, 0.0, unreachable=jammed)["detail"]


def test_A_UNANIMOUS_NOT_FOUND_NIGHT_IS_STILL_NOT_ZERO_MINUTES():
    """THE RESTRAINT, PINNED — the tempting win that would have been a fabrication.

    A machine that was genuinely off HAS an answer: zero. Reporting None there turns a measurement
    into an unknown, so promoting it is tempting. The classes cannot license it:

        machine OFF, radio healthy         -> every poll not-found
        machine ON, radio jammed all night -> every poll not-found

    Identical. So a night-long wedge would ship a fabricated 0, strictly worse than the honest None.
    Proven rather than argued: 2026-08-29 produced unanimous not-found across BOTH adapters for a
    night the machine was demonstrably running — ten EDF files were harvested from it the next day."""
    gone = W.unreachable_reason(_unreach_rows(*["BleakDeviceNotFoundError"] * 200))
    assert gone["unanimous_absent"] is True
    out = W.assess(None, 0.0, unreachable=gone)
    assert out["state"] == W.UNKNOWN, "a unanimous not-found night was promoted to a verdict"
    assert out["therapy_min"] is None, "a unanimous not-found night was promoted to 0.0 minutes"
    assert "equally consistent" in out["detail"], "the detail must not imply the machine was off"


def test_A_REACHABLE_POLL_SAYS_NOTHING_ABOUT_WHY_OTHERS_FAILED():
    # Only rows that actually failed carry a blame class; counting a successful poll's blank trigger
    # would dilute the dominant class with noise from polls that worked.
    text = (
        _unreach_rows("BleakDeviceNotFoundError") + "\n" + "2000;idle;idle;;;idle_steady;fgstate_only;True;Standby;;;"
    )
    r = W.unreachable_reason(text)
    assert r["n"] == 1 and r["classes"] == {"BleakDeviceNotFoundError": 1}


def test_A_JOURNAL_WITH_NO_FAILURES_HAS_NO_REASON_TO_GIVE():
    assert W.unreachable_reason("") is None
    assert W.unreachable_reason(_unreach_rows("X", reachable="True")) is None


def test_A_BLANK_TRIGGER_IS_NAMED_UNKNOWN_NOT_DROPPED():
    # Rows written before the class was recorded have an empty trigger. Dropping them would make an
    # old journal look like it had fewer failures than it did.
    r = W.unreachable_reason(_unreach_rows("", ""))
    assert r["n"] == 2 and r["classes"] == {"unknown": 2} and r["unanimous_absent"] is False


def test_EVERY_EXISTING_CALLER_IS_UNAFFECTED():
    # `unreachable` is keyword-only and defaults to None, the same shape `attempts`/`last_error` use.
    plain = W.assess(None, 0.0)
    assert plain["state"] == W.UNKNOWN and plain["unreachable"] is None
    assert "every one of" not in plain["detail"]


def test_A_TORN_LINE_IS_SKIPPED_NOT_COUNTED():
    """A journal being appended to while it is read ends in a partial row, and a rotation can leave
    one mid-line. Such a row has no trigger field to blame, so counting it would invent a failure
    class — or, worse, dilute a unanimous not-found night with a phantom 'unknown' and flip
    `unanimous_absent` to False on evidence that does not exist."""
    good = _unreach_rows("BleakDeviceNotFoundError", "BleakDeviceNotFoundError")
    torn = good + "\n3000;idle;idle;;unrea"  # cut mid-write
    r = W.unreachable_reason(torn)
    assert r["n"] == 2, "a truncated row was counted as a failed poll"
    assert r["unanimous_absent"] is True, "a torn row flipped a unanimous night to mixed"


def test_STARTING_THE_CAPTURE_MUST_NOT_DESTROY_THE_MEASUREMENT():
    """🔴 THE 2026-08-30 NIGHT, and the reason `assess` counts streamed time as therapy.

    The shadow detector holds the one AS11 link only while the stream does not, so it observes
    exactly the therapy that was NOT streamed. Treating that sliver as the whole session meant the
    act of STARTING a capture destroyed the measurement the capture is judged against.

    Real numbers: the operator started the stream by hand, the EDF ran 429 min (verified from its
    header — 429 records x 60 s), and the journal held 1.7 min of observed therapy. The old
    arithmetic called that "therapy ran 2 min, below the 30 min floor — too short to call a missed
    capture", and returned OK while declining to judge. So night-QC was silently disabled for
    precisely the nights where capture WORKED, and said nothing was wrong.

    ⚠️ Note it returned OK either way. The bug was not a wrong alarm, it was a REFUSAL TO LOOK
    wearing the same word as a clean night — which is why nobody noticed for as long as the feature
    has existed."""
    r = W.assess(therapy_min=1.7, stream_min=429.0)
    assert r["state"] == W.OK
    assert r["therapy_min"] > 430, "the streamed session was not counted as therapy"
    assert r["therapy_observed_min"] == 1.7, "the observed sliver must stay visible, not be erased"
    assert r["cover"] is not None and r["cover"] > 0.99
    assert "below the" not in r["detail"], "a 7-hour night was still dismissed as too short"


def test_COVER_IS_A_FRACTION_NOT_AN_UNBOUNDED_RATIO():
    # Before the fix `cover = stream / observed` could exceed 1 without limit — last night it would
    # have been 429/1.7 = 252. A "fraction covered" above 1 is a sign the denominator is wrong.
    assert W.assess(therapy_min=1.7, stream_min=429.0)["cover"] <= 1.0
    assert W.assess(therapy_min=0.5, stream_min=600.0)["cover"] <= 1.0


def test_the_detail_line_NAMES_THE_WINDOW_its_two_halves_were_summed_over():
    """2026-09-28: the line read "the live stream covered 775 of 776 therapy min (99.8 %)" beside a
    6.75 h EDF. 776 min is 12.9 h — roughly two nights — and THE NUMBER WAS RIGHT: `capture.py` scopes
    both halves to the night ±1 day precisely so numerator and denominator describe the same stretch,
    mirroring the EDF walk over DATALOG/<d-1|d0|d+1>. Only the label claimed otherwise, and a reader
    comparing it against one night could not tell a correct ratio from a broken counter."""
    note = "the ±1-day window that mirrors the EDF DATALOG walk"
    ok = W.assess(1.0, 775.0, window_note=note)
    assert "across " + note in ok["detail"]
    assert "775 of 776 therapy min" in ok["detail"], "the numbers are untouched — only the words moved"
    assert "(99.9 %)" in ok["detail"] or "(99.8 %)" in ok["detail"]


def test_the_died_early_line_names_it_too_because_that_is_the_one_a_reader_doubts():
    note = "the ±1-day window that mirrors the EDF DATALOG walk"
    bad = W.assess(676.0, 100.0, window_note=note)
    assert bad["state"] == W.DIED_EARLY
    assert "across " + note in bad["detail"] and "opened and stopped early" in bad["detail"]


def test_a_caller_that_does_not_say_gets_the_sentence_UNCHANGED():
    """The window is the CALLER's fact. `assess` receives two minute counts and nothing about the span
    they cover, so with no note it must claim nothing rather than assert a default — a hardcoded
    "±1 day" here would keep asserting it for a future caller that passed a different window."""
    plain = W.assess(1.0, 775.0)
    assert "across" not in plain["detail"]
    assert plain["detail"].startswith("the live stream covered 775 of 776 therapy min (")
    assert W.assess(1.0, 775.0, window_note="")["detail"] == plain["detail"], "an empty note is no note"


def test_the_numbers_and_the_state_are_IDENTICAL_with_and_without_the_note():
    """ANTI-REGRESSION: this change is wording only. Every field but `detail` must be untouched."""
    note = "the ±1-day window that mirrors the EDF DATALOG walk"
    a = W.assess(1.0, 775.0, window_note=note)
    b = W.assess(1.0, 775.0)
    assert {k: v for k, v in a.items() if k != "detail"} == {k: v for k, v in b.items() if k != "detail"}


# ── THE 26 SURVIVORS `assess` CARRIED, and why they were invisible until 2026-10-04 ────────────────
# E7 touched `assess`, the mutation gate's unit is the FUNCTION, and 26 of its mutants turned out to
# have no test that could see them. They were not E7's regressions — most sit on lines E7 never
# changed — and they were HIDDEN, not merely unnoticed: capture.py's generation timeout refused the
# whole run and a refusal RETURNS BEFORE the survivor report prints, so #3238's earlier run announced
# UNKNOWN while 228 of its mutants had already been decided and 26 had survived. #3260's module-level
# exclusion removed the refusal, and the gate then said what it had always known.
#
# Every test below names the mutant it kills. All 26 are genuine gaps — none is an equivalence, which
# is why none of them went to tools/mutate-equivalence.json.


@pytest.mark.parametrize(
    "obs, s, kw, state, want",
    [
        # the "too short to judge" branch
        (10.26, 0.0, {}, W.OK, {"therapy_min": 10.3, "therapy_observed_min": 10.3, "stream_min": 0.0}),
        # therapy ran, nothing opened
        (35.26, 0.0, {}, W.NEVER_STARTED, {"therapy_min": 35.3, "therapy_observed_min": 35.3}),
        # the automation tried and failed
        (35.26, 0.0, {"attempts": 3}, W.AUTOSTART_FAILED, {"therapy_min": 35.3, "therapy_observed_min": 35.3}),
        # opened and stopped early
        (
            20.26,
            15.26,
            {},
            W.DIED_EARLY,
            {"therapy_min": 35.5, "therapy_observed_min": 20.3, "stream_min": 15.3, "cover": 0.43},
        ),
        # covered the session
        (
            10.26,
            25.26,
            {},
            W.OK,
            {"therapy_min": 35.5, "therapy_observed_min": 10.3, "stream_min": 25.3, "cover": 0.711},
        ),
    ],
)
def test_every_reported_duration_keeps_ONE_decimal_and_cover_keeps_THREE(obs, s, kw, state, want):
    """Kills the fifteen rounding mutants — `round(x, 1)` → `round(x, None)` / `round(1)` /
    `round(x, )` / `round(x, 2)`, and `round(cover, 3)` → `round(cover, None)` / `round(cover, )` /
    `round(cover, 4)`.

    ⚠️ THE FIXTURES CARRY TWO DECIMALS ON PURPOSE, AND THAT IS THE WHOLE TEST. A value like `5.0`
    cannot distinguish `round(5.0, 1)` from `round(5.0)`: the first is `5.0`, the second is `5`, and
    `5 == 5.0` is True in Python, so the assertion passes against the mutant. Minutes that end in
    `.26` separate one decimal (10.3) from none (10) from two (10.26), and a cover of 0.4296…
    separates three (0.43) from four (0.4296) from an integer (0). Every existing test used round
    numbers, which is exactly why fifteen mutants lived here.
    """
    r = W.assess(therapy_min=obs, stream_min=s, **kw)
    assert r["state"] == state
    for field, expected in want.items():
        assert r[field] == expected, f"{field}: {r[field]!r} != {expected!r}"


def test_a_session_with_no_stream_reports_ZERO_streamed_and_ZERO_cover():
    """Kills `stream_min: 0.0` → `1.0` and `cover: 0.0` → `1.0` in both no-stream branches. The
    literals were asserted nowhere, so the watchdog could have reported a minute of stream and full
    coverage for a night nothing opened."""
    for kw in ({}, {"attempts": 2}):
        r = W.assess(therapy_min=35.26, stream_min=0.0, **kw)
        assert r["stream_min"] == 0.0, f"{kw}: {r['stream_min']!r}"
        assert r["cover"] == 0.0, f"{kw}: {r['cover']!r}"


def test_at_EXACTLY_the_therapy_floor_the_session_is_JUDGED_not_waved_through():
    """Kills `if t < float(min_therapy_min)` → `<=`.

    A session exactly at the floor must be judged, not excused. Both outcomes are `state == OK`, so
    the state cannot tell them apart — the tell is `cover`, which the too-short branch returns as
    `None` because it declines to compute one."""
    r = W.assess(therapy_min=15.0, stream_min=15.0)  # t == 30.0 == MIN_THERAPY_MIN
    assert r["state"] == W.OK
    assert r["cover"] == 0.5, "at exactly the floor the session was waved through as too short"
    assert "below the" not in r["detail"]


def test_at_EXACTLY_the_cover_floor_the_stream_is_NOT_called_died_early():
    """Kills `if cover < float(min_cover)` → `<=`. Exactly meeting the bar is meeting it."""
    r = W.assess(therapy_min=15.0, stream_min=15.0)  # cover == 0.5 == MIN_COVER
    assert r["state"] == W.OK, "a stream that exactly met the cover floor was called died-early"


def test_the_percentage_in_the_detail_IS_a_percentage():
    """Kills `100 * cover` → `100 / cover` (200.0 %) and → `101 * cover` (50.5 %). The percentage was
    printed and never read, so an inverted ratio would have reached an operator."""
    r = W.assess(therapy_min=15.0, stream_min=15.0)
    assert "(50.0 %)" in r["detail"], r["detail"]


def test_a_total_of_ZERO_does_not_divide_by_it():
    """Kills `0.0 if t <= 0` → `t < 0` and → `(t <= 0) and False`. Both drop the guard, and
    `s / t` with t == 0 raises ZeroDivisionError — the watchdog would crash on a night with no
    measured therapy and no stream instead of reporting it."""
    r = W.assess(therapy_min=0.0, stream_min=0.0, min_therapy_min=0.0)
    assert r["state"] == W.NEVER_STARTED
    assert r["cover"] == 0.0


def test_a_total_UNDER_one_minute_is_still_divided_honestly():
    """Kills `0.0 if t <= 0` → `t <= 1`. A sub-minute session is tiny, not zero: widening the guard
    to one minute reports zero coverage for a stream that covered all of it."""
    r = W.assess(therapy_min=0.0, stream_min=0.5, min_therapy_min=0.0)
    assert r["state"] == W.OK
    assert r["cover"] == 1.0, "a 0.5 min session fully covered was reported as zero coverage"


def test_the_zero_total_guard_yields_ZERO_cover_not_FULL_cover():
    """Kills `0.0 if t <= 0` → `1.0 if t <= 0`.

    ⚠️ THE ONLY INPUT THAT REACHES THIS GUARD WITH `cover` OBSERVABLE IS A NEGATIVE OBSERVED
    DURATION, and that is worth stating rather than hiding in a fixture. With non-negative inputs,
    `t <= 0` implies `s == 0`, and the no-stream branch returns a hardcoded cover before the computed
    one is read. So this asserts the guard's VALUE through the one door that exists; the guard is
    defensive, and a defensive guard returning the wrong constant is still wrong."""
    r = W.assess(therapy_min=-5.0, stream_min=5.0, min_therapy_min=0.0)
    assert r["cover"] == 0.0, "a zero-total session was reported as fully covered"
    assert r["state"] == W.DIED_EARLY


def test_an_autostart_failure_with_NO_recorded_error_does_not_invent_one():
    """Kills `if last_error else ""` → `if (last_error) or True`. With `or True` the suffix is always
    appended, so a failure that recorded no error reads as `(last error: None)` — a fabricated
    diagnostic, which is the §∅ shape: absence rendered as a value."""
    r = W.assess(therapy_min=35.0, stream_min=0.0, attempts=4)
    assert r["state"] == W.AUTOSTART_FAILED
    assert "last error" not in r["detail"], r["detail"]
    # and it IS reported when there is one, so the test cannot pass by the suffix never appearing
    r2 = W.assess(therapy_min=35.0, stream_min=0.0, attempts=4, last_error="BleakDeviceNotFoundError")
    assert "(last error: BleakDeviceNotFoundError)" in r2["detail"]


def test_a_SHORT_session_that_did_stream_reports_its_streamed_minutes_to_one_decimal():
    """Kills `round(s, 1)` → `round(s, None)` / `round(s, )` / `round(s, 2)` in the too-short branch.

    ⚠️ MY FIRST ROUND OF KILLS MISSED THESE, AND THE REASON IS THE SAME TRAP ONE LEVEL IN. The
    parametrised fixture for this branch passed `stream_min=0.0`, because "too short to judge"
    sounded like a session nothing streamed. `round(0.0, 1)` is `0.0` and `round(0.0)` is `0`, and
    `0 == 0.0`, so three mutants walked straight through a test written specifically to catch them.
    A fixture can cover the right branch, assert the right field, and still choose the one value that
    cannot tell the mutants apart.

    A short session CAN have streamed minutes: the detector and the stream observe disjoint windows,
    so a 10 min session where the stream caught 5.26 of it is both real and below the floor."""
    r = W.assess(therapy_min=5.0, stream_min=5.26)  # t = 10.26, under the 30 min floor
    assert r["state"] == W.OK
    assert r["cover"] is None, "the too-short branch declines to compute a cover"
    assert r["stream_min"] == 5.3, r["stream_min"]
    assert r["therapy_min"] == 10.3
    assert r["therapy_observed_min"] == 5.0


def test_the_DIED_EARLY_line_states_the_percentage_it_covered():
    """Kills `100 * cover` → `101 * cover` in the died-early detail.

    The sibling mutant (`100 / cover`) died with the OK branch's percentage assertion, which is
    exactly why this one survived: the two branches build the same sentence from different lines, so
    asserting it once proves nothing about the other. The number an operator reads when the stream
    DIED is the one they are most likely to act on."""
    r = W.assess(therapy_min=20.26, stream_min=15.26)  # cover 0.4296… → 43.0 %
    assert r["state"] == W.DIED_EARLY
    assert "(43.0 %)" in r["detail"], r["detail"]
    assert "stopped early" in r["detail"]
