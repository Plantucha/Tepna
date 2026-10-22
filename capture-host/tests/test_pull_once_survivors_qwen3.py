# tepna-capture — tests/test_pull_once_survivors_qwen.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Residue `2026-10-22-pull-once-survivors-qwen`: the survivors in `pull_session._pull_once`
# from the timeout print through the incomplete-save print. The diff-scoped mutation gate
# mutates the whole function a PR touches, so these old lines red any PR that enters `_pull_once`.
#
# What these tests read, and why:
#   * The EXACT TEXT of the operator lines. A mutant that changes the wording hides a defect
#     from a human operator who does not know the new phrasing is machine-generated.
#   * The `flush` KEYWORD of the operator lines. The pull runs under systemd, where stdout is a pipe
#     and is block-buffered. Without `flush=True` a line can sit in the buffer until the process
#     exits, so the journal shows nothing while a slow BLE transfer runs. `print` is monkeypatched
#     and the keyword is read off the call, which is the only way to observe it.
#   * The PAUSE after the FILE_END frame on the resume-START timeout path. `test_pull_once_contract.py`
#     asserts that a 0.3 s pause exists somewhere in a pull; a pull that skips one session has one
#     pause only, so this test can name it.
#
# Every test bounds its FILE_DATA waits (`_bound_data_waits`). A mutant elsewhere in `_pull_once` that
# stops the offset from advancing must FAIL these tests, not hang them: a hang is a mutation-gate
# TIMEOUT, which the gate reports as UNDECIDED and refuses on.

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


# ── timeout at offset N/N ──────────────────────────────────────────────────────────────────────────


# ── the N/N (NN%) progress line ──────────────────────────────────────────────────────────────────────


# ── resume START timeout: discard, re-serve, and pace ─────────────────────────────────────────────


# ── resume verification failure: discard, flush, and re-serve ────────────────────────────────────────
def test_resume_verification_failure_discards_flushes_and_restarts(tmp_path, monkeypatch):
    """A resumed file that fails verification discards the .part and re-serves from 0. The discard
    line must be flushed so the operator sees why the file vanished."""
    ts = "20260719010000"
    part = _dat_path(tmp_path, ts) + ".part"
    with open(part, "wb") as f:
        f.write(b"bad")  # not a valid oxy recording → verify() fails
    led = str(tmp_path / "inventory.jsonl")
    inv.append_row(led, inv.make_row(DEV, ts, inv.PARTIAL, size=3, path=part))
    ring = FakeRing([ts], BLOB)
    ring.answer_info = False  # skip the 6 s timeout — not what is being tested
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", True, None, "0000"))

    discard = _lines_with(calls, "resumed file failed verification")
    assert len(discard) == 1, calls
    assert discard[0][1] == {"flush": True}, discard[0]
    assert not os.path.exists(part), "the bad .part must be discarded on a verification failure"

    (failed,) = _rows(tmp_path, ts, inv.FAILED)
    assert failed["reason"].startswith("resume rejected:"), failed


# ── incomplete save: flush and explain ──────────────────────────────────────────────────────────────


# ── acquisition-evidence envelope failure: flush and proceed ─────────────────────────────────────────


# ── saved/partial line: flush and exact text ─────────────────────────────────────────────────────────
def test_saved_line_is_flushed_with_exact_text(tmp_path, monkeypatch):
    """The final line names whether the pull was complete (`saved`) or not (`partial`), the byte
    count, and the path. It must be flushed so the journal shows the outcome."""
    ts = "20260719010000"
    ring = FakeRing([ts], BLOB)
    _install(monkeypatch, ring)
    _bound_data_waits(monkeypatch)
    calls = _spy_prints(monkeypatch)

    _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000"))

    done = _lines_with(calls, "saved")
    assert len(done) == 1, calls
    line, kw = done[0]
    assert "saved" in line[0], line
    assert f"{len(BLOB)} bytes" in line[0], line
    assert kw == {"flush": True}, done[0]
