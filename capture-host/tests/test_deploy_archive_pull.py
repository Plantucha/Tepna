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


def test_never_chmods_an_existing_destination_folder(tmp_path):
    """A chmod on the Synology replaces the folder's ACL with mode bits. `-a` set each archived
    folder to the source's 755 and locked the NFS user out (exit 23 from 2026-10-31). An existing
    destination folder must keep its own mode after a pull."""
    src = tmp_path / "src"
    (src / "2026-11-06").mkdir(parents=True)
    (src / "2026-11-06" / "night.edf").write_bytes(b"n")
    (src / "2026-11-06").chmod(0o755)
    dest = tmp_path / "dest"
    (dest / "2026-11-06").mkdir(parents=True)
    (dest / "2026-11-06").chmod(0o777)
    log = tmp_path / "pull.log"

    proc = _run(src, dest, log)

    assert proc.returncode == 0, proc.stderr
    assert (dest / "2026-11-06" / "night.edf").read_bytes() == b"n"
    assert (dest / "2026-11-06").stat().st_mode & 0o777 == 0o777


def test_the_pull_names_a_writable_destination_before_rsync_runs(tmp_path):
    """The probe is a line in the log on EVERY run, not only a failing one: an operator reading a
    green pull still learns that the destination admitted a write."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.edf").write_bytes(b"1")
    dest = tmp_path / "dest"
    log = tmp_path / "pull.log"

    proc = _run(src, dest, log)

    assert proc.returncode == 0, proc.stderr
    text = log.read_text()
    # A fresh destination has no night yet, so the second depth is `none` rather than a guess (§∅).
    assert "dest-writable: root=yes newest-night=none" in text


def test_the_pull_probes_the_newest_night_not_only_the_root(tmp_path):
    """The measured failure was PER-NIGHT — 33 of the 35 night errors named a per-night marker — so a
    root-only probe would have reported a writable destination on the very tree that refused.

    This case is also the whole argument for a probe rather than an exit code: a root refusal and a
    per-night refusal reach the operator as the same single exit code. This test therefore asserts
    the probe line alone. It asserts NOTHING about rsync's exit, because what rsync manages against a
    refused tree is rsync's business and it varies with the host."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.edf").write_bytes(b"1")
    dest = tmp_path / "dest"
    night = dest / "2026-10-31"
    night.mkdir(parents=True)
    log = tmp_path / "pull.log"
    night.chmod(0o555)
    try:
        _run(src, dest, log)
    finally:
        night.chmod(0o755)

    text = log.read_text()
    assert "dest-writable: root=yes newest-night=NO" in text
    assert "the DESTINATION refused a probe write before rsync ran" in text


def test_an_unwritable_destination_is_named_beside_the_exit_code(tmp_path):
    """The one fact behind 59 error lines appeared in none of them. It appears here, next to the exit
    code an operator reads, and it names the step that fixes it."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.edf").write_bytes(b"1")
    dest = tmp_path / "dest"
    dest.mkdir()
    log = tmp_path / "pull.log"
    dest.chmod(0o555)
    try:
        _run(src, dest, log)
    finally:
        dest.chmod(0o755)

    text = log.read_text()
    assert "dest-writable: root=NO" in text
    assert "the DESTINATION refused a probe write before rsync ran" in text
    assert "restore the inherited ACL" in text
    # The exit code is reported, never asserted away. What rsync manages against a refused tree
    # varies with the host, and the fact an operator needs holds whatever it manages.
    assert "rsync EXIT=" in text


def test_the_remedy_names_the_acl_restore_and_never_a_chmod(tmp_path):
    """#4474 measured that a chmod on the Synology replaces a folder's inherited ACL with plain mode
    bits, and that rsync's own chmod under `-a` is what locked this uid out. So the remedy line must
    name the ACL restore and must not send an operator to a mode change, which would re-apply the
    mechanism behind the outage."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.edf").write_bytes(b"1")
    dest = tmp_path / "dest"
    dest.mkdir()
    log = tmp_path / "pull.log"
    dest.chmod(0o555)
    try:
        _run(src, dest, log)
    finally:
        dest.chmod(0o755)

    # The filter carries the script's own prefix. A bare "remedy" matched four lines, because
    # pytest names tmp_path after this test and every path-bearing line then carried the word.
    remedy = [ln for ln in log.read_text().splitlines() if ln.startswith("archive-pull: remedy")]
    assert len(remedy) == 1, remedy
    assert "restore the inherited ACL" in remedy[0]
    assert "never a chmod" in remedy[0]
    assert "chmod g+" not in remedy[0]
    assert "archive-dest-grant" not in log.read_text()


def test_a_writable_destination_gets_no_remedy_line(tmp_path):
    """A remedy printed beside a green run teaches an operator to ignore it. The line appears only
    when the probe actually refused."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.edf").write_bytes(b"1")
    dest = tmp_path / "dest"
    log = tmp_path / "pull.log"

    proc = _run(src, dest, log)

    assert proc.returncode == 0, proc.stderr
    text = log.read_text()
    assert "remedy" not in text
    assert "refused a probe write" not in text


def test_the_probe_leaves_nothing_behind_in_the_archive(tmp_path):
    """There is no `--delete` here, so a probe file this script forgets lives in the archive forever
    and counts as an archived file in the pull's own verdict."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.edf").write_bytes(b"1")
    dest = tmp_path / "dest"
    dest.mkdir()
    stale = dest / ".tepna-dest-probe.99999"
    stale.write_text("left by a killed run")
    log = tmp_path / "pull.log"

    proc = _run(src, dest, log)

    assert proc.returncode == 0, proc.stderr
    assert not list(dest.glob(".tepna-dest-probe*"))
    assert not stale.exists()
    assert "dest files: 1" in log.read_text()
