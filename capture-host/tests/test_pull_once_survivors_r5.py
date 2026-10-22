# tepna-capture — tests/test_pull_once_survivors_r5.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-10-22-pull-once-survivors-r5-of-6`: the survivors in `pull_session._pull_once` on the
# two ledger rows written after the transfer, the CLASSIFY row and the COMMITTED row. The diff-scoped
# mutation gate mutates the whole function a PR touches, so these old lines red any PR that enters
# `_pull_once`.
#
# What these tests read, and why:
#   * The CLASSIFY row (VERIFIED or PARTIAL). It is T4, the verdict on the received bytes, and it is
#     the last row a short pull leaves. It must carry `classify`'s own reason, the received size, the
#     size the ring reported, the content hash and the `.part` path the bytes sit in. A dropped field
#     is null in the ledger, and the next run cannot tell why the file was judged as it was.
#   * The COMMITTED row. It is what makes the next run skip the session, so it must say why it exists,
#     how many bytes the ring owed and the FINAL path the bytes were renamed to.
#
# The received size and the reported size are kept DIFFERENT in every pull here (a short pull, and a
# ring that serves more bytes than it declared), so a row that swapped or dropped one is visible.
# Absence is null, never 0: no assertion below accepts a 0 or "" where a value was measured.
#
# Every test bounds its FILE_DATA waits (`_bound_data_waits`). A mutant elsewhere in `_pull_once` that
# stops the offset from advancing must FAIL these tests, not hang them: a hang is a mutation-gate
# TIMEOUT, which the gate reports as UNDECIDED and refuses on.

import asyncio
import os

import oxy_inventory as inv
import oxyii
import pull_session

from test_pull_session import FakeRing, _install, _run

ADDR = "D1:98:62:7C:92:B3"


def _finalized_blob():
    """A Format-A file whose trailer carries the finalisation sub-magic, so `classify` says VERIFIED."""
    hdr = bytes([0x01, 0x03, 0, 0, 0, 0, 0, 0, 0x04, 0x00])
    trailer = bytearray(48)
    trailer[4:8] = bytes([0x48, 0x12, 0x5A, 0xDA])
    return hdr + bytes([96, 50, 0]) * 60 + bytes(trailer)


def _bound_data_waits(monkeypatch, limit=8):
    """End the transfer with a TimeoutError after `limit` FILE_DATA waits. A pull that should finish
    needs one wait here, so the default bound is never reached on the branch."""
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


def _rows(tmp_path, ts, state):
    return [r for r in inv.load_rows(str(tmp_path / "inventory.jsonl")) if r["session"] == ts and r["state"] == state]


def _dat_path(tmp_path, ts):
    return os.path.abspath(os.path.join(str(tmp_path), f"Wellue_O2Ring-S_{ts}_STORED.dat"))


# ── a complete pull: the CLASSIFY row and the COMMITTED row ─────────────────────────────────────────
def test_a_complete_pull_records_the_classify_and_commit_rows_in_full(tmp_path, monkeypatch):
    """The ring declares fewer bytes than it serves, so the transfer is complete and the received size
    differs from the reported one. The VERIFIED row names `classify`'s reason, both sizes, the hash and
    the `.part`; the COMMITTED row names its own reason, both sizes, the hash and the final path."""
    ts = "20260720020000"
    blob = _finalized_blob()
    declared = len(blob) - 40  # the ring owes fewer bytes than the single chunk it serves
    _install(monkeypatch, FakeRing([ts], blob, declared=declared))
    _bound_data_waits(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    final = _dat_path(tmp_path, ts)
    assert got == [final], got
    sha = inv.sha256_bytes(blob)
    want_state, want_reason = inv.classify(blob, declared, oxyii.parse_oxy_trailer)
    assert (want_state, want_reason) == (inv.VERIFIED, "trailer finalised"), "the fixture must be finalised"

    (verified,) = _rows(tmp_path, ts, inv.VERIFIED)
    assert verified["reason"] == want_reason, verified
    assert verified["size"] == len(blob), verified
    assert verified["reported_size"] == declared, verified
    assert verified["sha256"] == sha, verified
    assert verified["path"] == final + ".part", verified

    (committed,) = _rows(tmp_path, ts, inv.COMMITTED)
    assert committed["reason"] == "atomically committed into the night tree", committed
    assert committed["size"] == len(blob), committed
    assert committed["reported_size"] == declared, committed
    assert committed["sha256"] == sha, committed
    assert committed["path"] == final, committed


# ── a short pull: the CLASSIFY row is the last word ─────────────────────────────────────────────────
def test_a_short_pull_records_a_PARTIAL_row_that_says_how_short_and_where(tmp_path, monkeypatch):
    """The link dies after two chunks. The PARTIAL row is the last row this session gets, so it alone
    tells the next run and a human what arrived: the short reason, 1024 received of the reported size,
    the hash of the received bytes and the `.part` they were kept in. No COMMITTED row is written."""
    ts = "20260724060000"
    blob = b"\x01\x03" + b"p" * 4000
    _install(monkeypatch, FakeRing([ts], blob, chunk=512))
    _bound_data_waits(monkeypatch, limit=2)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    part = _dat_path(tmp_path, ts) + ".part"
    assert got == [part], got
    received = blob[:1024]
    (partial,) = _rows(tmp_path, ts, inv.PARTIAL)
    assert partial["reason"] == f"short: 1024 of {len(blob)} reported bytes", partial
    assert partial["size"] == 1024, partial
    assert partial["reported_size"] == len(blob), partial
    assert partial["sha256"] == inv.sha256_bytes(received), partial
    assert partial["path"] == part, partial
    assert _rows(tmp_path, ts, inv.COMMITTED) == [], "a short pull is never committed"
