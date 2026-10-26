# tepna-capture — tests/test_pull_once_survivors_s5.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Survivor batch `pull-once-s5-of-5` (#3855): the last operator-line survivors in
# `pull_session._pull_once`. The diff-scoped mutation gate mutates the whole function a PR touches, so
# these old lines red any PR that enters `_pull_once`.
#
# What these tests read, and why:
#   * The `flush` KEYWORD of four warning lines: the small-MTU warning, the two pre-pass guard skips
#     (an id that escapes the output dir, an id that is not a stamp) and the INCOMPLETE line. The pull
#     runs under systemd, where stdout is a pipe and is block-buffered. Without `flush=True` a warning
#     can sit in the buffer until the process exits, so the journal shows nothing while the slow BLE
#     transfer runs. `print` is monkeypatched and the keyword is read off the call, which is the only
#     way to observe it. `flush=None`, `flush=False` and no keyword at all are all "not flushed".
#   * The TEXT of the INCOMPLETE line. It is the one operator line that says a short pull was kept as a
#     `.part` and was NOT written as a session. A `print(None, ...)` or a bare `print(flush=True)`
#     leaves the journal with no record of the shortfall.
#
# The inputs are the ones that REACH these lines. The two guard lines are reached through
# `which=<specific>` (the LAN webmon /api/pull body), which bypasses `oxyii.parse_file_list`'s stamp
# filter. The INCOMPLETE line is reached by a ring that declares more bytes than it sends: its last
# FILE_DATA reply is empty, so the transfer stops short of `size`.
#
# Every pull bounds its FILE_DATA waits (`_bound_data_waits`). A mutant elsewhere in `_pull_once` that
# stops the offset from advancing must FAIL these tests, not hang them: a hang is a mutation-gate
# TIMEOUT, which the gate reports as UNDECIDED and refuses on.

import asyncio
import builtins
import os

import oxyii
import pull_session

from test_pull_session import FakeRing, _install, _run

ADDR = "D1:98:62:7C:92:B3"
TS = "20260719010000"
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


def _calls_with(calls, needle):
    """Every print call whose first argument is a string that contains `needle`, as (args, kwargs)."""
    return [(a, k) for a, k in calls if a and isinstance(a[0], str) and needle in a[0]]


# ── the small-MTU warning ───────────────────────────────────────────────────────────────────────────
def test_the_small_mtu_warning_is_flushed_with_its_exact_text(tmp_path, monkeypatch):
    """At an MTU below 200 the pull warns before the file transfer that may fail silently. The line
    must reach the journal before that transfer starts, so it is flushed."""
    ring = FakeRing([], b"")
    ring.mtu_size = 23
    _install(monkeypatch, ring)
    calls = _spy_prints(monkeypatch)

    assert _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000")) == []

    warn = _calls_with(calls, "ATT MTU is")
    assert warn == [
        (
            (
                "  ⚠ ATT MTU is 23 (<200) — file transfer (cmd=0xF2) may fail silently; "
                "if the pull times out with 0 bytes, this is why",
            ),
            {"flush": True},
        )
    ], calls


# ── the pre-pass guards ─────────────────────────────────────────────────────────────────────────────
def test_an_escaping_which_is_skipped_with_a_flushed_warning(tmp_path, monkeypatch):
    """A `which` whose resolved path leaves the output dir is dropped by the containment guard. The
    skip names the id and is flushed, so the journal shows why the pull did nothing."""
    escaping = "../" * 40 + "evil"
    _install(monkeypatch, FakeRing([TS], BLOB))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    assert _run(pull_session._pull_once(ADDR, str(tmp_path), escaping, 0, None, "0000")) == []

    warn = _calls_with(calls, "escapes the output dir")
    assert warn == [((f"  ⚠ session id {escaping!r} escapes the output dir — skipping.",), {"flush": True})], calls
    assert not _calls_with(calls, "implausible session id"), "the containment guard skips before the shape guard"


def test_an_implausible_which_is_skipped_with_a_flushed_warning(tmp_path, monkeypatch):
    """A `which` that stays inside the output dir but is not a stamp is dropped by the shape guard. The
    skip names the id and is flushed."""
    _install(monkeypatch, FakeRing([TS], BLOB))
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    assert _run(pull_session._pull_once(ADDR, str(tmp_path), "notadate", 0, None, "0000")) == []

    warn = _calls_with(calls, "implausible session id")
    assert warn == [(("  ⚠ implausible session id 'notadate' — skipping.",), {"flush": True})], calls
    assert not _calls_with(calls, "escapes the output dir"), calls


# ── the INCOMPLETE line ─────────────────────────────────────────────────────────────────────────────
def test_a_transfer_that_ends_short_prints_the_flushed_incomplete_line(tmp_path, monkeypatch):
    """The ring declares 200 B and sends 92. The second FILE_DATA reply is empty, so the transfer stops
    at 92/200. The bytes are kept as `.part`, never committed, and the operator line says exactly that,
    with the counts and the `.part` name, flushed."""
    declared = 200
    ring = FakeRing([TS], BLOB, declared=declared)
    _install(monkeypatch, ring)
    seen = _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    got = _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    assert seen["n"] == 2, seen
    part_name = f"Wellue_O2Ring-S_{TS}_STORED.dat.part"
    assert got == [os.path.abspath(os.path.join(str(tmp_path), part_name))], got
    assert os.path.getsize(tmp_path / part_name) == len(BLOB)
    assert not os.path.exists(tmp_path / f"Wellue_O2Ring-S_{TS}_STORED.dat"), "a short pull is never committed"
    expected = (
        f"  ⚠ INCOMPLETE: {len(BLOB)}/{declared} bytes — kept as {part_name}, "
        f"NOT written as a session. The next pull re-downloads it."
    )
    flagged = [(a, k) for a, k in calls if a and isinstance(a[0], str) and "INCOMPLETE" in a[0]]
    assert flagged == [((expected,), {"flush": True})], calls
    # A mutant that drops or nulls the message still prints SOMETHING flushed: there must be no
    # print call whose message is missing or not a string.
    bare = [c for c in calls if not (c[0] and isinstance(c[0][0], str))]
    assert bare == [], bare
