# tepna-capture — tests/test_pull_once_survivors_r2.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-10-22-pull-once-survivors-r2-of-6`: survivors in `pull_session._pull_once` from the
# QUARANTINE skip, the COMMIT recovery row, and the resume decision. The diff-scoped mutation gate
# mutates the whole function a PR touches, so these old lines red any PR that enters `_pull_once`.
#
# What these tests read, and why:
#   * The WALK after a quarantined session. A quarantined recording is skipped; a `break` there hides
#     every session listed after it, and the caller sees only a shorter list.
#   * The COMMITTED row that the COMMIT recovery writes. It is the only record that the restart
#     adopted a verified file instead of pulling it again. Its reason, sizes and path must be in the
#     row. A dropped field is null in the ledger, and the next reader cannot tell why.
#   * The resume decision. With no `.part` on disk, a resume has nothing to splice onto, so the pull
#     must serve from 0. The decision must get the size the ring reported, and the seek guard must
#     refuse a plan whose offset is not inside the file.
#
# Every test bounds its FILE_DATA waits (`_bound_data_waits`). A mutant that stops the offset from
# advancing must FAIL these tests, not hang them: a hang is a mutation-gate TIMEOUT, which the gate
# reports as UNDECIDED and refuses on.
#
# Mutant `resumed_from = 0` → `resumed_from = None` is NOT tested here. The only read of the initial
# value is the truthiness test `if complete and resumed_from:`, and 0 and None are both false. It is
# recorded as equivalent in `tools/mutate-equivalence.json` with that argument and its probe.

import asyncio
import builtins
import os

import pytest

import oxy_inventory as inv
import oxy_transfer
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


def _start_offsets(ring):
    """The offset of every FILE_START the ring received, in order (7-byte header, 16-byte stamp, u32)."""
    return [int.from_bytes(w[7:-1][16:20], "little") for w in ring.writes if w[1] == oxyii.OP_FILE_START]


# ── QUARANTINE: skipped, and the walk continues ─────────────────────────────────────────────────────
def test_a_quarantined_session_is_left_alone_and_does_not_end_the_walk(tmp_path, monkeypatch):
    """The quarantined session is listed FIRST, so a `break` cannot pass by having already pulled the
    session after it. The quarantined bytes stay as they are, and the next session is pulled."""
    held, fresh = "20260721030000", "20260722040000"
    drifted = BLOB + b"drift"
    (tmp_path / f"Wellue_O2Ring-S_{held}_STORED.dat").write_bytes(drifted)
    led = str(tmp_path / "inventory.jsonl")
    inv.append_row(led, inv.make_row(DEV, held, inv.DISCOVERED, at=1.0))
    inv.append_row(led, inv.make_row(DEV, held, inv.VERIFIED, size=len(BLOB), at=2.0))
    ring = FakeRing([held, fresh], BLOB)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "all", 0, None, "0000"))

    assert got == [_dat_path(tmp_path, fresh)], got
    assert len(_lines_with(calls, f"{held}: size changed under a verified record")) == 1, calls
    assert (tmp_path / f"Wellue_O2Ring-S_{held}_STORED.dat").read_bytes() == drifted
    assert len(_rows(tmp_path, held, inv.DISCOVERED)) == 1, "the quarantined session is not re-listed"
    assert (tmp_path / f"Wellue_O2Ring-S_{fresh}_STORED.dat").read_bytes() == BLOB


# ── COMMIT recovery: the COMMITTED row names its reason, sizes and path ─────────────────────────────
def test_the_commit_recovery_row_records_its_reason_the_disk_size_and_the_final_path(tmp_path, monkeypatch):
    """The recovered file is a different length from anything the ring serves, so the sizes in the
    row can only come from the file on disk. The ring is never asked for this session's bytes."""
    ts = "20260721030000"
    on_disk = b"\x01\x03" + b"q" * 40
    (tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat").write_bytes(on_disk)
    led = str(tmp_path / "inventory.jsonl")
    inv.append_row(led, inv.make_row(DEV, ts, inv.DISCOVERED, at=1.0))
    inv.append_row(led, inv.make_row(DEV, ts, inv.VERIFIED, size=len(on_disk), at=2.0))
    ring = FakeRing([ts], BLOB)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "all", 0, None, "0000"))

    assert got == [_dat_path(tmp_path, ts)], got
    assert _start_offsets(ring) == [], "a recovered session is not pulled again"
    (row,) = _rows(tmp_path, ts, inv.COMMITTED)
    assert row["id"] == inv.identity(DEV, ts), row
    assert row["reason"] == "verified but never committed — commit recorded on restart", row
    assert row["size"] == len(on_disk), row
    assert row["reported_size"] == len(on_disk), row
    assert row["path"] == _dat_path(tmp_path, ts), row


# ── RESUME: nothing on disk means nothing to resume ─────────────────────────────────────────────────
def test_a_resume_with_no_part_on_disk_serves_the_whole_file_from_zero(tmp_path, monkeypatch):
    """Resume is allowed, but no `.part` exists, so there are 0 bytes to keep. The ring is asked from
    0 only and the recording is committed whole. A non-zero `have` here would seek the ring and then
    read a `.part` that does not exist."""
    ts = "20260719010000"
    ring = FakeRing([ts], BLOB)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 1, None, "0000"))

    assert got == [_dat_path(tmp_path, ts)], got
    assert _start_offsets(ring) == [0], _start_offsets(ring)
    assert (tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat").read_bytes() == BLOB
    assert len(_lines_with(calls, "full serve: no partial bytes on disk")) == 1, calls


@pytest.mark.parametrize("resume", [0, 1])
def test_the_resume_decision_is_given_the_size_the_ring_reported(tmp_path, monkeypatch, resume):
    """A leftover `.part` exactly as long as the declared size is size-complete but unfinalised: the
    trailer never flushed. The decision can only say so if it gets the reported size. Without it the
    operator line names a different reason, and with resume on it claims a resume that never ran."""
    ts = "20260719010000"
    (tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat.part").write_bytes(BLOB)
    ring = FakeRing([ts], BLOB)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", resume, None, "0000"))

    assert got == [_dat_path(tmp_path, ts)], got
    assert _start_offsets(ring) == [0], _start_offsets(ring)
    lines = _lines_with(calls, "full serve: ")
    assert len(lines) == 1, calls
    assert lines[0] == (("  full serve: size-complete but unfinalised — trailer never flushed",), {"flush": True})


# ── RESUME: the seek guard refuses a plan whose offset is not inside the file ───────────────────────
@pytest.mark.parametrize(
    "mode, offset",
    [(oxy_transfer.RESUME, len(BLOB)), (oxy_transfer.RESTART, 10)],
    ids=["resume-at-the-end", "restart-carrying-an-offset"],
)
def test_a_plan_is_honoured_only_as_a_resume_inside_the_file(tmp_path, monkeypatch, mode, offset):
    """`oxy_transfer.resume_strategy` is the one place the choice is made, and the drop test will
    change its body. The guard in `_pull_once` seeks the ring only for a RESUME whose offset lies
    strictly inside the reported size. A RESUME at the end of the file, or a RESTART that carries an
    offset, must serve the whole file from 0."""
    ts = "20260719010000"
    (tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat.part").write_bytes(BLOB[:offset])
    seen = []

    def strategy(have, size, *, allow_resume=False):
        seen.append((have, size, allow_resume))
        return oxy_transfer.Resume(mode, offset, "planted out-of-contract plan")

    monkeypatch.setattr(pull_session.oxy_transfer, "resume_strategy", strategy)
    ring = FakeRing([ts], BLOB)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 1, None, "0000"))

    assert seen == [(offset, len(BLOB), True)], seen
    assert _start_offsets(ring) == [0], _start_offsets(ring)
    assert got == [_dat_path(tmp_path, ts)], got
    assert (tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat").read_bytes() == BLOB
