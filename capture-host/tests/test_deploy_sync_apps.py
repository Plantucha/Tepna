# tepna-capture — tests/test_deploy_sync_apps.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The served bundles must be the gated bundles.

`/srv/tepna/app` is a COPY of the repo's `*.html`, not a symlink and not a checkout — and until
2026-07-26 nothing refreshed it. `deploy-vigil.sh` created the directory, `install-services.sh` only
counted what was in it, and the bundles had been copied by hand once. On that date the served
`PpgDex.html` was a full day behind the repo and ELEVEN bundles had never been copied at all.

A stale bundle is the worst kind of wrong because nothing about it looks wrong: the phone loads an
app that opens, renders and computes — with last week's DSP. Worse, every provenance gate in this
suite operates on the REPO copy, so GATE A can be green on a `manifestHash` that is not the code
being served.
"""
import os
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "deploy", "sync-apps.sh")


def _run(src, dest, *args):
    return subprocess.run(["bash", SH, *args], capture_output=True, text=True,
                          env={**os.environ, "TEPNA_SRC": str(src), "TEPNA_APP_DIR": str(dest)})


def _src(tmp_path, names=("A.html", "B.html")):
    d = tmp_path / "repo"
    d.mkdir()
    for i, n in enumerate(names):
        (d / n).write_text(f"bundle {n} v1\n" + "x" * (10 + i))
    return d


def test_a_fresh_destination_gets_every_bundle(tmp_path):
    src = _src(tmp_path)
    dest = tmp_path / "app"
    r = _run(src, dest)
    assert r.returncode == 0, r.stdout + r.stderr
    assert (dest / "A.html").read_text() == (src / "A.html").read_text()
    assert "2 added" in r.stdout


def test_a_stale_bundle_is_refreshed(tmp_path):
    src, dest = _src(tmp_path), tmp_path / "app"
    _run(src, dest)
    (src / "A.html").write_text("bundle A.html v2 — a DSP changed\n")
    r = _run(src, dest)
    assert r.returncode == 0
    assert (dest / "A.html").read_text() == (src / "A.html").read_text()
    assert "1 refreshed" in r.stdout


def test_check_goes_RED_on_a_stale_bundle(tmp_path):
    """A verifier that cannot fail is not a verifier — and the exit code is the part CI reads."""
    src, dest = _src(tmp_path), tmp_path / "app"
    _run(src, dest)
    (src / "A.html").write_text("moved on\n")
    r = _run(src, dest, "--check")
    assert r.returncode == 1, f"stale bundle must exit non-zero, got {r.returncode}\n{r.stdout}"
    assert "STALE" in r.stdout


def test_check_goes_RED_on_a_missing_bundle(tmp_path):
    src, dest = _src(tmp_path), tmp_path / "app"
    _run(src, dest)
    os.remove(dest / "B.html")
    r = _run(src, dest, "--check")
    assert r.returncode == 1
    assert "MISSING" in r.stdout


def test_check_is_GREEN_when_the_served_set_matches(tmp_path):
    src, dest = _src(tmp_path), tmp_path / "app"
    _run(src, dest)
    r = _run(src, dest, "--check")
    assert r.returncode == 0, r.stdout


def test_check_does_not_write(tmp_path):
    """--check must be observation only, or a CI run silently repairs what it was asked to detect."""
    src, dest = _src(tmp_path), tmp_path / "app"
    _run(src, dest)
    (src / "A.html").write_text("moved on\n")
    before = (dest / "A.html").read_text()
    _run(src, dest, "--check")
    assert (dest / "A.html").read_text() == before, "--check modified the destination"


# ── the deletion the script deliberately does not do ──────────────────────────────────────────
def test_a_file_the_repo_does_not_have_is_reported_and_LEFT(tmp_path):
    """A deploy script that prunes a directory it does not fully own is one rename away from removing
    something an operator put there on purpose. Reporting is enough to notice."""
    src, dest = _src(tmp_path), tmp_path / "app"
    _run(src, dest)
    (dest / "OperatorNote.html").write_text("mine")
    r = _run(src, dest)
    assert (dest / "OperatorNote.html").exists(), "the script must never delete"
    assert "extra (left alone)" in r.stdout


def test_an_extra_file_alone_does_not_fail_the_check(tmp_path):
    """Extras are reported, not a failure — otherwise --check reds on a directory that is correct."""
    src, dest = _src(tmp_path), tmp_path / "app"
    _run(src, dest)
    (dest / "OperatorNote.html").write_text("mine")
    assert _run(src, dest, "--check").returncode == 0


def test_an_empty_or_wrong_source_fails_loudly(tmp_path):
    """Pointing at the wrong directory must not silently 'sync' zero bundles and report success."""
    empty = tmp_path / "empty"; empty.mkdir()
    r = _run(empty, tmp_path / "app")
    assert r.returncode == 1
    assert "no *.html bundles" in r.stdout


# ── the wiring ────────────────────────────────────────────────────────────────────────────────
def test_the_deploy_actually_calls_it():
    """The script only helps if the deploy runs it; that is the whole gap being closed."""
    body = open(os.path.join(HERE, "deploy", "deploy-vigil.sh"), encoding="utf-8").read()
    assert "sync-apps.sh" in body


def test_install_services_no_longer_writes_its_own_caddyfile():
    """It had drifted: no /monitor route, no /captures, and a bare `encode gzip` with no match block —
    re-running it would have deleted the monitor and restored the SSE gzip stall. One config, one
    owner (expose-monitor.sh)."""
    body = open(os.path.join(HERE, "deploy", "install-services.sh"), encoding="utf-8").read()
    assert "cat > /etc/caddy/Caddyfile" not in body, "install-services.sh must not own the web config"
    assert "expose-monitor.sh" in body, "it must point at the tool that does"


# ══ /etc DRIFT (2026-07-26) ═══════════════════════════════════════════════════════════════════
# Same rot as the served bundles, one directory over. On that date the installed udev rule was two
# fixes behind the repo and a hot-plugged adapter spent the evening with autosuspend live — while
# `systemctl status` was green, because the file was present and only its CONTENT was stale.
#
# It is a CHECKER, not a fixer, and that distinction is load-bearing:
#     repo  tepna-capture.service : User=tepna  ReadWritePaths=/srv/tepna
#     box   /etc/systemd/system/  : User=vigil  ReadWritePaths=/srv/tepna /opt/tepna/capture-host
# `id tepna` on the box: no such user. Syncing that file would leave capture unable to start and
# revoke the write access webmon needs for config.yaml.
CHK = os.path.join(HERE, "deploy", "check-system-files.sh")


def _chk(src, systemd, udev, *args):
    return subprocess.run(["bash", CHK, *args], capture_output=True, text=True,
                          env={**os.environ, "TEPNA_SRC": str(src),
                               "TEPNA_ETC_SYSTEMD": str(systemd), "TEPNA_ETC_UDEV": str(udev)})


def _tree(tmp_path, capture_user_repo="tepna", capture_user_etc="tepna"):
    src = tmp_path / "capture-host" / "systemd"
    src.mkdir(parents=True)
    (tmp_path / "capture-host" / "deploy").mkdir(parents=True)
    systemd = tmp_path / "etc-systemd"; systemd.mkdir()
    udev = tmp_path / "etc-udev"; udev.mkdir()
    (src / "99-tepna-btdongle.rules").write_text('ACTION=="add", ATTR{idVendor}=="2357"\n')
    (src / "tepna-usb-autosuspend.service").write_text("[Service]\nType=oneshot\n")
    unit = "[Service]\nUser={u}\nGroup={u}\nReadWritePaths=/srv/tepna\nExecStart=/x\n"
    # deploy/ is the installed source (see the script header); systemd/ no longer participates.
    (tmp_path / "capture-host" / "deploy" / "tepna-capture.service").write_text(unit.format(u=capture_user_repo))
    (udev / "99-tepna-btdongle.rules").write_text('ACTION=="add", ATTR{idVendor}=="2357"\n')
    (systemd / "tepna-usb-autosuspend.service").write_text("[Service]\nType=oneshot\n")
    (systemd / "tepna-capture.service").write_text(unit.format(u=capture_user_etc))
    return tmp_path / "capture-host", systemd, udev


def test_a_matching_tree_is_green(tmp_path):
    src, sd, ud = _tree(tmp_path)
    r = _chk(src, sd, ud)
    assert r.returncode == 0, r.stdout
    assert "0 drifted" in r.stdout


def test_a_stale_managed_file_goes_RED(tmp_path):
    """THE regression: the installed udev rule two fixes behind, with nothing saying so."""
    src, sd, ud = _tree(tmp_path)
    (ud / "99-tepna-btdongle.rules").write_text('ACTION=="add", ATTR{idVendor}=="2357"\n# old\n')
    r = _chk(src, sd, ud)
    assert r.returncode == 1
    assert "STALE" in r.stdout


def test_a_User_difference_in_etc_is_now_REAL_drift(tmp_path):
    """This used to be normalised away as "site keys". It is drift: the installed unit no longer
    matches the committed one, and the whole reason to look is to find out when that happens."""
    src, sd, ud = _tree(tmp_path, capture_user_repo="vigil", capture_user_etc="tepna")
    r = _chk(src, sd, ud)
    assert r.returncode == 1
    assert "STALE" in r.stdout


def test_install_writes_the_unit_from_the_deploy_copy(tmp_path):
    """The old rule was "never write this file", because the only repo copy named a user the box does
    not have. The deploy/ copy names the RIGHT user and is what /etc already holds, so installing it is
    correct — and refusing to would leave the one file most worth keeping current permanently stale."""
    src, sd, ud = _tree(tmp_path, capture_user_repo="vigil", capture_user_etc="tepna")
    _chk(src, sd, ud, "--install")
    assert (sd / "tepna-capture.service").read_text() == \
        (src / "deploy" / "tepna-capture.service").read_text()


def test_install_does_replace_a_stale_managed_file(tmp_path):
    src, sd, ud = _tree(tmp_path)
    (ud / "99-tepna-btdongle.rules").write_text("stale\n")
    _chk(src, sd, ud, "--install")
    assert (ud / "99-tepna-btdongle.rules").read_text() == \
        (src / "systemd" / "99-tepna-btdongle.rules").read_text()


def test_a_file_missing_from_etc_is_drift_not_a_crash(tmp_path):
    src, sd, ud = _tree(tmp_path)
    os.remove(sd / "tepna-usb-autosuspend.service")
    r = _chk(src, sd, ud)
    assert r.returncode == 1
    assert "NOT INSTALLED" in r.stdout


def test_the_deploy_runs_the_check():
    body = open(os.path.join(HERE, "deploy", "deploy-vigil.sh"), encoding="utf-8").read()
    assert "check-system-files.sh" in body


# ══ THE CHECKER WAS WATCHING THE WRONG FILE (2026-07-26, same day it shipped) ══════════════════════
# It compared `systemd/tepna-capture.service` and reported "✓ same but for site keys". The box installs
# `deploy/tepna-capture.service` — a DIFFERENT file that is byte-identical to /etc. The site-key
# normalisation papered over `User=tepna` vs `User=vigil` between two SOURCES, and comment-stripping hid
# the rest, so the green said nothing about the file anyone actually runs.
#
# Two files with one name is the condition that produced it, so that condition is now itself the alarm.
def _tree_two_sources(tmp_path, deploy_body, systemd_body, etc_body):
    src = tmp_path / "capture-host"
    (src / "systemd").mkdir(parents=True)
    (src / "deploy").mkdir(parents=True)
    systemd = tmp_path / "etc-systemd"; systemd.mkdir()
    udev = tmp_path / "etc-udev"; udev.mkdir()
    (src / "systemd" / "99-tepna-btdongle.rules").write_text("rule\n")
    (udev / "99-tepna-btdongle.rules").write_text("rule\n")
    (src / "systemd" / "tepna-usb-autosuspend.service").write_text("unit\n")
    (systemd / "tepna-usb-autosuspend.service").write_text("unit\n")
    (src / "deploy" / "tepna-capture.service").write_text(deploy_body)
    (src / "systemd" / "tepna-capture.service").write_text(systemd_body)
    (systemd / "tepna-capture.service").write_text(etc_body)
    return src, systemd, udev


UNIT_V = "[Service]\nUser=vigil\nExecStart=/x\n"
UNIT_T = "[Service]\nUser=tepna\nExecStart=/x\n"


def test_the_installed_file_is_the_one_compared(tmp_path):
    """/etc matches deploy/ byte-for-byte; systemd/ differs. That must read as IN SYNC."""
    src, sd, ud = _tree_two_sources(tmp_path, UNIT_V, UNIT_T, UNIT_V)
    r = _chk(src, sd, ud)
    assert "in sync" in r.stdout, r.stdout


def test_a_second_differing_copy_is_reported_as_AMBIGUOUS(tmp_path):
    """THE regression: two files named tepna-capture.service, one installed, one watched."""
    src, sd, ud = _tree_two_sources(tmp_path, UNIT_V, UNIT_T, UNIT_V)
    r = _chk(src, sd, ud)
    assert "AMBIGUOUS SOURCE" in r.stdout, r.stdout
    assert r.returncode == 1, "an ambiguous source must be non-zero even when /etc matches"


def test_no_ambiguity_when_the_copies_agree(tmp_path):
    """One name, two paths, identical bytes — nothing to choose between, so no alarm."""
    src, sd, ud = _tree_two_sources(tmp_path, UNIT_V, UNIT_V, UNIT_V)
    r = _chk(src, sd, ud)
    assert "AMBIGUOUS" not in r.stdout, r.stdout
    assert r.returncode == 0, r.stdout


def test_drift_in_the_installed_file_is_still_caught(tmp_path):
    src, sd, ud = _tree_two_sources(tmp_path, UNIT_V, UNIT_V, UNIT_V.replace("/x", "/y"))
    r = _chk(src, sd, ud)
    assert "STALE" in r.stdout and r.returncode == 1


def test_install_services_installs_from_the_repo_not_HOME(tmp_path):
    """`install -m644 /home/$OWNER/tepna-capture.service` installed a hand-edited file outside version
    control. It was a day stale and would have reverted the CAP_NET_ADMIN grant on the next deploy."""
    body = open(os.path.join(HERE, "deploy", "install-services.sh"), encoding="utf-8").read()
    assert "/home/$OWNER/tepna-capture.service" not in body
    assert "UNIT_SRC=" in body and "tepna-capture.service" in body


# ── a test must not reach past its sandbox into real host state (CAPTURE-HOST-DEEP-AUDIT §E6) ───
def test_a_redirected_install_does_not_reload_the_real_host(tmp_path):
    """THE §E6 regression, and it was being triggered BY THIS FILE. `check-system-files.sh` ran
    `udevadm control --reload-rules` and `systemctl daemon-reload` unconditionally whenever it
    installed >0 files — while `TEPNA_ETC_SYSTEMD`/`TEPNA_ETC_UDEV` exist precisely so a caller can
    install somewhere else. The tests below drive it with `--install` and both vars pointed at a
    tmpdir, so they installed into the tmpdir and reloaded the DEVELOPER'S OWN systemd.

    On a desktop that is a blocking polkit password dialog, and `2>/dev/null` hid it from pytest
    output: 14 prompts in 20 minutes, the suite blocked on each until cancelled.

        polkitd: Operator of unix-session:3 FAILED to authenticate to gain authorization for action
        org.freedesktop.systemd1.reload-daemon ... [systemctl daemon-reload]
    """
    src, sd, ud = _tree(tmp_path, capture_user_repo="tepna", capture_user_etc="vigil")
    r = _chk(src, sd, ud, "--install")
    assert "installed" in r.stdout, "the fixture must actually install something, or this proves nothing"
    assert "systemd NOT reloaded" in r.stdout
    assert "udev NOT reloaded" in r.stdout
    assert "systemd units reloaded" not in r.stdout
    assert "udev rules reloaded" not in r.stdout


def test_the_reload_guard_names_the_real_host_paths():
    """The guard has to compare against the paths the script itself defaults to, or a rename would
    silently disarm it — the failure would be invisible again (a passing suite that prompts for a
    password)."""
    body = open(CHK).read()
    assert 'ETC_SYSTEMD="${TEPNA_ETC_SYSTEMD:-/etc/systemd/system}"' in body
    assert 'ETC_UDEV="${TEPNA_ETC_UDEV:-/etc/udev/rules.d}"' in body
    assert '[ "$ETC_SYSTEMD" = "/etc/systemd/system" ]' in body
    assert '[ "$ETC_UDEV" = "/etc/udev/rules.d" ]' in body


def test_no_test_executes_a_deploy_script_that_mutates_host_state_unguarded():
    """The CLASS, not just the instance. Any test that SHELLS OUT to a deploy script can reach past its
    sandbox into real host state; the only ones safe to execute are those whose host-mutating commands
    are gated on a real-path check, or that touch nothing but files and HTTP.

    Parsed rather than grepped: a plain text match counts `open(.../install-services.sh)` — a
    source-inspection test that executes nothing — as if it ran the script, which is how this check
    first reported four false positives. It walks `subprocess.*` calls and resolves the module-level
    constants they are given.

    Enumerated so that a test which STARTS executing a new deploy script has to come here and say so."""
    import ast
    import glob
    executed = set()
    for t in sorted(glob.glob(os.path.join(HERE, "tests", "*.py"))):
        tree = ast.parse(open(t, encoding="utf-8").read())
        # module-level `CHK = os.path.join(HERE, "deploy", "check-system-files.sh")`
        names = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
                lits = [a.value for a in node.value.args
                        if isinstance(a, ast.Constant) and isinstance(a.value, str)]
                sh = [v for v in lits if v.endswith(".sh")]
                if sh and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                    names[node.targets[0].id] = sh[0]
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and isinstance(node.func.value, ast.Name) and node.func.value.id == "subprocess"):
                continue
            for a in ast.walk(node):
                if isinstance(a, ast.Constant) and isinstance(a.value, str) and a.value.endswith(".sh"):
                    executed.add(os.path.basename(a.value))
                elif isinstance(a, ast.Name) and a.id in names:
                    executed.add(os.path.basename(names[a.id]))
    assert executed, "the scan found no executed deploy scripts — it has stopped working"
    # check-system-files.sh: guarded above. sync-apps.sh / sse-frames.sh: files and HTTP only.
    assert executed <= {"check-system-files.sh", "sync-apps.sh", "sse-frames.sh"}, (
        f"a test now executes {sorted(executed)} — confirm it cannot mutate real host state "
        f"(systemctl / udevadm / mount / ip / install into /etc) before adding it here")
