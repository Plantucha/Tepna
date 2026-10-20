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
    blestats.attempt("connect", "D")
    blestats.ok("connect", "D")
    blestats.attempt("connect", "D")
    blestats.fail("connect", "D", "timeout")
    blestats.attempt("connect", "D")
    blestats.fail("connect", "D", "timeout")
    assert blestats.attempts("connect", "D") == 3
    assert blestats.success_rate("connect", "D") == pytest.approx(1 / 3)


def test_failure_classes_are_counted_separately():
    blestats.attempt("connect", "D")
    blestats.fail("connect", "D", "timeout")
    blestats.attempt("connect", "D")
    blestats.fail("connect", "D", "not_found")
    blestats.attempt("connect", "D")
    blestats.fail("connect", "D", "timeout")
    assert blestats.failures("connect", "D") == {"timeout": 2, "not_found": 1}


def test_counters_are_scoped_per_device_and_per_op():
    blestats.attempt("connect", "A")
    blestats.ok("connect", "A")
    blestats.attempt("connect", "B")
    blestats.attempt("pull", "A")
    assert blestats.success_rate("connect", "A") == 1.0
    assert blestats.success_rate("connect", "B") == 0.0  # attempted once, no success: a REAL zero
    assert blestats.success_rate("pull", "A") == 0.0
    assert blestats.success_rate("pull", "B") is None  # never attempted: an ABSENCE


def test_retries_carry_their_cause():
    """§1.6 — 'backoff' three times and 'charging' once are different facts about the night."""
    for _ in range(3):
        blestats.retried("D", "backoff")
    blestats.retried("D", "charging")
    assert blestats.retries("D") == {"backoff": 3, "charging": 1}


def test_snapshot_reports_None_rates_and_integer_counts():
    blestats.attempt("connect", "A")
    blestats.ok("connect", "A")
    blestats.attempt("connect", "B")
    blestats.fail("connect", "B", "timeout")
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
    call()  # must not raise


def test_non_string_keys_do_not_explode():
    """Addresses arrive from config and from BlueZ; neither is guaranteed to be a str."""
    blestats.attempt("connect", 12345)
    assert blestats.attempts("connect", "12345") == 1


# ── A FAILURES-ONLY OP MUST REACH THE REPORT (residue 2026-09-19-ble-rate-cannot-see-absence) ────────


def test_an_op_that_only_ever_FAILS_still_appears_in_the_snapshot():
    """THE SILENT DROP. `attempt()` has exactly ONE call site in capture.py and it is `"connect"`, so
    `link` and `offline_op` only ever call `fail()`. While `snapshot()` keyed on
    `_ATTEMPTS | _SUCCESSES`, neither op could appear in `status.json` AT ALL — the counts incremented
    and stopped there.

    That inverts this module's own purpose. Both call sites justify quietening their logs on the
    promise that the total is published — *"the total is in status.json ble where a rate can be read
    off it"*, *"the total is never lost"* — so the frequency was hidden in the LOG on the strength of a
    report it never reached. Measured on vigil before the fix: `ble.ops` carried three `connect/…` keys
    and none for `link`/`offline_op`, against 445 link-error and 887 offline_op journal lines in the
    same 72 h."""
    blestats.fail("link", "AA:BB", "BleakDBusError")
    ops = blestats.snapshot()["ops"]
    assert "link/AA:BB" in ops, "a failures-only op is unpublishable — the counts increment and vanish"
    assert ops["link/AA:BB"]["failures"] == {"BleakDBusError": 1}


def test_a_failures_only_op_reports_rate_None_NOT_zero():
    """§∅ at the point it is most tempting to bend. The op has no denominator — nobody counted its
    attempts — so the honest rate is `None`, meaning "nobody measured", not `0.0`, which would claim a
    measured total failure. Publishing the counts does not licence inventing the ratio."""
    blestats.fail("offline_op", "CC:DD", "timeout")
    row = blestats.snapshot()["ops"]["offline_op/CC:DD"]
    assert row["rate"] is None, "0.0 here would be a fabricated denominator"
    assert row["attempts"] == 0 and row["successes"] == 0  # measured zeros, which counts may be
    assert row["failures"] == {"timeout": 1}


def test_publishing_failures_does_not_disturb_an_op_that_has_a_real_denominator():
    """The control: `connect` counts attempts and successes, so its rate is unchanged by the widened
    key set. A fix to the failures-only case must not move the case that already worked."""
    blestats.attempt("connect", "EE:FF")
    blestats.ok("connect", "EE:FF")
    blestats.attempt("connect", "EE:FF")
    blestats.fail("connect", "EE:FF", "timeout")
    row = blestats.snapshot()["ops"]["connect/EE:FF"]
    assert row == {"attempts": 2, "successes": 1, "rate": 0.5, "failures": {"timeout": 1}}


# ── §1.6 THE SERIES · the journal line, its deltas, and the two absences on it ──────────────────────
# `snapshot()` is a level and `status.json` is rewritten every tick, so the journal line is the only
# surface here that keeps a shape over time. The line therefore carries INCREMENTS: a cumulative count
# on a series surface steps back at every deploy (4 stop/starts in 6 h, measured 2026-09-15) and a
# reader sees the problem go away. Residue 2026-09-16-ble-counters-not-drawn.


def _two_lines(**rates):
    """One device counted twice, with the first snapshot as the second line's baseline."""
    blestats.attempt("connect", "AA")
    blestats.ok("connect", "AA")
    blestats.fail("connect", "AA", "timeout")
    blestats.retried("AA", "backoff")
    first = blestats.snapshot()
    blestats.attempt("connect", "AA")
    blestats.ok("connect", "AA")
    blestats.retried("AA", "backoff")
    second = blestats.snapshot()
    return first, second, blestats.log_line(second, first, rates or None)


def test_PLANT_the_first_line_of_a_process_has_no_baseline_so_every_delta_is_null():
    """§∅. A 0 on the first line is a measured "nothing happened" over an interval nobody watched —
    and it is what a plain `cur - prev.get(k, 0)` with no previous line produces. The line says so in
    words rather than printing a number it cannot justify."""
    blestats.attempt("connect", "AA")
    blestats.ok("connect", "AA")
    blestats.fail("connect", "AA", "timeout")
    blestats.retried("AA", "backoff")
    line = blestats.log_line(blestats.snapshot())
    assert "connect/AA null/null fail timeout=null" in line
    assert "retries AA backoff=null" in line
    assert line.endswith(blestats.FIRST_LINE)
    assert "0" not in line.replace("AA", ""), "a zero anywhere here is the fabrication this plants"


def test_an_op_absent_from_the_previous_line_had_a_baseline_of_exactly_zero():
    """THE ABSENCE THAT IS NOT ONE, and the two look alike in the same `.get`. A key appears in these
    dicts on its FIRST bump, so an op the previous line does not name started the interval at zero and
    its whole count is a measured delta. Nulling it would blank out every op that STARTED during the
    interval, which is every op worth a line."""
    first = blestats.snapshot()
    blestats.fail("link", "CC", "disconnect")
    d = blestats.deltas(blestats.snapshot(), first)
    assert d["ops"]["link/CC"] == {"attempts": 0, "successes": 0, "failures": {"disconnect": 1}}
    blestats.retried("CC", "backoff")
    assert blestats.deltas(blestats.snapshot(), first)["retries"]["CC"] == {"backoff": 1}


def test_the_line_carries_increments_and_the_totals_stay_in_the_status_block():
    """The whole point of the line. Repeating the totals here would put the figure that resets at every
    deploy back onto the surface that keeps the series."""
    _first, second, line = _two_lines()
    assert second["ops"]["connect/AA"]["attempts"] == 2  # the TOTAL, which status.json carries
    assert "connect/AA 1/1 fail timeout=0" in line  # the INCREMENT, which the line carries
    assert "retries AA backoff=1" in line
    assert "2/2" not in line


def test_a_null_rate_and_a_measured_zero_rate_read_differently_on_the_line():
    """∅ The two absences the card and the line must never collapse: an uncovered window has NO rate,
    while a covered window holding no backoff has a rate of 0.0 that was measured."""
    _f, _s, line = _two_lines(
        AA={"rate": 0.0, "window_sec": 3600.0, "observed_s": 7200.0, "reason": None},
        BB={"rate": None, "window_sec": 3600.0, "observed_s": 60.0, "reason": "backoff rate BB: observed 60 s"},
    )
    assert "backoff rate AA 0.0/h over 60 min" in line
    assert "backoff rate BB null/h over 60 min" in line
    assert line.endswith("backoff rate BB: observed 60 s"), "an absence carries its own reason"


def test_an_over_budget_rate_prints_to_one_decimal_with_its_window():
    _f, _s, line = _two_lines(AA={"rate": 34.0, "window_sec": 1800.0, "observed_s": 9000.0, "reason": None})
    assert "backoff rate AA 34.0/h over 30 min" in line


def test_a_process_that_has_counted_nothing_says_so_rather_than_printing_an_empty_line():
    """A line reading `ble: since last line` with nothing after it is indistinguishable from a
    formatting defect, and this is the ordinary state of the first minute after a restart."""
    assert blestats.log_line(blestats.snapshot(), blestats.snapshot()) == "ble: since last line nothing counted yet"


def test_an_op_with_no_failure_class_yet_prints_no_failure_segment():
    blestats.attempt("connect", "AA")
    first = blestats.snapshot()
    blestats.attempt("connect", "AA")
    line = blestats.log_line(blestats.snapshot(), first)
    assert "connect/AA 0/1" in line and "fail" not in line


def test_the_snapshot_shape_deltas_INDEXES_is_pinned_here():
    """`deltas` reads `snap["ops"]`, `snap["retries"]` and a per-op `cur["failures"]` by index.

    That is sound only while `snapshot()` writes all three on every call, and nothing else pinned
    it: a `{}` default stood in for the key instead, which is a branch no producer can reach, so
    ten mutants of those five reads survived (measured 2026-10-20 on #3770). Indexing moved the
    cost here, where a producer that drops a key fails loudly. Both arms are exercised: the op dict
    below is empty when nothing has been counted, and populated once something has.
    """
    bare = blestats.snapshot()
    assert set(bare) == {"ops", "retries"}, "deltas indexes both of these"
    assert bare["ops"] == {} and bare["retries"] == {}

    blestats.attempt("connect", "AA")
    blestats.fail("connect", "AA", "timeout")
    blestats.retried("AA", "backoff")
    full = blestats.snapshot()
    assert set(full) == {"ops", "retries"}
    assert set(full["ops"]["connect/AA"]) == {"attempts", "successes", "rate", "failures"}
    assert full["retries"] == {"AA": {"backoff": 1}}
    assert blestats.deltas(full, bare)["ops"]["connect/AA"]["failures"] == {"timeout": 1}
