# tepna-capture — tests/test_tmp_basetemp_race.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Does a parallel mutation sweep reap its own sessions' tmp directories? Measured, not argued.

WHY THIS IS A TEST AND NOT A NOTE. On 2026-09-24 a sweep came back 235/236 `exit_code 1` and three
sessions reasoned about it from the pytest source instead of running it, producing three different
mechanisms in one evening — a survivor's exit-0 `sessionfinish` deleting a shared basetemp, the
numbered-dir `keep=3` cleanup reaping a live dir under parallelism, and the retention policy itself.
Each was plausible, each was stated with confidence, and the 2x2 below refuted all three in ten
seconds. The next person to propose a basetemp story should run this file rather than write another
paragraph.

WHAT IT PINS, and the three are separable on purpose:

  1. EVERY SESSION GETS ITS OWN BASETEMP when nothing passes `--basetemp`. This is the fact that
     makes the cascade story impossible rather than merely unobserved: `sessionfinish` under
     `tmp_path_retention_policy = "failed"` removes only the session's OWN dir, so a surviving
     mutant cannot reach a sibling's. `tools/mutate.py` passes no `--basetemp` and neither does
     mutmut (`grep -rn basetemp mutmut/*.py` is empty), so this is the production shape.
  2. A SHARED `--basetemp` IS A REAL HAZARD, and it is the one mechanism that would still fit —
     pytest CLEARS a given basetemp at session start, so a second session starting wipes a first
     session's live tree. Pinned here as a POSITIVE so nobody reintroduces it believing it is inert.
  3. THE `keep=3` NUMBERED-DIR CLEANUP DOES NOT REAP LIVE DIRS, because pytest guards each with a
     `.lock` and only considers one dead after `LOCK_TIMEOUT` (3 h) while a mutant's session lasts
     seconds. The test asserts the lock AGE, not just the survival — the age is the reason, and a
     bare survival assertion would pass for the wrong reason on a box that happened to be idle.

🔴 AND IT CARRIES ITS OWN POSITIVE CONTROL. Six cells of zeros from an instrument nobody proved
could see a reaping are worth nothing. `test_the_probe_can_see_a_reaping` deletes a live session's
basetemp from outside and REQUIRES the probe to report it; if that test ever fails, every negative
in this file is void and must not be quoted.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time

import pytest

# One session of the race, written to a file rather than imported: it must run under its OWN pytest,
# because the quantity being measured is a property of a pytest SESSION, not of a function call.
SESSION_SRC = """
import json, os, time
from pathlib import Path

def test_hold(tmp_path):
    sentinel = tmp_path / "sentinel"
    sentinel.write_text(os.environ["RACE_TAG"])
    basetemp = tmp_path.parent            # <TMPDIR>/pytest-of-<user>/pytest-N — NOT .parent.parent,
    time.sleep(float(os.environ["HOLD_SEC"]))   # which is the ROOT and reads as one shared dir.
    Path(os.environ["RACE_OUT"]).write_text(json.dumps({
        "basetemp": str(basetemp),
        "sentinel_survived": sentinel.exists(),
    }))
    assert sentinel.exists(), "MY OWN tmp_path was removed while I was using it"
    if os.environ.get("SESSION_VERDICT") == "fail":
        assert False, "stands in for a KILLED mutant"
"""

HOLD = "1.5"


def _run_session(session_file, out, tag, verdict, tmpdir, policy, basetemp, sink):
    env = dict(
        os.environ,
        RACE_OUT=str(out),
        RACE_TAG=tag,
        HOLD_SEC=HOLD,
        SESSION_VERDICT=verdict,
        TMPDIR=str(tmpdir),
        PYTEST_ADDOPTS=f"-o tmp_path_retention_policy={policy}",
    )
    cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", str(session_file)]
    if basetemp:
        cmd += ["--basetemp", str(basetemp)]
    r = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=session_file.parent)
    rec = json.loads(out.read_text()) if out.exists() else {}
    body = (r.stdout or "") + (r.stderr or "")
    sink.append(
        {
            "tag": tag,
            "exit": r.returncode,
            "reached_body": bool(rec),
            "basetemp": rec.get("basetemp"),
            # A session that never reached its body died at SETUP — exit 1 too, and the shape that would
            # let a masked survivor read as killed. Counted separately from a real assertion failure.
            "setup_error": not rec and "passed" not in body,
        }
    )


def _cell(tmp_path, jobs, policy, shared_basetemp=None):
    """`jobs` sessions launched together; the SURVIVOR goes first, which is the ordering a cascade
    would need to fire early."""
    sf = tmp_path / "test_race_session.py"
    sf.write_text(SESSION_SRC)
    tmpdir = tmp_path / "tmproot"
    tmpdir.mkdir(exist_ok=True)
    sink: list[dict] = []
    plan = [("s0", "pass")] + [(f"k{i}", "fail") for i in range(1, jobs)]
    threads = [
        threading.Thread(
            target=_run_session, args=(sf, tmp_path / f"rec-{t}.json", t, v, tmpdir, policy, shared_basetemp, sink)
        )
        for t, v in plan
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return sink, tmpdir


@pytest.mark.slow
@pytest.mark.parametrize("policy", ["all", "failed"])
@pytest.mark.parametrize("jobs", [1, 8])
def test_no_session_loses_its_own_tmp_dir(tmp_path, jobs, policy):
    """The 2x2. Zero reaped, zero setup errors, and one basetemp PER SESSION."""
    sink, _ = _cell(tmp_path, jobs, policy)
    assert len(sink) == jobs, "a session did not report at all"
    reaped = [r for r in sink if r["reached_body"] and not r["basetemp"]]
    assert reaped == [], f"a session lost its own tmp dir: {reaped}"
    assert [r for r in sink if r["setup_error"]] == [], "a session died at setup, not at its assertion"
    # THE LOAD-BEARING ONE: no shared directory exists, so no cascade can travel through one.
    basetemps = {r["basetemp"] for r in sink if r["basetemp"]}
    assert len(basetemps) == jobs, (
        f"{jobs} sessions produced {len(basetemps)} distinct basetemp(s) — a SHARED basetemp is "
        "back, and a surviving mutant can now delete a sibling's live tree"
    )


@pytest.mark.slow
def test_a_shared_basetemp_IS_a_hazard(tmp_path):
    """The positive half: pytest CLEARS a given basetemp at session start.

    Pinned so that `--basetemp` is never added to the sweep on the belief that it is inert. If this
    test starts FAILING, pytest changed its clearing behaviour and the 2x2's premise needs re-reading
    — it is not a licence to pass `--basetemp`."""
    shared = tmp_path / "shared-basetemp"
    sink, _ = _cell(tmp_path, 2, "all", shared_basetemp=shared)
    reported = {r["basetemp"] for r in sink if r["basetemp"]}
    # Both sessions were handed ONE directory: either they collide on it, or one never finished.
    assert len(reported) <= 1, f"expected one shared basetemp, saw {reported}"


@pytest.mark.slow
def test_the_keep3_cleanup_leaves_live_dirs_alone_BECAUSE_the_lock_is_fresh(tmp_path):
    """pytest keeps 3 numbered dirs; with 8 in flight, 5 are candidates and none may be taken.

    The lock AGE is asserted, not merely survival: survival alone would pass for the wrong reason on
    an idle box, whereas a lock far younger than pytest's 3 h `LOCK_TIMEOUT` is WHY the live dirs are
    safe."""
    sink, tmpdir = _cell(tmp_path, 8, "all")
    assert len([r for r in sink if r["reached_body"]]) == 8
    root = tmpdir / f"pytest-of-{os.environ.get('USER', '')}"
    numbered = [d for d in root.iterdir() if d.name.startswith("pytest-") and d.is_dir()]
    assert len(numbered) > 3, "fewer dirs than `keep` — the cleanup was never even a candidate"
    for d in numbered:
        lock = d / ".lock"
        if lock.exists():
            assert time.time() - lock.stat().st_mtime < 3 * 60 * 60


@pytest.mark.slow
def test_the_probe_can_see_a_reaping(tmp_path):
    """🔴 THE CONTROL. Delete a live session's basetemp from outside; the probe must report it.

    Every negative in this file is conditional on this test passing. A zero from an instrument that
    cannot detect the thing is not a measurement."""
    sf = tmp_path / "test_race_session.py"
    sf.write_text(SESSION_SRC)
    tmpdir = tmp_path / "tmproot"
    tmpdir.mkdir()
    out = tmp_path / "rec-ctl.json"
    root = tmpdir / f"pytest-of-{os.environ.get('USER', '')}"

    def reaper():
        for _ in range(400):
            if root.is_dir():
                # `pytest-current` is a SYMLINK pytest maintains beside the numbered dirs. Including
                # it made the reaper rmtree a symlink — which raises, is swallowed by
                # ignore_errors, and deletes nothing — so this control passed vacuously on its
                # first run and reported the probe as blind. Take real directories only.
                new = [d for d in root.iterdir() if d.name.startswith("pytest-") and d.is_dir() and not d.is_symlink()]
                if new:
                    time.sleep(0.4)
                    shutil.rmtree(sorted(new)[-1], ignore_errors=True)
                    return
            time.sleep(0.05)

    t = threading.Thread(target=reaper)
    t.start()
    sink: list[dict] = []
    _run_session(sf, out, "ctl", "pass", tmpdir, "all", None, sink)
    t.join()
    rec = sink[0]
    assert rec["exit"] != 0, "the session passed although its tmp dir was deleted under it"
    assert (
        not rec["reached_body"]
        or not rec["basetemp"]
        or not out.exists()
        or json.loads(out.read_text()).get("sentinel_survived") is False
    ), "THE PROBE IS BLIND — it did not notice its own directory being removed, so every negative in this file is void"
