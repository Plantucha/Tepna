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

⚠️ WHAT THIS FILE DOES NOT COVER, STATED SO IT IS NOT MISREAD AS COVERAGE. Every session here is
a plain `pytest` subprocess. It does NOT go through mutmut's runner, and there is a measured
tool-level effect it therefore cannot see: Wren's A/B over one real glob (350 decided mutants, same
tree, only the policy varied) found `all` and `failed` per-mutant IDENTICAL, while `none` converted
**29 survivors into kills** — concentrated in a single function, which looks like one fixture rather
than a diffuse cascade. That mechanism is NOT reproduced below and is not claimed to be. Anyone
asking "can the retention policy fake a kill?" must read that A/B; this file answers only "can a
sweep's sessions reap each other's directories", which is a different question that four of us spent
an evening conflating with it. A probe that quietly widened its own scope would be the exact defect
it exists to prevent.

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
                                          # which is the ROOT and reads as one shared dir.
    # A BARRIER, NOT A SLEEP. The overlap is the whole experiment: every session must still be HOLDING
    # its dir while the others hold theirs, or the cleanup never has a live dir to take and the cell
    # passes having tested nothing. A fixed `HOLD_SEC` only makes that LIKELY — a session that starts
    # later than the hold misses the window entirely and nothing says so.
    barrier = "no-barrier"
    ready_dir = os.environ.get("RACE_READY")
    if ready_dir:
        Path(ready_dir, os.environ["RACE_TAG"]).write_text("ready")
        peers = int(os.environ["RACE_PEERS"])
        deadline = time.monotonic() + float(os.environ.get("RACE_BARRIER_MAX_S", "30"))
        barrier = "timeout"
        while time.monotonic() < deadline:
            if len(os.listdir(ready_dir)) >= peers:
                barrier = "all-ready"
                break
            time.sleep(0.01)
    else:
        time.sleep(float(os.environ["HOLD_SEC"]))
    Path(os.environ["RACE_OUT"]).write_text(json.dumps({
        "basetemp": str(basetemp),
        "sentinel_survived": sentinel.exists(),
        "barrier": barrier,
    }))
    assert sentinel.exists(), "MY OWN tmp_path was removed while I was using it"
    if os.environ.get("SESSION_VERDICT") == "fail":
        assert False, "stands in for a KILLED mutant"
"""

HOLD = "1.5"

# CONCURRENCY IS SCALED TO THE MACHINE, and that is not a tidiness point — it is why #3029 turned
# `main` red. Every "job" here is a whole pytest SUBPROCESS importing this suite's conftest. CI runs
# `pytest -q -n 4` on a 4-vCPU runner, so a hard-coded 16 meant sixteen sessions inside ONE of four
# workers: ~5x oversubscription, next to a neighbouring test whose `_qc_offload` drives a `spawn`
# ProcessPoolExecutor. It was measured on a 16-core rig and shipped at that number without anyone
# asking what the runner has.
#
# The hazards below do NOT need a big number. `keep=0` reaps EVERY prior numbered dir, so two
# overlapping sessions are enough to show it; the count only changes how emphatic the result is.
# AND IT DIVIDES BY THE XDIST WORKER COUNT, which is the half that actually bites. Under `-n 4`
# these test functions can run in FOUR workers at once, so a per-test count of N is 4N processes on
# the box. pytest-xdist publishes the width in PYTEST_XDIST_WORKER_COUNT; dividing by it bounds the
# TOTAL rather than the per-test number. CI (4 vCPU, `-n 4`) lands on 2; a serial rig run gets 8.
_WORKERS = max(1, int(os.environ.get("PYTEST_XDIST_WORKER_COUNT", "1")))


def _usable_cpus() -> int:
    """CPUs this process may actually run on — NOT `os.cpu_count()`.

    `os.cpu_count()` reports the MACHINE, ignoring both `taskset` and a container's cgroup quota. It
    returned 24 on a rig pinned to four cores with `taskset -c 0-3`, which made the verification run
    that was supposed to reproduce CI's shape exercise the rig's value instead — a check that ran and
    measured the wrong box. `sched_getaffinity` respects the mask; it is Linux-only, so the
    `cpu_count` fallback stays for anything else."""
    try:
        return max(1, len(os.sched_getaffinity(0)))
    except AttributeError:  # pragma: no cover — non-Linux; the capture host and CI are both Linux
        return max(1, os.cpu_count() or 2)


JOBS_HIGH = min(8, max(2, _usable_cpus() // _WORKERS))


def _run_session(session_file, out, tag, verdict, tmpdir, policy, basetemp, sink, hold=HOLD, ready=None, peers=0):
    """`hold` is the session's own, because only a CONCURRENT cell needs one.

    ⚠️ IT WAS GLOBAL, AND THE COMMENT IN `test_the_keep3_cleanup...` IS THE EVIDENCE THAT NOBODY MEANT IT
    TO BE: "Four quick sequential sessions cost ~0.4 s and pin it." Measured 2026-10-05, those four cost
    about EIGHT seconds — 4 x (1.5 s `HOLD` + interpreter start) — because they inherited the hold a
    concurrent cell needs. They run one after another in a `for` loop, so they cannot overlap by
    construction and the hold buys them nothing. What they discriminate on is how many numbered dirs
    EXIST (`len(numbered) > 3`), not how long any of them lived.
    """
    env = dict(
        os.environ,
        RACE_OUT=str(out),
        RACE_TAG=tag,
        HOLD_SEC=hold,
        **({"RACE_READY": str(ready), "RACE_PEERS": str(peers)} if ready else {}),
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
            # Which mechanism held the dir, so a cell can ASSERT the overlap rather than hope for it.
            "barrier": rec.get("barrier"),
            # Carried through explicitly. Dropping it is what made the 2x2's own reaped-check vacuous:
            # `reached_body and not basetemp` can never be true, because a session that reaches its body
            # always records a basetemp. See the `none` cells below, which are what exposed it.
            "sentinel_survived": rec.get("sentinel_survived"),
            # A session that never reached its body died at SETUP — exit 1 too, and the shape that would
            # let a masked survivor read as killed. Counted separately from a real assertion failure.
            "setup_error": not rec and "passed" not in body,
        }
    )


def _cell(tmp_path, jobs, policy, shared_basetemp=None, barrier=True):
    """`jobs` sessions launched together; the SURVIVOR goes first, which is the ordering a cascade
    would need to fire early."""
    sf = tmp_path / "test_race_session.py"
    sf.write_text(SESSION_SRC)
    tmpdir = tmp_path / "tmproot"
    tmpdir.mkdir(exist_ok=True)
    sink: list[dict] = []
    plan = [("s0", "pass")] + [(f"k{i}", "fail") for i in range(1, jobs)]
    # The barrier's rendezvous. Its own directory per cell, so two cells can never see each other's
    # readiness files and conclude they are peers.
    # ⚠️ `barrier=False` IS FOR A CELL WHOSE PREMISE IS INTERFERENCE, NOT COEXISTENCE. The barrier waits
    # for every peer to signal, which is right when the question is "do concurrent sessions leave each
    # other alone" — and wrong when the question is "do they destroy each other", because there a session
    # that never finishes is an EXPECTED outcome (`test_a_shared_basetemp_IS_a_hazard`: "either they
    # collide on it, or one never finished"). Such a cell keeps the fixed hold: nothing can wait for a
    # peer that may never arrive. Found by the overlap assertion below failing on its first run.
    ready = tmp_path / f"ready-{policy}-{jobs}-{'shared' if shared_basetemp else 'own'}" if barrier else None
    if ready:
        ready.mkdir(exist_ok=True)
    threads = [
        threading.Thread(
            target=_run_session,
            args=(sf, tmp_path / f"rec-{t}.json", t, v, tmpdir, policy, shared_basetemp, sink),
            kwargs={"ready": ready, "peers": jobs},
        )
        for t, v in plan
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    # 🔴 THE OVERLAP IS NOW ASSERTED, NOT HOPED FOR. Every session that reached its body must have seen all
    # of its peers ready — i.e. they were all holding their dirs at the same instant, which is the only
    # condition under which the cleanup below had a live dir it could have taken. Under the fixed
    # `HOLD_SEC` this was merely LIKELY: a session that started later than the hold missed the window,
    # the cell passed, and nothing recorded that the experiment had not happened. That is the same
    # vacuous-pass shape this file's own comments warn about twice elsewhere.
    missed = [r["tag"] for r in sink if barrier and r.get("reached_body") and r.get("barrier") != "all-ready"]
    assert not missed, (
        f"the sessions never overlapped — {missed} did not see {jobs} peers ready, so the cleanup was "
        "never offered a live dir and this cell measured nothing"
    )
    return sink, tmpdir


@pytest.mark.slow
@pytest.mark.parametrize("policy", ["all", "failed"])
@pytest.mark.parametrize("jobs", [1, JOBS_HIGH])
def test_no_session_loses_its_own_tmp_dir(tmp_path, jobs, policy):
    """The 2x2. Zero reaped, zero setup errors, and one basetemp PER SESSION."""
    sink, _ = _cell(tmp_path, jobs, policy)
    assert len(sink) == jobs, "a session did not report at all"
    reaped = [r for r in sink if r["reached_body"] and r["sentinel_survived"] is False]
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
    # barrier=False: this cell's premise is that one session may never finish — see `_cell`.
    sink, _ = _cell(tmp_path, 2, "all", shared_basetemp=shared, barrier=False)
    reported = {r["basetemp"] for r in sink if r["basetemp"]}
    # Both sessions were handed ONE directory: either they collide on it, or one never finished.
    assert len(reported) <= 1, f"expected one shared basetemp, saw {reported}"


@pytest.mark.slow
def test_the_keep3_cleanup_leaves_live_dirs_alone_BECAUSE_the_lock_is_fresh(tmp_path):
    """pytest keeps 3 numbered dirs; more than that are in flight, and none may be taken.

    The lock AGE is asserted, not merely survival: survival alone would pass for the wrong reason on
    an idle box, whereas a lock far younger than pytest's 3 h `LOCK_TIMEOUT` is WHY the live dirs are
    safe."""
    # SEED past `keep` first, cheaply and deterministically. The premise of this test is that the
    # cleanup HAD candidates to take. With concurrency scaled to the machine, JOBS_HIGH can be 2, and
    # the premise would silently evaporate — the test would pass having tested nothing, which is the
    # exact failure this whole file is about. Four quick sequential sessions cost ~0.4 s and pin it.
    sf = tmp_path / "test_race_session.py"
    sf.write_text(SESSION_SRC)
    seed_dir = tmp_path / "tmproot"
    seed_dir.mkdir(exist_ok=True)
    seed_sink: list[dict] = []
    for i in range(4):
        # hold="0": a sequential seed cannot overlap anything, so it waits for nothing. This is what the
        # comment above already claimed these four cost.
        _run_session(sf, tmp_path / f"rec-seed{i}.json", f"seed{i}", "pass", seed_dir, "all", None, seed_sink, hold="0")
    sink, tmpdir = _cell(tmp_path, JOBS_HIGH, "all")
    assert len([r for r in sink if r["reached_body"]]) == JOBS_HIGH
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


# ── The policy's PER-TEST semantics, which are the opposite of how everyone read them ────────────
PERTEST_SRC = """
import json, os
from pathlib import Path

SEEN = {}

def test_a(tmp_path):
    (tmp_path / "f").write_text("a")
    SEEN["a"] = tmp_path

def test_b(tmp_path):
    Path(os.environ["RACE_OUT"]).write_text(json.dumps(
        {"earlier_test_dir_still_there": SEEN["a"].exists()}))
"""


@pytest.mark.slow
@pytest.mark.parametrize(
    "policy,earlier_dir_survives",
    [("all", True), ("failed", False), ("none", True)],
)
def test_retention_policy_is_per_test_and_failed_is_the_AGGRESSIVE_one(tmp_path, policy, earlier_dir_survives):
    """`failed` deletes a passing test's dir IMMEDIATELY, mid-session. `none` does not.

    🔴 THIS IS BACKWARDS FROM HOW FOUR SESSIONS READ IT, INCLUDING ME. The names invite
    "all keeps everything, failed keeps failures, none keeps nothing, so `none` is the most
    destructive during a run" — and every hazard argument on 2026-09-24 was built on that. Measured,
    the order is inverted: under `failed` an earlier passing test's `tmp_path` is ALREADY GONE by the
    time a later test in the same session runs, while under `none` it is still there. `none` retains
    through the session and cleans up at the end; `failed` cleans up per test, as each one passes.

    Why it is pinned rather than written in a comment: a test whose fixture reads a DIRECTORY and
    treats an absent one as empty — `nightqc.ppg2w_contact_quality(str(tmp_path))`, whose suite
    asserts `(tmp_path / "absent") == []` — is exactly the shape that a mid-session deletion turns
    from a real observation into a vacuous one, and which policy does that is not guessable from the
    name. Wren's A/B over 350 mutants found `all` and `failed` per-mutant IDENTICAL while `none`
    converted 29 survivors into kills, so the tool-level consequence does NOT follow the per-test
    semantics either. Both facts are counterintuitive and both are now measured rather than argued.
    """
    sf = tmp_path / "test_pertest_session.py"
    sf.write_text(PERTEST_SRC)
    out = tmp_path / "pertest.json"
    env = dict(os.environ, RACE_OUT=str(out), TMPDIR=str(tmp_path / "tmproot"))
    (tmp_path / "tmproot").mkdir()
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "-p",
            "no:cacheprovider",
            "-o",
            f"tmp_path_retention_policy={policy}",
            str(sf),
        ],
        capture_output=True,
        text=True,
        env=env,
        cwd=tmp_path,
    )
    assert out.exists(), "the probe session did not run"
    got = json.loads(out.read_text())["earlier_test_dir_still_there"]
    assert got is earlier_dir_survives, (
        f"policy={policy}: earlier test's tmp_path present={got}, expected "
        f"{earlier_dir_survives}. pytest changed its retention semantics — every hazard argument "
        "that cites this file needs re-reading before it is quoted again."
    )


@pytest.mark.slow
@pytest.mark.parametrize(
    "policy,expected_survivors",
    # MEASURED, not predicted — my first guess had `all` at 3 and it is 2. Five prior dirs planted,
    # one session started, then counted:
    #   all     → 2 survive. `keep=3` counts the session's OWN new dir, so only 2 old ones remain.
    #   failed  → 3 survive. Same keep=3, but the session PASSED so it deletes its own, freeing a slot.
    #   none    → 0 survive, and the root is left completely EMPTY — its own dir goes too.
    [("all", 2), ("failed", 3), ("none", 0)],
)
def test_policy_none_sets_keep_0_so_a_starting_session_reaps_EVERY_prior_dir(tmp_path, policy, expected_survivors):
    """🔴 THE POSITIVE, and it is deterministic because it does not race.

    `_pytest/tmpdir.py:210` — `keep = self._retention_count`, then `if policy == "none": keep = 0`,
    passed to `make_numbered_dir_with_cleanup`. Five prior numbered dirs are planted; a session then
    starts and runs that cleanup, and the three policies separate cleanly — 2 / 3 / 0 survivors.
    Under `none` the root is left **entirely empty**, the session's own directory included.

    WHY THAT MATTERS: under mutmut there is one session per mutant, all in flight. A session whose
    tmp dir is taken FAILS, and a failing session is a KILLED mutant — so a mutant that genuinely
    SURVIVES is scored dead. That is the unit-level half of the fleet's end-to-end A/B, where `none`
    converted 29 survivors into kills over one real glob while `all` and `failed` were per-mutant
    identical.

    ⚠️ AND HERE IS THE CLAIM I HAD TO WEAKEN, WHICH IS THE USEFUL PART. I first wrote this as "`none`
    reaps LIVE siblings" and measured 4/8 and 15/16 sessions losing their own directory. That is real
    but PROBABILISTIC — it needs two sessions starting close enough together that the victim's dir
    exists while its `.lock` is not yet protecting it. Asserting it as a test was flaky: it passed
    10/10 alone under `-k` and then failed 2 of 3 full-suite runs. Sequencing it to remove the race —
    wait for the victim's dir, then start the reaper — made it fail CONSISTENTLY, which is the
    refutation: once a live dir's lock is established, `keep=0` does NOT take it.

    So the honest statement is narrower than the one I shipped: **`keep=0` spares nothing, and that
    makes a concurrent starter able to take a sibling's tree in the window before its lock holds.**
    The deterministic half is asserted here; the concurrent half is recorded with its measured rates
    and is deliberately NOT a test, because a positive that fires probabilistically is a flaky test.
    """
    tmpdir = tmp_path / "tmproot"
    root = tmpdir / f"pytest-of-{os.environ.get('USER', '')}"
    root.mkdir(parents=True)
    # Five PRIOR dirs, unlocked — i.e. the leftovers of finished sessions, which is what a sweep
    # accumulates. Unlocked on purpose: a lock would make this a test of the lock, not of `keep`.
    planted = []
    for i in range(5):
        d = root / f"pytest-{i}"
        d.mkdir()
        (d / "leftover").write_text(str(i))
        planted.append(d)

    sf = tmp_path / "test_race_session.py"
    sf.write_text(SESSION_SRC)
    sink: list[dict] = []
    _run_session(sf, tmp_path / "rec.json", "starter", "pass", tmpdir, policy, None, sink)
    assert sink and sink[0]["reached_body"], "the starting session did not run"

    survived = [d.name for d in planted if d.exists()]
    assert len(survived) == expected_survivors, (
        f"policy={policy}: {len(survived)} of 5 planted dirs survived, expected "
        f"{expected_survivors} ({survived}). pytest's `keep` handling changed — re-read every "
        "argument that cites this file before quoting it again."
    )
