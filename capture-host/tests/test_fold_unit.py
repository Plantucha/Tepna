# tepna-capture — tests/test_fold_unit.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The fold runs inside a fence, and capture outranks it — asserted on the files that carry it.

VIGIL-SELF-SUSTAINED-FOLDING-2026-09-01-BRIEF acceptance 2. The box measured `MemoryMax=infinity` and
`OOMScoreAdjust=0` on 2026-10-17, so until these units install, nothing on vigil ranks a recording above
a fold. These invariants live in unit files that no test can execute (they need root and real system
paths), so they are asserted against their SOURCE — the same approach test_shell_surface.py takes for
the privileged scripts.

The one invariant worth naming twice: the fold's `OOMScoreAdjust` and the capture daemon's are ONE
decision, not two settings. A test on either alone would pass while the pair was broken.
"""

import os
import stat
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLD_UNIT = os.path.join(HERE, "systemd", "tepna-fold.service")
FOLD_TIMER = os.path.join(HERE, "systemd", "tepna-fold.timer")
CAPTURE_UNIT = os.path.join(HERE, "deploy", "tepna-capture.service")
WRAPPER = os.path.join(HERE, "deploy", "tepna-fold.sh")
MANIFEST = os.path.join(HERE, "deploy", "check-system-files.sh")
INSTALLER = os.path.join(HERE, "deploy", "install-services.sh")


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _directives(path):
    """Unit directives as a dict, comments dropped. Last writer wins, as systemd reads them."""
    out = {}
    for line in _read(path).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("["):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


# ── the fence ─────────────────────────────────────────────────────────────────────────────────────


def test_the_fold_is_capped_at_the_briefs_own_pre_stated_bar():
    d = _directives(FOLD_UNIT)
    assert d["MemoryMax"] == "4G", "acceptance 1 pre-stated 4 GB; the fence IS that criterion"


def test_swap_cannot_hide_a_breach():
    assert _directives(FOLD_UNIT)["MemorySwapMax"] == "0"


def test_the_fold_yields_cpu_and_disk_to_whatever_else_runs():
    d = _directives(FOLD_UNIT)
    assert int(d["Nice"]) > 0
    assert d["IOSchedulingClass"] == "idle"
    assert int(d["CPUWeight"]) < 100


def test_capture_outranks_the_fold_for_the_kernel():
    """The pair, in one assertion — a test on either side alone passes while the pair is broken."""
    capture = int(_directives(CAPTURE_UNIT)["OOMScoreAdjust"])
    fold = int(_directives(FOLD_UNIT)["OOMScoreAdjust"])
    assert capture < 0, "the capture daemon must be the protected tenant"
    assert fold > 0, "the fold must be the first thing the kernel reaches for"
    assert capture < fold


def test_nothing_to_fold_is_a_success_not_a_daily_failure_mail():
    assert "4" in _directives(FOLD_UNIT)["SuccessExitStatus"].split()


def test_the_fold_runs_unprivileged_and_sees_only_srv_tepna():
    d = _directives(FOLD_UNIT)
    assert d["User"] == "vigil"
    assert d["ProtectSystem"] == "strict"
    assert d["ProtectHome"] == "true"
    assert d["ReadWritePaths"] == "/srv/tepna"
    # Safe HERE and nowhere else: the fold reaches no sudo helper, unlike the capture daemon.
    assert d["NoNewPrivileges"] == "yes"
    assert _directives(CAPTURE_UNIT)["NoNewPrivileges"] == "no"


def test_a_wedged_fold_ends_instead_of_holding_the_next_firing():
    assert int(_directives(FOLD_UNIT)["TimeoutStartSec"]) > 0


def test_the_unit_names_its_own_journal_scope():
    comments = "\n".join(ln for ln in _read(FOLD_UNIT).splitlines() if ln.startswith("#"))
    assert "journalctl -u tepna-fold" in comments
    assert "--user-unit" in comments


# ── the schedule ──────────────────────────────────────────────────────────────────────────────────


def test_the_fold_fires_in_the_daytime_dead_zone():
    oncal = _directives(FOLD_TIMER)["OnCalendar"]
    hour = int(oncal.split()[-1].split(":")[0])
    # After the 08:30 report, before the 13:00 SD harvest and the 13:30 archive pull.
    assert 9 <= hour < 13, f"OnCalendar {oncal!r} is not in the daytime dead zone"


def test_a_box_that_was_off_still_folds_when_it_returns():
    assert _directives(FOLD_TIMER)["Persistent"] == "true"
    assert _directives(FOLD_TIMER)["WantedBy"] == "timers.target"


# ── the wrapper ───────────────────────────────────────────────────────────────────────────────────


def test_the_wrapper_is_executable_and_parses():
    assert os.stat(WRAPPER).st_mode & stat.S_IXUSR
    subprocess.run(["bash", "-n", WRAPPER], check=True)


def test_the_wrapper_never_forces_jobs():
    """CLAUDE.md: never force `--jobs`. The planner probes, and reads this unit's own fence."""
    # Comments are dropped first: the reason for the absence is written in the file beside the absence,
    # so the flag's NAME appears there. The assertion is about what the wrapper RUNS.
    code = "\n".join(ln for ln in _read(WRAPPER).splitlines() if not ln.lstrip().startswith("#"))
    assert "--jobs" not in code
    assert "--skip-existing" in code


def _run(tmp_path, **env):
    e = dict(os.environ)
    e.update({k: str(v) for k, v in env.items()})
    return subprocess.run([WRAPPER], capture_output=True, text=True, env=e, cwd=str(tmp_path))


def _tree(tmp_path, *, node=True, src=True, tool=True):
    root = tmp_path / "root"
    (root / "tools").mkdir(parents=True)
    if tool:
        (root / "tools" / "trio-batch.mjs").write_text("// stub\n")
    src_dir = tmp_path / "captures"
    if src:
        src_dir.mkdir()
    stub = tmp_path / "fake-node"
    stub.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGV_OUT"\n')
    stub.chmod(0o755)
    env = {
        "TEPNA_FOLD_ROOT": root,
        "TEPNA_FOLD_SRC": src_dir,
        "TEPNA_FOLD_OUT": tmp_path / "out",
        "ARGV_OUT": tmp_path / "argv.txt",
    }
    env["TEPNA_FOLD_NODE"] = str(stub) if node else str(tmp_path / "absent-node")
    return env


def test_an_absent_node_runtime_exits_4_and_says_which_step_is_owed(tmp_path):
    r = _run(tmp_path, **_tree(tmp_path, node=False))
    assert r.returncode == 4
    assert "node" in r.stdout and "owner" in r.stdout


def test_an_absent_captures_directory_exits_4(tmp_path):
    r = _run(tmp_path, **_tree(tmp_path, src=False))
    assert r.returncode == 4
    assert "nothing to fold" in r.stdout


def test_a_tree_without_the_fold_tool_exits_4(tmp_path):
    r = _run(tmp_path, **_tree(tmp_path, tool=False))
    assert r.returncode == 4
    assert "not a full checkout" in r.stdout


def test_a_complete_box_folds_its_captures_into_the_output_root(tmp_path):
    env = _tree(tmp_path)
    r = _run(tmp_path, **env)
    assert r.returncode == 0, r.stderr
    argv = (tmp_path / "argv.txt").read_text().split("\n")
    assert str(env["TEPNA_FOLD_ROOT"] / "tools" / "trio-batch.mjs") in argv
    assert "--src" in argv and str(env["TEPNA_FOLD_SRC"]) in argv
    assert "--out" in argv and str(env["TEPNA_FOLD_OUT"]) in argv
    assert "--skip-existing" in argv
    assert "--jobs" not in argv
    assert (tmp_path / "out").is_dir(), "the output root is created before the fold runs"


# ── deployment ────────────────────────────────────────────────────────────────────────────────────


def test_both_units_are_managed_so_drift_is_visible():
    manifest = _read(MANIFEST)
    for name in ("tepna-fold.service", "tepna-fold.timer"):
        row = f"systemd/{name}|$ETC_SYSTEMD/{name}|MANAGED|0644"
        assert row in manifest, f"{name} is not a MANAGED row — a drifted copy would be invisible"


def test_the_installer_enables_the_timer_and_never_the_oneshot():
    s = _read(INSTALLER)
    assert "systemctl enable --now tepna-fold.timer" in s
    assert "enable --now tepna-fold.service" not in s
    assert "enable --now tepna-fold\n" not in s


@pytest.mark.skipif(sys.platform != "linux", reason="systemd-analyze is Linux-only")
def test_every_directive_is_one_systemd_accepts():
    """A typo in a directive name is SILENTLY IGNORED by systemd — the fence would simply be absent."""
    exe = subprocess.run(["sh", "-c", "command -v systemd-analyze"], capture_output=True, text=True)
    if exe.returncode != 0:
        pytest.skip("systemd-analyze absent")
    r = subprocess.run(
        ["systemd-analyze", "verify", FOLD_UNIT, FOLD_TIMER],
        capture_output=True,
        text=True,
    )
    noise = ("is not executable", "legacy directory", "teamviewerd")
    bad = [ln for ln in (r.stdout + r.stderr).splitlines() if "tepna-fold" in ln and not any(n in ln for n in noise)]
    assert not bad, "\n".join(bad)
