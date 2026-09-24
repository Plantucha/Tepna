# tepna-capture — tests/test_worn_record.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# WORN.csv — the per-night record of WHICH VOTE HELD (2026-09-24).
#
# `worn_verdict` returns `(verdict, why)` and `why` names the detectors that voted, but it reaches only
# live STATUS, which the next write erases. So the state the drop logic acted on cannot be read back: the
# 27.5 min of not-worn on 2026-09-23 and the 102 min on 2026-09-22 are decisions no artifact records.
# Until that is persisted there is nothing for Magpie's band or Wren's offline detector to be compared
# AGAINST, and no basis on which the vote could ever responsibly be changed.
#
# This records; it does not decide. Nothing here feeds back into `worn_verdict` or
# `should_drop_not_worn`.

import datetime as _dt
import os

import capture
import writers
from telemetry import worn_verdict

T0 = _dt.datetime(2026, 9, 23, 23, 14, 0)


def _rows(root, when=T0):
    p = os.path.join(writers.night_dir(root, when), writers.WORN_NAME)
    lines = open(p).read().splitlines()
    assert lines[0] == "Phone timestamp;device;address;worn;why;trigger;votes"
    assert "Phone timestamp" not in "\n".join(lines[1:]), "one header per file, however many appends"
    return [ln.split(";") for ln in lines[1:]]


# ── the plant ──────────────────────────────────────────────────────────────────────────────────────

def test_a_motionless_strap_records_hr_beats_HOLDING_worn(tmp_path):
    """THE PLANT. A chest strap on a still sleeper: its contact bit reads not-worn and it is not moving,
    so an ACC-derived rule — Wren's, once it runs live — would call it off-body. `hr-beats` holds it worn,
    and the drop therefore does not fire.

    That disagreement is the whole reason this file exists: the offline detector needs to know WHICH vote
    held, not merely that the verdict was worn. Before this, `why` went to STATUS and was overwritten
    seconds later, so a night's worth of these decisions left no trace to compare against."""
    worn, why = worn_verdict(contact=False, beats=True, charging=None, charging_why=None)
    assert (worn, why) == (True, "worn per hr-beats"), "the fixture must be the real verdict"

    votes = dict(contact=False, beats=True, charging=None, charging_why=None)
    assert writers.append_worn_decision(str(tmp_path), T0, "H10", "AA:BB", worn, why, "change", votes)

    (row,) = _rows(str(tmp_path))
    _ts, dev, addr, w, rec_why, trig, v = row
    assert (dev, addr, w, trig) == ("H10", "AA:BB", "1", "change")
    assert rec_why == "worn per hr-beats", "which vote HELD is the record's point"
    # the losing and abstaining detectors are in the row too, or an offline rule cannot tell WHY it
    # disagrees — only that it does
    assert "beats=True" in v and "contact=False" in v
    assert "charging=" in v and "charging=None" not in v and "charging=False" not in v, \
        "an abstention is blank, never False (§∅)"


def test_the_same_verdict_by_a_DIFFERENT_vote_is_a_new_row(tmp_path):
    """A device that goes from `worn per contact, hr-beats` to `worn per hr-beats` has LOST a detector
    while the published boolean never moves. Keying the change on the verdict alone would record nothing,
    and the loss of a detector is exactly what a band comparing against this would want to see."""
    prev = (True, "worn per contact, hr-beats", 100.0)
    assert capture.worn_record_trigger(prev, True, "worn per hr-beats", 100.5, 60.0) == "change"


# ── what earns a row ───────────────────────────────────────────────────────────────────────────────

def test_the_first_decision_is_always_recorded():
    assert capture.worn_record_trigger(None, True, "worn per hr-beats", 0.0, 60.0) == "change"


def test_an_unchanged_verdict_is_recorded_on_the_CADENCE_and_not_between(tmp_path):
    """The cadence row is the proof that the state was still being OBSERVED. Without it a verdict that
    legitimately held for four hours and a daemon that stopped evaluating produce the same file, and the
    second is the failure worth catching."""
    prev = (True, "worn per hr-beats", 100.0)
    assert capture.worn_record_trigger(prev, True, "worn per hr-beats", 130.0, 60.0) is None
    assert capture.worn_record_trigger(prev, True, "worn per hr-beats", 160.0, 60.0) == "cadence"
    assert capture.worn_record_trigger(prev, True, "worn per hr-beats", 900.0, 60.0) == "cadence"


def test_an_abstention_is_a_change_from_a_verdict():
    """`None` is not `False`. A detector going silent is a different night from one reporting not-worn,
    and `worn_verdict`'s own history is of an abstention being read as an answer."""
    assert capture.worn_record_trigger((False, "not worn per hr-contact-bit", 0.0), None,
                                       "no worn detector is available and in domain (PPG rate unknown)",
                                       1.0, 60.0) == "change"


# ── the file ───────────────────────────────────────────────────────────────────────────────────────

def test_an_abstention_is_written_BLANK_and_not_as_zero(tmp_path):
    worn, why = worn_verdict()
    assert worn is None, "the fixture must be a real abstention"
    writers.append_worn_decision(str(tmp_path), T0, "H10", "AA:BB", worn, why, "change", {"contact": None})
    (row,) = _rows(str(tmp_path))
    assert row[3] == "", "None is blank; `0` would claim the device was measured not-worn"
    assert row[6] == "contact="


def test_a_restart_APPENDS_and_never_reheads_the_file(tmp_path):
    """OxyLifeWriter's lesson, which cost a night's rows per daemon restart on a box that restarts 11-15
    times a day: a fixed-name per-night file opened with "w" holds only its last process's rows."""
    for i in range(3):                       # three "daemon processes" over one night
        writers.append_worn_decision(str(tmp_path), T0, "H10", "AA:BB", True, f"why {i}", "change", {})
    rows = _rows(str(tmp_path))
    assert [r[4] for r in rows] == ["why 0", "why 1", "why 2"], "every process's rows survive"


def test_a_semicolon_or_newline_in_a_reason_cannot_split_the_row(tmp_path):
    writers.append_worn_decision(str(tmp_path), T0, "H10", "AA:BB", False, "not worn; because\nreasons",
                                 "change", {"note": "a;b"})
    (row,) = _rows(str(tmp_path))
    assert len(row) == 7 and row[4] == "not worn, because reasons" and row[6] == "note=a,b"


def test_no_root_and_an_unwritable_root_return_False_and_never_raise(tmp_path):
    assert writers.append_worn_decision(None, T0, "H10", "A", True, "w", "change") is False
    blocker = tmp_path / "captures"
    blocker.write_text("a file where the captures dir must go")
    assert writers.append_worn_decision(str(tmp_path), T0, "H10", "A", True, "w", "change") is False


def test_a_ppg_window_is_recorded_as_a_LENGTH_not_as_its_contents(tmp_path):
    """The optical vote is handed a PPG window and an ambient list. Writing those verbatim would put
    thousands of samples in a CSV cell — the record is of the DECISION, not of the signal under it."""
    writers.append_worn_decision(str(tmp_path), T0, "Verity", "CC:DD", True, "worn per ppg-prominence",
                                 "change", {"ppg": list(range(4000)), "ambient": [1, 2], "fs": 55.0})
    (row,) = _rows(str(tmp_path))
    assert row[6] == "ambient=n2,fs=55.0,ppg=n4000" and len(row[6]) < 40


def test_the_write_cost_of_a_night_is_stated_and_bounded(tmp_path):
    """The number in `_WORN_RECORD_EVERY_S`'s comment, asserted rather than claimed: a minute's cadence
    over an 8 h night for three devices is ~180 KB. A test that lets it grow silently is how a sidecar
    becomes the thing that fills the disk."""
    for i in range(480):                    # one device, one night at the real cadence
        writers.append_worn_decision(str(tmp_path), T0, "H10", "AA:BB", True,
                                     "worn per contact, hr-beats", "cadence",
                                     {"contact": True, "beats": True, "charging": False,
                                      "charging_why": None})
    p = os.path.join(writers.night_dir(str(tmp_path), T0), writers.WORN_NAME)
    per_device = os.path.getsize(p)
    assert per_device < 70_000, f"one device-night is {per_device} B"
    assert 3 * per_device < 200_000, f"three devices would be {3 * per_device} B a night"


# ── the runner's entry point ───────────────────────────────────────────────────────────────────────

def test_record_worn_decision_writes_once_and_then_holds_for_the_cadence(tmp_path):
    """The function the runner calls. It lives at MODULE level deliberately: inside `run_polar` the name
    `writers` is a local dict of open StreamWriters that shadows the module, so a `writers.append_*` call
    written there raises `'dict' object has no attribute ...` — swallowed by the notification handler's
    own `except Exception`, taking the rest of that callback with it. Measured while building this: the
    PPI file stopped being written and the only symptom was one `link error` line.

    That regression is caught by `test_run_polar_writer_contract.py::test_PPI_and_HR_carry_NO_device_
    clock_column`, which is how it was found; no test is duplicated here for it."""
    capture._WORN_RECORD.clear()
    # `record_worn_decision` stamps with `_now()`, so the row lands in TODAY's night dir, not T0's.
    now = capture._now()
    try:
        votes = {"contact": False, "beats": True}
        assert capture.record_worn_decision(str(tmp_path), "H10", "AA:BB", True, "worn per hr-beats",
                                            votes, 100.0) == "change"
        assert capture.record_worn_decision(str(tmp_path), "H10", "AA:BB", True, "worn per hr-beats",
                                            votes, 130.0) is None, "inside the cadence, nothing is written"
        assert len(_rows(str(tmp_path), now)) == 1
        assert capture.record_worn_decision(str(tmp_path), "H10", "AA:BB", True, "worn per hr-beats",
                                            votes, 161.0) == "cadence"
        rows = _rows(str(tmp_path), now)
        assert [r[5] for r in rows] == ["change", "cadence"]
    finally:
        capture._WORN_RECORD.clear()
