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


def test_a_writer_closed_DISCARDED_and_reopened_on_its_path_is_a_new_baseline(tmp_path):
    """The 2026-11-05 false alarm: the ring close discarded an EMPTY writer of a set that did not resume,
    and the resume five seconds later opened the same path again. Same path, new inode, 0 -> 0 bytes:
    a new file by design, never `replaced`."""
    first = _writer(tmp_path, "Ring_ACCRAW.txt", "acc")
    _, snap = writers.live_loss_check()
    first.close()
    os.unlink(first.path)  # the close discards the empty file
    again = _writer(tmp_path, "Ring_ACCRAW.txt", "acc")
    try:
        findings, snap2 = writers.live_loss_check(snap)
        assert findings == [] and again.path in snap2
        os.unlink(again.path)
        with open(again.path, "w") as fh:  # the SAME opening replaced later is still loss
            fh.write("x" * 100)
        findings, _ = writers.live_loss_check(snap2)
        assert [f["kind"] for f in findings] == ["replaced"]
    finally:
        again.close()


def test_a_reused_token_is_still_a_new_opening_and_an_absent_new_file_is_not_missing(tmp_path):
    """`id(writer)` is reused once the old writer is freed, so the token alone cannot mark a new opening.
    A new opening whose file does not exist yet is a writer that has not created it, not a lost file."""
    path = str(tmp_path / "Ring_SPO2.csv")
    token = -20261105
    with open(path, "w") as fh:
        fh.write("a")
    writers._writer_opened(path, token)
    try:
        _, snap = writers.live_loss_check()
        writers._writer_closed(token)
        os.unlink(path)
        writers._writer_opened(path, token)  # the same token, a new opening, no file yet
        findings, snap2 = writers.live_loss_check(snap)
        assert findings == [] and path not in snap2
        with open(path, "w") as fh:
            fh.write("")
        findings, _ = writers.live_loss_check(snap)  # an old snapshot of the old opening
        assert findings == []
    finally:
        writers._writer_closed(token)


def _planted(tmp_path, name, body, token):
    path = str(tmp_path / name)
    with open(path, "w") as fh:
        fh.write(body)
    writers._writer_opened(path, token)
    return path


def test_closing_a_writer_drops_exactly_one_from_the_count_and_its_opening(tmp_path, monkeypatch):
    """One close is one writer: the count falls by 1, never more, and the opening leaves both maps.
    A close on a token that never opened raises no KeyError."""
    monkeypatch.setattr(writers, "_open_sample_writers", writers._open_sample_writers)  # restored after
    a = _planted(tmp_path, "a.txt", "a", -20261106)
    _planted(tmp_path, "b.txt", "b", -20261107)
    try:
        n = writers.open_sample_writers()
        writers._writer_closed(-20261106)
        assert writers.open_sample_writers() == n - 1
        assert -20261106 not in writers._OPEN_GEN and a not in writers.open_writer_paths()
        writers._writer_closed(-20261199)  # never opened: no KeyError from either map
    finally:
        writers._writer_closed(-20261107)


def test_every_finding_carries_its_exact_detail_and_prior_size(tmp_path):
    """The finding text is what the operator reads, so each field is pinned, not only its kind. A path
    that is missing, or newly open, does not stop the walk: the paths after it are still examined."""
    gone = _planted(tmp_path, "a_gone.txt", "x" * 40, -20261110)
    swap = _planted(tmp_path, "b_swap.txt", "x" * 30, -20261111)
    cut = _planted(tmp_path, "c_cut.txt", "x" * 20, -20261112)
    same = _planted(tmp_path, "d_same.txt", "x" * 10, -20261113)
    try:
        _, snap = writers.live_loss_check()
        late = _planted(tmp_path, "a_late.txt", "x", -20261114)  # sorts first, no prior look
        os.unlink(gone)
        old_ino = snap[swap][1]
        os.unlink(swap)
        with open(swap, "w") as fh:
            fh.write("y" * 5)
        new_ino = os.stat(swap).st_ino
        with open(cut, "r+") as fh:
            fh.truncate(7)
        findings, snap2 = writers.live_loss_check(snap)
        by = {f["path"]: f for f in findings}
        assert sorted(by) == [gone, swap, cut]  # `same` kept its size: not a finding
        assert by[gone]["detail"].startswith("FileNotFoundError: ") and by[gone]["was"] == 40
        assert by[swap]["detail"] == f"inode {old_ino} → {new_ino}"
        assert by[swap]["was"] == 30 and by[swap]["now"] == 5
        assert by[cut]["detail"] == "20 → 7 bytes" and by[cut]["was"] == 20 and by[cut]["now"] == 7
        assert late in snap2 and same in snap2
    finally:
        for t in (-20261110, -20261111, -20261112, -20261113, -20261114):
            writers._writer_closed(t)
