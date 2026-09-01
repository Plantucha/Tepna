# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""A SIGNAL NOBODY CAN SEE IS NOT A SIGNAL.

`link_distress_scan` has been computing per-device reconnect distress against real baselines and
publishing it to `STATUS["radio_distress"]` — where NOTHING read it. Not this projection, not the
monitor, not the failover ladder. Enumerated 2026-09-01: a distressed radio was computed nightly and
seen by nobody.

⚠️ `find_unwired` could not catch this. Its `status_keys()` extracts `_set(name, key=…)` — the
per-DEVICE status — while this is a top-level `STATUS[...] = ` assignment, a shape that scan does not
cover. So the "0 unexplained" the gate reports is silent about this whole class of publication.
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
    """The second. Forwarding it and not drawing it would move the dead end one layer out."""
    src = module_source("monitor.html")
    assert "renderRadioDistress(s.radio_distress)" in src, "forwarded but never called"
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
    not be averaged away by measured-calm ones."""
    src = module_source("monitor.html")
    i = src.index("function renderRadioDistress")
    body = src[i:i + 1600]
    m = re.search(r"rank\s*=\s*\{([^}]*)\}", body)
    assert m, "no explicit ranking — the worst-device rule must be stated, not implied"
    rank = m.group(1)
    assert rank.index("bad") < rank.index("unknown") < rank.index("ok") or (
        "bad: 3" in rank and "unknown: 2" in rank and "ok: 1" in rank), rank


def test_THE_COMMENT_THAT_THE_BOX_CONTRADICTED_IS_GONE():
    """capture.py said report-only because 'no baseline file exists on any box yet'. One does —
    vigil's captures/link-baselines.json, since 2026-08-31, 6-14 nights per device. A comment the
    box contradicts is how the next reader repeats the last reader's mistake."""
    src = module_source("capture.py")
    i = src.index("no baseline file exists on any box yet")
    # The old text is KEPT, as a quotation of what was corrected — deleting it would lose the record
    # that the reason changed. What must not survive is it standing as a CURRENT reason, so pin that
    # it is introduced as superseded.
    # "the reason has CHANGED" and not "used to say": the latter is split across two comment lines
    # in the source, so asserting it would be a test that can only ever fail. (It did.)
    assert "the reason has CHANGED" in src[i - 300:i], "the stale reason still reads as current"
    assert "captures/link-baselines.json since 2026-08-31" in src[i:i + 300], "no evidence it is stale"
    assert "SINGLE GLOBAL PIN" in src, "the real reason it stays report-only must be stated"
