# tepna-capture — tests/test_spool_marker.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The one-day run marker for the stored-spool pull. The defect it answers (residue
# 2026-10-18-daemon-restart-in-the-window-repeats-the-spool-pull): `_cpap_spool_loop` held
# `last_run_date` in a local, so every daemon restart inside the window re-read the whole spool page
# on a day whose pull had already succeeded — 27 times on 17 days, each in a new PID.
#
# What these tests defend is the DIRECTION of every failure. A marker that cannot be read must read
# as None, which costs one duplicate pull; a marker that reads as a date it should not would skip a
# day of data silently, and nothing downstream could tell that day from a night with no therapy.

import builtins
import datetime as _dt
import os
import tempfile

import pytest

import spool_marker as M

DAY = _dt.date(2026, 10, 18)


def test_a_recorded_day_round_trips(tmp_path):
    p = str(tmp_path / "M.txt")
    assert M.save_day(p, DAY) is None
    assert M.load_day(p) == (DAY, None)


def test_the_file_holds_one_ISO_day_and_a_newline(tmp_path):
    """The format is read by the next process, so it is pinned here rather than inferred from a
    round-trip that would pass for any symmetric encoding."""
    p = tmp_path / "M.txt"
    M.save_day(str(p), DAY)
    assert p.read_text(encoding="utf-8") == "2026-10-18\n"


def test_an_absent_marker_is_None_and_says_so(tmp_path):
    assert M.load_day(str(tmp_path / "nothing.txt")) == (None, M.ABSENT)


def test_an_unreadable_marker_is_None_and_names_the_error(tmp_path):
    """A directory where the marker should be. The reason has to separate this from absence: one is
    a box that has never pulled and the other is a box that cannot read its own records."""
    d = tmp_path / "M.txt"
    d.mkdir()
    day, reason = M.load_day(str(d))
    assert day is None
    assert reason != M.ABSENT and "unreadable" in reason and "IsADirectoryError" in reason


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        "not a date",
        "20261018",  # a spelling this module never writes
        "2026-10-18T00:00:00",
        "2026-2-30",
        "2026-02-30",  # matches the pattern and is not a calendar day
        "2026-13-01",
        "2026-00-10",
    ],
)
def test_a_marker_this_module_did_not_write_reads_as_None(tmp_path, text):
    p = tmp_path / "M.txt"
    p.write_text(text, encoding="utf-8")
    day, reason = M.load_day(str(p))
    assert day is None
    assert reason is not None and reason != M.ABSENT


def test_surrounding_whitespace_is_tolerated(tmp_path):
    p = tmp_path / "M.txt"
    p.write_text("  2026-10-18  \n", encoding="utf-8")
    assert M.load_day(str(p)) == (DAY, None)


def test_a_long_unparsable_line_is_reported_SHORT(tmp_path):
    """The reason reaches the journal. An unbounded slice of a file that is not what it should be is
    how one corrupt marker turns into an unreadable journal."""
    p = tmp_path / "M.txt"
    p.write_text("x" * 5000, encoding="utf-8")
    _, reason = M.load_day(str(p))
    assert len(reason) < 80
    # The bound itself, not just "short": `len(reason) < 80` is satisfied by any slice from 1 to
    # 65 characters, so it reports a bound it never measured.
    assert reason == "not a date: " + repr("x" * 40)


def test_a_bare_filename_records_in_the_working_directory(tmp_path, monkeypatch):
    """`os.path.dirname` of a bare name is empty, and `makedirs("")` raises. The `or "."` is the
    branch that keeps a relative marker path working."""
    monkeypatch.chdir(tmp_path)
    assert M.save_day("M.txt", DAY) is None
    assert M.load_day("M.txt") == (DAY, None)


def test_a_missing_parent_directory_is_created(tmp_path):
    p = str(tmp_path / "a" / "b" / "M.txt")
    assert M.save_day(p, DAY) is None
    assert M.load_day(p) == (DAY, None)


def test_a_save_that_cannot_land_RETURNS_the_reason(tmp_path):
    """It never raises into the loop and never returns None. A scheduled job must survive a
    read-only volume, and a save reported as a success is the repeat coming back."""
    ro = tmp_path / "ro"
    ro.mkdir()
    ro.chmod(0o500)
    try:
        reason = M.save_day(str(ro / "M.txt"), DAY)
    finally:
        ro.chmod(0o700)
    assert reason is not None and "Error" in reason


def test_a_day_that_is_not_a_date_is_a_reason_not_a_crash(tmp_path):
    reason = M.save_day(str(tmp_path / "M.txt"), "2026-10-18")
    assert reason is not None and "AttributeError" in reason


def test_a_FAILED_save_leaves_no_temporary_file_behind(tmp_path):
    """Thirty tries a month on a daemon that runs for months. A leaked `.tmp` per failure fills the
    capture root, which is the volume the night's data needs."""
    M.save_day(str(tmp_path / "M.txt"), object())
    assert sorted(os.listdir(tmp_path)) == []


def test_a_FAILED_save_that_cannot_clean_up_still_reports_the_reason(tmp_path, monkeypatch):
    """A read-only volume fails the write AND the cleanup. The reason still has to reach the caller,
    because the caller is what journals the coming repeat."""

    def _no_unlink(_p):
        raise OSError("read-only file system")

    monkeypatch.setattr(os, "unlink", _no_unlink)
    reason = M.save_day(str(tmp_path / "M.txt"), object())
    assert reason is not None and "AttributeError" in reason


def test_the_destination_still_holds_the_OLD_day_when_the_rename_happens(tmp_path, monkeypatch):
    """Atomicity, observed rather than asserted: at the instant of `os.replace` the marker file must
    still read as the PREVIOUS day, which proves the new bytes went to a temporary file. A writer
    that truncated in place could leave `2026-10-1`, and a line that parses as another day skips a
    real one."""
    p = tmp_path / "M.txt"
    M.save_day(str(p), DAY)
    seen = []
    real_replace = os.replace

    def _spy(src, dst):
        seen.append(p.read_text(encoding="utf-8"))
        return real_replace(src, dst)

    monkeypatch.setattr(os, "replace", _spy)
    assert M.save_day(str(p), _dt.date(2026, 10, 19)) is None
    assert seen == ["2026-10-18\n"], "the destination was written in place, not renamed over"
    assert p.read_text(encoding="utf-8") == "2026-10-19\n"
    assert [f for f in os.listdir(tmp_path) if f.endswith(".tmp")] == []


def test_the_temp_file_is_created_BESIDE_the_destination_hidden_and_named_for_this_module(tmp_path, monkeypatch):
    """`os.replace` is atomic over ONE filesystem. A temp file in the system temp directory raises
    `Invalid cross-device link` on any box whose capture root is a separate volume, and no assertion
    about the saved value can see it here, because this suite's own `tmp_path` shares a device with
    `/tmp`. The name is load-bearing beside it: a leftover the cleanup could not remove has to say
    which module made it, and a dot keeps it out of the globs that walk the capture root."""
    dest = tmp_path / "sub" / "M.txt"
    seen = []
    real = tempfile.mkstemp

    def spy(*args, **kwargs):
        fd, created = real(*args, **kwargs)
        seen.append(created)
        return fd, created

    monkeypatch.setattr(tempfile, "mkstemp", spy)
    assert M.save_day(str(dest), _dt.date(2026, 10, 18)) is None
    assert len(seen) == 1
    assert os.path.dirname(seen[0]) == str(dest.parent)
    assert os.path.basename(seen[0]).startswith(".spool-marker-")
    assert seen[0].endswith(".tmp")


def test_the_marker_is_READ_as_utf8_whatever_this_box_prefers(tmp_path, monkeypatch):
    """`encoding=None` takes the box locale. It reads identically on this UTF-8 box and differently
    on a capture host configured otherwise, so the kwarg is the only thing an assertion here can
    observe. The spy filters on the path, because the window covers one call of ours."""
    p = tmp_path / "M.txt"
    p.write_text("2026-10-18\n", encoding="utf-8")
    seen = []
    real = builtins.open

    def spy(*args, **kwargs):
        if args and args[0] == str(p):
            seen.append(kwargs.get("encoding"))
        return real(*args, **kwargs)

    monkeypatch.setattr(builtins, "open", spy)
    assert M.load_day(str(p))[0] == _dt.date(2026, 10, 18)
    assert seen == ["utf-8"]


def test_the_marker_is_WRITTEN_as_utf8_whatever_this_box_prefers(tmp_path, monkeypatch):
    """The write half of the same blind spot. An ISO day is ASCII, so no byte of the record differs
    under either encoding on this box, and a reader on a host with another locale is the one that
    would see it."""
    p = tmp_path / "M.txt"
    seen = []
    real = os.fdopen

    def spy(fd, *args, **kwargs):
        seen.append(kwargs.get("encoding"))
        return real(fd, *args, **kwargs)

    monkeypatch.setattr(os, "fdopen", spy)
    assert M.save_day(str(p), _dt.date(2026, 10, 18)) is None
    assert seen == ["utf-8"]
    assert p.read_text(encoding="utf-8") == "2026-10-18\n"


def test_the_real_loop_reads_this_module(tmp_path):
    """Non-vacuity: the module is wired, not merely covered. `capture._cpap_spool_loop` is the one
    caller, and `tools/find_unwired.py` would not catch a marker nobody loads."""
    import capture

    src = capture.__file__
    with open(src, encoding="utf-8") as fh:
        text = fh.read()
    assert "import spool_marker" in text
    assert "spool_marker.load_day(marker_path)" in text
    assert "spool_marker.save_day(marker_path" in text
