# tepna-capture — tests/test_pull_once_survivors_s2.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-10-22-pull-once-survivors-s2-of-5`: seven survivors in `pull_session._pull_once`, all
# on OPERATOR LINES — the unanswered-seek warning, the resume line, the mid-transfer timeout warning,
# the progress line, the envelope-failure warning and the closing saved/partial line. The diff-scoped
# mutation gate mutates the whole function a PR touches, so these old lines red any PR that enters
# `_pull_once`.
#
# What these tests read, and why:
#   * The `flush` KEYWORD. The pull runs under systemd, where stdout is a pipe and is block-buffered.
#     Without `flush=True` a line can sit in the buffer until the process exits, so the journal shows
#     nothing while a slow BLE transfer runs. `print` is monkeypatched and the keyword is read off the
#     call, which is the only way to observe it. `flush=None`, `flush=False` and a dropped keyword are
#     all falsy to `print`, so each is a line the journal does not show in time.
#   * The EXACT TEXT. The resume line is the only record of where a resume spliced; the progress line
#     is an integer percentage, and a float one prints `33.333333333333336%` to the journal; the
#     closing line says `partial` for a short pull, and saying `saved` there claims a recording that
#     the same pull just refused to commit.
#
# Every pull here bounds its FILE_DATA waits (`_bound_data_waits`). A mutant elsewhere in
# `_pull_once` that stops the offset from advancing must FAIL these tests, not hang them: a hang is a
# mutation-gate TIMEOUT, which the gate reports as UNDECIDED and refuses on.

import asyncio

import oxy_transfer
import oxyii
import pull_session

from test_pull_once_survivors_p3 import _bound_data_waits, _lines_with, _spy_prints
from test_pull_once_survivors_r3 import TS, _blob, _dat, _part, _start_offsets
from test_pull_session import FakeRing, _install, _run

ADDR = "D1:98:62:7C:92:B3"


def _pull(tmp_path, resume=False):
    return _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", resume, None, "0000"))


# ── the unanswered-seek warning ─────────────────────────────────────────────────────────────────────
def test_an_unanswered_seek_warns_with_its_offset_and_is_flushed(tmp_path, monkeypatch):
    """The ring ignored a resume START. The warning names the offset it was asked for and is flushed,
    because the re-serve that follows is a whole extra acquisition the operator should see begin."""
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
    warn = _lines_with(calls, "got no reply")
    assert warn == [(("  ⚠ resume START at 1024 got no reply — re-serving from 0.",), {"flush": True})], warn


# ── the resume line ─────────────────────────────────────────────────────────────────────────────────
def test_the_resume_line_names_offset_size_and_reason_and_is_flushed(tmp_path, monkeypatch):
    """A resume that the ring honoured prints where it resumed, out of how many bytes, and why."""
    blob = _blob()
    _part(tmp_path).write_bytes(blob[:1024])
    ring = FakeRing([TS], blob)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path, resume=True)

    assert _start_offsets(ring) == [0, 1024], _start_offsets(ring)
    assert _dat(tmp_path).read_bytes() == blob
    reason = oxy_transfer.resume_strategy(1024, len(blob), allow_resume=True).reason
    want = f"  resuming at 1024/{len(blob)} B ({reason})"
    resumed = [(a, k) for a, k in calls if a and isinstance(a[0], str) and a[0].startswith("  resuming at")]
    assert resumed == [((want,), {"flush": True})], (resumed, [a for a, _ in calls])


# ── the mid-transfer timeout warning ────────────────────────────────────────────────────────────────
def test_a_mid_transfer_timeout_warns_with_its_offset_and_is_flushed(tmp_path, monkeypatch):
    """The second FILE_DATA wait times out. The warning names the offset reached out of the size the
    ring reported, and is flushed: it is the line that explains the `.part` left behind."""
    blob = b"\x01\x03" + b"t" * 1022
    _install(monkeypatch, FakeRing([TS], blob))
    _bound_data_waits(monkeypatch, limit=1)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path)

    warn = _lines_with(calls, "timeout at offset")
    assert warn == [(("  ⚠ timeout at offset 512/1024; stopping.",), {"flush": True})], warn


# ── the progress line ───────────────────────────────────────────────────────────────────────────────
def test_the_progress_line_prints_an_integer_percentage(tmp_path, monkeypatch):
    """Progress is printed at every 20480-byte boundary as an integer percentage. A size that does not
    divide evenly is the only input that separates floor division from true division."""
    blob = b"\x01\x03" + bytes(i % 251 for i in range(3 * 20480 - 2))
    _install(monkeypatch, FakeRing([TS], blob, chunk=2048))
    _bound_data_waits(monkeypatch, limit=40)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path)

    assert len(got) == 1 and got[0].endswith(".dat"), got
    size = len(blob)
    progress = [a[0] for a, _ in calls if a and isinstance(a[0], str) and a[0].endswith("%)")]
    assert progress == [
        f"  20480/{size} (33%)",
        f"  40960/{size} (66%)",
        f"  {size}/{size} (100%)",
    ], progress


# ── the envelope-failure warning ────────────────────────────────────────────────────────────────────
def test_an_envelope_failure_warns_and_is_flushed(tmp_path, monkeypatch):
    """The acquisition-evidence assembler raises. The pull still lands its sidecar, and the warning
    that the envelope is missing from it is flushed so the journal says why."""

    def boom(*a, **k):
        raise ValueError("boom")

    monkeypatch.setattr(pull_session.acq_evidence_o2ring, "assemble_dat", boom)
    _install(monkeypatch, FakeRing([TS], b"\x01\x03" + b"e" * 90))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path)

    assert got == [str(_dat(tmp_path))], got
    warn = _lines_with(calls, "acquisition-evidence envelope failed")
    want = f"  ⚠ acquisition-evidence envelope failed for {TS} (ValueError('boom')) — bytes unaffected"
    assert warn == [((want,), {"flush": True})], warn


# ── the closing line of a short pull ────────────────────────────────────────────────────────────────
def test_a_short_pull_closes_with_partial_never_saved(tmp_path, monkeypatch):
    """The ring declares more bytes than it serves. The pull keeps a `.part` and refuses to commit, so
    its closing line must say `partial`; `saved` there claims the recording the pull just refused."""
    blob = b"\x01\x03" + b"p" * 90
    _install(monkeypatch, FakeRing([TS], blob, declared=len(blob) + 100))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _pull(tmp_path)

    part = str(_dat(tmp_path)) + ".part"
    assert got == [part], got
    closing = _lines_with(calls, " bytes → ")
    assert len(closing) == 1, calls
    (text,), kw = closing[0]
    assert text.startswith(f"  partial {len(blob)} bytes → {part}\n"), text
    assert kw == {"flush": True}, closing[0]
