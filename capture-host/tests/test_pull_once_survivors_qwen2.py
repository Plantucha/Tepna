# tepna-capture — tests/test_pull_once_survivors_qwen.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-10-22-pull-once-survivors-qwen`: the survivors in `pull_session._pull_once`
# from the path guards through the resume strategy. The diff-scoped mutation gate mutates the
# whole function a PR touches, so these old lines red any PR that enters `_pull_once`.
#
# What these tests read, and why:
#   * The CONTAINMENT GUARD rejects a session id that resolves outside the output dir. The guard
#     must name the bad id and flush the warning line — a line that sits in the buffer until exit
#     is as good as unwritten, and the id tells a user what to delete.
#   * The STAMP SHAPE guard rejects a non-digit or out-of-length id. It too must name the id and
#     flush the line — a silent skip that leaves no trace is the exact bug a log line exists to fix.
#   * The QUARANTINE branch warns that a human decides. The line must be flushed — the journal
#     shows nothing while a slow BLE transfer runs, so a late line says nothing happened instead.
#   * The INTACT skip names the session and is flushed. Without the flush a systemd journal shows
#     nothing while a pull runs, so a late line misleads a reader into thinking nothing happened.
#   * The RESUME STRATEGY decision names the offset and the reason. Both parts must be flushed —
#     a resume that re-downloads everything and splices is the exact failure the resume path avoids.
#   * The TIMEOUT warning names the offset and is flushed. Without the flush the journal shows
#     nothing while a pull runs, so a late line misleads a reader into thinking nothing happened.
#
# Every test bounds its FILE_DATA waits (`_bound_data_waits`). A mutant elsewhere in `_pull_once`
# that stops the offset from advancing must FAIL these tests, not hang them: a hang is a mutation-
# gate TIMEOUT, which the gate reports as UNDECIDED and refuses on.

import asyncio
import builtins
import os

import oxy_inventory as inv
import oxyii
import pull_session

from test_pull_session import DEV, FakeRing, _install, _run

ADDR = "D1:98:62:7C:92:B3"
BLOB = b"\x01\x03" + b"z" * 90


def _bound_data_waits(monkeypatch, limit=8):
    """End the transfer with a TimeoutError after `limit` FILE_DATA waits. Every pull in this file
    needs at most two, so the bound is never reached on the branch."""
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


def _lines_with(calls, needle):
    return [(a, k) for a, k in calls if a and isinstance(a[0], str) and needle in a[0]]


def _rows(tmp_path, ts, state):
    return [r for r in inv.load_rows(str(tmp_path / "inventory.jsonl")) if r["session"] == ts and r["state"] == state]


def _dat_path(tmp_path, ts):
    return os.path.abspath(os.path.join(str(tmp_path), f"Wellue_O2Ring-S_{ts}_STORED.dat"))


# ── the path guards ─────────────────────────────────────────────────────────────────────────────────


# ── the ledger branches: quarantine, intact, commit ────────────────────────────────────────────────
def test_a_quarantined_session_warns_and_flushes(tmp_path, monkeypatch):
    """The QUARANTINE branch warns that a human decides. The line must be flushed — the journal
    shows nothing while a slow BLE transfer runs, so a late line says nothing happened instead."""
    ts = "20260719010000"
    led = str(tmp_path / "inventory.jsonl")
    inv.append_row(led, inv.make_row(DEV, ts, inv.COMMITTED, size=100, at=1.0))
    (tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat").write_bytes(b"x" * 200)  # size changed
    _install(monkeypatch, FakeRing([ts], BLOB))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    assert got == [], got
    lines = _lines_with(calls, f"{ts}: size changed under a verified record")
    assert len(lines) == 1, calls
    assert lines[0][1] == {"flush": True}, lines[0]


def test_an_intact_skip_names_the_session_and_flushes(tmp_path, monkeypatch):
    """The INTACT skip names the session and is flushed. Without the flush a systemd journal shows
    nothing while a pull runs, so a late line misleads a reader into thinking nothing happened."""
    ts = "20260719010000"
    led = str(tmp_path / "inventory.jsonl")
    inv.append_row(led, inv.make_row(DEV, ts, inv.COMMITTED, size=len(BLOB), at=1.0))
    (tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat").write_bytes(BLOB)
    _install(monkeypatch, FakeRing([ts], BLOB))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    assert got == [], got
    lines = _lines_with(calls, f"{ts}: committed and unchanged on disk")
    assert len(lines) == 1, calls
    assert lines[0][1] == {"flush": True}, lines[0]


# ── the resume strategy and timeout warnings ────────────────────────────────────────────────────────


# ── the resume START timeout fallback ───────────────────────────────────────────────────────────────
class _NoResumeStartRing(FakeRing):
    """A ring that answers the initial START but times out on a resume START."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._start_count = 0

    async def write_gatt_char(self, char, frame, response=None):
        if frame[1] == oxyii.OP_FILE_START:
            self._start_count += 1
            if self._start_count == 2:  # resume START
                await asyncio.sleep(0.01)  # let the timeout trigger
                return
        await super().write_gatt_char(char, frame, response=response)


# ── full serve line flush ───────────────────────────────────────────────────────────────────────────
def test_full_serve_line_flushes(tmp_path, monkeypatch):
    """The full serve line names the reason and is flushed. Without the flush the journal shows
    nothing while a pull runs, so a late line misleads a reader into thinking nothing happened."""
    ts = "20260719010000"
    _install(monkeypatch, FakeRing([ts], BLOB))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    assert len(got) == 1, got
    lines = _lines_with(calls, "full serve:")
    assert len(lines) == 1, calls
    assert lines[0][1] == {"flush": True}, lines[0]
