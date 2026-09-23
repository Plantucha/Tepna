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


def _sandbox(tmp_path, *, ruff_rc=0, shellcheck_rc=0, pytest_rc=0, mypy_found=None):
    """A PATH where each gate is a stub that records that it ran and exits as scripted."""
    binn = tmp_path / "bin"
    binn.mkdir()
    log = tmp_path / "ran.log"

    # `mypy_found` scripts the SUMMARY LINE, not a line count: check.sh reads the count off mypy's
    # own "Found N errors" line, because the output also carries `note:` lines and counting those
    # would drift from the number the baseline describes.
    mypy_emit = (
        f'echo "Found {mypy_found} errors in 3 files (checked 300 source files)"' if mypy_found is not None else "true"
    )
    # One fake `python` dispatching on `-m <tool>`; check.sh invokes ruff and pytest through $PYTHON.
    _write_exec(
        str(binn / "fakepy"),
        f"""#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    ruff)   echo ruff   >> "{log}"; exit {ruff_rc} ;;
    pytest) echo pytest >> "{log}"; exit {pytest_rc} ;;
    mypy)   {mypy_emit}; exit 0 ;;   # NOT logged: `ran` is the BLOCKING gate set, and mypy is advisory
    checkverdict.py) exec python3 "$@" ;;   # the verdict writer runs for REAL — it is what the object tests read
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
    env["CHECK_VERDICT_OUT"] = str(tmp_path / "check-verdict.json")   # never the real tree's file
    env["MYPY_OUT"] = str(tmp_path / "mypy-latest.txt")              # per sandbox: eight boxes, eight files
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
def _mypy_run(tmp_path, found):
    env, _log = _sandbox(tmp_path, mypy_found=found)
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
    for delta, want in ((+1, "RISEN"), (0, "AT_BASELINE"), (-1, "BELOW")):
        d = tmp_path / f"run{delta}"
        d.mkdir()
        assert _state_of(_mypy_run(d, base + delta), "mypy") == want


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
    assert set(states) == {"mypy", "format"}, f"a leg is missing a state: {states}"
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


def test_a_green_run_writes_the_object_over_the_four_blocking_children_UNKNOWN_until_unwired_adopts(tmp_path):
    p, _ = _run(tmp_path)
    assert p.returncode == 0, "the shell's verdict is unchanged — §3d: the exit code STAYS"
    v = _verdict(tmp_path)
    assert v["schema"] == "tepna.verdict/1" and v["gate"] == "capture-host-check"
    assert v["status"] == "UNKNOWN" and v["result"]["statuses"]["unwired"] == "UNKNOWN"   # ours, unadopted: by provenance
    assert {k: s for k, s in v["result"]["statuses"].items() if k != "unwired"} == {"ruff": "PASS", "shellcheck": "PASS", "pytest": "PASS"}
    assert v["population"] == {"checked": 4, "eligible": 4, "excluded": 0}
    assert v["result"]["advisory"]["mypy"] == "NO_COUNT"   # the fake mypy prints no summary line: an abort, carried as the token
    assert "verdict: UNKNOWN" in p.stdout


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
    assert v["population"] == {"checked": 3, "eligible": 4, "excluded": 1}
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
    for var in ("MYPY_OUT", "CHECK_VERDICT_OUT"):
        assert f"${{{var}:-" in code, f"{var} is no longer an override — sandboxes would share the checkout's file"
