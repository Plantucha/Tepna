# tepna-capture — tests/test_pull_once_survivors_r1.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-10-22-pull-once-survivors-r1-of-6`: survivors in `pull_session._pull_once` from the
# adapter pin through the lifecycle edges that open a pull. The diff-scoped mutation gate mutates the
# whole function a PR touches, so these old lines red any PR that enters `_pull_once`.
#
# What these tests read, and why:
#   * The KWARGS that reach bleak. With no adapter pin, the scan and the connect get no `bluez` key at
#     all. `{"bluez": {"adapter": None}}` is not "no pin": it hands bleak an explicit null adapter.
#   * The MTU line. A client with no `mtu_size` reports `MTU=?`; it must not raise. The warning is for
#     an MTU strictly below 200, so 200 itself is quiet.
#   * The identity read's TIMEOUT. It is a declared 6 s bound, short on purpose: a ring that does not
#     answer 0xE1 must cost the pull 6 s, not `_wait`'s 20 s default.
#   * The PRE-PASS guards. The source comment names the ring's file list as untrusted input to them, so
#     a hostile id must be skipped and the sessions after it still pulled. `oxyii.parse_file_list`
#     filters ids today; the test replaces it so the guard is reached with a session listed after it.
#   * The PLAN's view of a `.part`. A `.part` beside a VERIFIED-but-uncommitted `.dat` turns the COMMIT
#     recovery into a re-pull. Without `part_files` the plan records a commit for bytes it never checked.
#   * The LIFECYCLE edges. The two transitions that open a pull carry the device id and a named reason;
#     `OXYLIFE.csv` is written from these records and a null there says nothing.
#
# Every pull that moves data bounds its FILE_DATA waits (`_bound_data_waits`), so a mutant that stops
# the offset from advancing FAILS a test rather than hanging it (a hang is a gate TIMEOUT, UNDECIDED).
#
# Two survivors of this share are NOT tested here; they are recorded as equivalent in
# `tools/mutate-equivalence.json` with their argument and probe:
#   * `identity = None` -> `identity = ""`: every reader is `if identity:` or `(identity or {})`, and
#     `None` and `""` are both falsy.
#   * `part_files[ident] = os.path.getsize(part)` -> `= None`: `oxy_restart.plan` reads the KEYS of
#     `part_files` only (`for ident in part_files`, `sorted(part_files)`), never a value.

import asyncio
import builtins
import os

import oxy_inventory as inv
import oxy_lifecycle
import oxyii
import pull_session

from test_pull_session import DEV, FakeDevice, FakeRing, _install, _run

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
    return [a[0] for a, _k in calls if a and isinstance(a[0], str) and needle in a[0]]


def _dat_path(tmp_path, ts):
    return os.path.abspath(os.path.join(str(tmp_path), f"Wellue_O2Ring-S_{ts}_STORED.dat"))


# ── the adapter pin ─────────────────────────────────────────────────────────────────────────────────
def test_no_adapter_pin_sends_no_bluez_kwarg_to_the_scan_or_the_connect(tmp_path, monkeypatch):
    """`adapter=None` is "use the default radio". The scan and the connect must then carry no `bluez`
    key: `{"bluez": {"adapter": None}}` is an explicit null adapter, which is a different request."""
    seen = {}
    ring = FakeRing([], b"")

    async def find(predicate, *a, **k):
        seen["scan"] = k
        return FakeDevice()

    def client(dev, **kw):
        seen["client"] = kw
        return ring

    _install(monkeypatch, ring)
    monkeypatch.setattr(pull_session.BleakScanner, "find_device_by_filter", find)
    monkeypatch.setattr(pull_session, "BleakClient", client)

    assert _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000")) == []
    assert seen["scan"] == {"timeout": 25}, seen["scan"]
    assert seen["client"] == {"timeout": 30.0}, seen["client"]


# ── the MTU report ──────────────────────────────────────────────────────────────────────────────────
def test_a_client_with_no_mtu_size_reports_an_unknown_mtu_and_does_not_raise(tmp_path, monkeypatch):
    """A backend that exposes no `mtu_size` yields `MTU=?`. The MTU is reporting only; a missing
    attribute must never fail the pull."""
    ring = FakeRing([], b"")
    del ring.mtu_size
    _install(monkeypatch, ring)
    calls = _spy_prints(monkeypatch)

    assert _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000")) == []
    assert _lines_with(calls, "connected · MTU=? (post-acquire)"), calls
    assert not _lines_with(calls, "ATT MTU is"), "an unknown MTU is not a small one"


def test_the_small_mtu_warning_is_strictly_below_200(tmp_path, monkeypatch):
    """The bound is `< 200`: 199 warns, 200 does not."""
    for mtu, warns in ((199, True), (200, False)):
        ring = FakeRing([], b"")
        ring.mtu_size = mtu
        _install(monkeypatch, ring)
        calls = _spy_prints(monkeypatch)
        _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))
        assert bool(_lines_with(calls, f"ATT MTU is {mtu} (<200)")) is warns, (mtu, calls)
        assert _lines_with(calls, f"connected · MTU={mtu} (post-acquire)"), calls


# ── the identity read's bound ───────────────────────────────────────────────────────────────────────
def test_the_identity_read_waits_its_declared_six_seconds(tmp_path, monkeypatch):
    """The 0xE1 read is a nice-to-have and must never hold the pull for long: its bound is 6 s, not
    `_wait`'s 20 s default and not any other number."""
    ring = FakeRing([], b"")
    _install(monkeypatch, ring)
    real_wait = pull_session._wait
    waits = []

    async def spy(q, op, timeout=20.0):
        waits.append((op, timeout))
        return await real_wait(q, op, timeout=timeout)

    monkeypatch.setattr(pull_session, "_wait", spy)
    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))
    assert [t for op, t in waits if op == oxyii.OP_GET_INFO] == [6.0], waits


# ── the pre-pass guards skip ONE id and keep walking ────────────────────────────────────────────────
def test_a_hostile_listed_id_is_skipped_and_the_sessions_after_it_are_still_pulled(tmp_path, monkeypatch):
    """The guards drop an id that escapes the output dir or is not a stamp. They drop THAT id only: a
    `break` would hide every session listed after it, and the caller would see a shorter list with no
    error. The parser is replaced so the hostile ids reach the guards ahead of a real stamp."""
    good = "20260719010000"
    escaping, implausible = "/../../escape", "notastamp"
    monkeypatch.setattr(oxyii, "parse_file_list", lambda payload: [escaping, implausible, good])
    _install(monkeypatch, FakeRing([good], BLOB))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "all", 0, None, "0000"))

    assert got == [_dat_path(tmp_path, good)], got
    assert len(_lines_with(calls, f"session id {escaping!r} escapes the output dir")) == 1, calls
    assert len(_lines_with(calls, f"implausible session id {implausible!r}")) == 1, calls
    sessions = {r["session"] for r in inv.load_rows(str(tmp_path / "inventory.jsonl"))}
    assert sessions == {good}, "a skipped id never reaches the ledger"


def test_an_implausible_id_ahead_of_a_good_one_does_not_end_the_walk(tmp_path, monkeypatch):
    """The stamp-shape guard alone, with no escaping id in front of it."""
    good = "20260719010000"
    monkeypatch.setattr(oxyii, "parse_file_list", lambda payload: ["12345", good])
    _install(monkeypatch, FakeRing([good], BLOB))
    _bound_data_waits(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "all", 0, None, "0000"))
    assert got == [_dat_path(tmp_path, good)], got


# ── the plan sees the leftover .part ────────────────────────────────────────────────────────────────
def test_a_part_beside_a_verified_dat_forces_a_repull_not_a_commit(tmp_path, monkeypatch):
    """A VERIFIED row with a matching `.dat` alone is the COMMIT recovery. A `.part` beside it means a
    later transfer of the same session began and did not finish, and `oxy_restart.plan` turns that into
    a RE-PULL. The pull must hand the plan its `.part` map, or it records COMMITTED for bytes that
    nothing re-checked."""
    ts = "20260721030000"
    dat = tmp_path / f"Wellue_O2Ring-S_{ts}_STORED.dat"
    dat.write_bytes(BLOB)
    (tmp_path / (dat.name + ".part")).write_bytes(BLOB[:10])
    led = str(tmp_path / "inventory.jsonl")
    inv.append_row(led, inv.make_row(DEV, ts, inv.DISCOVERED, at=1.0))
    inv.append_row(led, inv.make_row(DEV, ts, inv.VERIFIED, size=len(BLOB), at=2.0))
    ring = FakeRing([ts], BLOB)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "all", 0, None, "0000"))

    rows = [r for r in inv.load_rows(led) if r["session"] == ts]
    assert not [r for r in rows if r.get("reason") == "verified but never committed — commit recorded on restart"], rows
    assert not _lines_with(calls, "commit recorded (no re-pull)"), calls
    assert [r for r in rows if r["state"] == inv.DOWNLOADING], "the session was re-pulled"
    assert any(w[1] == oxyii.OP_FILE_START for w in ring.writes), "a FILE_START was sent for it"


# ── the lifecycle edges that open a pull ────────────────────────────────────────────────────────────
def test_the_opening_lifecycle_edges_carry_the_device_id_and_their_reasons(tmp_path, monkeypatch):
    """NOT_SEEN -> PAUSED_FOR_PULL -> PULLING. Each record names the ring (the identity read's serial)
    and says why the edge was taken."""
    ts = "20260719010000"
    _install(monkeypatch, FakeRing([ts], BLOB))
    _bound_data_waits(monkeypatch)
    life = oxy_lifecycle.OxyLifecycle()

    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000", lifecycle=life))

    first, second = life.history[0], life.history[1]
    assert (first.new, second.new) == (oxy_lifecycle.OxyState.PAUSED_FOR_PULL, oxy_lifecycle.OxyState.PULLING)
    assert first.reason == "stored-session pull owns the link", first
    assert second.reason == "autopull: reading stored recordings off flash", second
    assert first.device_id == DEV and second.device_id == DEV, (first, second)
    assert life.device_id == DEV
