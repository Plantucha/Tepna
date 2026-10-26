# tepna-capture — tests/test_pull_once_survivors_s1.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Survivor batch `pull-once-s1-of-5` (#3855): seven survivors in `pull_session._pull_once`, all on
# the operator lines of the transfer: the unanswered-seek warning, the resume line, the mid-transfer
# timeout warning, the 20 KB progress line and the final saved/partial line. The diff-scoped mutation
# gate mutates the whole function a PR touches, so these old lines red any PR that enters `_pull_once`.
#
# What these tests read, and why:
#   * The WHOLE print call, text and keywords together, compared for equality. The pull runs under
#     systemd, where stdout is a pipe and is block-buffered, so a line without `flush=True` can sit in
#     the buffer until the process exits. `print` is monkeypatched and the call is read as
#     (args, kwargs), which is the only way to see the keyword.
#   * Lines are selected by their own PREFIX, never by a substring that can occur anywhere. pytest
#     names `tmp_path` after the test, so a test called `test_saved_...` puts "saved" into every path
#     it prints, and a substring match on "saved" then also matches a line that says "partial". That is
#     why the saved/partial mutant survived the earlier test of the same line.
#
# Every test bounds its FILE_DATA waits (`_bound_data_waits`). A mutant elsewhere in `_pull_once` that
# stops the offset from advancing must FAIL these tests, not hang them: a hang is a mutation-gate
# TIMEOUT, which the gate reports as UNDECIDED and refuses on.

import asyncio
import builtins
import os
import re

import oxyii
import pull_session

from test_oxyii import _fmt_a_file
from test_pull_session import FakeRing, _install, _run

ADDR = "D1:98:62:7C:92:B3"
TS = "20260720010000"
PROGRESS = re.compile(r"^  \d+/\d+ \(\d+%\)$")


def _blob(n=900):
    """A real Format-A file, so a complete pull classifies VERIFIED and commits."""
    return _fmt_a_file([(96, 50 + (i % 7), i % 3) for i in range(n)])


def _bound_data_waits(monkeypatch, limit=12):
    """End the transfer with a TimeoutError after `limit` FILE_DATA waits. The bound is set per test
    above what the branch needs, except where the timeout itself is the scenario."""
    real_wait = pull_session._wait
    seen = {"n": 0}

    async def bounded(q, op, timeout=20.0):
        if op == oxyii.OP_FILE_DATA:
            seen["n"] += 1
            if seen["n"] > limit:
                raise asyncio.TimeoutError("FILE_DATA wait bound reached")
        return await real_wait(q, op, timeout=timeout)

    monkeypatch.setattr(pull_session, "_wait", bounded)
    return seen


def _spy_prints(monkeypatch):
    """Record every print call as (args, kwargs). Nothing is written to stdout."""
    calls = []

    def spy(*args, **kwargs):
        calls.append((args, kwargs))

    monkeypatch.setattr(builtins, "print", spy)
    return calls


def _starting(calls, prefix):
    return [(a, k) for a, k in calls if a and isinstance(a[0], str) and a[0].startswith(prefix)]


def _start_offsets(ring):
    return [int.from_bytes(w[7:-1][16:20], "little") for w in ring.writes if w[1] == oxyii.OP_FILE_START]


def _dat(tmp_path):
    return os.path.abspath(str(tmp_path / f"Wellue_O2Ring-S_{TS}_STORED.dat"))


def _part(tmp_path):
    return tmp_path / f"Wellue_O2Ring-S_{TS}_STORED.dat.part"


def _pull(tmp_path, resume=0):
    return _run(pull_session._pull_once(ADDR, str(tmp_path), "all", resume, None, "0000"))


# ── the unanswered seek says where it tried to seek, and says it now ────────────────────────────────
def test_an_unanswered_seek_warns_with_its_offset_and_is_flushed(tmp_path, monkeypatch):
    """When the ring ignores a resume START, the warning is the only line that names the offset the
    ring refused. It is flushed, so the journal shows the fallback while the re-serve runs."""
    blob = _blob()
    _part(tmp_path).write_bytes(blob[:1024])
    ring = FakeRing([TS], blob)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    bounded, refused = pull_session._wait, []

    async def refuse_the_seek(q, op, timeout=20.0):
        if op == oxyii.OP_FILE_START and _start_offsets(ring)[-1] and not refused:
            refused.append(op)
            raise asyncio.TimeoutError()
        return await bounded(q, op, timeout=timeout)

    monkeypatch.setattr(pull_session, "_wait", refuse_the_seek)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path, resume=True)

    assert refused, "the test never reached the unanswered-seek fallback"
    warn = _starting(calls, "  ⚠ resume START")
    assert warn == [(("  ⚠ resume START at 1024 got no reply — re-serving from 0.",), {"flush": True})], calls


# ── a resume says where it resumed and why, and says it now ─────────────────────────────────────────
def test_a_resume_reports_its_offset_size_and_reason_and_is_flushed(tmp_path, monkeypatch):
    """The resume line is the journal's only record that the file was spliced from a local prefix,
    which is the pull whose failure mode is invisible in the byte count."""
    blob = _blob()
    _part(tmp_path).write_bytes(blob[:1024])
    ring = FakeRing([TS], blob)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path, resume=True)

    assert _start_offsets(ring) == [0, 1024], _start_offsets(ring)
    assert got == [_dat(tmp_path)], got
    n = len(blob)
    line = f"  resuming at 1024/{n} B (resuming at 1024 B of {n} B)"
    assert _starting(calls, "  resuming at") == [((line,), {"flush": True})], calls


# ── a mid-transfer timeout names the offset it stopped at ───────────────────────────────────────────
def test_a_mid_transfer_timeout_names_its_offset_and_size_and_is_flushed(tmp_path, monkeypatch):
    """The link dies after one 512 B chunk. The warning names how far the transfer got and how far it
    had to go; it is the only line that says WHY the file that follows is a partial."""
    blob = _blob()
    _install(monkeypatch, FakeRing([TS], blob, chunk=512))
    _bound_data_waits(monkeypatch, limit=1)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path)

    warn = _starting(calls, "  ⚠ timeout at offset")
    assert warn == [((f"  ⚠ timeout at offset 512/{len(blob)}; stopping.",), {"flush": True})], calls


# ── the 20 KB progress line ─────────────────────────────────────────────────────────────────────────
def test_the_progress_lines_name_offset_size_and_percent_and_are_flushed(tmp_path, monkeypatch):
    """One progress line per 20 480 B. A slow BLE transfer runs for minutes, and an unflushed progress
    line reaches the journal only when the pull ends — a progress line that arrives with the result
    reports nothing."""
    blob = b"\x01\x03" + b"n" * 60000  # 60 002 B in 512 B chunks: 118 FILE_DATA waits
    _install(monkeypatch, FakeRing([TS], blob, chunk=512))
    _bound_data_waits(monkeypatch, limit=200)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path)

    n = len(blob)
    progress = [(a, k) for a, k in calls if a and isinstance(a[0], str) and PROGRESS.match(a[0])]
    assert progress == [
        ((f"  20480/{n} (34%)",), {"flush": True}),
        ((f"  40960/{n} (68%)",), {"flush": True}),
    ], progress


# ── the closing line says saved or partial, by the byte count ───────────────────────────────────────
def test_a_complete_pull_closes_with_a_saved_line(tmp_path, monkeypatch):
    """A complete pull's closing line says `saved` and names the committed `.dat`."""
    blob = _blob()
    _install(monkeypatch, FakeRing([TS], blob))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path)

    assert got == [_dat(tmp_path)], got
    closing = _starting(calls, "  saved ") + _starting(calls, "  partial ")
    assert len(closing) == 1, calls
    (line,), kw = closing[0]
    assert line.startswith(f"  saved {len(blob)} bytes → {_dat(tmp_path)}\n"), line
    assert kw == {"flush": True}, closing[0]


def test_a_short_pull_closes_with_a_partial_line(tmp_path, monkeypatch):
    """A short pull's closing line says `partial` and names the `.part` it kept, never the `.dat`."""
    blob = _blob()
    _install(monkeypatch, FakeRing([TS], blob, chunk=512))
    _bound_data_waits(monkeypatch, limit=1)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path)

    part = _dat(tmp_path) + ".part"
    assert got == [part], got
    closing = _starting(calls, "  saved ") + _starting(calls, "  partial ")
    assert len(closing) == 1, calls
    (line,), kw = closing[0]
    assert line.startswith(f"  partial 512 bytes → {part}\n"), line
    assert kw == {"flush": True}, closing[0]
