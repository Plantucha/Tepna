# tepna-capture — tests/test_offline_op_rate.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The offline-op timeout is COUNTED, and logged by condition rather than by occurrence.

Measured over a 72 h unattended window on vigil: 240 ERROR-level events from `tepna-capture`, of which
**239 were this one line** and exactly **1** was a distinct condition (bluez blind to the CPAP,
restarting bluetooth). At 1:239 an operator greps for errors and finds occurrences, not conditions.

⚠️ The original `log.error` carried the right reasoning — *"Loud, because the alternative is a silently
dead box"* — and it is kept for the FIRST occurrence. Nothing here suppresses the event or loses the
total; the count is incremented before any logging decision.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import blestats  # noqa: E402


def _emit(n, addr="AA:BB"):
    """Reproduce the decision the site makes, for `n` consecutive occurrences."""
    out = []
    for _ in range(n):
        blestats.fail("offline_op", addr, "timeout")
        k = blestats.failures("offline_op", addr).get("timeout", 1)
        decade = k < 10 or (k < 100 and k % 10 == 0) or k % 100 == 0
        if k == 1:
            out.append(("error", k))
        elif decade:
            out.append(("warning", k))
    return out


def setup_function():
    blestats.reset()


def teardown_function():
    blestats.reset()


def test_the_FIRST_occurrence_still_shouts():
    """The original reasoning is preserved: a box that goes quiet must not do so silently."""
    assert _emit(1) == [("error", 1)]


def test_PLANT_239_occurrences_do_not_produce_239_error_lines():
    """The measured case. 239 ERROR lines for one condition is what buried the single event that
    mattered, and it is the whole reason this changed."""
    emitted = _emit(239)
    errors = [e for e in emitted if e[0] == "error"]
    assert len(errors) == 1, "exactly one ERROR for one condition"
    assert len(emitted) < 30, f"and far fewer lines overall, got {len(emitted)}"


def test_the_COUNT_is_never_lost_however_the_line_is_logged():
    """§1.6: the frequency must not be hideable. Counting happens BEFORE the logging decision, so a
    quieter log cannot cost the rate."""
    _emit(239)
    assert blestats.failures("offline_op", "AA:BB")["timeout"] == 239


def test_it_repeats_on_decades_so_a_worsening_condition_still_surfaces():
    """Quieter must not mean silent: an operator watching a degrading radio needs the line to come
    back as it gets worse, not once at the start of the night."""
    seen = [k for _lvl, k in _emit(1000)]
    for milestone in (10, 100, 1000):
        assert milestone in seen, f"occurrence {milestone} must be reported"


def test_the_rate_is_per_DEVICE_not_pooled():
    """Two straps degrading independently are two conditions. Pooling them would let a healthy device's
    silence mask a failing one's rate."""
    _emit(5, "AA:BB")
    _emit(3, "CC:DD")
    assert blestats.failures("offline_op", "AA:BB")["timeout"] == 5
    assert blestats.failures("offline_op", "CC:DD")["timeout"] == 3


def test_the_site_counts_before_it_decides():
    """Pins the ORDER, which is the load-bearing part: if the count came after the logging branch, a
    change to the branch could silently stop counting and the rate would read as improvement."""
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "capture.py")).read()
    # Compare POSITIONS, not a fixed window. The first version searched 1200 characters back and the
    # count sat 1239 behind — a passing invariant failing on the size of the comment between them,
    # which is the shape of assertion that has to be re-tuned every time the file is edited.
    counted = src.index('blestats.fail("offline_op"')
    logged = src.index("offline op exceeded")
    assert counted < logged, "the count must precede the logging decision, not follow it"
