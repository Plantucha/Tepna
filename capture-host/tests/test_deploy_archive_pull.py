# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""deploy/archive-pull.sh — the second-disk mitigation must actually mitigate.

This script is the fix for the single-copy risk (every night on one disk), so its own failure
modes are the ones that matter most: silently archiving nothing, deleting what it should keep,
or truncating its log exactly when the pull fails. Each test here pins one of those, by running
the REAL script against a local fixture tree (TEPNA_ARCHIVE_SRC) — rsync local-to-local exercises
the same flags as pull-over-ssh.
"""

import os
import pathlib
import subprocess

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "deploy" / "archive-pull.sh"


def _run(src: pathlib.Path, dest: pathlib.Path, log: pathlib.Path) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["TEPNA_ARCHIVE_SRC"] = str(src) + "/"
    env["TEPNA_ARCHIVE_DEST"] = str(dest)
    env["TEPNA_ARCHIVE_LOG"] = str(log)
    return subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60)


def test_pulls_files_and_excludes_inflight(tmp_path):
    src = tmp_path / "src"
    (src / "2026-08-25").mkdir(parents=True)
    (src / "2026-08-25" / "night.edf").write_bytes(b"x" * 100)
    (src / "2026-08-25" / "growing.edf.part").write_bytes(b"y" * 50)
    dest = tmp_path / "dest"
    log = tmp_path / "pull.log"

    proc = _run(src, dest, log)

    assert proc.returncode == 0, proc.stderr
    assert (dest / "2026-08-25" / "night.edf").read_bytes() == b"x" * 100
    # In-flight captures must NOT be archived — a torn tail archived as final is worse than absent.
    assert not (dest / "2026-08-25" / "growing.edf.part").exists()


def test_never_deletes_from_the_archive(tmp_path):
    """An archive that mirrors deletions is a replica. A file that exists only in the dest
    (an upstream night later removed) must survive every subsequent pull."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "current.edf").write_bytes(b"a")
    dest = tmp_path / "dest"
    dest.mkdir()
    (dest / "only-in-archive.edf").write_bytes(b"precious")
    log = tmp_path / "pull.log"

    proc = _run(src, dest, log)

    assert proc.returncode == 0, proc.stderr
    assert (dest / "only-in-archive.edf").read_bytes() == b"precious"
    # Belt and braces: the flag must not appear on any EXECUTABLE line. (Comment lines are excluded —
    # the header's "No --delete, EVER" prose tripped the naive substring check on this test's first
    # run: a grep proves occurrence, not reference.)
    code_lines = [ln for ln in SCRIPT.read_text().splitlines() if not ln.lstrip().startswith("#")]
    assert not any("--delete" in ln for ln in code_lines)


def test_failed_pull_still_writes_a_complete_log(tmp_path):
    """The RC is captured around `set -e` so a failing rsync cannot truncate the log — the log's
    EXIT line and destination counts are the operator's verdict, and they must exist precisely
    when the pull fails (the truncated-log family, pinned)."""
    src = tmp_path / "does-not-exist"
    dest = tmp_path / "dest"
    log = tmp_path / "pull.log"

    proc = _run(src, dest, log)

    assert proc.returncode != 0
    text = log.read_text()
    assert "rsync EXIT=" in text and "rsync EXIT=0" not in text
    # The verdict counts the DESTINATION even on failure — never success-shaped, never absent.
    assert "dest files: 0" in text


def test_log_verdict_counts_the_destination(tmp_path):
    """The success measure is what ARRIVED, not what the log narrates (the 2026-08-25 harvest
    lesson): the log must state the destination file count and the newest file."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.edf").write_bytes(b"1")
    (src / "b.edf").write_bytes(b"22")
    dest = tmp_path / "dest"
    log = tmp_path / "pull.log"

    proc = _run(src, dest, log)

    assert proc.returncode == 0, proc.stderr
    text = log.read_text()
    assert "dest files: 2" in text
    assert "newest:" in text
