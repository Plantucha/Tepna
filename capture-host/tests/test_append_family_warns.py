# tepna-capture — tests/test_append_family_warns.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE APPEND FAMILY'S FAILURE PATH — residue 2026-11-07-the-writer-append-family-logs-failures-at-debug-only.
#
# `append_worn_decision`, `append_clock_sync_event`, `append_daemon_start` and `append_pmd_negotiation`
# are never-raises observability, and all 16 production call sites in `capture.py` discard the bool they
# return. So the journal line is the ONLY report a failed append has. Until 2026-11-08 three of them
# spoke at DEBUG and `append_worn_decision` said nothing at all — and `journal_logging.py:73` installs
# the daemon's root logger at INFO, so a DEBUG record never left the process. The level was not "quiet".
# It was zero trace.
#
# WHY A LOST ROW MATTERS MORE THAN A LOST FILE. Every consumer of these four files is already honest
# about WHOLE-FILE absence: `nightqc.daemon_starts` returns `starts: None`, `nightqc.pmd_negotiations`
# returns `{}`, `solid_night_inputs._negotiated_rate` returns a named UNKNOWN, and
# `loss_audit.daemon_worn_rows` returns None. None of them can see a file that is SHORT. A lost PMDNEG
# row under-counts `rec["starts"]` by one and publishes a NUMBER, and a lost STARTS row removes a
# restart from a count that reads as measured. These files carry no `failures=` trailer the way
# `_SeamSidecar` does, so the WARNING line is the whole of the §∅ story for a partial loss.
#
# Each helper gets two tests, because `path or root` has two sides:
#   · the fault lands AFTER `path` is bound — the line must name the FILE;
#   · the fault lands BEFORE it — the line must fall back to the ROOT, and must not raise `NameError`
#     out of a function whose docstring promises it never raises.

import datetime as _dt
import logging
import os

import writers

WHEN = _dt.datetime(2026, 11, 8, 23, 41, 7)
DATE = "2026-11-08"


def _blocked_file(root: str, name: str) -> str:
    """Put a DIRECTORY where the sidecar belongs, so `open(path, "a")` raises after `path` is bound."""
    p = os.path.join(root, "captures", DATE, name)
    os.makedirs(p)
    return p


def _blocked_folder(root: str) -> None:
    """Put a FILE where the night folder belongs, so `night_dir`'s own `makedirs` raises first."""
    os.makedirs(os.path.join(root, "captures"))
    with open(os.path.join(root, "captures", DATE), "w") as fh:
        fh.write("not a folder\n")


def _one(caplog, token: str) -> logging.LogRecord:
    """The single record carrying `token`. A family of four writers shares one logger, so a line that
    names no file names no writer — every assertion below reads the message, not just the count."""
    said = [r for r in caplog.records if token in r.getMessage()]
    assert len(said) == 1, [r.getMessage() for r in caplog.records]
    assert said[0].levelno == logging.WARNING, (
        f"the daemon's root logger sits at INFO, so anything below WARNING never leaves the process: "
        f"{logging.getLevelName(said[0].levelno)}"
    )
    return said[0]


# ── WORN.csv ──────────────────────────────────────────────────────────────────────────────────────


def test_a_WORN_append_that_cannot_OPEN_the_file_WARNS_and_names_it(tmp_path, caplog):
    """`append_worn_decision` logged NOTHING before 2026-11-08, so a lost worn decision left no trace
    anywhere: the decision itself reaches only live STATUS, which the next write erases."""
    root = str(tmp_path)
    p = _blocked_file(root, writers.WORN_NAME)
    with caplog.at_level("WARNING"):
        ok = writers.append_worn_decision(root, WHEN, "H10", "AA:BB", True, "acc", "change")
    assert ok is False, "a blocked write returns False, it does not raise into the daemon"
    m = _one(caplog, "WORN append failed").getMessage()
    assert p in m, m
    assert "IsADirectoryError" in m, m


def test_a_WORN_append_that_cannot_MAKE_the_folder_falls_back_to_the_ROOT(tmp_path, caplog):
    """`night_dir` creates the folder itself, so it can raise before `path` is bound. The handler reads
    `path`, so without the `path = ""` guard a never-raises function would raise `NameError`."""
    root = str(tmp_path)
    _blocked_folder(root)
    with caplog.at_level("WARNING"):
        ok = writers.append_worn_decision(root, WHEN, "H10", "AA:BB", None, "no detector", "cadence")
    assert ok is False, "a folder that cannot exist returns False, it does not raise"
    m = _one(caplog, "WORN append failed").getMessage()
    assert root in m, f"with no path to name, the line names the capture root: {m!r}"
    assert "FileExistsError" in m, m


# ── CLOCKSYNC.csv ─────────────────────────────────────────────────────────────────────────────────


def test_a_CLOCKSYNC_append_that_cannot_OPEN_the_file_WARNS_and_names_the_EVENT(tmp_path, caplog):
    """84 H10 nights recorded on the strap's 2019 firmware default because nothing persisted the sync
    outcome. The line carries the event name, so one failed row does not read as four."""
    root = str(tmp_path)
    p = _blocked_file(root, writers.CLOCKSYNC_NAME)
    with caplog.at_level("WARNING"):
        ok = writers.append_clock_sync_event(root, WHEN, "H10", "AA:BB", "synced", skew_s=1.25)
    assert ok is False, "a blocked write returns False, it does not raise into the daemon"
    m = _one(caplog, "CLOCKSYNC append failed").getMessage()
    assert "synced" in m, f"which outcome was lost is part of the report: {m!r}"
    assert p in m, m
    assert "IsADirectoryError" in m, m


def test_a_CLOCKSYNC_append_that_cannot_MAKE_the_folder_falls_back_to_the_ROOT(tmp_path, caplog):
    root = str(tmp_path)
    _blocked_folder(root)
    with caplog.at_level("WARNING"):
        ok = writers.append_clock_sync_event(root, WHEN, "H10", "AA:BB", "watchdog-skew", skew_s=None)
    assert ok is False, "a folder that cannot exist returns False, it does not raise"
    m = _one(caplog, "CLOCKSYNC append failed").getMessage()
    assert "watchdog-skew" in m, m
    assert root in m, f"with no path to name, the line names the capture root: {m!r}"
    assert "FileExistsError" in m, m


# ── STARTS.csv ────────────────────────────────────────────────────────────────────────────────────


def test_a_STARTS_append_that_cannot_OPEN_the_file_WARNS_and_names_it(tmp_path, caplog):
    """The daemon restarts 11 to 15 times a day, and `nightqc.daemon_starts` counts the rows. A row
    that never landed removes a restart from a count the reader takes as measured."""
    root = str(tmp_path)
    p = _blocked_file(root, writers.STARTS_NAME)
    with caplog.at_level("WARNING"):
        ok = writers.append_daemon_start(root, WHEN, pid=4242, git="abc1234", dirty=False, adapter="hci0")
    assert ok is False, "a blocked write returns False, it does not raise into the daemon"
    m = _one(caplog, "STARTS append failed").getMessage()
    assert p in m, m
    assert "IsADirectoryError" in m, m


def test_a_STARTS_append_that_cannot_MAKE_the_folder_falls_back_to_the_ROOT(tmp_path, caplog):
    root = str(tmp_path)
    _blocked_folder(root)
    with caplog.at_level("WARNING"):
        ok = writers.append_daemon_start(root, WHEN, pid=4242, git=None, dirty=None, adapter=None)
    assert ok is False, "a folder that cannot exist returns False, it does not raise"
    m = _one(caplog, "STARTS append failed").getMessage()
    assert root in m, f"with no path to name, the line names the capture root: {m!r}"
    assert "FileExistsError" in m, m


# ── PMDNEG.csv ────────────────────────────────────────────────────────────────────────────────────


def test_a_PMDNEG_append_that_cannot_OPEN_the_file_WARNS_and_names_DEVICE_and_STREAM(tmp_path, caplog):
    """One device negotiates several streams a night, so the device and the stream both belong in the
    line. Without them a reader cannot tell which rate record the file is short of."""
    root = str(tmp_path)
    p = _blocked_file(root, writers.PMDNEG_NAME)
    with caplog.at_level("WARNING"):
        ok = writers.append_pmd_negotiation(
            root,
            WHEN,
            "Polar Sense",
            "AA:BB",
            "ppg",
            requested=176,
            offered=[130, 176],
            chosen=176,
            ack="ok",
            how="negotiated",
        )
    assert ok is False, "a blocked write returns False, it does not raise into the daemon"
    m = _one(caplog, "PMDNEG append failed").getMessage()
    assert "Polar Sense" in m and "ppg" in m, f"device and stream both name the lost record: {m!r}"
    assert p in m, m
    assert "IsADirectoryError" in m, m


def test_a_PMDNEG_append_with_an_UNREADABLE_MENU_falls_back_to_the_ROOT(tmp_path, caplog):
    """`offered` is converted before `path` is bound, and `int()` over a bad menu raises `ValueError`.
    So this helper reaches the fallback without any filesystem fault at all."""
    root = str(tmp_path)
    with caplog.at_level("WARNING"):
        ok = writers.append_pmd_negotiation(
            root,
            WHEN,
            "Polar Sense",
            "AA:BB",
            "acc",
            requested=52,
            offered=["fifty-two"],
            chosen=52,
            ack="ok",
            how="negotiated",
        )
    assert ok is False, "an unreadable menu returns False, it does not raise into the daemon"
    m = _one(caplog, "PMDNEG append failed").getMessage()
    assert "acc" in m, m
    assert root in m, f"with no path to name, the line names the capture root: {m!r}"
    assert "ValueError" in m, m


# ── THE HEADER DISCIPLINE THESE FOUR SHARE ────────────────────────────────────────────────────────
#
# The mutation gate's unit is the FUNCTION, so touching the log line in each of these four put their
# whole bodies back in scope and surfaced gaps older than this unit. They are real gaps, not noise:
# each one below is a line whose mutant left the suite green. An existing but EMPTY file is the case
# all four share — a daemon that created the file and died before its first row must not leave a
# headerless CSV behind, and `nightqc` and `loss_audit` both read the header to find their columns.


def _lines(path: str) -> list[str]:
    return open(path, encoding="utf-8").read().splitlines()


def test_an_EMPTY_CLOCKSYNC_file_still_gets_its_HEADER(tmp_path):
    """`fresh` asks `getsize(path) == 0`, so an existing empty file is still fresh."""
    root = str(tmp_path)
    p = os.path.join(writers.night_dir(root, WHEN), writers.CLOCKSYNC_NAME)
    open(p, "w").close()
    assert writers.append_clock_sync_event(root, WHEN, "H10", "AA:BB", "synced", skew_s=0.5) is True
    got = _lines(p)
    assert got[0] == writers._CLOCKSYNC_HEADER.rstrip("\n"), got[:2]
    assert len(got) == 2, got


def test_an_EMPTY_PMDNEG_file_still_gets_its_HEADER(tmp_path):
    root = str(tmp_path)
    p = os.path.join(writers.night_dir(root, WHEN), writers.PMDNEG_NAME)
    open(p, "w").close()
    ok = writers.append_pmd_negotiation(
        root,
        WHEN,
        "Polar Sense",
        "AA:BB",
        "ppg",
        requested=176,
        offered=[130, 176],
        chosen=176,
        ack="ok",
        how="negotiated",
    )
    assert ok is True
    got = _lines(p)
    assert got[0] == writers._PMDNEG_HEADER.rstrip("\n"), got[:2]
    assert len(got) == 2, got


def test_a_PMDNEG_row_carries_the_DEVICE_and_the_ADDRESS_verbatim(tmp_path):
    """`str(device or "")` is a §∅ blank for an absent name, not a discard of a present one. Nothing
    asserted the present case, so a mutant writing `str(None)` or `str(device and "")` stayed green."""
    root = str(tmp_path)
    ok = writers.append_pmd_negotiation(
        root,
        WHEN,
        "Polar Sense",
        "AA:BB",
        "ppg",
        requested=176,
        offered=[130, 176],
        chosen=176,
        ack="ok",
        how="negotiated",
    )
    assert ok is True
    p = os.path.join(root, "captures", DATE, writers.PMDNEG_NAME)
    cells = _lines(p)[1].split(";")
    assert cells[1] == "Polar Sense", cells
    assert cells[2] == "AA:BB", cells


def test_an_EMPTY_WORN_file_still_gets_its_HEADER(tmp_path):
    """`resumed` asks `getsize(path) > 0`. A mutant asking `>= 0` reads an empty file as resumed and
    writes the first row with no header above it."""
    root = str(tmp_path)
    p = os.path.join(writers.night_dir(root, WHEN), writers.WORN_NAME)
    open(p, "w").close()
    assert writers.append_worn_decision(root, WHEN, "H10", "AA:BB", True, "acc", "change") is True
    got = _lines(p)
    assert got[0].startswith("Phone timestamp;device;address;worn;"), got[:2]
    assert len(got) == 2, got


def test_a_ONE_BYTE_WORN_file_is_RESUMED_and_never_re_headed(tmp_path):
    """The other side of the same threshold. A torn write can leave one byte, and `> 1` would then
    re-head a file that already holds content — the truncation this writer exists to prevent."""
    root = str(tmp_path)
    p = os.path.join(writers.night_dir(root, WHEN), writers.WORN_NAME)
    with open(p, "w") as fh:
        fh.write("x")
    assert writers.append_worn_decision(root, WHEN, "H10", "AA:BB", True, "acc", "change") is True
    body = open(p, encoding="utf-8").read()
    assert "Phone timestamp" not in body, f"a non-empty file is continued, never re-headed: {body!r}"
    assert body.startswith("x"), body
