# tepna-capture — tests/test_mutate_prune.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`tools/mutate` scratch pruning — residue `2026-09-24-mutate-prune-crosses-sessions`.

/tmp is SHARED. The prune globbed `mut-<module>-*` across it and removed every directory for that
module that was not the current run's, so two sessions mutating one module deleted each other's work
tree mid-run. The failure was silent in the worst way: `mutmut results` in a deleted cwd yields
nothing, and nothing reads as an EMPTY SURVIVOR LIST — a clean verdict for mutants that never ran.

Every test here drives the real predicate against a REAL live process, because the defect exists only
with two runs in flight; a fix whose only proof needs a 20-minute mutation pass is one nobody
re-checks."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import mutation_scratch as M  # noqa: E402


def _scratch(root: Path, name: str) -> Path:
    d = root / name
    (d / "work").mkdir(parents=True, exist_ok=True)
    (d / "work" / "canary.txt").write_text("a mutation run's output lives here\n")
    return d


def test_holder_alive_true_for_this_process(tmp_path):
    d = _scratch(tmp_path, "mut-foo-aaa")
    M._claim(d)
    assert M._holder_alive(d) is True


def test_holder_alive_false_without_a_marker(tmp_path):
    """Fails CLOSED. An unmarked dir predates this mechanism or was left by a crash; calling it live
    would reintroduce the unbounded /tmp growth the prune exists to stop (153 orphaned scratches,
    2.6 GB, measured 2026-08-03) on a tmpfs where a scratch is RAM."""
    d = _scratch(tmp_path, "mut-foo-bbb")
    assert M._holder_alive(d) is False


def test_holder_alive_false_once_the_holder_exits(tmp_path):
    d = _scratch(tmp_path, "mut-foo-ccc")
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    (d / M.HOLDER).write_text(f"{proc.pid} {M._proc_start_ticks(proc.pid)}\n")
    assert M._holder_alive(d) is True, "a running holder must read as live"
    proc.terminate()
    proc.wait(timeout=10)
    assert M._holder_alive(d) is False, "once the holder exits the scratch is reclaimable"


def test_holder_alive_false_when_the_pid_was_reused(tmp_path):
    """A bare `pid alive?` check is wrong the first time the OS wraps a pid onto a new process, and
    it fails toward never reclaiming. Pairing the pid with its start time makes the identity exact:
    OUR pid with a start time that is not ours is a different process."""
    d = _scratch(tmp_path, "mut-foo-ddd")
    (d / M.HOLDER).write_text(f"{os.getpid()} 999999999\n")
    # our own pid short-circuits to live, so use a pid that exists and is not us
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        (d / M.HOLDER).write_text(f"{proc.pid} 1\n")  # wrong start time for a live pid
        assert M._holder_alive(d) is False
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def test_prune_leaves_the_live_run_and_reclaims_the_dead_one(tmp_path):
    """THE PLANT: two concurrent runs on one module. Before the fix the prune removed BOTH scratches
    that were not the caller's own, so whichever run reached this line second destroyed the other's
    work tree mid-pass."""
    live = _scratch(tmp_path, "mut-foo-live")
    dead = _scratch(tmp_path, "mut-foo-dead")
    keep = _scratch(tmp_path, "mut-foo-keep")

    holder = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    (live / M.HOLDER).write_text(f"{holder.pid} {M._proc_start_ticks(holder.pid)}\n")
    gone = subprocess.Popen([sys.executable, "-c", "pass"])
    gone.wait(timeout=10)
    (dead / M.HOLDER).write_text(f"{gone.pid} {M._proc_start_ticks(gone.pid)}\n")

    try:
        pruned, left = M.prune_stale_scratches(tmp_path, "foo", keep=keep)
        assert left == ["mut-foo-live"], "a scratch a live run holds is not this run's to delete"
        assert pruned == ["mut-foo-dead"], "a scratch whose holder is gone is reclaimable"
        assert (live / "work" / "canary.txt").exists(), "the live run's work tree survived"
        assert not dead.exists(), "the stale scratch was actually removed, not merely reported"
        assert (keep / "work" / "canary.txt").exists(), "the caller's own scratch is never pruned"
    finally:
        holder.terminate()
        holder.wait(timeout=10)


def test_prune_is_not_vacuous_without_the_liveness_check(tmp_path):
    """ANTI-VACUITY. The plant above would also pass if the prune simply stopped deleting anything.
    This pins that the OLD predicate — everything that is not `keep` — would have taken the live
    directory, so the assertions above are about liveness and not about an inert prune."""
    live = _scratch(tmp_path, "mut-bar-live")
    keep = _scratch(tmp_path, "mut-bar-keep")
    holder = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    (live / M.HOLDER).write_text(f"{holder.pid} {M._proc_start_ticks(holder.pid)}\n")
    try:
        old_predicate = [d.name for d in sorted(tmp_path.glob("mut-bar-*")) if d != keep and d.is_dir()]
        assert "mut-bar-live" in old_predicate, "the old prune would have deleted the live run's tree"
        pruned, left = M.prune_stale_scratches(tmp_path, "bar", keep=keep)
        assert pruned == [] and left == ["mut-bar-live"]
    finally:
        holder.terminate()
        holder.wait(timeout=10)


def test_proc_start_ticks_is_none_for_a_dead_pid(tmp_path):
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait(timeout=10)
    time.sleep(0.05)
    assert M._proc_start_ticks(proc.pid) is None


def test_claim_survives_an_unwritable_path(tmp_path):
    """A scratch we cannot mark is still usable — it just prunes as stale later, never raises."""
    blocker = tmp_path / "afile"
    blocker.write_text("not a directory\n")
    M._claim(blocker / "sub")  # mkdir raises NotADirectoryError, an OSError
    assert not (blocker / "sub").exists()


def test_liveness_fails_open_where_there_is_no_proc(tmp_path, monkeypatch):
    """Off Linux liveness is UNKNOWABLE, and deleting another run's tree is the worse error."""
    d = _scratch(tmp_path, "mut-x-1")
    # no marker at all: on Linux this is a stale dir (fail closed) …
    assert M._holder_alive(d) is False
    monkeypatch.setattr(M, "PROC", tmp_path / "no-such-proc")
    # … and off Linux the same dir must be left alone.
    assert M._holder_alive(d) is True
    pruned, left = M.prune_stale_scratches(tmp_path, "x", keep=tmp_path / "keep")
    assert pruned == [] and left == ["mut-x-1"]


def test_an_empty_or_unparseable_marker_is_stale(tmp_path):
    """A crashed run can leave a truncated marker; it must not pin the dir forever."""
    for name, body in (("mut-y-1", ""), ("mut-y-2", "   \n"), ("mut-y-3", "not-a-pid 9\n")):
        d = _scratch(tmp_path, name)
        (d / M.HOLDER).write_text(body)
        assert M._holder_alive(d) is False, name
    pruned, _ = M.prune_stale_scratches(tmp_path, "y", keep=tmp_path / "keep")
    assert pruned == ["mut-y-1", "mut-y-2", "mut-y-3"]


def test_a_marker_without_start_ticks_is_honoured_by_pid_alone(tmp_path):
    """`_claim` writes an empty ticks field when /proc could not be read; a live pid still holds."""
    holder = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        d = _scratch(tmp_path, "mut-z-1")
        (d / M.HOLDER).write_text(f"{holder.pid}\n")  # pid only — no start-ticks column
        assert M._holder_alive(d) is True
        pruned, left = M.prune_stale_scratches(tmp_path, "z", keep=tmp_path / "keep")
        assert pruned == [] and left == ["mut-z-1"]
    finally:
        holder.kill()
        holder.wait()


def test_a_plain_file_matching_the_glob_is_left_alone(tmp_path):
    """The glob matches names, not directories; a stray file is not a scratch to delete."""
    stray = tmp_path / "mut-w-1"
    stray.write_text("someone else's file\n")
    pruned, left = M.prune_stale_scratches(tmp_path, "w", keep=tmp_path / "keep")
    assert pruned == [] and left == []
    assert stray.exists()


# ── the twelve survivors the diff-scoped gate reported on #3027 ──────────────────────────────────
# Every assertion below exists because a mutant of the line it covers survived: tests that checked
# only truthiness, only the happy ordering, or only "it did not raise" could not see any of them.

# A real /proc line, comm deliberately containing BOTH a space and a ')', which is legal and is why
# the parser splits on the LAST ')'. starttime is field 22 → index 19 after the comm.
_STAT = (
    b"4242 (sh (weird) name) S 1 4242 4242 0 -1 4194560 812 0 12 0 "
    b"3 7 0 0 20 0 1 0 987654321 4526080 512 18446744073709551615 1 1 0 0 0 0 0 0 0\n"
)


def test_ticks_are_parsed_from_the_right_field():
    """The VALUE, against a known answer — not merely that something non-empty came back."""
    assert M._ticks_from_stat(_STAT) == "987654321"


def test_ticks_split_on_the_LAST_paren_not_the_first():
    """`rfind`→`find` returns a plausible wrong string; a truthiness check cannot tell them apart."""
    from_first = _STAT[_STAT.find(b")") + 2 :].split()
    assert from_first[19].decode() != "987654321"  # the mutant's answer, proven different


def test_ticks_are_None_when_the_line_is_too_short():
    """Boundary, both sides: 20 fields after the comm is exactly enough, 19 is not."""
    head = _STAT[: _STAT.rfind(b")") + 2]
    assert M._ticks_from_stat(head + b" ".join(str(i).encode() for i in range(20))) is not None
    assert M._ticks_from_stat(head + b" ".join(str(i).encode() for i in range(19))) is None
    assert M._ticks_from_stat(b"1 (x) S") is None


def test_claim_creates_missing_parents(tmp_path):
    """`parents=True` — a scratch two levels below an absent dir must still be markable."""
    nested = tmp_path / "absent" / "alsoabsent" / "mut-p-1"
    M._claim(nested)
    assert (nested / M.HOLDER).exists()
    assert M._holder_alive(nested) is True


def test_the_scan_continues_past_a_dir_it_must_not_touch(tmp_path):
    """`continue`→`break` would stop at the first skip; `keep` is named to sort FIRST."""
    keep = _scratch(tmp_path, "mut-q-0-keep")
    stale = _scratch(tmp_path, "mut-q-1-stale")
    assert sorted(p.name for p in tmp_path.glob("mut-q-*"))[0] == keep.name
    pruned, left = M.prune_stale_scratches(tmp_path, "q", keep=keep)
    assert pruned == [stale.name] and left == []
    assert keep.exists() and not stale.exists()


def test_an_undeletable_scratch_is_reported_as_LEFT_not_pruned(tmp_path):
    """`ignore_errors=True` must not crash the run — and must not claim a deletion that failed.

    `ignore_errors=False` would raise here instead, taking down a mutation run over an orphan that
    is none of its business; reporting it as `pruned` would be the opposite lie."""
    if os.geteuid() == 0:
        import pytest

        pytest.skip("root ignores the directory permissions this test relies on")
    stale = _scratch(tmp_path, "mut-r-1")
    (stale / "child").write_text("x")
    os.chmod(stale, 0o500)  # no write on the parent → the child cannot be unlinked
    try:
        pruned, left = M.prune_stale_scratches(tmp_path, "r", keep=tmp_path / "keep")
        assert pruned == [] and left == ["mut-r-1"]  # not a crash, and not a false claim
        assert stale.exists()
    finally:
        os.chmod(stale, 0o700)


def test_a_live_holder_does_not_stop_the_scan(tmp_path):
    """The SECOND `continue`: a live dir must be skipped, not treated as the end of the sweep.

    `continue`→`break` there survived the first round of these tests, because every one of them had
    at most one live dir and none had a prunable dir AFTER it. Sorting is by name, so the live dir
    is named to come first."""
    holder = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        live = _scratch(tmp_path, "mut-s-0-live")
        (live / M.HOLDER).write_text(f"{holder.pid} {M._proc_start_ticks(holder.pid)}\n")
        stale = _scratch(tmp_path, "mut-s-1-stale")
        assert sorted(p.name for p in tmp_path.glob("mut-s-*"))[0] == live.name
        pruned, left = M.prune_stale_scratches(tmp_path, "s", keep=tmp_path / "keep")
        assert pruned == [stale.name], "the sweep stopped at the live dir"
        assert left == [live.name]
        assert live.exists() and not stale.exists()
    finally:
        holder.kill()
        holder.wait()
