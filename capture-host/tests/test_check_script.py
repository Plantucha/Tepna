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

import pathlib
import shlex
import re
import os
import shutil
import stat
import json
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(HERE, "check.sh")


def _write_exec(path, body):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


# The interpreter THIS suite runs under, for the stub below. `python3` from PATH is not it, and
# under the mutation gate only this one can import the transformed module's `mutmut`.
_PY = shlex.quote(sys.executable)


def _sandbox(
    tmp_path,
    *,
    ruff_rc=0,
    format_rc=0,
    shellcheck_rc=0,
    pytest_rc=0,
    mypy_found=None,
    mypy_line=None,
    timeout_plugin=True,
    runtime_deps=True,
    ruff_mod=True,
    cov_plugin=True,
    unwired_rc=0,
    unwired_object="PASS",
):
    """A PATH where each gate is a stub that records that it ran and exits as scripted."""
    binn = tmp_path / "bin"
    binn.mkdir()
    log = tmp_path / "ran.log"
    # `find_unwired.py` is a tool of OURS that WRITES ITS OWN `tepna.verdict/1` (to --verdict-out), and
    # check.sh reads that object, not its exit code. The stub writes the scripted kind of object —
    # "PASS", "FAIL", "WRONG_GATE" or "NONE" (writes nothing: the crash / old-tool shape) — and exits
    # `unwired_rc`. It runs under THIS interpreter for the same reason checkverdict.py does (see below).
    _write_exec(
        str(binn / "unwired_stub.py"),
        f"""import sys
sys.path.insert(0, {HERE!r})
import verdict as VD

rc, kind = int(sys.argv[1]), sys.argv[2]
args = sys.argv[3:]
out = args[args.index("--verdict-out") + 1] if "--verdict-out" in args else None  # an invocation without the flag writes nothing
crit = {{"name": "unexplained_findings_plus_spent_suppressions", "threshold": 0, "unit": "findings", "direction": "eq"}}
if kind != "NONE" and out:
    failing = kind == "FAIL"
    VD.write(
        out,
        VD.make(
            gate="not-find-unwired" if kind == "WRONG_GATE" else "find-unwired",
            status="FAIL" if failing else "PASS",
            population={{"checked": 3, "eligible": 3, "excluded": 0}},
            criterion=crit,
            result={{"unexplained": 1 if failing else 0}},
            evidence=["capture-host/tools/find_unwired.py"],
            reason="1 unexplained finding(s)" if failing else None,
            tool="capture-host/tools/find_unwired.py",
        ),
    )
sys.exit(rc)
""",
    )

    # `mypy_found` scripts the SUMMARY LINE, not a line count: check.sh reads the count off mypy's
    # own "Found N errors" line, because the output also carries `note:` lines and counting those
    # would drift from the number the baseline describes.
    # `mypy_line` plants a summary line VERBATIM — the clean-run shape ("Success: no issues found in N
    # source files") and the shapes that must stay NO COUNT are only expressible as the exact bytes.
    mypy_emit = (
        f"echo {mypy_line!r}"
        if mypy_line is not None
        else f'echo "Found {mypy_found} errors in 3 files (checked 300 source files)"'
        if mypy_found is not None
        else "true"
    )
    # One fake `python` dispatching on `-m <tool>`; check.sh invokes ruff and pytest through $PYTHON.
    _write_exec(
        str(binn / "fakepy"),
        f"""#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    # The plugin PROBE, scripted: this fake exits 0 for any arg it does not match, so a MISSING
    # pytest-timeout would otherwise be unrepresentable here and the announcement untestable.
    "import pytest_timeout") exit {0 if timeout_plugin else 1} ;;
    # The RUNTIME-requirements probe (bleak): absent, the mypy count is not the baseline's quantity.
    "import bleak") exit {0 if runtime_deps else 1} ;;
    # The PREFLIGHT probes. These two absences are the ones no exit code can report honestly — ruff's
    # absent-module exit 1 is also its "violations found" code — so the script refuses before any gate.
    "import ruff") exit {0 if ruff_mod else 1} ;;
    "import pytest_cov") exit {0 if cov_plugin else 1} ;;
    # ⚠️ `ruff` SERVES TWO GATES since 2026-10-05 — `ruff check .` and `ruff format --check .` — and a
    # single stub for both is a harness that cannot tell them apart. It showed up as arithmetic: the
    # "every failing gate is named" test planted TWO failures and the summary reported THREE, because
    # one `ruff_rc=1` reddened both legs. Dispatching on the subcommand keeps each test's plant equal to
    # what it meant to plant, and lets a future divergence between the two legs be expressed at all.
    ruff)
      case " $* " in
        *" format "*) echo format >> "{log}"; exit {format_rc} ;;
        *)            echo ruff   >> "{log}"; exit {ruff_rc} ;;
      esac
      ;;
    pytest) echo pytest >> "{log}"; exit {pytest_rc} ;;
    mypy)   {mypy_emit}; exit 0 ;;   # NOT logged: `ran` is the BLOCKING gate set, and mypy is advisory
    # The verdict writer runs for REAL — it is what the object tests read. It must run under THIS
    # interpreter, never `python3` from PATH. `checkverdict.py` imports `verdict.py`, and under the
    # mutation gate that module is mutmut's transformed copy, which imports `mutmut` at module
    # scope. Only the interpreter running this suite has it. Measured 2026-10-12: with `python3`
    # here, every mutant of `verdict.py` read as UNDECIDED and `mutate_diff` refused the whole
    # diff (exit 2) — a ModuleNotFoundError inside the writer, which the shell reports as
    # "verdict: NOT WRITTEN" and this test reads as a missing file.
    checkverdict.py) exec {_PY} "$@" ;;
    *find_unwired.py) exec {_PY} "{binn}/unwired_stub.py" {unwired_rc} {unwired_object} "$@" ;;
  esac
done
exit 0
""",
    )
    _write_exec(
        str(binn / "shellcheck"),
        f"""#!/usr/bin/env bash
echo shellcheck >> "{log}"
exit {shellcheck_rc}
""",
    )
    env = dict(os.environ)
    env["PATH"] = f"{binn}{os.pathsep}{env['PATH']}"
    env["PYTHON"] = str(binn / "fakepy")
    env["CHECK_VERDICT_OUT"] = str(tmp_path / "check-verdict.json")  # never the real tree's file
    env["UNWIRED_VERDICT_OUT"] = str(tmp_path / "unwired-verdict.json")  # …nor the real tree's unwired object
    env["MYPY_OUT"] = str(tmp_path / "mypy-latest.txt")  # per sandbox: eight boxes, eight files
    return env, log


def _run(tmp_path, **rcs):
    env, log = _sandbox(tmp_path, **rcs)
    p = subprocess.run([CHECK], env=env, capture_output=True, text=True, timeout=120)
    ran = log.read_text().split() if log.exists() else []
    return p, ran


def test_all_green_exits_zero_and_runs_all_four_blocking_gates(tmp_path):
    p, ran = _run(tmp_path)
    assert p.returncode == 0, p.stdout + p.stderr
    # `format` JOINED THE BLOCKING SET on 2026-10-05 (owner: "Add formatter."), so every pin on the
    # gate SHAPE moves with it. Updated deliberately, which is what these pins are for.
    assert set(ran) == {"ruff", "format", "shellcheck", "pytest"}, ran
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
    # `format` JOINED THE BLOCKING SET on 2026-10-05 (owner: "Add formatter."), so every pin on the
    # gate SHAPE moves with it. Updated deliberately, which is what these pins are for.
    assert set(ran) == {"ruff", "format", "shellcheck", "pytest"}, ran


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
    out = subprocess.run(
        ["git", "ls-files", "-s", "--", os.path.basename(CHECK)], cwd=HERE, capture_output=True, text=True, timeout=30
    )
    assert out.returncode == 0 and out.stdout.strip(), (
        "could not read the committed mode from git — an unverifiable mode is the gap itself, "
        f"not a reason to skip: {out.stderr}"
    )
    mode = out.stdout.split()[0]
    assert mode == "100755", (
        f"check.sh is committed as {mode}, not 100755 — it will be non-executable for everyone who "
        "clones. `chmod` alone does not fix this where core.fileMode=false; use "
        "`git update-index --chmod=+x capture-host/check.sh`"
    )
    with open(CHECK, encoding="utf-8") as fh:
        assert fh.readline().startswith("#!"), "check.sh needs a shebang"


def test_it_actually_names_all_three_gates(monkeypatch):
    """Non-vacuity for the stubs above: if check.sh stopped invoking a real gate by name, the sandbox
    would happily report the remaining two as a clean run."""
    src = open(CHECK, encoding="utf-8").read()
    for gate in ("ruff check", '"$SC" --severity=style', "pytest -q --cov"):
        assert gate in src, f"check.sh no longer runs {gate!r}"
    assert "--cov-fail-under=100" in src, "the coverage floor must stay in the aggregate"
    # shellcheck is resolved BESIDE THE INTERPRETER first (the test_shell_surface.py rule), then PATH.
    # A bare `shellcheck` here exited 127 on a box whose only gap was the undeclared wheel (2026-09-06),
    # and the 127 read as "not installed" four times. The fallback must stay bare so a genuinely
    # missing tool still fails visibly instead of being pointed at a path that does not exist.
    assert '"$(dirname "$PY")/shellcheck"' in src, "shellcheck must be looked up beside $PY first"
    assert "|| SC=shellcheck" in src, "the PATH fallback keeps a missing tool visible (127)"


# ── the per-test bound: a hang must have a verdict, and a missing bound must have a voice ────────


def test_the_per_test_bound_is_passed_to_pytest(tmp_path):
    """The bound itself. Without it a hanging test has no upper limit — measured 2026-09-24 as a
    four-hour 99 %-CPU run for an already-merged PR, with no exit code and no failing test."""
    env, _ = _sandbox(tmp_path)
    env["PYTEST_TIMEOUT_S"] = "77"
    p = subprocess.run([CHECK], env=env, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stdout + p.stderr
    src = open(CHECK, encoding="utf-8").read()
    assert '--timeout="$PYTEST_TIMEOUT_S"' in src, "the bound must reach pytest, not merely be defined"
    assert 'PYTEST_TIMEOUT_S="${PYTEST_TIMEOUT_S:-' in src, "and stay overridable for a slow box"


def test_a_MISSING_bound_is_ANNOUNCED_not_silent(tmp_path):
    """The plant, and the whole difference from the `XDIST` line above it: a venv without xdist runs
    the identical gate slower, so silence is honest there. A venv without pytest-timeout runs it with
    NO BOUND, and a guard that is absent and says nothing is the defect the bound exists to fix."""
    env, _ = _sandbox(tmp_path, timeout_plugin=False)
    p = subprocess.run([CHECK], env=env, capture_output=True, text=True, timeout=120)
    out = p.stdout + p.stderr
    assert "pytest-timeout ABSENT" in out, out[-2000:]
    assert "no verdict" in out, "it must say WHAT is lost, not merely that a package is missing"
    assert p.returncode == 0, "and it is a warning, not a gate failure — a contributor can still run it"


def test_the_bound_agrees_with_the_one_CI_runs():
    """TWO invocations, ONE number. CI runs its own `pytest` line (not check.sh), so the bound is
    written twice — the same shape as the mutmut pin, which lives in requirements-dev.txt AND in the
    workflow with a test asserting they agree. A bound that holds locally and not in CI is half-wired,
    and the half that is missing is the one nobody watches."""
    wf = pathlib.Path(HERE).parent / ".github" / "workflows" / "capture-host-ci.yml"
    if not wf.exists():  # pragma: no cover - lane shipped alone
        pytest.skip("workflow not present in this checkout")
    src = open(CHECK, encoding="utf-8").read()
    local = re.search(r'PYTEST_TIMEOUT_S="\$\{PYTEST_TIMEOUT_S:-(\d+)\}"', src)
    assert local, "check.sh must define the bound as a named, overridable default"
    ci = re.findall(r"--timeout=(\d+)", wf.read_text(encoding="utf-8"))
    assert ci, "the CI pytest job must carry the bound too — it does not run check.sh"
    assert set(ci) == {local.group(1)}, f"check.sh says {local.group(1)}, CI says {sorted(set(ci))}"


def test_it_is_not_set_e(monkeypatch):
    """`set -e` would abort at the first failing gate and silently undo the whole point."""
    src = open(CHECK, encoding="utf-8").read()
    assert "set -uo pipefail" in src
    assert "set -euo" not in src, "set -e aborts on the first failing gate"


if sys.platform == "win32":  # pragma: no cover - the box is Linux; guard kept honest
    raise RuntimeError("capture-host is Linux-only")


def test_shutil_which_finds_the_script_dir_independent(tmp_path):
    """check.sh cds to its own directory, so it works from anywhere — a gate you can only run from one
    cwd gets run from the wrong one."""
    env, _ = _sandbox(tmp_path)
    p = subprocess.run([CHECK], cwd=str(tmp_path), env=env, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stdout + p.stderr
    assert shutil.which("bash") is not None


# ── the mypy baseline, which used to live only in a label string ──────────────────────────────────
def _mypy_run(tmp_path, found, *, runtime_deps=True, line=None):
    env, _log = _sandbox(tmp_path, mypy_found=found, mypy_line=line, runtime_deps=runtime_deps)
    p = subprocess.run([CHECK], env=env, capture_output=True, text=True, timeout=120)
    return p.stdout + p.stderr


def _baseline():
    """READ THE BASELINE FROM check.sh, never restate it. These tests hardcoded 103/104 and went red
    the first time the ratchet was tightened (2026-09-13, 103 → 99) — a test that repeats a constant
    instead of reading it turns every legitimate improvement into a failure, which is the incentive
    a ratchet must not create."""
    with open(CHECK, encoding="utf-8") as fh:
        m = re.search(r"^MYPY_BASELINE=(\d+)$", fh.read(), re.M)
    assert m, "check.sh no longer declares MYPY_BASELINE — the tests below cannot mean anything"
    return int(m.group(1))


def test_A_RISEN_COUNT_IS_NAMED_AS_RISEN(tmp_path):
    """🔴 THE DEFECT THIS CLOSES. The baseline lived inside the advisory's note string, where nothing
    read it — so 'count may only go DOWN' was prose, and the count rose from 102 (2026-09-03) to 103
    three days later with every gate green throughout."""
    risen = _baseline() + 1
    out = _mypy_run(tmp_path, risen)
    assert "RISEN" in out and str(risen) in out


def test_A_COUNT_AT_THE_BASELINE_SAYS_SO_WITHOUT_ALARM(tmp_path):
    at = _baseline()
    out = _mypy_run(tmp_path, at)
    assert f"at the {at} baseline" in out
    assert "RISEN" not in out


def test_AN_IMPROVEMENT_SAYS_TO_BANK_IT(tmp_path):
    """A count below the baseline is progress that can be silently spent again unless the baseline
    moves with it — the banked-progress half of any ratchet.

    ⚠️ DERIVED FROM THE BASELINE, like the two tests above, and it was a HARDCODED 90. That is below
    99 and above 68, so the moment someone did the thing this test exists to encourage — bank the
    progress — the literal landed on the wrong side and the test exercised the RISEN path while still
    asserting BELOW. A test that reds when you follow its own advice is worse than no test: it makes
    banking look like a regression. Measured 2026-09-17 when the baseline moved 99 -> 68.

    At a baseline of 0 there is no "below" to report — and 0 is where the gate stops being advisory
    and becomes blocking, so that is a real endpoint rather than an awkward edge.
    """
    base = _baseline()
    if base == 0:
        pytest.skip("baseline is 0 — the gate is blocking and there is no improvement path to report")
    out = _mypy_run(tmp_path, base - 1)
    assert "BELOW" in out and "bank it" in out


def test_NO_SUMMARY_LINE_IS_AN_ABORT_NOT_A_CLEAN_TREE(tmp_path):
    """An aborted mypy prints no 'Found N errors'. Reporting that as zero would be the loudest
    possible lie — and it is the exact shape the brief already recorded: a bare `mypy .` aborts on
    tests/_srcscan.py and 'counts' 1, which is 101 short of the truth."""
    out = _mypy_run(tmp_path, None)
    assert "NO COUNT" in out and "aborted, not passed" in out


def test_the_CLEAN_summary_line_is_the_count_ZERO_not_an_abort(tmp_path):
    """Since MYPY_BASELINE reached 0 (#3373) a clean run prints no "Found" line at all — mypy says
    "Success: no issues found in N source files" — and the parser reported every green run as
    "NO COUNT — aborted", a false reading of a pass (measured on #3379's gate logs, 2026-10-10). The
    clean line IS the count 0; both the singular and the plural wording are mypy's own."""
    for line in ("Success: no issues found in 483 source files", "Success: no issues found in 1 source file"):
        case = tmp_path / re.sub(r"\W", "_", line)[:40]  # one sandbox per planted line
        case.mkdir()
        out = _mypy_run(case, None, line=line)
        assert "NO COUNT" not in out and "NO_COUNT" not in out, out
        assert "mypy: 0 errors" in out
        assert ("at the 0 baseline" in out) if _baseline() == 0 else ("BELOW" in out)


def test_ANY_OTHER_LINE_is_still_NO_COUNT_the_honest_refusal(tmp_path):
    """Only mypy's two summary shapes count. A line that merely resembles one — a stray "Success:"
    from another tool, a "Found" with no number, a truncated clean line — is not a count, and
    reading it as 0 would reopen the exact lie the clean-line fix closes."""
    for line in (
        "Success: everything is fine",
        "Found errors in 3 files",
        "Success: no issues found",
        "no issues found in 4 source files",
    ):
        case = tmp_path / re.sub(r"\W", "_", line)[:40]  # one sandbox per planted line
        case.mkdir()
        out = _mypy_run(case, None, line=line)
        assert "NO COUNT" in out and "aborted, not passed" in out, line


def test_THE_ADVISORY_STILL_DOES_NOT_FAIL_THE_RUN(tmp_path):
    """Advisory means advisory. §P3 is what flips mypy blocking, and it flips at 0 — deciding that
    here would pre-empt it."""
    env, _log = _sandbox(tmp_path, mypy_found=999)
    p = subprocess.run([CHECK], env=env, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, "a risen mypy count must report, not fail the gate"


# ── THE VERDICT IS A STATUS, NOT AN ADJECTIVE ───────────────────────────────────────────────────────
# A reader keying on the prose has NO correct option, measured 2026-09-19. Anchored to the sentence
# (`^\s*mypy: .*RISEN`) it breaks on any reflow that keeps the word but moves it — a false GREEN.
# Loosened to `grep -c RISEN` it matches `test_A_RISEN_COUNT_IS_NAMED_AS_RISEN`, which pytest prints in
# its short summary whenever that test FAILS — so the test about the token, failing, reports as the
# condition the token names. A false ALARM, self-referentially.


def _state_of(out, leg):
    """Read a leg's state off the machine-readable line, the way a downstream reader should."""
    m = re.search(r"^\s*advisory-state: (.+)$", out, re.M)
    assert m, f"no advisory-state line in output:\n{out[-800:]}"
    return dict(kv.split("=", 1) for kv in m.group(1).split())[leg]


def test_the_mypy_VERDICT_is_emitted_as_a_status_in_every_direction(tmp_path):
    """Both directions and the improvement, because a status that only appears when alarmed is the
    prose problem again: a reader cannot distinguish "not risen" from "the line moved"."""
    base = _baseline()
    # a fresh dir per run: `_sandbox` mkdirs `bin/`, so three runs cannot share one tmp_path
    # BELOW needs base > 0 — at baseline 0 there is no valid count below it (count=-1 is
    # not a mypy result), so that direction is untestable by construction, not untested.
    cases = [(+1, "RISEN"), (0, "AT_BASELINE")]
    if base > 0:
        cases.append((-1, "BELOW"))
    for delta, want in cases:
        d = tmp_path / f"run{delta}"
        d.mkdir()
        assert _state_of(_mypy_run(d, base + delta), "mypy") == want


def test_a_count_WITHOUT_the_runtime_requirements_is_NOT_COMPARABLE_in_every_direction(tmp_path):
    """Measured 2026-09-26 on one tree with one mypy: 36 errors with only requirements-dev.txt
    installed, 39 with requirements.txt (bleak, typed) too. The dev-only 36 read `BELOW — lower
    MYPY_BASELINE to bank it`, and banking it would set a baseline the fully-installed machine can
    never meet. So when `import bleak` fails the count is reported, but as a quantity that is not
    the baseline's — in EVERY direction, because a RISEN or AT_BASELINE read without the types is
    just as accidental as the BELOW one."""
    base = _baseline()
    # Deltas must yield valid non-negative counts: at baseline 0, delta=-1 would
    # fake a "-1 errors" mypy output that check.sh cannot parse (NO_COUNT, not
    # NOT_COMPARABLE). The direction under test here is the missing-deps one;
    # the count just needs to be a valid mypy result.
    deltas = (+1, 0) if base == 0 else (+1, 0, -1)
    for delta in deltas:
        d = tmp_path / f"nodeps{delta}"
        d.mkdir()
        out = _mypy_run(d, base + delta, runtime_deps=False)
        assert _state_of(out, "mypy") == "NOT_COMPARABLE", out[-600:]
        assert "NOT COMPARABLE" in out and "import bleak" in out and "requirements.txt" in out
        assert "RISEN" not in out and "BELOW" not in out  # never the direction, never the alarm
    # the positive control: the SAME below-baseline count with the requirements present still banks
    # (only when a below-baseline count exists — at baseline 0 there is none by construction)
    if base > 0:
        deps = tmp_path / "deps"
        deps.mkdir()
        assert _state_of(_mypy_run(deps, base - 1), "mypy") == "BELOW"


def test_the_at_baseline_state_does_NOT_contain_the_word_RISEN(tmp_path):
    """The collision this token had to dodge. `test_A_COUNT_AT_THE_BASELINE_SAYS_SO_WITHOUT_ALARM`
    asserts "RISEN" is absent from the WHOLE run, so a token like `NOT_RISEN` would have reded it —
    the negative assertion is the valuable half of that test and the status must not collide with it."""
    out = _mypy_run(tmp_path, _baseline())
    assert "RISEN" not in out


def test_the_status_token_is_UNFORGEABLE_BY_A_TEST_NAME(tmp_path):
    """Why `key=value` rather than a bare word, and it is structural rather than stylistic: `=` cannot
    occur in a Python identifier, so `mypy=RISEN` cannot appear in a test name however that test is
    worded. The false-alarm mode above is excluded by construction, not by care."""
    import keyword

    assert not any(c == "=" for c in "mypy_RISEN")  # an identifier can carry the WORD...
    assert "=" in "mypy=RISEN"  # ...but never the TOKEN
    assert not keyword.iskeyword("mypy")  # (sanity: the leg name is a plain name)
    out = _mypy_run(tmp_path, _baseline())
    assert "mypy=RISEN" not in out, "a non-risen run must not carry the risen token anywhere"


def test_EVERY_advisory_leg_gets_a_state_not_just_mypy(tmp_path):
    """Every leg is NAMED and carries a non-empty state token.

    🔴 THIS ASSERTED `format == "EMPTY_SCOPE"` UNTIL 2026-09-19, WHICH MADE IT A TEST OF THE BRANCH
    RATHER THAN OF THE CODE. The `format` leg is diff-scoped — `git diff --name-only origin/main...HEAD
    -- '*.py'` — so its scope is empty only when the branch has no Python commits. I wrote it on a
    docs-shaped branch, saw `EMPTY_SCOPE` and pinned it; the next person to touch a `.py` file gets `OK`
    and a red test. Found by Wren; reproduced here — same tree, same code, one Python commit flips it.
    The sharpest case was a worktree byte-identical to `main` that still failed, because the leg keys on
    the DIFF and not on the content. CI merged through it green, so the check that failed locally was
    not failing in the lane that gates.

    ⚠️ AND THE OBVIOUS FIX IS VACUOUS — measured, not assumed. "Assert the value is in the declared
    vocabulary" cannot work here, because the only declaration IS the emission sites. I built exactly
    that (derive the set from `check.sh`, then check membership), mutated `AT_BASELINE` to `WOBBLE`, and
    the test still passed: `WOBBLE` became "declared" the moment it was emitted. A vocabulary check
    needs a declaration SEPARATE from the emitter, which this script does not have and which would be a
    hand-maintained duplicate if bolted on.

    So this asserts what the name promises and nothing it cannot back: both legs appear, and each value
    is a non-empty uppercase token. Falsifiable — dropping a leg or emitting an empty state both red it
    — and independent of the branch's shape, which is the property that was missing. A fallthrough to
    `UNSPECIFIED` stays visible as a value rather than silently absent."""
    m = re.search(r"^\s*advisory-state: (.+)$", _mypy_run(tmp_path, _baseline()), re.M)
    assert m, "no advisory-state line at all"
    states = dict(kv.split("=", 1) for kv in m.group(1).split())
    # `format` LEFT the advisory set on 2026-10-05 (owner: "Add formatter.") — it is blocking now, so
    # the set shrank to mypy alone. `devfloors` JOINED it on 2026-10-19 (the declared-floor comparison
    # that `tests/test_dev_requirements.py` could not make, because it compares names), and the set
    # equality is what required this line to move — which is the mechanism this test exists for: a new
    # advisory leg cannot reach the printout without being declared here.
    assert set(states) == {"mypy", "devfloors"}, f"a leg is missing a state: {states}"
    for leg, st in states.items():
        assert re.fullmatch(r"[A-Z][A-Z_]*", st), f"{leg}={st!r} is not a state token"
    # ⚠️ KEPT FROM THE ORIGINAL, and I deleted it once while rewriting this test — restored after a
    # mutation caught it. `UNSPECIFIED` is the printf fallthrough for a leg whose `adv_states` entry is
    # missing, and it is UPPERCASE, so the token-shape check above accepts it happily. Dropping a leg's
    # state desynchronises the parallel arrays and surfaces HERE and nowhere else: not as an absent key
    # (the loop iterates `adv_names`), not as a bad shape. This is the assertion that makes the test's
    # own name true.
    assert "UNSPECIFIED" not in states.values(), f"a leg fell through to UNSPECIFIED: {states}"


def _run_advisory_state(rc, leg_body=""):
    """Exercise `run_advisory`'s DEFAULT directly, because the sandbox cannot: `format` reaches its
    EMPTY_SCOPE branch there and never calls the function, so a test that only inspects the sandbox's
    state line is VACUOUS for the rc-derived default — proven by mutation, it survived removal of the
    default entirely.

    The leg is a shell FUNCTION, and that is the mechanism rather than a convenience: `run_advisory`
    clears `ADVISORY_STATE` on entry, so only a callee running in the SAME shell can set it. That is
    exactly why `mypy_advisory` is a function while the `format` leg is `"$PY" -m ruff ...` — an external
    process cannot reach the variable, so it takes the rc-derived default. My first harness set the
    variable before the call and it was wiped: the failure caught my model of the seam, not the seam."""
    src = pathlib.Path(CHECK).read_text()
    body = src[src.index("run_advisory() {") :]
    body = body[: body.index("\n}\n") + 3]
    script = (
        "adv_names=(); adv_codes=(); adv_notes=(); adv_states=()\n"
        + body
        + f"leg() {{ {leg_body}return {rc}; }}\n"
        + "run_advisory lbl note leg >/dev/null 2>&1\n"
        + 'printf "%s" "${adv_states[0]}"\n'
    )
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30).stdout.strip()


def test_a_leg_that_sets_no_state_still_gets_one_from_its_exit_code():
    """So a future advisory is covered without knowing the seam exists. `ADVISORY_STATE` is the override,
    exactly as `ADVISORY_NOTE` already is; absent it, the exit code decides."""
    assert _run_advisory_state(0) == "OK"
    assert _run_advisory_state(3) == "ISSUES"


def test_a_leg_that_KNOWS_its_direction_overrides_the_exit_code():
    """mypy's whole point: its exit code is 1 in BOTH the risen and the at-baseline case, so the derived
    default would be `ISSUES` either way and carry no direction at all. The override is what lets a leg
    that reports a DIRECTION say which one, rather than only pass/fail."""
    assert _run_advisory_state(1, "ADVISORY_STATE=AT_BASELINE; ") == "AT_BASELINE"
    assert _run_advisory_state(1, "ADVISORY_STATE=RISEN; ") == "RISEN"


def test_the_PROSE_ANCHOR_a_downstream_reader_keys_on_is_byte_STABLE(tmp_path):
    """⚠️ THE HAZARD THIS UNIT COULD HAVE INTRODUCED, pinned so it cannot.

    A peer's handoff predicate is `^\\s*mypy: .*RISEN` — anchored to the sentence's exact prefix and
    leading whitespace. Folding a status INTO that line, or reflowing it to make room for one, would
    have kept the word, passed `test_A_RISEN_COUNT_IS_NAMED_AS_RISEN` (which only needs it SOMEWHERE),
    and silently returned 0 for that reader: a false GREEN, introduced by the fix for the very problem.

    So the status went on its own line and this asserts the old anchor still resolves. Both directions —
    a predicate verified only on the alarmed case proves it fires, not that it discriminates."""
    base = _baseline()
    anchor = r"^\s*mypy: .*RISEN"
    for sub, count, delta in (("risen", 1, +1), ("clean", 0, 0)):
        d = tmp_path / sub
        d.mkdir()
        out = _mypy_run(d, base + delta)
        assert len(re.findall(anchor, out, re.M)) == count, f"{sub}: the anchor moved"


# ── THE OBJECT (VERDICT-CONTRACT §3d): check.sh writes one tepna.verdict/1 beside .mypy-latest.txt ────
def _verdict(tmp_path):
    with open(tmp_path / "check-verdict.json", encoding="utf-8") as fh:
        return json.load(fh)


def test_a_green_run_writes_the_object_over_the_five_blocking_children_and_it_reads_PASS(tmp_path):
    """THE RESIDUE 2026-10-12-find-unwired-has-not-adopted-the-verdict-schema-so-check-sh-can-never-read-
    pass. All five children exit 0 and the object read UNKNOWN anyway, because `unwired` was the last child
    of ours that published no object — so a downstream reader keying on `status` could not tell a green
    gate from a broken one. It now reads PASS, and `unwired` is read from ITS OWN object."""
    p, _ = _run(tmp_path)
    assert p.returncode == 0, "the shell's verdict is unchanged — §3d: the exit code STAYS"
    v = _verdict(tmp_path)
    assert v["schema"] == "tepna.verdict/1" and v["gate"] == "capture-host-check"
    assert v["status"] == "PASS" and v["reason"] is None, v
    assert v["result"]["statuses"] == {
        "ruff": "PASS",
        "format": "PASS",
        "shellcheck": "PASS",
        "pytest": "PASS",
        "unwired": "PASS",
    }
    assert v["result"]["unknown"] == 0 and v["result"]["notRun"] == 0 and v["result"]["fail"] == 0
    # 4 → 5 children with `format` blocking (2026-10-05). The population is the BLOCKING set, so this
    # equality is the one that would have caught a leg added to the printout and not to the object.
    assert v["population"] == {"checked": 5, "eligible": 5, "excluded": 0}
    assert (
        v["result"]["advisory"]["mypy"] == "NO_COUNT"
    )  # the fake mypy prints no summary line: an abort, carried as the token
    assert "verdict: PASS" in p.stdout


@pytest.mark.parametrize(
    "kind, rc, want",
    [
        ("NONE", 0, "UNKNOWN"),  # exit 0 and NO object: an adopted tool that wrote nothing decided nothing
        ("WRONG_GATE", 0, "UNKNOWN"),  # an object about some other gate is not unwired's
        ("PASS", 1, "UNKNOWN"),  # a PASS object beside a non-zero exit contradicts itself
        ("FAIL", 1, "FAIL"),  # its own FAIL object, and the run is FAIL naming it
    ],
)
def test_unwired_is_read_from_ITS_OWN_object_never_from_the_exit_code_alone(tmp_path, kind, rc, want):
    p, _ = _run(tmp_path, unwired_rc=rc, unwired_object=kind)
    v = _verdict(tmp_path)
    assert v["result"]["statuses"]["unwired"] == want, v
    assert v["status"] == want, v
    assert p.returncode == (1 if rc else 0), "§3d: the exit code STAYS the shell's verdict"


def test_a_STALE_unwired_object_from_an_earlier_run_is_never_read_as_this_runs(tmp_path):
    """check.sh removes the object before the child runs. Plant a PASS object where the child will write,
    let the child write NOTHING: a script that did not clear the file would read the planted PASS."""
    env, _ = _sandbox(tmp_path, unwired_object="NONE")
    stale = tmp_path / "unwired-verdict.json"
    import verdict as VD

    VD.write(
        str(stale),
        VD.make(
            gate="find-unwired",
            status="PASS",
            population={"checked": 3, "eligible": 3, "excluded": 0},
            criterion={"name": "x", "threshold": 0, "unit": "findings", "direction": "eq"},
            result={"unexplained": 0},
            evidence=["capture-host/tools/find_unwired.py"],
            reason=None,
            tool="capture-host/tools/find_unwired.py",
        ),
    )  # a VALID PASS object: a script that failed to clear it would read this and call unwired green
    subprocess.run([CHECK], env=env, capture_output=True, text=True, timeout=120)
    assert not stale.exists(), "check.sh did not clear the previous run's unwired object"
    assert _verdict(tmp_path)["result"]["statuses"]["unwired"] == "UNKNOWN"


def test_a_failing_child_is_a_FAIL_object_naming_it_and_the_exit_code_stays(tmp_path):
    p, _ = _run(tmp_path, pytest_rc=1)
    assert p.returncode == 1, "§3d: the exit code STAYS the shell's verdict"
    v = _verdict(tmp_path)
    assert v["status"] == "FAIL" and v["result"]["firstFailure"] == "pytest" and "pytest" in v["reason"]
    assert v["result"]["exitCodes"]["pytest"] == 1


def test_a_MISSING_TOOL_is_NOT_RUN_for_that_child_and_leaves_the_run_UNKNOWN_never_FAIL(tmp_path):
    """CLAUDE.md §🐍: exit 127 is a missing TOOL, not a failing gate — and §3d: an unplanned exclusion
    is never a PASS over the children that ran."""
    _run(tmp_path, shellcheck_rc=127)
    v = _verdict(tmp_path)
    assert v["status"] == "UNKNOWN" and v["result"]["statuses"]["shellcheck"] == "NOT_RUN"
    # 4 → 5 eligible with `format` blocking (2026-10-05); one tool missing still excludes exactly one.
    assert v["population"] == {"checked": 4, "eligible": 5, "excluded": 1}
    assert "not installed" in v["reason"]


def test_the_object_is_validated_by_verdict_js_the_contract_s_own_validator(tmp_path):
    from test_verdict import js_validate

    _run(tmp_path, ruff_rc=1)
    r = js_validate(_verdict(tmp_path))
    assert r["ok"], r["errors"]


def test_every_path_check_sh_writes_is_redirectable():
    """The sandbox relies on both files being overridable; a default that crept back would make eight
    concurrent sandboxes share one file again (the 2026-09-22 race)."""
    code = open(CHECK, encoding="utf-8").read()
    for var in ("MYPY_OUT", "CHECK_VERDICT_OUT", "UNWIRED_VERDICT_OUT"):
        assert f"${{{var}:-" in code, f"{var} is no longer an override — sandboxes would share the checkout's file"


# ── THE PREFLIGHT ────────────────────────────────────────────────────────────────────────────────────
# Measured twice in one day, from two different worktrees (2026-10-18 `wt-mut63-osp`, 2026-10-19
# `wt-nqcframe-hrn`): a `git worktree` has no `.venv`, `PY` falls back to a bare `python3`, and the run
# reports `3 gate(s) failed` with a FAIL verdict naming ruff — about a diff nothing examined. The remedy
# was in the script's header both times, so these pin it in the SCRIPT.


def test_an_interpreter_without_ruff_is_REFUSED_before_any_gate_runs(tmp_path):
    """The defect, in the direction that misreports worst: `$PY -m ruff` with no ruff exits 1, and that
    is also ruff's "violations found" code, so the verdict blames the diff. Nothing may run."""
    p, ran = _run(tmp_path, ruff_mod=False)
    assert p.returncode == 2, p.stdout + p.stderr
    assert ran == [], f"a refusal that still ran gates is not a refusal: {ran}"
    out = p.stdout + p.stderr
    assert "REFUSED" in out and "ruff" in out, out[-2000:]
    assert "PYTHON=" in out, "it must name the remedy, not merely the fault"


def test_an_interpreter_without_pytest_cov_is_REFUSED_so_the_floor_is_never_silently_skipped(tmp_path):
    """The other half: `--cov` with no pytest-cov is exit 4, and the 100 % floor goes unevaluated —
    CLAUDE.md §🐍's "a pytest line without --cov does not evaluate the floor at all"."""
    p, ran = _run(tmp_path, cov_plugin=False)
    assert p.returncode == 2, p.stdout + p.stderr
    assert ran == [], ran
    assert "pytest-cov" in p.stdout + p.stderr


def test_the_refusal_names_EVERY_missing_tool_not_just_the_first(tmp_path):
    """Same reason the gate runs all five children: fix one, re-run, discover the second."""
    p, _ = _run(tmp_path, ruff_mod=False, cov_plugin=False)
    out = p.stdout + p.stderr
    assert "ruff pytest-cov" in out, out[-2000:]


def test_the_refusal_writes_a_NOT_RUN_object_so_no_reader_sees_a_STALE_pass(tmp_path):
    """The object is the API (§🧾). A refusal that writes nothing leaves the PREVIOUS run's object on
    disk, and a reader keying on it reads a PASS over a tree nobody examined."""
    env, _ = _sandbox(tmp_path, ruff_mod=False)
    out_path = pathlib.Path(env["CHECK_VERDICT_OUT"])
    out_path.write_text(json.dumps({"schema": "tepna.verdict/1", "gate": "capture-host-check", "status": "PASS"}))
    p = subprocess.run([CHECK], env=env, capture_output=True, text=True, timeout=120)
    assert p.returncode == 2, p.stdout + p.stderr
    obj = json.loads(out_path.read_text())
    assert obj["status"] == "NOT_RUN", f"a refusal must overwrite the stale PASS: {obj['status']}"
    assert obj["population"] == {"checked": 0, "eligible": 5, "excluded": 5}
    assert obj["result"] is None
    assert "ruff" in obj["reason"] and "nothing was examined" in obj["reason"]


def test_a_COMPLETE_interpreter_is_not_refused(tmp_path):
    """The control. The probes are the only thing standing between a working box and a refusal, so a
    green sandbox must still run all four blocking gates."""
    p, ran = _run(tmp_path)
    assert p.returncode == 0, p.stdout + p.stderr
    assert set(ran) == {"ruff", "format", "shellcheck", "pytest"}, ran
    assert "REFUSED" not in p.stdout + p.stderr
