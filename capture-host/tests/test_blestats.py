# tepna-capture — tests/test_blestats.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""BLE-TRANSPORT-REDESIGN §1.5/§1.6 — the denominator, and a retry that can be counted.

The plant these tests exist for is §∅: a success rate over ZERO attempts must be None. The idiom that
gets this wrong — `successes / max(attempts, 1)` — reports a PERFECT 1.0 for a device that was never
contacted once, which is exactly the "zero failures over an unknown denominator" that made #2170's
rate unrecoverable from the logs.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import blestats  # noqa: E402


@pytest.fixture(autouse=True)
def _clean():
    blestats.reset()
    yield
    blestats.reset()


def test_PLANT_a_rate_over_zero_attempts_is_None_not_one_and_not_zero():
    """§∅. The two fabrications this replaces are 1.0 ('nothing failed') and 0.0 ('nothing
    succeeded'); both are answers to a question nobody asked the device."""
    assert blestats.success_rate("connect", "AA:BB") is None
    assert blestats.success_rate("connect", "AA:BB") != 1.0
    assert blestats.success_rate("connect", "AA:BB") != 0.0


def test_PLANT_the_naive_idiom_would_have_reported_a_perfect_score():
    """Pins the defect itself, so the plant cannot be satisfied by returning None from everything."""
    n, s = blestats.attempts("connect", "NEVER"), blestats.successes("connect", "NEVER")
    assert n == 0 and s == 0
    assert s / max(n, 1) == 0.0, "the naive idiom yields a NUMBER where there is no measurement"
    assert blestats.success_rate("connect", "NEVER") is None, "and this module must not"


def test_a_measured_zero_is_still_a_number():
    """The other side: a COUNT of 0 is a real measurement — we looked and saw none. Only the RATE is
    an absence. Returning None for counts too would lose that distinction."""
    assert blestats.attempts("connect", "AA:BB") == 0
    assert blestats.failures("connect", "AA:BB") == {}
    assert blestats.retries("AA:BB") == {}


def test_the_denominator_includes_the_failures():
    """An attempt counted only on success is not a denominator — it is a success count twice."""
    blestats.attempt("connect", "D"); blestats.ok("connect", "D")
    blestats.attempt("connect", "D"); blestats.fail("connect", "D", "timeout")
    blestats.attempt("connect", "D"); blestats.fail("connect", "D", "timeout")
    assert blestats.attempts("connect", "D") == 3
    assert blestats.success_rate("connect", "D") == pytest.approx(1 / 3)


def test_failure_classes_are_counted_separately():
    blestats.attempt("connect", "D"); blestats.fail("connect", "D", "timeout")
    blestats.attempt("connect", "D"); blestats.fail("connect", "D", "not_found")
    blestats.attempt("connect", "D"); blestats.fail("connect", "D", "timeout")
    assert blestats.failures("connect", "D") == {"timeout": 2, "not_found": 1}


def test_counters_are_scoped_per_device_and_per_op():
    blestats.attempt("connect", "A"); blestats.ok("connect", "A")
    blestats.attempt("connect", "B")
    blestats.attempt("pull", "A")
    assert blestats.success_rate("connect", "A") == 1.0
    assert blestats.success_rate("connect", "B") == 0.0   # attempted once, no success: a REAL zero
    assert blestats.success_rate("pull", "A") == 0.0
    assert blestats.success_rate("pull", "B") is None     # never attempted: an ABSENCE


def test_retries_carry_their_cause():
    """§1.6 — 'backoff' three times and 'charging' once are different facts about the night."""
    for _ in range(3):
        blestats.retried("D", "backoff")
    blestats.retried("D", "charging")
    assert blestats.retries("D") == {"backoff": 3, "charging": 1}


def test_snapshot_reports_None_rates_and_integer_counts():
    blestats.attempt("connect", "A"); blestats.ok("connect", "A")
    blestats.attempt("connect", "B"); blestats.fail("connect", "B", "timeout")
    blestats.retried("B", "backoff")
    snap = blestats.snapshot()
    assert snap["ops"]["connect/A"] == {"attempts": 1, "successes": 1, "rate": 1.0, "failures": {}}
    assert snap["ops"]["connect/B"]["rate"] == 0.0
    assert snap["ops"]["connect/B"]["failures"] == {"timeout": 1}
    assert snap["retries"] == {"B": {"backoff": 1}}


def test_snapshot_rate_is_None_when_only_successes_were_somehow_recorded():
    """Defensive: a success without a preceding attempt must not manufacture a denominator."""
    blestats.ok("connect", "GHOST")
    assert blestats.snapshot()["ops"]["connect/GHOST"]["rate"] is None


@pytest.mark.parametrize(
    "call",
    [
        lambda: blestats.attempt("c", "D"),
        lambda: blestats.ok("c", "D"),
        lambda: blestats.fail("c", "D", "x"),
        lambda: blestats.retried("D", "why"),
    ],
)
def test_counting_never_raises_into_the_capture_path(monkeypatch, call):
    """Rule 2. A telemetry defect that takes down a night's recording is worse than the blindness it
    was added to fix, so every entry point swallows."""
    def boom(*_a, **_k):
        raise RuntimeError("counter store is broken")
    monkeypatch.setattr(blestats, "_bump", boom)
    call()   # must not raise


def test_non_string_keys_do_not_explode():
    """Addresses arrive from config and from BlueZ; neither is guaranteed to be a str."""
    blestats.attempt("connect", 12345)
    assert blestats.attempts("connect", "12345") == 1
