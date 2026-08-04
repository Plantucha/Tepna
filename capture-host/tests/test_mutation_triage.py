# tepna-capture — tests/test_mutation_triage.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `mutation_triage.classify` decides whether a surviving mutant is worth a human's time. A wrong bucket
# is harmful in BOTH directions: UNOBSERVABLE→REACHABLE sends someone chasing a mutant no test can
# kill; REACHABLE→UNOBSERVABLE dismisses a real defect as noise. Every case below is a real diff taken
# from a 2026-08-04 run, not an invented one.

import pytest

from mutation_triage import EQUIVALENT, PROSE, REACHABLE, UNOBSERVABLE, ceiling, classify


# ── UNOBSERVABLE: no assertion can distinguish these ────────────────────────────────────────────────
def test_a_flush_only_change_is_unobservable():
    """The family that broke a hand estimate: 30 of pull_session's survivors differ ONLY in `flush=`.
    capsys and capfd read the captured buffer regardless of flushing, so True/False/None produce byte-
    identical output. Counting these as reachable projected a 94.4% ceiling for a module whose real one
    is 89.1%."""
    b, w = classify('print(f"connecting to {addr} …", flush=True)',
                    'print(f"connecting to {addr} …", flush=False)')
    assert b == UNOBSERVABLE and "flush" in w
    assert classify('print("x", flush=True)', 'print("x", flush=None)')[0] == UNOBSERVABLE


def test_mutmuts_XX_literal_wrapping_is_unobservable():
    """mutmut rewrites `"latest"` as `"XXlatestXX"`. Killable only by asserting the exact string, which
    pins wording and reds the build on every message edit."""
    assert classify('ap.add_argument("--which", help="latest | all")',
                    'ap.add_argument("--which", help="XXlatest | allXX")')[0] == UNOBSERVABLE


def test_a_case_flip_is_unobservable():
    assert classify('getattr(client, "mtu_size", "?")',
                    'getattr(client, "MTU_SIZE", "?")')[0] == UNOBSERVABLE


# ── PROSE: the values survive, only the wording moved ───────────────────────────────────────────────
def test_wording_only_with_values_intact_is_prose():
    b, w = classify('print(f"saved {n} bytes → {path}")', 'print(f"wrote {n} bytes → {path}")')
    assert b == PROSE and "values intact" in w


def test_a_bare_literal_change_outside_a_message_is_still_prose():
    b, w = classify('reason = "no mountpoint configured"', 'reason = "nothing configured"')
    assert b == PROSE and "surrounding code unchanged" in w


# ── REACHABLE: the work-list ────────────────────────────────────────────────────────────────────────
def test_a_message_that_lost_its_interpolated_value_is_reachable():
    """The distinction that makes 15 real kills possible on _pull_once. Both forms below leave the
    message unable to NAME its value, and both are killed by asserting `ts in out` — which survives any
    rewording. The two arrive at REACHABLE by different arms (the argument dropped entirely vs replaced
    with None) and the `why` differs; the BUCKET is what a triage decision is made on."""
    dropped = classify('print(f"── session {ts} ──", flush=True)', 'print(flush=True)')
    noned = classify('print(f"session {ts}", flush=True)', 'print(None, flush=True)')
    assert dropped[0] == REACHABLE and noned[0] == REACHABLE
    assert "names its value" in noned[1], "the None form is recognised as a lost argument"
    assert "structurally" in dropped[1], "a wholly dropped argument lands on the general message arm"


def test_ordinary_code_changes_are_reachable():
    assert classify("if want <= 0:", "if want <= 1:")[0] == REACHABLE
    assert classify("return not (lo < have <= hi)", "return not (lo <= have <= hi)")[0] == REACHABLE


def test_a_structurally_changed_message_is_reachable_even_without_a_none():
    b, w = classify('log.warning("cpap: %s rc=%d", cmd, rc)', 'log.warning("cpap: %s rc=%d", cmd)')
    assert b == REACHABLE and "structurally" in w


def test_identical_lines_are_flagged_not_silently_dropped():
    """A no-op diff means the reader misparsed, not that the mutant is harmless — flag it for a human
    rather than bucketing it as noise."""
    assert classify("x = 1", " x = 1 ")[0] == EQUIVALENT


# ── the arithmetic a report must not get wrong ──────────────────────────────────────────────────────
def test_ceiling_reports_all_three_numbers_from_the_real_pull_session_run():
    c = ceiling(total=466, survived=123, timeouts=7, unobservable=51, reachable=65)
    assert c["killed"] == 336
    assert round(c["now_pct"], 1) == 72.1
    assert c["ceiling"] == 415 and round(c["ceiling_pct"], 1) == 89.1
    assert c["if_all_reachable"] == 401 and round(c["if_all_reachable_pct"], 1) == 86.1


def test_timeouts_count_against_the_rate_and_are_not_folded_into_killed():
    """A timeout is neither killed nor survived. Treating it as either is how a rate drifts: the same
    module read 5 timeouts under load and 0 idle, which moved the apparent kill count by 5."""
    with_to = ceiling(100, 10, 5, 0, 0)
    without = ceiling(100, 10, 0, 0, 0)
    assert with_to["killed"] == 85 and without["killed"] == 90


def test_an_empty_denominator_is_refused_rather_than_divided_by():
    """`mutmut results` returning nothing reads exactly like a clean sweep. Dividing by it is how a
    100% kill rate was once reported for a run that had not measured anything."""
    with pytest.raises(ValueError, match="not a rate"):
        ceiling(0, 0, 0, 0, 0)


def test_counts_exceeding_the_total_are_refused():
    """Survivors from one run against a total from another — the stale-list trap in miniature."""
    with pytest.raises(ValueError, match="exceeds total"):
        ceiling(100, 90, 20, 0, 0)
