# tepna-capture — tests/test_link_error_rate.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Failed connects are reported by CONDITION, not by occurrence — and counted either way.

Measured on vigil over a 72 h unattended window: 2426 WARNINGs, of which 1992 (82 %) were four
"device not present" conditions — 913 H10 connect timeouts, 631 ring-not-advertising, 298 AS11 shadow
polls, 150 Verity timeouts. Normal for a box whose devices are worn only at night, and it buried the
37 `event loop stalled` and 32 `wpa_cli` failures that were not normal.
"""
import logging
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import blestats  # noqa: E402
import capture  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def setup_function():
    blestats.reset()


def teardown_function():
    blestats.reset()


def _spam(n, addr="AA:BB", name="Polar H10", exc=None):
    e = exc or TimeoutError("connect to AA:BB timed out after 30s")
    for _ in range(n):
        capture._log_link_error(name, addr, e)


def test_the_FIRST_failure_is_reported_in_full(caplog):
    """A device that stops coming back is the failure this suite keeps rediscovering. The first
    occurrence must still say everything it used to."""
    with caplog.at_level(logging.WARNING, logger="capture"):
        _spam(1)
    msgs = [r.getMessage() for r in caplog.records]
    assert len(msgs) == 1 and "timed out" in msgs[0]
    assert "occurrence" not in msgs[0], "the first line is the plain one"


def test_PLANT_913_occurrences_do_not_produce_913_lines(caplog):
    """The measured case: one not-worn H10 produced 913 WARNINGs in 72 h."""
    with caplog.at_level(logging.WARNING, logger="capture"):
        _spam(913)
    lines = len(caplog.records)
    # Asserted as a REDUCTION FACTOR, not a magic count. The first version said `< 20` and the rule
    # yields 21 (nine singles, then 25/50/75, then nine hundreds) — an assertion failing on its own
    # arithmetic rather than on the behaviour it is about.
    assert 913 / lines > 35, f"913 occurrences collapsed to only {lines} lines"
    assert lines < 30, f"and bounded in absolute terms too: {lines}"


def test_the_COUNT_survives_the_quieter_log():
    """§1.6. The frequency must remain readable however the line is throttled — the count is taken
    before the decision, so throttling cannot cost the rate."""
    _spam(913)
    assert blestats.failures("link", "AA:BB")["TimeoutError"] == 913


def test_a_WORSENING_streak_keeps_resurfacing(caplog):
    """Quieter must not mean silent: a degrading radio has to come back into view as it degrades."""
    with caplog.at_level(logging.WARNING, logger="capture"):
        _spam(500)
    seen = [int(m.group(1)) for r in caplog.records
            if (m := re.search(r"occurrence (\d+)", r.getMessage()))]
    for milestone in (25, 100, 500):
        assert milestone in seen, f"occurrence {milestone} must resurface"


def test_two_CAUSES_on_one_device_are_two_conditions(caplog):
    """A ring that stops advertising and a ring whose adapter is busy are different faults. Pooling
    them would let one mask the other's onset."""
    with caplog.at_level(logging.WARNING, logger="capture"):
        _spam(3, exc=TimeoutError("timed out"))
        _spam(3, exc=OSError("in progress"))
    assert blestats.failures("link", "AA:BB") == {"TimeoutError": 3, "OSError": 3}
    firsts = [r for r in caplog.records if "occurrence" not in r.getMessage()]
    assert len(firsts) == 2, "each cause reports its own first occurrence in full"


def test_two_DEVICES_are_two_conditions():
    """Per device, never pooled — a healthy strap's silence must not mask a failing one's rate."""
    _spam(5, addr="AA:BB")
    _spam(2, addr="CC:DD", name="Verity")
    assert blestats.failures("link", "AA:BB")["TimeoutError"] == 5
    assert blestats.failures("link", "CC:DD")["TimeoutError"] == 2


def test_PLANT_every_named_site_uses_the_helper():
    """`link_error_text`'s docstring warns that a grep stopping at the first two sites misses one.
    This makes that a gate. Asserted as a NAMED SET — the question is WHICH sites, not how many."""
    from tests._srcscan import module_source
    src = module_source("capture.py").split("\n")
    starts = {}
    for i, l in enumerate(src):
        m = re.match(r"(?:async )?def ([a-z_0-9]+)\(", l)
        if m:
            starts[i] = m.group(1)
    idx = sorted(starts)
    missing = []
    for want in capture.LINK_ERROR_SITES:
        ln = next((k for k in idx if starts[k] == want), None)
        assert ln is not None, f"{want} not found"
        end = idx[idx.index(ln) + 1] if idx.index(ln) + 1 < len(idx) else len(src)
        if "_log_link_error(" not in "\n".join(src[ln:end]):
            missing.append(want)
    assert not missing, f"sites still logging raw link errors: {missing}"


def test_the_count_precedes_the_logging_decision():
    """The load-bearing order, pinned by position rather than a fixed window."""
    from tests._srcscan import module_source
    src = module_source("capture.py")
    body = src[src.index("def _log_link_error"):]
    assert body.index('blestats.fail("link"') < body.index("log.warning")
