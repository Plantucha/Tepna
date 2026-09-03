# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""A SIGNAL NOBODY CAN SEE IS NOT A SIGNAL.

`link_distress_scan` has been computing per-device reconnect distress against real baselines and
publishing it to `STATUS["radio_distress"]` — where NOTHING read it. Not this projection, not the
monitor, not the failover ladder. Enumerated 2026-09-01: a distressed radio was computed nightly and
seen by nobody.

⚠️ `find_unwired` could not catch this WHEN IT HAPPENED: its `status_keys()` extracted only
`_set(name, key=…)` — the per-DEVICE shape — while this was a top-level `STATUS[...] = ` assignment.
CLOSED 2026-09-01: `top_status_keys()` now covers the top-level shape and the report names both
enumerated shapes with counts, so the "0 unexplained" carries its filter (see
`test_find_unwired.py`'s top-shape tests, which plant exactly this class).
"""
import re

from _srcscan import module_source


def test_WEBMON_FORWARDS_IT():
    """The first missing link. Published to STATUS and absent from the projection is the shape the
    projection's own comment already warns about — 'a value that exists in STATUS but is not
    forwarded here is NOT on the monitor'."""
    src = module_source("webmon.py")
    assert '"radio_distress": status.get("radio_distress")' in src


def test_THE_MONITOR_DRAWS_IT():
    """The second. Forwarding it and not drawing it would move the dead end one layer out — and since
    the part-(a) fold, the SAME rule covers the adapter verdict and the switch events: forwarded
    fields that the renderer is not handed are the dead end reborn one argument over."""
    src = module_source("monitor.html")
    assert "renderRadioDistress(s.radio_distress, s.radio_distress_adapter, s.radio_switches)" in src, \
        "forwarded but never called with the forwarded fields"
    assert 'id="rdPill"' in src, "called but no element to write into"


def test_AN_UNRUN_SCAN_RENDERS_NOTHING_RATHER_THAN_OK():
    """Absent is not calm. Before the scan has run there is no verdict, and a green 'Radio ok' there
    would be a claim about a radio nobody has measured — the exact fabrication the UNKNOWN state
    exists to prevent one level down."""
    src = module_source("monitor.html")
    i = src.index("function renderRadioDistress")
    body = src[i:i + 1600]
    assert "card.hidden = true" in body and "names.length" in body
    assert "never a fake ok" in body


def test_THE_WORST_DEVICE_WINS_AND_UNKNOWN_OUTRANKS_OK():
    """A glance asks 'is any link in trouble', not 'what is the mean'. And an unmeasured device must
    not be averaged away by measured-calm ones.

    🔴 The rank must use the PRODUCER'S vocabulary. This test used to accept `bad: 3` — a state
    `link_distress.py` never emits — so the renderer it pinned scored a real DISTRESSED verdict at 0
    (below ok), picked a healthy sibling as 'worst', and rendered a storm as “Radio ok · N links”.
    The test encoded the renderer's shape instead of the producer's contract, and both were wrong
    together (found 2026-09-01, statically, while wiring the adapter fold). The rank keys are now
    asserted against the module constants, so the two vocabularies cannot drift apart silently."""
    import link_distress as D
    src = module_source("monitor.html")
    i = src.index("function renderRadioDistress")
    body = src[i:i + 2600]
    m = re.search(r"rank\s*=\s*\{([^}]*)\}", body)
    assert m, "no explicit ranking — the worst-device rule must be stated, not implied"
    rank = m.group(1)
    assert f"{D.DISTRESSED}: 3" in rank and f"{D.UNKNOWN}: 2" in rank and f"{D.OK}: 1" in rank, rank
    assert "bad" not in rank, "the guessed vocabulary must not survive alongside the real one"


def test_THE_PUBLICATION_SITE_STATES_THE_REAL_CONSTRAINT_AND_THE_ARMING_RULE():
    """Successor to the stale-comment archaeology test (the 'no baseline file exists' quotation and
    its correction are now git history — the situation it recorded was RESOLVED by the part-(a) fold,
    so keeping the quotation would itself have become the stale comment). What must hold now:
    the per-device verdicts' structural reason is still stated at the site, the fold is wired there,
    and the default-off + owner-arming rule is written where the flag is read — a reader at the code
    must not need the brief to learn the flag is not theirs to flip."""
    src = module_source("capture.py")
    assert "SINGLE GLOBAL PIN" in src, "the real reason per-device verdicts stay report-only must be stated"
    i = src.index('STATUS["radio_distress_adapter"]')
    site = src[i - 2500:i + 2500]
    assert "adapter_verdict" in site, "the fold must be computed at the publication site"
    assert "distress_failover" in site, "the arm must be gated on the config flag"
    assert "ARMING IS THE OWNER'S" in site, "the arming rule must be readable at the flag"
    assert "RADIO-FAILOVER-DISTRESS-SIGNAL-2026-08-29-BRIEF" in site, "the pre-stated criterion must be cited"
