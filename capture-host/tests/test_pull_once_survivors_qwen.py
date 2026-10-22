# tepna-capture — tests/test_pull_once_survivors_qwen.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Survivors in `pull_session._pull_once` that Qwen missed. These mutants survive because the
# existing tests do not assert the `flush=True` keyword of the print calls, or do not check the exact
# text printed. Every test here must FAIL when its mutant is applied and PASS on the original code.

import asyncio
import builtins

import oxyii
import pull_session

from test_pull_session import FakeRing, _install, _run


ADDR = "D1:98:62:7C:92:B3"
BLOB = b"\x01\x03" + b"z" * 90


def _spy_prints(monkeypatch):
    """Record every print call as (args, kwargs). Nothing is written to stdout."""
    calls = []

    def spy(*args, **kwargs):
        calls.append((args, kwargs))

    monkeypatch.setattr(builtins, "print", spy)
    return calls


def _lines_with(calls, needle):
    return [(a, k) for a, k in calls if a and isinstance(a[0], str) and needle in a[0]]


def _bound_data_waits(monkeypatch, limit=8):
    """End the transfer with a TimeoutError after `limit` FILE_DATA waits."""
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


# ── connecting line ──────────────────────────────────────────────────────────────────────────────────
def test_connecting_line_is_flushed_with_exact_text(tmp_path, monkeypatch):
    """The connecting line must be flushed and contain the device address and name."""
    calls = _spy_prints(monkeypatch)
    _install(monkeypatch, FakeRing([]))
    _bound_data_waits(monkeypatch)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    lines = _lines_with(calls, f"connecting to {ADDR}")
    assert len(lines) == 1, calls
    assert "O2Ring S8AW" in lines[0][0][0], lines[0]
    assert lines[0][1] == {"flush": True}, lines[0]


# ── MTU post-acquire line ───────────────────────────────────────────────────────────────────────────
def test_mtu_post_acquire_line_is_flushed_with_exact_text(tmp_path, monkeypatch):
    """The MTU post-acquire line must be flushed and show the correct MTU."""
    calls = _spy_prints(monkeypatch)
    ring = FakeRing([])
    ring.mtu_size = 247
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    lines = _lines_with(calls, "connected · MTU=247 (post-acquire)")
    assert len(lines) == 1, calls
    assert lines[0][1] == {"flush": True}, lines[0]


# ── device identity not read warning ────────────────────────────────────────────────────────────────
def test_device_identity_not_read_warning_is_flushed_with_exact_text(tmp_path, monkeypatch):
    """When identity read fails, the warning must be flushed with exact text."""
    calls = _spy_prints(monkeypatch)
    ring = FakeRing(["20260719010000"], BLOB)
    ring.answer_info = False  # Cause identity read to fail
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    lines = _lines_with(calls, "⚠ device identity not read")
    assert len(lines) == 1, calls
    assert lines[0][1] == {"flush": True}, lines[0]


# ── device identity line ────────────────────────────────────────────────────────────────────────────
def test_device_identity_line_is_flushed_with_exact_text(tmp_path, monkeypatch):
    """When identity is read, the device line must be flushed with firmware and serial."""
    calls = _spy_prints(monkeypatch)
    _install(monkeypatch, FakeRing(["20260719010000"], BLOB))
    _bound_data_waits(monkeypatch)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    lines = _lines_with(calls, "device: firmware='2D010003' serial='O2R-TEST-1'")
    assert len(lines) == 1, calls
    assert lines[0][1] == {"flush": True}, lines[0]


# ── recorded sessions line ─────────────────────────────────────────────────────────────────────────
def test_recorded_sessions_line_is_flushed_with_exact_text(tmp_path, monkeypatch):
    """The recorded sessions line must be flushed with the session list."""
    calls = _spy_prints(monkeypatch)
    sessions = ["20260719010000", "20260720020000"]
    _install(monkeypatch, FakeRing(sessions, BLOB))
    _bound_data_waits(monkeypatch)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "all", 0, None, "0000"))

    lines = _lines_with(calls, f"recorded sessions on flash ({len(sessions)}): {sessions}")
    assert len(lines) == 1, calls
    assert lines[0][1] == {"flush": True}, lines[0]


# ── no sessions found line ──────────────────────────────────────────────────────────────────────────
def test_no_sessions_found_line_is_flushed_with_exact_text(tmp_path, monkeypatch):
    """The no sessions line must be flushed when there are no sessions."""
    calls = _spy_prints(monkeypatch)
    _install(monkeypatch, FakeRing([]))
    _bound_data_waits(monkeypatch)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    lines = _lines_with(calls, "no sessions found — nothing to pull.")
    assert len(lines) == 1, calls
    assert lines[0][1] == {"flush": True}, lines[0]
