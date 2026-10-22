# tepna-capture — tests/test_pull_once_survivors_p3.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-10-22-pull-once-survivors-part-3-of-6`: the survivors in `pull_session._pull_once`
# from the COMMIT recovery branch through the DOWNLOADING ledger row. The diff-scoped mutation gate
# mutates the whole function a PR touches, so these old lines red any PR that enters `_pull_once`.
#
# What these tests read, and why:
#   * The LEDGER ROWS. `inventory.jsonl` is the only record a crashed pull leaves behind. The
#     DISCOVERED, DOWNLOADING and FAILED rows must name the session, the device, the path and the
#     reported size. A dropped field is null in the ledger, and the next run cannot tell why.
#   * The `flush` KEYWORD of the operator lines. The pull runs under systemd, where stdout is a pipe
#     and is block-buffered. Without `flush=True` a line can sit in the buffer until the process
#     exits, so the journal shows nothing while a slow BLE transfer runs. `print` is monkeypatched
#     and the keyword is read off the call, which is the only way to observe it.
#   * The PAUSE after the FILE_END frame on the implausible-size path. `test_pull_once_contract.py`
#     asserts that a 0.3 s pause exists somewhere in a pull; a pull that skips one session has one
#     pause only, so this test can name it.
#
# Every test bounds its FILE_DATA waits (`_bound_data_waits`). A mutant elsewhere in `_pull_once` that
# stops the offset from advancing must FAIL these tests, not hang them: a hang is a mutation-gate
# TIMEOUT, which the gate reports as UNDECIDED and refuses on.
#
# Mutant `file_start_frame(ts, 0)` → `file_start_frame(ts, )` is NOT tested here. `offset` defaults to
# 0 in `oxyii.file_start_frame`, so both calls build the same bytes. It is recorded as equivalent in
# `tools/mutate-equivalence.json` with that argument.

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


def _spy_sleeps(monkeypatch):
    """Record every awaited sleep. Call it AFTER `_install`, which installs its own no-op sleep."""
    seen = []

    async def spy(d, *a, **k):
        seen.append(d)

    monkeypatch.setattr(pull_session.asyncio, "sleep", spy)
    return seen


def _lines_with(calls, needle):
    return [(a, k) for a, k in calls if a and isinstance(a[0], str) and needle in a[0]]


def _rows(tmp_path, ts, state):
    return [r for r in inv.load_rows(str(tmp_path / "inventory.jsonl")) if r["session"] == ts and r["state"] == state]


def _dat_path(tmp_path, ts):
    return os.path.abspath(os.path.join(str(tmp_path), f"Wellue_O2Ring-S_{ts}_STORED.dat"))


# ── COMMIT recovery: recorded, reported, and the walk continues ─────────────────────────────────────
def test_a_commit_recovery_is_flushed_and_does_not_end_the_walk(tmp_path, monkeypatch):
    """The COMMIT branch records a verified file that was never committed. It must then CONTINUE to
    the next session. A `break` there hides every session listed after the recovered one, and the
    caller only sees a shorter list."""
    recovered, fresh = "20260721030000", "20260722040000"
    (tmp_path / f"Wellue_O2Ring-S_{recovered}_STORED.dat").write_bytes(BLOB)
    led = str(tmp_path / "inventory.jsonl")
    inv.append_row(led, inv.make_row(DEV, recovered, inv.DISCOVERED, at=1.0))
    inv.append_row(led, inv.make_row(DEV, recovered, inv.VERIFIED, size=len(BLOB), at=2.0))
    _install(monkeypatch, FakeRing([recovered, fresh], BLOB))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "all", 0, None, "0000"))

    assert got == [_dat_path(tmp_path, recovered), _dat_path(tmp_path, fresh)], got
    lines = _lines_with(calls, f"{recovered}: verified but never committed")
    assert len(lines) == 1, calls
    assert lines[0][1] == {"flush": True}, lines[0]


# ── the happy path's DISCOVERED and DOWNLOADING rows ────────────────────────────────────────────────
def test_the_discovered_and_downloading_rows_name_their_reason_size_and_path(tmp_path, monkeypatch):
    """DISCOVERED points at the final `.dat` path. DOWNLOADING points at the `.part` the bytes land
    in and carries the size the ring reported. A crash during the transfer leaves DOWNLOADING as the
    last row, so it is the row that must say where the partial bytes are and how many were owed."""
    ts = "20260719010000"
    _install(monkeypatch, FakeRing([ts], BLOB))
    _bound_data_waits(monkeypatch)
    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    final = _dat_path(tmp_path, ts)
    (disc,) = _rows(tmp_path, ts, inv.DISCOVERED)
    assert disc["reason"] == "listed on flash", disc
    assert disc["path"] == final, disc
    (down,) = _rows(tmp_path, ts, inv.DOWNLOADING)
    assert down["reason"] == "transfer in flight", down
    assert down["reported_size"] == len(BLOB), down
    assert down["path"] == final + ".part", down
    assert down["size"] is None, "no byte has arrived yet: the received size is absent, never 0"


# ── the operator lines that open a session ──────────────────────────────────────────────────────────
class _LongMetaRing(FakeRing):
    """A ring whose START reply carries more than 16 meta bytes, all distinct. The size line prints
    `meta[:16]`; with only 8 bytes of meta every wider slice prints the same hex."""

    EXTRA = bytes(range(0x30, 0x30 + 20))

    def _reply(self, op, payload):
        if op == oxyii.OP_FILE_START:
            payload = payload + self.EXTRA
        super()._reply(op, payload)


def test_the_session_header_and_size_lines_name_their_values_and_are_flushed(tmp_path, monkeypatch):
    """The header names the session; the size line names the reported size and the first 16 meta
    bytes. Both are flushed, so the journal shows which session is in flight while it is in flight."""
    ts = "20260719010000"
    _install(monkeypatch, _LongMetaRing([ts], BLOB))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)
    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    header = _lines_with(calls, f"session {ts}")
    assert len(header) == 1, calls
    assert header[0][1] == {"flush": True}, header[0]

    meta = len(BLOB).to_bytes(4, "little") + b"\xab\xcd\xef\x12" + _LongMetaRing.EXTRA
    size_lines = _lines_with(calls, f"size = {len(BLOB)} bytes")
    assert len(size_lines) == 1, calls
    (line,), kw = size_lines[0]
    assert f"(meta {meta[:16].hex()})" in line, line
    assert meta[:17].hex() not in line, "the meta excerpt is exactly 16 bytes"
    assert kw == {"flush": True}, size_lines[0]


# ── the implausible-size skip ───────────────────────────────────────────────────────────────────────
def test_an_implausible_size_is_recorded_FAILED_flushed_and_paced(tmp_path, monkeypatch):
    """The FAILED row is the retry policy's input: `failure` is the class it branches on, `reason`
    and `reported_size` tell a human what the ring said. The row has no path and no received size,
    because nothing was written; both are null, never 0. The FILE_END frame that closes the refused
    file is followed by its 0.3 s pause before the next session's START."""
    ts = "20260719010000"
    declared = 60_000_000
    ring = FakeRing([ts], BLOB, declared=declared)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    sleeps = _spy_sleeps(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    assert got == []
    (failed,) = _rows(tmp_path, ts, inv.FAILED)
    assert failed["id"] == inv.identity(DEV, ts), failed
    assert failed["device_id"] == DEV and failed["session"] == ts, failed
    assert failed["reason"] == f"implausible reported size {declared}", failed
    assert failed["reported_size"] == declared, failed
    assert failed["failure"] == "implausible_size", failed
    assert failed["size"] is None and failed["path"] is None, failed

    warn = _lines_with(calls, f"implausible size ({declared})")
    assert len(warn) == 1, calls
    assert warn[0][1] == {"flush": True}, warn[0]

    assert ring.writes[-1] == oxyii.file_end_frame(), "the refused file is closed with FILE_END"
    assert sleeps == [0.5, 0.5, 0.3], "auth and setup pauses, then the FILE_END pause of the skip"
