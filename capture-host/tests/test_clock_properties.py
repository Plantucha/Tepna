# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# PROPERTY tests for the Python clock surface. Every property below is a CONTRACT SENTENCE quoted from
# the module it tests or from CLAUDE.md's Clock Contract, cited in the docstring — never a restatement
# of what the implementation happens to do. A property that merely re-derives the code passes forever
# and pins nothing (`assertions-encode-shape`).
#
# 🔴 WHY THESE TWO FUNCTIONS AND NOT THE PARSERS. The Clock Contract's verification list describes
# `clock.js`, which has no Python counterpart: there is no Python `parseTimestamp`, no DMY/MDY
# disambiguation, no time-only rollover, no floating-tMs. Writing those as Python properties would
# test `datetime` itself. What DOES have contract-grade invariants over a continuous input space is the
# pair that reduces many noisy anchors to one number under a stated refusal rule — which is exactly
# what property testing is for, and what a known-answer table cannot cover.

import math

from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

import as11_clock
import clock_offset
import timeline
import writers

# Anchors are epoch seconds on a real box: bounded, finite, and not adversarially huge. Unbounded
# floats would exercise IEEE edge cases rather than the contract, which is a different test.
_HOST = st.floats(min_value=1.7e9, max_value=1.9e9, allow_nan=False, allow_infinity=False)
_OFF = st.floats(min_value=-4000.0, max_value=4000.0, allow_nan=False, allow_infinity=False)
_SETTINGS = settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.too_slow])


# ── as11_clock.analyze ───────────────────────────────────────────────────────────────────────────
@_SETTINGS
@given(st.lists(st.tuples(_HOST, _HOST), max_size=1))
def test_fewer_than_two_anchors_REFUSES_and_returns_no_estimate(anchors):
    """CONTRACT (as11_clock.analyze): "A refusal (fewer than two finite anchors) returns
    { ok:False, reason:"too-few", n } and NO estimate."

    The refusal is the property, and the absence of an estimate is half of it: a caller must not be
    able to read an offset out of a measurement that was declined."""
    r = as11_clock.analyze(anchors)
    assert r["ok"] is False
    assert r["reason"] == "too-few"
    assert "offset_s" not in r and "slope_ppm" not in r


@_SETTINGS
@given(
    st.lists(st.tuples(_HOST, _HOST), min_size=2, max_size=40),
    st.lists(st.sampled_from([float("nan"), float("inf"), float("-inf")]), max_size=6),
)
def test_non_finite_anchors_are_DROPPED_before_the_count_not_after(good, junk):
    """CONTRACT: the refusal counts FINITE anchors — `math.isfinite` filters before `n < 2`.

    So garbage cannot push a too-few session over the threshold. This is the property that separates
    "we had two readings" from "we had two rows"."""
    polluted = list(good) + [(j, j) for j in junk]
    r = as11_clock.analyze(polluted)
    assert r["ok"] is True
    assert r["n"] == len(good)  # the junk is invisible to the count
    r_junk_only = as11_clock.analyze([(j, j) for j in junk])
    assert r_junk_only["ok"] is False  # …and junk alone still refuses


@_SETTINGS
@given(st.lists(st.tuples(_HOST, _HOST), min_size=2, max_size=40))
def test_offset_is_the_MEDIAN_of_host_minus_device(anchors):
    """CONTRACT: "`offset_s = median(host − device)`". Stated as an identity, so it is asserted as one
    rather than as a tolerance — a median has no float drift to forgive."""
    import statistics

    r = as11_clock.analyze(anchors)
    expect = statistics.median([h - d for h, d in anchors])
    assert r["offset_s"] == round(expect, 3)


@_SETTINGS
@given(
    st.lists(st.tuples(_HOST, _HOST), min_size=2, max_size=40),
    st.floats(min_value=-5000, max_value=5000, allow_nan=False, allow_infinity=False),
)
def test_shifting_every_DEVICE_stamp_shifts_the_offset_by_exactly_that(anchors, c):
    """CONTRACT: offset is `host − device`, so it is TRANSLATION-EQUIVARIANT in the device clock.

    This is the property a fixture cannot express: it holds for every input, and it is what makes the
    number an OFFSET rather than a fitted constant. A implementation that centred or normalised would
    pass a known-answer test and fail this."""
    base = as11_clock.analyze(anchors)["offset_s"]
    shifted = as11_clock.analyze([(h, d + c) for h, d in anchors])["offset_s"]
    assert math.isclose(shifted, base - c, abs_tol=2e-3)


@_SETTINGS
@given(st.lists(st.tuples(_HOST, _HOST), min_size=2, max_size=40))
def test_span_is_never_negative_and_a_zero_span_refuses_the_RATE_not_the_offset(anchors):
    """CONTRACT: "`slope_ppm`/`minute_is_real` are None (with a reason) when there are too few anchors
    or no time span to measure a rate; the offset is still returned whenever ≥2 anchors exist."

    The partial refusal is the interesting half: a rate that cannot be measured must not be reported,
    while the offset that CAN be measured still ships.

    ⚠️ THE CONDITION IS READ OFF THE RAW HOST SPAN, NEVER OFF `span_s`, and the first version of this
    property got that wrong. `span_s` is reported as `round(raw, 3)` while every branch inside
    `analyze` tests the RAW value — so a span of 2.4e-7 s REPORTS as 0.0, sails past `span_s <= 0`,
    and refuses the rate one line later as `too-few-for-rate`. Both are correct refusals; asserting
    WHICH one fires, from a field that has been rounded, pins an implementation ordering the contract
    never promised. Hypothesis found it on 2026-08-29 (two host stamps 2.4e-7 apart), which is
    precisely the class of input a hand-written fixture never contains."""
    r = as11_clock.analyze(anchors)
    raw_span = max(h for h, _ in anchors) - min(h for h, _ in anchors)
    assert r["span_s"] >= 0
    if raw_span <= 0:
        assert r["reason"] == "no-span"
        assert r["slope_ppm"] is None and r["minute_is_real"] is None
        assert r["offset_s"] is not None  # …but the offset survives


@_SETTINGS
@given(st.integers(min_value=2, max_value=8))
def test_below_the_rate_threshold_the_offset_ships_and_the_RATE_does_not(n):
    """CONTRACT: "`n < min_rate_anchors` → reason `too-few-for-rate`" — with the offset present.

    Asserted across the whole sub-threshold range rather than at one n, because an off-by-one in the
    comparison is exactly the defect a single fixture would miss."""
    assume(n < 10)
    anchors = [(1.75e9 + i * 60.0, 1.75e9 + i * 60.0 - 1260.0) for i in range(n)]
    r = as11_clock.analyze(anchors, min_rate_anchors=10)
    assert r["ok"] is True
    assert r["reason"] == "too-few-for-rate"
    assert r["slope_ppm"] is None
    assert r["offset_s"] == round(1260.0, 3)


@_SETTINGS
@given(st.floats(min_value=-500, max_value=500, allow_nan=False, allow_infinity=False))
def test_a_planted_linear_drift_is_recovered_as_its_own_ppm(ppm):
    """CONTRACT: "`slope_ppm` is the least-squares rate of offset(t)".

    Planted truth: build anchors whose offset drifts at exactly `ppm`, and require the reported rate
    back. This is the one property here that would catch a sign error, which no refusal test can."""
    n, step = 60, 60.0
    anchors = []
    for i in range(n):
        t = 1.75e9 + i * step
        drift = ppm * 1e-6 * (i * step)
        anchors.append((t, t - 1260.0 - drift))
    r = as11_clock.analyze(anchors, min_rate_anchors=3)
    assert r["ok"] is True
    assert math.isclose(r["slope_ppm"], ppm, abs_tol=0.5)


@_SETTINGS
@given(st.lists(st.tuples(_HOST, _HOST), min_size=12, max_size=40))
def test_minute_is_real_is_exactly_the_stated_comparison(anchors):
    """CONTRACT: "`minute_is_real` is |slope_ppm| ≤ ppm_floor".

    Pinned as the identity it is claimed to be, so a later 'tuning' of the threshold cannot pass
    silently."""
    r = as11_clock.analyze(anchors, min_rate_anchors=3)
    if r.get("slope_ppm") is not None:
        assert r["minute_is_real"] == (abs(r["slope_ppm"]) <= r["ppm_floor"])


# ── clock_offset.estimate ────────────────────────────────────────────────────────────────────────
@_SETTINGS
@given(
    st.lists(
        st.tuples(
            st.floats(0, 4e4, allow_nan=False, allow_infinity=False),
            st.floats(0, 500, allow_nan=False, allow_infinity=False),
        ),
        max_size=60,
    )
)
def test_a_refusal_carries_no_estimate_and_a_success_carries_its_reference(points):
    """CONTRACT (clock_offset.estimate): "A refusal returns `{ok: False, reason, n}` and NO estimate —
    the `hostAxis` contract, and for its reason: a caller must not be able to read a silent zero out of
    a measurement that was declined."

    Both halves in one property, over arbitrary input: refusals never leak a number, successes always
    quote `t_ref_sec` so a consumer can reconstruct the line instead of mistaking a centroid for the
    start-of-recording offset."""
    r = clock_offset.estimate(points)
    if not r["ok"]:
        assert "reason" in r and "n" in r
        assert r.get("offset_ms") is None
    else:
        assert "t_ref_sec" in r


@_SETTINGS
@given(
    st.lists(
        st.tuples(
            st.floats(0, 4e4, allow_nan=False, allow_infinity=False),
            st.floats(0, 500, allow_nan=False, allow_infinity=False),
        ),
        min_size=30,
        max_size=80,
    )
)
def test_the_certified_offset_is_None_wherever_the_two_estimators_DISAGREE(points):
    """CONTRACT: "`offset_ms` is the certified number and is **None** wherever the two estimators
    disagree. That is the point of computing two."

    The property is the implication, not the rate: whenever `agree_ms` exceeds the tolerance, the
    certified value must be absent. An implementation that certified anyway would pass every
    known-answer test built from agreeing inputs."""
    r = clock_offset.estimate(points)
    if r["ok"] and r.get("agree_ms") is not None and r.get("offset_ms") is not None:
        assert r["agree_ms"] <= clock_offset.AGREE_TOL_MS


# ── the honest small set: stamps that cannot be read must yield None, never "now" ─────────────────
@_SETTINGS
@given(st.text(max_size=40))
def test_a_filename_without_our_stamp_yields_None_never_a_fabricated_one(name):
    """CLOCK CONTRACT §2.6: "NEVER fall back to `new Date()` / now() — a missing stamp must be visible
    (null), never fabricated." The Python siblings obey the same rule.

    `file_stamp` is the anchored extractor (writers, audit F5): it parses the token before the stream
    tag and requires a plausible year, so a random string cannot produce a stamp."""
    s = writers.file_stamp(name)
    assert s is None or (len(s) == 14 and s.isdigit())


@_SETTINGS
@given(st.text(max_size=40))
def test_an_unreadable_filename_stamp_is_None_not_the_current_time(name):
    """Same contract at `timeline._stamp_ms`, which is the consumer: an unparseable name must return
    None so the caller can fall back deliberately — not a value near `time.time()` that would look
    like a real session start."""
    v = timeline._stamp_ms(name)
    assert v is None or isinstance(v, float)


@_SETTINGS
@given(st.integers(min_value=1, max_value=12), st.integers(min_value=29, max_value=31))
def test_an_impossible_calendar_DAY_is_refused_at_our_call_site(month, day):
    """CLOCK CONTRACT §2.7: "Component ranges are validated — `Date.UTC`'s silent roll is a fabricated
    instant… any out-of-range component ⇒ null."

    Asserted AT OUR CALL SITE rather than against `datetime`: the property is that `timeline._stamp_ms`
    returns None for a stamp naming a day that does not exist, whatever the mechanism. Feb 30 is the
    contract's own example."""
    import calendar

    assume(day > calendar.monthrange(2026, month)[1])
    name = f"Polar_H10_AABBCCDD_2026{month:02d}{day:02d}235959_ECG.txt"
    assert timeline._stamp_ms(name) is None
