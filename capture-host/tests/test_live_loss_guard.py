# tepna-capture — tests/test_live_loss_guard.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE LIVE HALF OF THE LOSS GUARD (residue 2026-09-20-no-loss-guard-during-live-capture).

`oxy_inventory.reconcile()` classifies a lost recording and is reached from a live consumer — but only
at PULL and COLD-START boundaries. The incident that opened the row was a live ring session losing two
files mid-session, with nothing looking at the files the daemon believed it was writing. These tests
plant exactly that: a file the daemon has open is deleted, truncated, or replaced under its own name."""

import os

import writers


def _writer(tmp_path, name="Polar_H10_0284_20260922_ECG.txt", stream="ecg"):
    return writers.StreamWriter(str(tmp_path / name), stream)


def test_the_open_set_is_the_writers_own_and_closes_with_them(tmp_path):
    before = writers.open_writer_paths()
    w = _writer(tmp_path)
    assert str(tmp_path / "Polar_H10_0284_20260922_ECG.txt") in writers.open_writer_paths()
    assert len(writers.open_writer_paths()) == len(before) + 1 == writers.open_sample_writers()
    w.close()
    assert writers.open_writer_paths() == before


def test_a_first_pass_only_establishes_a_baseline(tmp_path):
    w = _writer(tmp_path)
    try:
        findings, snap = writers.live_loss_check()
        assert findings == [] and w.path in snap  # nothing is a finding without a prior look
    finally:
        w.close()


def test_a_file_that_VANISHES_under_a_live_writer_is_reported(tmp_path):
    w = _writer(tmp_path)
    try:
        _, snap = writers.live_loss_check()
        os.unlink(w.path)
        findings, snap2 = writers.live_loss_check(snap)
        assert [f["kind"] for f in findings] == ["missing"]
        assert findings[0]["path"] == w.path and findings[0]["was"] == snap[w.path][0]
        assert w.path not in snap2  # gone from the snapshot too
    finally:
        w.close()


def test_a_file_that_SHRINKS_is_reported_and_growth_is_not(tmp_path):
    import datetime as dt

    w = _writer(tmp_path)
    try:
        _, snap = writers.live_loss_check()
        for i in range(50):
            w.write_ecg(dt.datetime(2026, 9, 22, 22, 0, i % 60), 0, float(i), 100 + i)
        w.flush()
        grew, snap = writers.live_loss_check(snap)
        assert grew == [], "a file that grew is not a loss"
        with open(w.path, "r+") as fh:
            fh.truncate(10)
        findings, _ = writers.live_loss_check(snap)
        assert [f["kind"] for f in findings] == ["shrank"] and findings[0]["now"] == 10
        assert "bytes" in findings[0]["detail"]
    finally:
        w.close()


def test_a_file_REPLACED_under_the_same_name_is_reported(tmp_path):
    w = _writer(tmp_path)
    try:
        _, snap = writers.live_loss_check()
        os.unlink(w.path)
        with open(w.path, "w") as fh:  # same name, a different file
            fh.write("x" * 10_000)
        findings, _ = writers.live_loss_check(snap)
        assert [f["kind"] for f in findings] == ["replaced"] and "inode" in findings[0]["detail"]
    finally:
        w.close()


def test_a_path_that_was_never_seen_and_is_absent_is_not_a_finding(tmp_path):
    """An OSError on a path with no prior observation is a writer that has not created its file yet —
    absence with nothing to compare against is not loss (§∅: never a fabricated finding)."""
    w = _writer(tmp_path)
    try:
        os.unlink(w.path)
        findings, snap = writers.live_loss_check()  # no prior snapshot at all
        assert findings == [] and snap == {}
    finally:
        w.close()
