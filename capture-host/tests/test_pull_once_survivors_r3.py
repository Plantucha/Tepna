# tepna-capture — tests/test_pull_once_survivors_r3.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-10-22-pull-once-survivors-r3-of-6`: the survivors in `pull_session._pull_once` on the
# RESUME path — the seek guard, the unanswered-seek fallback, the prefix read, the verification of a
# resumed file and the ledger row that records its rejection. The diff-scoped mutation gate mutates the
# whole function a PR touches, so these old lines red any PR that enters `_pull_once`.
#
# What these tests read, and why:
#   * The START OFFSETS the ring receives. A seek the caller should not send, or one it fails to send,
#     is visible only on the wire: `FakeRing` honours the offset, so the bytes that follow come from
#     wherever the ring was told to go.
#   * The COMMITTED BYTES. A wrong prefix read or a missing seek splices the file; the splice is
#     visible only as bytes that differ from the ring's session.
#   * The CALLER'S OWN RANGE CHECK on the plan. `_pull_once` re-checks `0 < offset < size` against the
#     size the ring reported, and does not act on a plan that check rejects. The real strategy never
#     returns such a plan today, which is why no other test can see the check. The drop test is meant
#     to flip `resume_strategy`'s body (brief §5), so these tests stub that one function and hold the
#     caller to its half of the contract.
#
# Every test bounds its FILE_DATA waits (`_bound_data_waits`). A mutant that stops the offset from
# advancing must FAIL these tests, not hang them: a hang is a mutation-gate TIMEOUT, which the gate
# reports as UNDECIDED and refuses on.
#
# FOUR survivors are NOT tested here, because no input can reach a difference. They are recorded in
# `tools/mutate-equivalence.json` with the argument and a probe:
#   * the fallback `Resume(RESTART, 0, ...)` with its mode replaced by None, or its offset by None or 1.
#     The fallback plan's mode and offset are read only by the second guard, whose first operand is
#     False for RESTART and for None alike, and `and` never reads the offset after a False.
#   * `data += fh.read(...)` replaced by `data = fh.read(...)`. `data` is the empty buffer built a few
#     lines above, and nothing is appended to it before this line.

import asyncio
import builtins
import os

import oxy_inventory as inv
import oxy_transfer
import oxyii
import pull_session

from test_oxyii import _fmt_a_file
from test_pull_session import DEV, FakeRing, _install, _run

ADDR = "D1:98:62:7C:92:B3"
TS = "20260720010000"


def _blob(n=900):
    """A real Format-A file with position-dependent records, so a splice changes the bytes."""
    return _fmt_a_file([(96, 50 + (i % 7), i % 3) for i in range(n)])


def _bound_data_waits(monkeypatch, limit=12):
    """End the transfer with a TimeoutError after `limit` FILE_DATA waits. Every pull in this file
    needs at most four on the branch, so the bound is never reached there."""
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


def _start_offsets(ring):
    return [int.from_bytes(w[7:-1][16:20], "little") for w in ring.writes if w[1] == oxyii.OP_FILE_START]


def _dat(tmp_path):
    return tmp_path / f"Wellue_O2Ring-S_{TS}_STORED.dat"


def _part(tmp_path):
    return tmp_path / f"Wellue_O2Ring-S_{TS}_STORED.dat.part"


def _failed_rows(tmp_path):
    return [r for r in inv.load_rows(str(tmp_path / "inventory.jsonl")) if r["state"] == inv.FAILED]


def _pull(tmp_path, resume=True):
    return _run(pull_session._pull_once(ADDR, str(tmp_path), "all", resume, None, "0000"))


# ── a ONE-BYTE prefix is a resume like any other ────────────────────────────────────────────────────
def test_a_one_byte_part_seeks_the_ring_to_one_and_resumes_byte_identically(tmp_path, monkeypatch):
    """Offset 1 is the smallest legal resume point, so it is the input that separates `0 < offset`
    from `1 < offset` in both guards. If the seek guard rejects it, the ring serves from 0 and the
    pull splices the ring's first byte after the prefix. If the read guard rejects it, the ring is
    seeked to 1 and the local prefix is never read, so the file is one byte short."""
    blob = _blob()
    _part(tmp_path).write_bytes(blob[:1])
    ring = FakeRing([TS], blob)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)

    got = _pull(tmp_path)

    assert _start_offsets(ring) == [0, 1], _start_offsets(ring)
    assert got == [os.path.abspath(str(_dat(tmp_path)))], got
    assert _dat(tmp_path).read_bytes() == blob, "a resumed file must be the ring's session, byte for byte"


# ── the caller re-checks the plan against the size the ring reported ────────────────────────────────
def _at_zero(size):
    return oxy_transfer.Resume(oxy_transfer.RESUME, 0, "stub: resume at zero")


def _at_size(size):
    return oxy_transfer.Resume(oxy_transfer.RESUME, size, "stub: resume at the reported size")


def _restart_mid_file(size):
    return oxy_transfer.Resume(oxy_transfer.RESTART, 512, "stub: restart carrying an offset")


def _assert_a_plain_full_serve(tmp_path, monkeypatch, make_plan):
    blob = _blob()
    ring = FakeRing([TS], blob)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    seen = {}

    def stub(have, size, *, allow_resume=False):
        seen["plan"] = make_plan(size)
        return seen["plan"]

    monkeypatch.setattr(oxy_transfer, "resume_strategy", stub)
    calls = _spy_prints(monkeypatch)

    _pull(tmp_path)

    assert _start_offsets(ring) == [0], f"the ring must only be asked from 0, got {_start_offsets(ring)}"
    assert _dat(tmp_path).read_bytes() == blob, "a refused plan must leave an ordinary full serve"
    full = [(a, k) for a, k in calls if a and a[0] == f"  full serve: {seen['plan'].reason}"]
    assert full == [((f"  full serve: {seen['plan'].reason}",), {"flush": True})], calls


def test_a_resume_plan_at_offset_zero_is_served_from_zero_without_a_seek(tmp_path, monkeypatch):
    """A RESUME at 0 resumes nothing. The caller must not send a second START for it, and must not
    open a `.part` to read zero bytes from it (here there is no `.part`, so a read would raise)."""
    _assert_a_plain_full_serve(tmp_path, monkeypatch, _at_zero)


def test_a_resume_plan_at_the_reported_size_is_served_from_zero_without_a_seek(tmp_path, monkeypatch):
    """A RESUME at the reported size would seek the ring to its end-of-file and read a whole `.part`
    as the recording. The caller must refuse it and re-serve the file."""
    _assert_a_plain_full_serve(tmp_path, monkeypatch, _at_size)


def test_a_restart_plan_that_carries_an_offset_still_restarts(tmp_path, monkeypatch):
    """The MODE decides. A RESTART whose offset happens to lie inside the file is still a restart:
    the caller must not read a prefix for it, and it never sent a seek for it either."""
    _assert_a_plain_full_serve(tmp_path, monkeypatch, _restart_mid_file)


# ── the prefix read takes EXACTLY `offset` bytes ────────────────────────────────────────────────────
def test_the_prefix_read_stops_at_the_resume_point_even_when_the_part_is_longer(tmp_path, monkeypatch):
    """The comment at the read says it: read exactly `offset` bytes, never the whole file. The real
    strategy resumes at the `.part`'s own size, so no other test has a `.part` longer than the resume
    point. A strategy that resumes at an earlier boundary is the case the rule exists for: the stale
    tail must not reach the recording."""
    blob = _blob()
    _part(tmp_path).write_bytes(blob[:1024] + b"\x99" * 500)
    ring = FakeRing([TS], blob)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    monkeypatch.setattr(
        oxy_transfer,
        "resume_strategy",
        lambda have, size, *, allow_resume=False: oxy_transfer.Resume(oxy_transfer.RESUME, 1024, "stub"),
    )

    _pull(tmp_path)

    assert _start_offsets(ring) == [0, 1024], _start_offsets(ring)
    assert _dat(tmp_path).read_bytes() == blob, "the stale tail of the .part reached the recording"


# ── a resumed file is verified against the size the ring REPORTED ───────────────────────────────────
def test_a_resumed_file_longer_than_the_reported_size_is_rejected_not_committed(tmp_path, monkeypatch):
    """The ring here reports 3 bytes fewer than it then sends. The received bytes are a whole,
    finalised Format-A file, so the trailer and the record walk both pass. Only the size layer of
    `verify` can see that the file is not the one the ring declared, and it can see it only when it
    is given the reported size."""
    blob = _blob()
    declared = len(blob) - 3
    _part(tmp_path).write_bytes(blob[:1024])
    ring = FakeRing([TS], blob, declared=declared, chunk=2048)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)

    got = _pull(tmp_path)

    assert _start_offsets(ring) == [0, 1024], _start_offsets(ring)
    assert got == [], got
    assert not _dat(tmp_path).exists(), "a file the ring did not declare must never be committed"
    (row,) = _failed_rows(tmp_path)
    assert row["reason"] == f"resume rejected: size {len(blob)} B != reported {declared} B", row


def test_the_rejection_row_names_the_device_session_size_and_part(tmp_path, monkeypatch):
    """A rejected resume deletes its `.part`, so the FAILED row is the only trace it leaves. The row
    must carry the identity the ledger keys on — device and session — or `current()` files it under
    another recording, and the next pass cannot see that this one was rejected."""
    blob = _blob()
    part = _part(tmp_path)
    part.write_bytes(b"\xff" * 1024)  # right length, wrong bytes
    _install(monkeypatch, FakeRing([TS], blob))
    _bound_data_waits(monkeypatch)

    _pull(tmp_path)

    (row,) = _failed_rows(tmp_path)
    assert row["device_id"] == DEV, row
    assert row["session"] == TS, row
    assert row["id"] == inv.identity(DEV, TS), row
    assert row["reported_size"] == len(blob), row
    assert row["path"] == os.path.abspath(str(part)), row
    assert row["reason"].startswith("resume rejected: "), row


# ── the unanswered-seek fallback says why it re-serves ──────────────────────────────────────────────
def test_an_unanswered_seek_reports_its_own_reason_on_the_full_serve_line(tmp_path, monkeypatch):
    """The fallback replaces the plan, so the full-serve line prints the FALLBACK's reason. That line
    is the only place the journal says the ring ignored the seek; a plan without a reason prints
    `None` there."""
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

    _pull(tmp_path)

    assert refused, "the test never reached the unanswered-seek fallback"
    assert _start_offsets(ring) == [0, 1024, 0], _start_offsets(ring)
    full = [(a, k) for a, k in calls if a and isinstance(a[0], str) and a[0].startswith("  full serve:")]
    assert full == [(("  full serve: resume START unanswered",), {"flush": True})], full
