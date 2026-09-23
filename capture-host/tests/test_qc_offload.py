# tepna-capture — tests/test_qc_offload.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The night-QC scan runs in a CHILD PROCESS, not a thread. A thread shares the interpreter lock with
every capture task, and `nightqc.summarize` (51 s of pure-Python CPU per poll by dawn, measured on vigil
2026-09-23) held it for 1.1–4.8 s at every poll — every live stream's host stamps gapped in lockstep at
the poll cadence and the monitor's "fragments" column rose for three nodes at once."""

import asyncio
import concurrent.futures
import concurrent.futures.process   # lazily loaded by the package; an xdist worker may not have touched it yet
import os

import pytest

import capture
from tests import _qc_child_target


def test_a_module_level_scan_runs_in_another_process_and_leaves_no_worker_behind():

    async def go():
        first = await capture._qc_offload(_qc_child_target.pid_stamp, "2026-09-22", [{"name": "Ring"}])
        second = await capture._qc_offload(_qc_child_target.pid_stamp, "2026-09-22", [])
        return first, second

    first, second = asyncio.run(go())
    assert first["pid"] != os.getpid(), "the scan ran in THIS process — the lock is still shared"
    assert first["night"] == "2026-09-22" and first["devices"] == [{"name": "Ring"}]
    assert second["pid"] != os.getpid() and second["pid"] != first["pid"], \
        "one pool per scan: each scan gets a fresh worker and the previous one is gone with its working set"
    assert capture._QC_ISOLATION == "process"
    assert not hasattr(capture, "_QC_CHILD"), "no module-level pool — a pool nobody shuts down hung the gate"


def test_a_callable_the_child_could_not_import_runs_on_a_thread_and_says_so(monkeypatch):
    calls = []

    def local_scan(night, devices):          # not importable by name from a spawned child
        calls.append(night)
        return {"pid": os.getpid()}

    out = asyncio.run(capture._qc_offload(local_scan, "n", []))
    assert out["pid"] == os.getpid() and calls == ["n"]
    assert capture._QC_ISOLATION == "thread"
    # a monkeypatched module attribute is the same shape: the module no longer binds the name to it
    assert capture._importable_by_reference(capture.nightqc.summarize) is True
    monkeypatch.setattr(capture.nightqc, "summarize", lambda n, d: {})
    assert capture._importable_by_reference(capture.nightqc.summarize) is False


def test_a_dead_worker_propagates_its_error_and_the_pool_is_still_shut_down(monkeypatch):
    seen = {"shutdown": None}

    class Broken:
        def __init__(self, **kw):
            seen["kw"] = kw

        def submit(self, fn, *args):
            raise concurrent.futures.process.BrokenProcessPool("worker died")

        def shutdown(self, wait=True):
            seen["shutdown"] = wait

    monkeypatch.setattr(capture.concurrent.futures, "ProcessPoolExecutor", Broken)
    with pytest.raises(concurrent.futures.BrokenExecutor):   # a scan that did not run must not read as one that did
        asyncio.run(capture._qc_offload(_qc_child_target.pid_stamp, "n", []))
    assert seen["shutdown"] is False, "the pool is released even when the scan failed"
    assert seen["kw"]["max_workers"] == 1 and seen["kw"]["mp_context"].get_start_method() == "spawn"


def test_the_poller_hands_summarize_to_the_child_and_not_to_a_thread():
    src = open(capture.__file__).read()
    assert 'summ = await _qc_offload(nightqc.summarize, night, cfg.get("devices", []))' in src
    assert "to_thread(nightqc.summarize" not in src
    assert 'summ["isolation"] = _QC_ISOLATION' in src, "the path taken travels on the summary, which is READ"
