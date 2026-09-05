# tepna-capture — tests/test_check_script.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`check.sh` — the one command that cannot silently omit a gate.

CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS §5. `pytest --cov` printing 100 % while `ruff` failed on the
next line happened twice — #852 and again in #880, same defect, same position — because there was no
single local invocation that ran both. §5 proposed a pre-commit hook; this is the aggregate instead
(see check.sh's header for why), and an aggregate gate that is itself ungated would be the joke.

The property under test is NOT "it runs three things". It is **every gate runs even after one fails, and
the verdict comes from the collected exit codes**. A script that stopped at the first failure would still
look correct in a green run and would still let you fix ruff, re-run, and only then find the suite red —
the exact loop that cost two PRs. So the tests below drive it with a FAILING gate and assert the later
ones still executed.

The real gates take ~11 minutes, so they are stubbed on PATH. That is the point of the isolation, not a
shortcut: what is being tested is check.sh's own control flow, not pytest's.
"""
import os
import shutil
import stat
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(HERE, "check.sh")


def _write_exec(path, body):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


def _sandbox(tmp_path, *, ruff_rc=0, shellcheck_rc=0, pytest_rc=0, mypy_found=None):
    """A PATH where each gate is a stub that records that it ran and exits as scripted."""
    binn = tmp_path / "bin"
    binn.mkdir()
    log = tmp_path / "ran.log"

    # `mypy_found` scripts the SUMMARY LINE, not a line count: check.sh reads the count off mypy's
    # own "Found N errors" line, because the output also carries `note:` lines and counting those
    # would drift from the number the baseline describes.
    mypy_emit = (f'echo "Found {mypy_found} errors in 3 files (checked 300 source files)"'
                 if mypy_found is not None else "true")
    # One fake `python` dispatching on `-m <tool>`; check.sh invokes ruff and pytest through $PYTHON.
    _write_exec(str(binn / "fakepy"), f"""#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    ruff)   echo ruff   >> "{log}"; exit {ruff_rc} ;;
    pytest) echo pytest >> "{log}"; exit {pytest_rc} ;;
    mypy)   {mypy_emit}; exit 0 ;;   # NOT logged: `ran` is the BLOCKING gate set, and mypy is advisory
  esac
done
exit 0
""")
    _write_exec(str(binn / "shellcheck"), f"""#!/usr/bin/env bash
echo shellcheck >> "{log}"
exit {shellcheck_rc}
""")
    env = dict(os.environ)
    env["PATH"] = f"{binn}{os.pathsep}{env['PATH']}"
    env["PYTHON"] = str(binn / "fakepy")
    return env, log


def _run(tmp_path, **rcs):
    env, log = _sandbox(tmp_path, **rcs)
    p = subprocess.run([CHECK], env=env, capture_output=True, text=True, timeout=120)
    ran = log.read_text().split() if log.exists() else []
    return p, ran


def test_all_green_exits_zero_and_runs_all_three(tmp_path):
    p, ran = _run(tmp_path)
    assert p.returncode == 0, p.stdout + p.stderr
    assert set(ran) == {"ruff", "shellcheck", "pytest"}, ran
    assert "all gates green" in p.stdout


def test_a_failing_ruff_does_not_stop_pytest_from_running(tmp_path):
    """THE regression. #852/#880 were 'ruff red, suite green' — if ruff aborted the run, the operator
    would fix ruff, re-run, and meet the suite's verdict only on the second pass."""
    p, ran = _run(tmp_path, ruff_rc=1)
    assert p.returncode != 0
    assert "pytest" in ran, f"pytest never ran after ruff failed: {ran}"
    assert "shellcheck" in ran, ran


def test_a_failing_pytest_still_reports_the_other_gates(tmp_path):
    p, ran = _run(tmp_path, pytest_rc=1)
    assert p.returncode != 0
    assert set(ran) == {"ruff", "shellcheck", "pytest"}, ran


def test_every_failing_gate_is_named_in_the_verdict_not_just_the_first(tmp_path):
    """A summary that names one of three failures sends you round the loop twice more."""
    p, _ = _run(tmp_path, ruff_rc=1, pytest_rc=1)
    assert p.returncode != 0
    out = p.stdout
    assert "ruff" in out and "pytest" in out
    assert "2 gate(s) failed" in out, out


def test_the_verdict_is_not_readable_off_the_tail_alone(tmp_path):
    """CLAUDE.md §4b: never read a verdict off a tail. A green tail with a non-zero exit is the trap, so
    the exit code must disagree with any optimistic last line — here there is none, and rc says so."""
    p, _ = _run(tmp_path, shellcheck_rc=1)
    assert p.returncode != 0
    assert "all gates green" not in p.stdout


def test_it_reports_the_actual_exit_code_of_a_failing_gate(tmp_path):
    p, _ = _run(tmp_path, pytest_rc=3)
    assert "exit 3" in p.stdout, p.stdout


def test_check_sh_is_executable_and_shebanged():
    """The mode GIT RECORDS, not the working tree's.

    `os.access(X_OK)` alone was not enough and CI proved it: the primary checkout lives on an ntfs3
    volume with `core.fileMode=false`, so a local `chmod +x` sets the on-disk bit and git records
    100644 anyway. The file was executable here, unexecutable in the clone, and every run of this
    script in CI died with PermissionError while this test passed locally. The committed mode is the
    only one that reaches anybody else — fix with `git update-index --chmod=+x`.
    """
    out = subprocess.run(["git", "ls-files", "-s", "--", os.path.basename(CHECK)],
                         cwd=HERE, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0 and out.stdout.strip(), (
        "could not read the committed mode from git — an unverifiable mode is the gap itself, "
        f"not a reason to skip: {out.stderr}")
    mode = out.stdout.split()[0]
    assert mode == "100755", (
        f"check.sh is committed as {mode}, not 100755 — it will be non-executable for everyone who "
        "clones. `chmod` alone does not fix this where core.fileMode=false; use "
        "`git update-index --chmod=+x capture-host/check.sh`")
    with open(CHECK, encoding="utf-8") as fh:
        assert fh.readline().startswith("#!"), "check.sh needs a shebang"


def test_it_actually_names_all_three_gates(monkeypatch):
    """Non-vacuity for the stubs above: if check.sh stopped invoking a real gate by name, the sandbox
    would happily report the remaining two as a clean run."""
    src = open(CHECK, encoding="utf-8").read()
    for gate in ("ruff check", "shellcheck --severity=style", "pytest -q --cov"):
        assert gate in src, f"check.sh no longer runs {gate!r}"
    assert "--cov-fail-under=100" in src, "the coverage floor must stay in the aggregate"


def test_it_is_not_set_e(monkeypatch):
    """`set -e` would abort at the first failing gate and silently undo the whole point."""
    src = open(CHECK, encoding="utf-8").read()
    assert "set -uo pipefail" in src
    assert "set -euo" not in src, "set -e aborts on the first failing gate"


if sys.platform == "win32":          # pragma: no cover - the box is Linux; guard kept honest
    raise RuntimeError("capture-host is Linux-only")


def test_shutil_which_finds_the_script_dir_independent(tmp_path):
    """check.sh cds to its own directory, so it works from anywhere — a gate you can only run from one
    cwd gets run from the wrong one."""
    env, _ = _sandbox(tmp_path)
    p = subprocess.run([CHECK], cwd=str(tmp_path), env=env, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stdout + p.stderr
    assert shutil.which("bash") is not None


# ── the mypy baseline, which used to live only in a label string ──────────────────────────────────
def _mypy_run(tmp_path, found):
    env, _log = _sandbox(tmp_path, mypy_found=found)
    p = subprocess.run([CHECK], env=env, capture_output=True, text=True, timeout=120)
    return p.stdout + p.stderr


def test_A_RISEN_COUNT_IS_NAMED_AS_RISEN(tmp_path):
    """🔴 THE DEFECT THIS CLOSES. The baseline lived inside the advisory's note string, where nothing
    read it — so 'count may only go DOWN' was prose, and the count rose from 102 (2026-09-03) to 103
    three days later with every gate green throughout."""
    out = _mypy_run(tmp_path, 104)
    assert "RISEN" in out and "104" in out


def test_A_COUNT_AT_THE_BASELINE_SAYS_SO_WITHOUT_ALARM(tmp_path):
    out = _mypy_run(tmp_path, 103)
    assert "at the 103 baseline" in out
    assert "RISEN" not in out


def test_AN_IMPROVEMENT_SAYS_TO_BANK_IT(tmp_path):
    """A count below the baseline is progress that can be silently spent again unless the baseline
    moves with it — the banked-progress half of any ratchet."""
    out = _mypy_run(tmp_path, 90)
    assert "BELOW" in out and "bank it" in out


def test_NO_SUMMARY_LINE_IS_AN_ABORT_NOT_A_CLEAN_TREE(tmp_path):
    """An aborted mypy prints no 'Found N errors'. Reporting that as zero would be the loudest
    possible lie — and it is the exact shape the brief already recorded: a bare `mypy .` aborts on
    tests/_srcscan.py and 'counts' 1, which is 101 short of the truth."""
    out = _mypy_run(tmp_path, None)
    assert "NO COUNT" in out and "aborted, not passed" in out


def test_THE_ADVISORY_STILL_DOES_NOT_FAIL_THE_RUN(tmp_path):
    """Advisory means advisory. §P3 is what flips mypy blocking, and it flips at 0 — deciding that
    here would pre-empt it."""
    env, _log = _sandbox(tmp_path, mypy_found=999)
    p = subprocess.run([CHECK], env=env, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, "a risen mypy count must report, not fail the gate"
