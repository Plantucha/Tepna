# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""ONE NIGHT'S STREAM MUST NOT BE DIVIDED BY A WEEK'S THERAPY.

`SESSIONDETECT.csv` is a single append-only journal for the box — not per night, never rotated.
`stream_minutes` was already night-scoped (the EDF walk reads DATALOG/<d-1|d0|d+1>); `therapy_minutes`
was not scoped at all. So `cover` compared one night's numerator against the whole journal's
denominator, and could only shrink as the journal grew.

Measured on vigil 2026-09-01 before the fix: 7818 rows over 6.45 days summed to 951 min of therapy,
judged against 321 stream min, reported "died-early — the live stream covered 321 of 1272 therapy min
(25.2 %)". Nothing was wrong with the night.
"""
import datetime as _d

import capture
import cpap_stream_watch

_POLL_S = 30


def _journal(*days):
    """A SESSIONDETECT journal with `_POLL_S`-spaced Therapy rows on each given date."""
    out = ["host_ms;a;b;c;d;trigger;e;reachable;fg_state"]
    for day in days:
        t0 = _d.datetime.combine(day, _d.time(23, 0))
        for i in range(120):                       # 120 polls x 30 s = 60 min of covered therapy
            ms = (t0 + _d.timedelta(seconds=i * _POLL_S)).timestamp() * 1000.0
            out.append(f"{ms};i;i;;;;;True;Therapy")
    return "\n".join(out)


def test_THE_WHOLE_JOURNAL_IS_WHAT_THE_OLD_CALL_MEASURED(tmp_path):
    """The defect, pinned. Unscoped, seven nights of therapy come back as one number — which is
    exactly what was being divided into a single night's stream minutes."""
    days = [_d.date(2026, 8, 25) + _d.timedelta(days=k) for k in range(7)]
    whole = cpap_stream_watch.therapy_minutes(_journal(*days))
    assert whole is not None and whole > 6 * 55, f"expected ~7 nights of therapy, got {whole}"


def test_SCOPING_TO_THE_NIGHT_LEAVES_ONLY_THAT_NIGHT(tmp_path):
    days = [_d.date(2026, 8, 25) + _d.timedelta(days=k) for k in range(7)]
    text = _journal(*days)
    since, until = capture._night_window_ms("2026-08-31")
    scoped = cpap_stream_watch.therapy_minutes(text, since_ms=since, until_ms=until)
    whole = cpap_stream_watch.therapy_minutes(text)
    # The window is d-1..d+1, matching the EDF walk — so it holds 08-30 and 08-31, not all seven.
    assert scoped is not None and whole is not None
    assert scoped < whole / 2, f"scoping changed nothing: {scoped} vs {whole}"
    assert 100 < scoped < 130, f"expected ~2 nights x 60 min, got {scoped}"


def test_A_SINGLE_NIGHT_JOURNAL_READS_THE_SAME_EITHER_WAY(tmp_path):
    """The control. Every assertion above is satisfied by a window that discards everything, so this
    pins that scoping does not shrink a journal that was already one night."""
    text = _journal(_d.date(2026, 8, 31))
    since, until = capture._night_window_ms("2026-08-31")
    assert cpap_stream_watch.therapy_minutes(text, since_ms=since, until_ms=until) == \
        cpap_stream_watch.therapy_minutes(text)


def test_AN_UNPARSEABLE_NIGHT_NAME_KEEPS_THE_WHOLE_JOURNAL(tmp_path):
    """A window we could not compute must not read as an empty night. `(None, None)` restores the
    old behaviour — over-counting is wrong, but reporting a measured zero would be worse."""
    assert capture._night_window_ms("not-a-date") == (None, None)
    assert capture._night_window_ms(None) == (None, None)
    text = _journal(_d.date(2026, 8, 31))
    assert cpap_stream_watch.therapy_minutes(text, since_ms=None, until_ms=None) is not None


def test_AN_OUTAGE_IN_A_PRIOR_NIGHT_CANNOT_REFUSE_TONIGHT():
    """The bound is applied BEFORE the unreachable tally, not just before the sum. Three nights of
    unreachable rows would otherwise trip `MIN_OBSERVED_FRAC` and return None — refusing a night
    that was, in fact, observed."""
    old = _d.datetime.combine(_d.date(2026, 8, 20), _d.time(2, 0))
    rows = ["host_ms;a;b;c;d;trigger;e;reachable;fg_state"]
    for i in range(2000):                          # a long outage, well before the night we judge
        rows.append(f"{(old + _d.timedelta(seconds=i * 30)).timestamp() * 1000.0};i;i;;;;;False;")
    rows.append(_journal(_d.date(2026, 8, 31)).split("\n", 1)[1])
    text = "\n".join(rows)
    since, until = capture._night_window_ms("2026-08-31")
    assert cpap_stream_watch.therapy_minutes(text) is None, "control: unscoped, the outage refuses"
    assert cpap_stream_watch.therapy_minutes(text, since_ms=since, until_ms=until) is not None


def test_THE_CALLER_SCOPES_IT_NOT_JUST_THE_PURE_FUNCTION(tmp_path):
    """🔴 THE TEST THE FIRST PLANT CAUGHT MISSING. Everything above exercises `therapy_minutes` and
    `_night_window_ms` directly — so removing the window from `_cpap_stream_watch_row` left all of
    them green. Two correct pieces and no wiring reads exactly like a working fix.

    Seven nights in the journal, one night judged: the row must report roughly one night's therapy,
    not seven."""
    hdr = "host_ms;a;b;c;d;trigger;e;reachable;fg_state;0;0;"
    rows = [hdr]
    for k in range(7):
        day = _d.date(2026, 8, 25) + _d.timedelta(days=k)
        t0 = _d.datetime.combine(day, _d.time(23, 0))
        for i in range(120):                       # 60 min covered per night
            ms = (t0 + _d.timedelta(seconds=i * 30)).timestamp() * 1000.0
            rows.append(f"{ms};i;i;;;i;f;True;Therapy;0;0;")
    (tmp_path / "SESSIONDETECT.csv").write_text("\n".join(rows))

    got = capture._cpap_stream_watch_row({"cpap": {"ble_stream": {"edf_dir": str(tmp_path / "edf")}}},
                                         str(tmp_path), "2026-08-31")
    # d-1..d+1 holds 08-30 and 08-31 => ~2 x 60 min. Seven nights would be ~7 x 60.
    assert got["therapy_min"] is not None
    assert got["therapy_min"] < 200, f"the caller is still summing the whole journal: {got}"
    assert 100 < got["therapy_min"] < 130, got


def test_LATER_NIGHTS_IN_THE_JOURNAL_DO_NOT_COUNT_EITHER(tmp_path):
    """The upper bound, which the lower-bound tests do not reach. The journal only grows, so judging
    an older night means every LATER night is already sitting in the same file — re-running QC over
    last week would otherwise credit it with everything recorded since."""
    days = [_d.date(2026, 8, 25) + _d.timedelta(days=k) for k in range(7)]
    text = _journal(*days)
    since, until = capture._night_window_ms("2026-08-26")     # early night, five nights follow it
    scoped = cpap_stream_watch.therapy_minutes(text, since_ms=since, until_ms=until)
    assert scoped is not None and scoped < 200, f"later nights leaked in: {scoped}"

    # ...and with ONLY the upper bound set, everything after the night is still excluded
    upper_only = cpap_stream_watch.therapy_minutes(text, until_ms=until)
    assert upper_only is not None and upper_only < cpap_stream_watch.therapy_minutes(text)
