# tepna-capture — tests/test_pull_once_survivors_s3.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-10-22-pull-once-survivors-s3-of-5`: seven survivors in `pull_session._pull_once`, all
# on the operator lines of the transfer loop and the save. The diff-scoped mutation gate mutates the
# whole function a PR touches, so these old lines red any PR that enters `_pull_once`.
#
# What these tests read, and why:
#   * The EXACT TEXT of each line. The journal is the only live view of a pull on the box. A line that
#     loses its offset, its percentage or its outcome word tells the operator nothing.
#   * The `flush` KEYWORD. The pull runs under systemd, where stdout is a pipe and is block-buffered.
#     Without `flush=True` a line can sit in the buffer until the process exits. `print` is
#     monkeypatched and the keyword is read off the call, which is the only way to observe it.
#   * The saved line is compared EXACTLY, never with `"saved" in line`. pytest names `tmp_path` after
#     the test, so a test whose name contains "saved" finds that word in the PATH on the same line.
#
# Every pull bounds its FILE_DATA waits (`_bound_data_waits`), and the resume-START test raises its
# timeout at once instead of waiting 20 s. A mutant that stops the offset from advancing FAILS these
# tests; it cannot hang them.

import asyncio
import os

import oxyii
import pull_session

from test_oxyii import _fmt_a_file
from test_pull_once_survivors_p3 import _bound_data_waits, _spy_prints
from test_pull_session import FakeRing, _install, _run

ADDR = "D1:98:62:7C:92:B3"
TS = "20260719010000"


def _dat_path(tmp_path):
    return os.path.abspath(os.path.join(str(tmp_path), f"Wellue_O2Ring-S_{TS}_STORED.dat"))


def _blob():
    """A real Format-A file with a valid trailer, so a resumed pull passes verification."""
    return _fmt_a_file([(96, 50 + (i % 7), i % 3) for i in range(900)])


def _exact(calls, text):
    return [(a, k) for a, k in calls if a == (text,)]


def _pull(tmp_path, resume=0):
    return _run(pull_session._pull_once(ADDR, str(tmp_path), "all", resume, None, "0000"))


# ── the resume START that gets no reply ─────────────────────────────────────────────────────────────
class _SilentOnSeekRing(FakeRing):
    """Answers a START from 0 and ignores a START that seeks. `dropped` says a seek was ignored."""

    dropped = False

    async def write_gatt_char(self, char, frame, response=None):
        if frame[1] == oxyii.OP_FILE_START and int.from_bytes(frame[7:-1][16:20], "little") > 0:
            self.writes.append(frame)
            self.dropped = True
            return
        await super().write_gatt_char(char, frame, response=response)


def test_an_unanswered_resume_START_says_so_names_the_offset_and_is_flushed(tmp_path, monkeypatch):
    """The fallback re-serves from 0. The line must name the offset that went unanswered, because it
    explains why a resume turned into a full serve."""
    blob = _blob()
    (tmp_path / f"Wellue_O2Ring-S_{TS}_STORED.dat.part").write_bytes(blob[:1024])
    ring = _SilentOnSeekRing([TS], blob)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch, limit=40)
    bounded = pull_session._wait

    async def no_reply_after_a_dropped_seek(q, op, timeout=20.0):
        if op == oxyii.OP_FILE_START and ring.dropped:
            ring.dropped = False
            raise asyncio.TimeoutError("the ring ignored the seek")
        return await bounded(q, op, timeout=timeout)

    monkeypatch.setattr(pull_session, "_wait", no_reply_after_a_dropped_seek)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path, resume=1)

    assert got == [_dat_path(tmp_path)], got
    text = "  ⚠ resume START at 1024 got no reply — re-serving from 0."
    assert _exact(calls, text) == [((text,), {"flush": True})], calls
    assert _exact(calls, "  full serve: resume START unanswered") != [], calls


# ── a resume that the ring accepts ──────────────────────────────────────────────────────────────────
def test_the_resuming_line_is_flushed(tmp_path, monkeypatch):
    blob = _blob()
    (tmp_path / f"Wellue_O2Ring-S_{TS}_STORED.dat.part").write_bytes(blob[:1024])
    _install(monkeypatch, FakeRing([TS], blob))
    _bound_data_waits(monkeypatch, limit=40)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path, resume=1)

    assert got == [_dat_path(tmp_path)], got
    text = f"  resuming at 1024/{len(blob)} B (resuming at 1024 B of {len(blob)} B)"
    assert _exact(calls, text) == [((text,), {"flush": True})], calls


# ── a timeout in the middle of the transfer ─────────────────────────────────────────────────────────
def test_a_mid_transfer_timeout_names_the_offset_and_is_flushed(tmp_path, monkeypatch):
    """One chunk arrives, then the next FILE_DATA wait times out. The line names how far it got."""
    blob = b"\x01\x03" + b"z" * 90
    _install(monkeypatch, FakeRing([TS], blob, chunk=50))
    _bound_data_waits(monkeypatch, limit=1)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path)

    text = f"  ⚠ timeout at offset 50/{len(blob)}; stopping."
    assert _exact(calls, text) == [((text,), {"flush": True})], calls


# ── the progress line ───────────────────────────────────────────────────────────────────────────────
def test_the_progress_line_prints_a_whole_percentage(tmp_path, monkeypatch):
    """One line per 20 480 B, with the integer percentage of the reported size."""
    blob = b"\x01\x03" + b"n" * 60000  # 60 002 B in 512 B chunks
    _install(monkeypatch, FakeRing([TS], blob, chunk=512))
    _bound_data_waits(monkeypatch, limit=200)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path)

    progress = [a[0] for a, _ in calls if a and isinstance(a[0], str) and a[0].endswith("%)")]
    assert progress == ["  20480/60002 (34%)", "  40960/60002 (68%)"], progress


# ── the acquisition-evidence envelope fault ─────────────────────────────────────────────────────────
def test_an_envelope_fault_is_reported_and_flushed(tmp_path, monkeypatch):
    blob = b"\x01\x03" + b"z" * 90
    _install(monkeypatch, FakeRing([TS], blob))
    _bound_data_waits(monkeypatch)
    err = ValueError("undeclared word")

    def boom(*a, **kw):
        raise err

    monkeypatch.setattr(pull_session.acq_evidence_o2ring, "assemble_dat", boom)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path)

    text = f"  ⚠ acquisition-evidence envelope failed for {TS} ({err!r}) — bytes unaffected"
    assert _exact(calls, text) == [((text,), {"flush": True})], calls


# ── the outcome line ────────────────────────────────────────────────────────────────────────────────
def test_a_complete_pull_ends_with_the_lowercase_saved_line(tmp_path, monkeypatch):
    blob = b"\x01\x03" + b"z" * 90
    _install(monkeypatch, FakeRing([TS], blob))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path)

    first = f"  saved {len(blob)} bytes → {_dat_path(tmp_path)}"
    done = [(a, k) for a, k in calls if a and isinstance(a[0], str) and a[0].split("\n")[0] == first]
    assert len(done) == 1, calls
    assert done[0][1] == {"flush": True}, done[0]
