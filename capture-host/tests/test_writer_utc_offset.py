# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The writer's recorded UTC offset — residue `2026-09-28-writer-records-no-utc-offset`.

Its own file rather than an addition to `test_writers_sidecars.py`, because that module parametrises
every test over writer CLASSES through a `cls` fixture and these two are about a module-level function
and one appender. Putting them there collected as `function uses no argument 'cls'`.
"""

import datetime as dt
import os
import time

import writers


def test_append_start_RECORDS_THE_UTC_OFFSET_at_the_session_instant(tmp_path, monkeypatch):
    """Residue `2026-09-28-writer-records-no-utc-offset`: the box recorded its zone NOWHERE, so every
    reader of a night had to INFER the writer's offset from `mtime` against a last row. Recorded here at
    session open, where it is known exactly.

    ⚠️ AT THE SESSION'S INSTANT, NOT AT `now()`, which is why `_utc_offset_sec` takes an argument. The
    offset is a function of the INSTANT, not of the machine: two sessions on a DST-change night have
    different offsets, and a `now()`-based reading would stamp both with whichever the process saw. This
    asserts a summer and a winter instant in the SAME process, which only a per-instant reading can pass."""
    before = os.environ.get("TZ")
    monkeypatch.setenv("TZ", "America/New_York")
    time.tzset()
    try:
        root = str(tmp_path)
        summer = dt.datetime(2026, 8, 15, 15, 49, 45)
        winter = dt.datetime(2026, 1, 15, 15, 49, 45)
        assert writers.append_daemon_start(root, summer, pid=1, git="abc", dirty=False, adapter="hci0")
        assert writers.append_daemon_start(root, winter, pid=2, git="abc", dirty=False, adapter="hci0")
        # two different nights, so two files — read each
        got = {}
        for when, want in ((summer, -14400), (winter, -18000)):
            path = os.path.join(writers.night_dir(root, when), writers.STARTS_NAME)
            lines = [ln for ln in open(path, encoding="utf-8").read().split("\n") if ln.strip()]
            head = lines[0].split(";")
            assert head[-1] == "utc_offset_sec", head
            col = head.index("utc_offset_sec")
            got[want] = lines[1].split(";")[col]
        assert got[-14400] == "-14400", f"a summer session must record EDT: {got}"
        assert got[-18000] == "-18000", f"a winter session must record EST, in the SAME process: {got}"
    finally:
        if before is None:
            monkeypatch.delenv("TZ", raising=False)
        else:
            monkeypatch.setenv("TZ", before)
        time.tzset()


def test_append_start_writes_a_BLANK_offset_when_the_zone_cannot_be_determined(tmp_path, monkeypatch):
    """∅ 0 is a REAL offset — it is what a box running UTC reports — so a failure to determine the zone
    must not be written as one. A reader that sees a blank knows the writer could not say; one that sees
    0 believes it said UTC. The two claims are different and the column keeps them apart."""
    monkeypatch.setattr(writers, "_utc_offset_sec", lambda when: None)
    root = str(tmp_path)
    when = dt.datetime(2026, 8, 15, 15, 49, 45)
    assert writers.append_daemon_start(root, when, pid=1, git="abc", dirty=False, adapter="hci0")
    path = os.path.join(writers.night_dir(root, when), writers.STARTS_NAME)
    lines = [ln for ln in open(path, encoding="utf-8").read().split("\n") if ln.strip()]
    col = lines[0].split(";").index("utc_offset_sec")
    assert lines[1].split(";")[col] == "", lines[1]
    assert lines[1].split(";")[col] != "0", "a blank must never be written as 0"


def test_an_UNRESOLVABLE_instant_yields_None_rather_than_raising_into_the_daemon():
    """∅ The handler around `astimezone()`. A writer that raised here would cost the STARTS row — and on
    this box `append_daemon_start` is observability, documented "never raises". So an instant the platform
    cannot resolve yields None, which the column writes as a blank, which a reader reads as "the writer
    could not say". Driven with a stub rather than left to inspection, because an unexercised handler is
    a claim about behaviour nobody has seen."""

    class Unresolvable:
        def astimezone(self):
            raise OverflowError("date value out of range")

    assert writers._utc_offset_sec(Unresolvable()) is None

    class NoOffset:
        def astimezone(self):
            return self

        def utcoffset(self):
            return None  # an aware-but-offsetless result: also "could not say", also not 0

    assert writers._utc_offset_sec(NoOffset()) is None
