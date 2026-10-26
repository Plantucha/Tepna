# tepna-capture — tests/test_pull_once_survivors_s4.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Survivor batch `pull-once-s4-of-5` (#3855): seven survivors in `pull_session._pull_once`, all
# on operator lines of the transfer and save path — the unanswered-seek warning, the resume line, the
# mid-transfer timeout, the progress line, the envelope-failure warning and the saved/partial line.
# The diff-scoped mutation gate mutates the whole function a PR touches, so these old lines red any PR
# that enters `_pull_once`.
#
# What these tests read, and why:
#   * The `flush` KEYWORD. The pull runs under systemd, where stdout is a pipe and is block-buffered.
#     Without `flush=True` a line can sit in the buffer until the process exits, so the journal shows
#     nothing while a slow BLE transfer runs. `print` is monkeypatched and the keyword is read off the
#     call, which is the only way to observe it. `flush=None` and `flush=False` both buffer, so the
#     assertion is on the exact value True.
#   * The WHOLE TEXT of the resume, progress and saved/partial lines. These carry numbers and a state
#     word a human reads to decide whether a night is whole: the resume offset, the percentage, and
#     `partial` (lower case, the word `grep partial` in a runbook finds). The progress test lands an
#     update exactly at the end of the file, where the percentage must read 100 and not more.
#
# Every test bounds its FILE_DATA waits (`_bound_data_waits`). A mutant elsewhere in `_pull_once` that
# stops the offset from advancing must FAIL these tests, not hang them: a hang is a mutation-gate
# TIMEOUT, which the gate reports as UNDECIDED and refuses on.

import asyncio
import builtins
import os

import oxyii
import pull_session

from test_oxyii import _fmt_a_file
from test_pull_session import FakeRing, _install, _run

ADDR = "D1:98:62:7C:92:B3"
TS = "20260720010000"


def _blob(n=900):
    """A real Format-A file with position-dependent records (2758 B for 900 records)."""
    return _fmt_a_file([(96, 50 + (i % 7), i % 3) for i in range(n)])


def _bound_data_waits(monkeypatch, limit=60):
    """End the transfer with a TimeoutError after `limit` FILE_DATA waits. The largest pull in this
    file needs 40, so the bound is never reached on the branch."""
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


def _cut_after(monkeypatch, n):
    """Answer `n` FILE_DATA waits, then time out the next one, the way a link that dies does."""
    real_wait = pull_session._wait
    seen = {"n": 0}

    async def cut(q, op, timeout=20.0):
        if op == oxyii.OP_FILE_DATA:
            seen["n"] += 1
            if seen["n"] > n:
                raise asyncio.TimeoutError("link died mid-transfer")
        return await real_wait(q, op, timeout=timeout)

    monkeypatch.setattr(pull_session, "_wait", cut)
    return seen


def _spy_prints(monkeypatch):
    """Record every print call as (args, kwargs). Nothing is written to stdout."""
    calls = []

    def spy(*args, **kwargs):
        calls.append((args, kwargs))

    monkeypatch.setattr(builtins, "print", spy)
    return calls


def _lines_with(calls, needle):
    return [(a, k) for a, k in calls if a and isinstance(a[0], str) and needle in a[0]]


def _start_offsets(ring):
    return [int.from_bytes(w[7:-1][16:20], "little") for w in ring.writes if w[1] == oxyii.OP_FILE_START]


def _dat(tmp_path):
    return os.path.abspath(str(tmp_path / f"Wellue_O2Ring-S_{TS}_STORED.dat"))


def _part(tmp_path):
    return tmp_path / f"Wellue_O2Ring-S_{TS}_STORED.dat.part"


def _pull(tmp_path, resume=0):
    return _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", resume, None, "0000"))


# ── the unanswered seek: the warning is flushed ─────────────────────────────────────────────────────
def test_an_unanswered_seek_warns_with_its_offset_and_flushes(tmp_path, monkeypatch):
    """When the ring ignores the resume START, the pull re-serves from 0. The warning is the journal's
    only record that a resume was attempted and abandoned, so it names the offset and is flushed."""
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

    got = _pull(tmp_path, resume=True)

    assert refused, "the test never reached the unanswered-seek fallback"
    assert got == [_dat(tmp_path)], got
    warn = _lines_with(calls, "got no reply")
    assert warn == [(("  ⚠ resume START at 1024 got no reply — re-serving from 0.",), {"flush": True})], warn


# ── the resume line names the offset, the size and the reason ───────────────────────────────────────
def test_the_resume_line_names_offset_size_and_reason_and_flushes(tmp_path, monkeypatch):
    """An answered seek resumes from the `.part`. The resume line says where the transfer picks up,
    out of how many bytes, and why — the only trace in the journal that the file was spliced from a
    prefix on disk rather than served whole."""
    blob = _blob()
    _part(tmp_path).write_bytes(blob[:1024])
    ring = FakeRing([TS], blob)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    seen = {}
    real_strategy = pull_session.oxy_transfer.resume_strategy

    def spy(have, size, *, allow_resume=False):
        seen["plan"] = real_strategy(have, size, allow_resume=allow_resume)
        return seen["plan"]

    monkeypatch.setattr(pull_session.oxy_transfer, "resume_strategy", spy)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path, resume=True)

    assert got == [_dat(tmp_path)], got
    assert _start_offsets(ring) == [0, 1024], _start_offsets(ring)
    assert seen["plan"].reason, "the real strategy gives a resume its reason"
    want = f"  resuming at 1024/{len(blob)} B ({seen['plan'].reason})"
    resumed = [(a, k) for a, k in calls if a and isinstance(a[0], str) and a[0].startswith("  resuming at")]
    assert resumed == [((want,), {"flush": True})], calls


# ── the mid-transfer timeout is flushed ─────────────────────────────────────────────────────────────
def test_a_mid_transfer_timeout_names_the_offset_and_flushes(tmp_path, monkeypatch):
    """A link that dies mid-transfer stops the loop. The warning names how far it got; it is flushed
    because the process may be about to be torn down by the caller, taking a buffered line with it."""
    blob = _blob()
    ring = FakeRing([TS], blob, chunk=512)
    _install(monkeypatch, ring)
    _cut_after(monkeypatch, 2)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path)

    warn = _lines_with(calls, "timeout at offset")
    assert warn == [((f"  ⚠ timeout at offset 1024/{len(blob)}; stopping.",), {"flush": True})], warn


# ── the progress line at the last byte ──────────────────────────────────────────────────────────────
def test_a_progress_line_at_the_last_byte_reads_100_percent_and_flushes(tmp_path, monkeypatch):
    """Progress prints every 512 * 40 B. A file of exactly that size prints one update, at its last
    byte, and that update must read 100 % — the percentage is `100 * off // size`, and at off == size
    any other factor shows the operator a number that is not a percentage."""
    size = 512 * 40
    blob = b"\x01\x03" + b"q" * (size - 2)
    ring = FakeRing([TS], blob, chunk=512)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)
    seen = []

    got = _run(
        pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000", on_progress=lambda *a: seen.append(a))
    )

    assert got == [_dat(tmp_path)], got
    assert seen == [(size, size)], seen
    progress = [(a, k) for a, k in calls if a and isinstance(a[0], str) and a[0].startswith(f"  {size}/{size} (")]
    assert progress == [((f"  {size}/{size} (100%)",), {"flush": True})], progress


# ── the envelope-failure warning is flushed ─────────────────────────────────────────────────────────
def test_an_envelope_failure_warning_is_flushed(tmp_path, monkeypatch):
    """The envelope fault costs the envelope and nothing else; the warning is what tells the operator
    which session lost it. It is flushed like every other operator line of the pull."""
    ring = FakeRing([TS], _blob())
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)

    def boom(*a, **kw):
        raise ValueError("undeclared word")

    monkeypatch.setattr(pull_session.acq_evidence_o2ring, "assemble_dat", boom)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path)

    assert got == [_dat(tmp_path)], got
    warn = _lines_with(calls, "acquisition-evidence envelope failed")
    assert len(warn) == 1, calls
    (line,), kw = warn[0]
    assert TS in line and "undeclared word" in line, line
    assert kw == {"flush": True}, warn[0]


# ── a short pull is reported as `partial` ───────────────────────────────────────────────────────────
def test_a_short_pull_is_reported_as_partial_under_its_part_name(tmp_path, monkeypatch):
    """A short pull lands under `.part` and the last line says so with the word `partial`, the byte
    count and the path. The word is lower case, the same word the complete case's `saved` sits beside;
    a runbook greps for it."""
    blob = _blob()
    ring = FakeRing([TS], blob, chunk=512)
    _install(monkeypatch, ring)
    _cut_after(monkeypatch, 2)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path)

    part = _dat(tmp_path) + ".part"
    assert got == [part], got
    done = [(a, k) for a, k in calls if a and isinstance(a[0], str) and f"bytes → {part}" in a[0]]
    assert len(done) == 1, calls
    (line,), kw = done[0]
    assert line.startswith(f"  partial 1024 bytes → {part}\n"), line
    assert kw == {"flush": True}, done[0]
