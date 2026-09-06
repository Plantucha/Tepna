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
import re
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "deploy", "sync-apps.sh")


def _run(src, dest, *args):
    return subprocess.run(["bash", SH, *args], capture_output=True, text=True,
                          env={**os.environ, "TEPNA_SRC": str(src), "TEPNA_APP_DIR": str(dest)})


def _src(tmp_path, names=("A.html", "B.html"), clutter=True):
    """A mini repo in the REAL shape: each served app is an owned bundle with a
    `provenance/<App>.json` fragment beside it.

    The fixture used to be a directory of arbitrary `*.html`, which is exactly the assumption
    CAPTURE-HOST-DEEP-AUDIT §C7 is about — `bundles=("$SRC"/*.html)` selected on EXTENSION, so it swept
    up 11 unbundled `*.src.html` editing sources and ~30 analysis harnesses and served them with none
    of their `.js`/`.css` siblings. A fixture that contains nothing but valid bundles cannot express
    that, so it now carries the clutter the real root has."""
    d = tmp_path / "repo"
    (d / "provenance").mkdir(parents=True)
    for i, n in enumerate(names):
        (d / n).write_text(f"bundle {n} v1\n" + "x" * (10 + i))
        (d / "provenance" / (n[:-5] + ".json")).write_text('{"bundle": "%s"}' % n)
    (d / "provenance" / "_meta.json").write_text("{}")
    (d / "provenance" / "index.json").write_text('{"apps": []}')
    if clutter:
        # Present in the root, MUST NOT be served: an editing source (needs its .js siblings) and an
        # analysis harness (needs the whole module set).
        (d / "A.src.html").write_text('<script src="a-dsp.js"></script>\n')
        (d / "Dex-Test-Suite.html").write_text('<script src="tests/dex-tests.js"></script>\n')
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
    assert "no provenance/<App>.json fragments" in r.stdout


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
# It is a CHECKER, not a fixer, and that distinction WAS load-bearing while two copies of the unit
# existed:
#     systemd/tepna-capture.service : User=tepna  ReadWritePaths=/srv/tepna          <- installed by nobody
#     deploy/tepna-capture.service  : User=vigil  ReadWritePaths=/srv/tepna /opt/…   <- the installed one
# `id tepna` on the box: no such user. Syncing the FIRST would have left capture unable to start and
# revoked the write access webmon needs for config.yaml.
#
# RESOLVED 2026-08-05: `systemd/tepna-capture.service` is DELETED and its unique documentation merged
# into the deploy/ copy. It had to be — `ambiguous()` correctly refuses to go green while two different
# files share a name, so on the live box the gate exited 1 on EVERY run with every row reading ✓. A gate
# that cannot be green is a gate that gets ignored, which is this suite's own recurring failure class.
# The fixtures below still build two copies on purpose: they exercise `ambiguous()` itself.
CHK = os.path.join(HERE, "deploy", "check-system-files.sh")


def _chk(src, systemd, udev, *args, networkd=None):
    env = {**os.environ, "TEPNA_SRC": str(src),
           "TEPNA_ETC_SYSTEMD": str(systemd), "TEPNA_ETC_UDEV": str(udev)}
    # The networkd destination is redirected for the same reason as the other two: an install that
    # writes into a tmpdir must never touch the developer's own /etc (§E6).
    env["TEPNA_ETC_NETWORKD"] = str(networkd if networkd is not None else systemd)
    # Same §E6 reasoning for the privileged helper dir: /usr/local/lib/tepna holds the root-owned copies
    # that carry the NOPASSWD sudoers grants, so a redirected run must never be able to write the real one.
    env["TEPNA_LIB_DIR"] = str(systemd.parent / "lib-tepna")
    return subprocess.run(["bash", CHK, *args], capture_output=True, text=True, env=env)


def _tree(tmp_path, capture_user_repo="tepna", capture_user_etc="tepna"):
    src = tmp_path / "capture-host" / "systemd"
    src.mkdir(parents=True)
    (tmp_path / "capture-host" / "deploy").mkdir(parents=True)
    systemd = tmp_path / "etc-systemd"; systemd.mkdir()
    udev = tmp_path / "etc-udev"; udev.mkdir()
    (src / "99-tepna-btdongle.rules").write_text('ACTION=="add", ATTR{idVendor}=="2357"\n')
    (src / "99-tepna-hidraw.rules").write_text('SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1915"\n')
    (src / "tepna-usb-autosuspend.service").write_text("[Service]\nType=oneshot\n")
    unit = "[Service]\nUser={u}\nGroup={u}\nReadWritePaths=/srv/tepna\nExecStart=/x\n"
    # deploy/ is the installed source (see the script header); systemd/ no longer participates.
    (tmp_path / "capture-host" / "deploy" / "tepna-capture.service").write_text(unit.format(u=capture_user_repo))
    (udev / "99-tepna-btdongle.rules").write_text('ACTION=="add", ATTR{idVendor}=="2357"\n')
    (udev / "99-tepna-hidraw.rules").write_text('SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1915"\n')
    (systemd / "tepna-usb-autosuspend.service").write_text("[Service]\nType=oneshot\n")
    (systemd / "tepna-capture.service").write_text(unit.format(u=capture_user_etc))
    # The four privileged NOPASSWD helpers (helper_path.SYSTEM_DIRS[0]). Added to the manifest 2026-08-04
    # after the live box was found running a STALE root-owned tepna-clock.sh and tepna-restart.sh, with
    # tepna-usbreset.sh never installed at all — drift in the most privileged files on the box, invisible
    # because they were not on this list.
    for u in ("tepna-update.service", "tepna-update.timer", "tepna-sniff.service", "tepna-sniff.timer"):
        (src / u).write_text(f"[Unit]\nDescription={u}\n")
        (systemd / u).write_text(f"[Unit]\nDescription={u}\n")
    lib = tmp_path / "lib-tepna"; lib.mkdir()
    for h in ("tepna-clock.sh", "tepna-restart.sh", "tepna-rssi.sh", "tepna-usbreset.sh",
                                             "tepna-btreset.sh", "tepna-wifi.sh"):
        body = f"#!/usr/bin/env bash\n# {h}\n"
        (tmp_path / "capture-host" / h).write_text(body)
        (lib / h).write_text(body)
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
    (src / "systemd" / "99-tepna-hidraw.rules").write_text("hidraw rule\n")
    (udev / "99-tepna-hidraw.rules").write_text("hidraw rule\n")
    (src / "systemd" / "tepna-usb-autosuspend.service").write_text("unit\n")
    (systemd / "tepna-usb-autosuspend.service").write_text("unit\n")
    (src / "deploy" / "tepna-capture.service").write_text(deploy_body)
    (src / "systemd" / "tepna-capture.service").write_text(systemd_body)
    (systemd / "tepna-capture.service").write_text(etc_body)
    # The privileged helpers, in sync — this fixture is about AMBIGUOUS SOURCES, so they must not be
    # the thing that reds it.
    for u in ("tepna-update.service", "tepna-update.timer", "tepna-sniff.service", "tepna-sniff.timer"):
        (src / "systemd" / u).write_text(f"[Unit]\nDescription={u}\n")
        (systemd / u).write_text(f"[Unit]\nDescription={u}\n")
    lib = tmp_path / "lib-tepna"; lib.mkdir()
    for h in ("tepna-clock.sh", "tepna-restart.sh", "tepna-rssi.sh", "tepna-usbreset.sh",
                                             "tepna-btreset.sh", "tepna-wifi.sh"):
        body = f"#!/usr/bin/env bash\n# {h}\n"
        (src / h).write_text(body)
        (lib / h).write_text(body)
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


def test_a_stale_privileged_helper_goes_RED(tmp_path):
    """THE 2026-08-04 finding, reproduced. The live box was running a root-owned tepna-clock.sh eight
    days older than its own checkout, and tepna-restart.sh likewise — invisible because the four
    NOPASSWD helpers were not on this script's manifest.

    It matters more than ordinary drift: `helper_path.SYSTEM_DIRS[0]` is `/usr/local/lib/tepna`, checked
    BEFORE the in-repo copy, so the stale privileged file is the one that actually runs under sudo. A
    fixed helper can sit in the checkout indefinitely while the box keeps executing the old one."""
    src, sd, ud = _tree(tmp_path)
    (tmp_path / "lib-tepna" / "tepna-clock.sh").write_text("#!/usr/bin/env bash\n# EIGHT DAYS OLD\n")
    r = _chk(src, sd, ud)
    assert r.returncode == 1, r.stdout
    assert "STALE" in r.stdout and "tepna-clock.sh" in r.stdout, r.stdout


def test_the_four_privileged_helpers_are_installed_EXECUTABLE(tmp_path):
    """The defect #914 shipped, and the reason the mode column exists.

    #914 correctly put the four NOPASSWD helpers on the manifest — but both install sites still forced
    `install -m 0644`. Those helpers are reached as `sudo -n /usr/local/lib/tepna/<x>.sh …`, so a 0644
    copy is not merely untidy, it is UNRUNNABLE: every scoped grant breaks, including tepna-restart.sh,
    the one that lets a deploy finish itself without an interactive password.

    That made `--install` strictly worse than the drift it repairs, and it was newly reachable, because
    before #914 these files were not managed and --install never touched them. The mode is per-file
    manifest data now; this test is the thing that would have caught it."""
    src, sd, ud = _tree(tmp_path)
    lib = tmp_path / "lib-tepna"
    for h in ("tepna-clock.sh", "tepna-restart.sh", "tepna-rssi.sh", "tepna-usbreset.sh",
                                             "tepna-btreset.sh", "tepna-wifi.sh"):
        (lib / h).unlink()
    # --install still exits 1 after repairing (it reports the drift it found), so the MODE is the
    # assertion here, not the status.
    _chk(src, sd, ud, "--install")
    for h in ("tepna-clock.sh", "tepna-restart.sh", "tepna-rssi.sh", "tepna-usbreset.sh",
                                             "tepna-btreset.sh", "tepna-wifi.sh"):
        assert os.access(lib / h, os.X_OK), f"{h} installed non-executable — every sudoers grant on it is dead"


def test_the_mode_is_per_file_and_not_globally_0755(tmp_path):
    """The mode column has to be DATA, not a second hardcoded constant. Flipping `install -m 0644` to
    `-m 0755` would pass the test above while making three /etc config files world-executable — trading
    one wrong global mode for another. A unit file is not a program."""
    src, sd, ud = _tree(tmp_path)
    (sd / "tepna-capture.service").unlink()
    (ud / "99-tepna-btdongle.rules").unlink()
    _chk(src, sd, ud, "--install")
    for f in (sd / "tepna-capture.service", ud / "99-tepna-btdongle.rules"):
        assert not os.access(f, os.X_OK), f"{f.name} installed executable — the mode is hardcoded, not per-file"


def test_a_file_counted_as_drift_is_never_ALSO_reported_in_sync(tmp_path):
    """Observed on the live box, 2026-08-04: `--install` printed "3 managed, 1 drifted, 1 AMBIGUOUS"
    and exited 1 while EVERY ROW of the table read `✓ in sync`. There was nothing to point at.

    An ambiguous source (the same filename resolvable from two roots) is counted into `drift` and does
    force exit 1, so the row must not claim to be in sync. The bytes matching is a narrower statement
    than the file being fine, and the row now says exactly that much and marks the rest."""
    # deploy/ (the installed source) matches /etc byte-for-byte, so the CONTENT really is in sync —
    # while systemd/ holds a different twin of the same filename, which is the ambiguity. Exactly the
    # combination that produced the all-green table on the box.
    src, sd, ud = _tree_two_sources(tmp_path, UNIT_V, UNIT_T, UNIT_V)
    r = _chk(src, sd, ud)
    assert r.returncode == 1, r.stdout
    row = [l for l in r.stdout.splitlines() if "tepna-capture.service" in l and "sync" in l]
    assert row, r.stdout
    assert "ambiguous source" in row[0], f"counted as drift and exits 1, but the row claims: {row[0]!r}"


def test_a_never_installed_privileged_helper_goes_RED(tmp_path):
    """The other half of the same finding: tepna-usbreset.sh existed in the repo and had never been
    installed, so the USB unbind/bind recovery step — the only reliable way to clear a wedged adapter
    (VIGIL-OVERNIGHT-FINDINGS P1.3) — could not run, and nothing said so."""
    src, sd, ud = _tree(tmp_path)
    (tmp_path / "lib-tepna" / "tepna-usbreset.sh").unlink()
    r = _chk(src, sd, ud)
    assert r.returncode == 1, r.stdout
    assert "NOT INSTALLED" in r.stdout and "tepna-usbreset.sh" in r.stdout, r.stdout


def test_every_sudoers_granted_helper_is_on_the_manifest():
    """Non-vacuity, and the rule that keeps it true: a helper is added to the manifest because it holds
    a root NOPASSWD grant, so the two lists must not drift apart. Derived from enable-clock-control.sh's
    own helper list rather than restated, so adding a fifth helper there fails here until it is checked."""
    grant = open(os.path.join(HERE, "deploy", "enable-clock-control.sh"), encoding="utf-8").read()
    manifest = open(CHK, encoding="utf-8").read()
    helpers = set(re.findall(r"tepna-[a-z]+\.sh", grant))
    assert helpers, "found no helpers in enable-clock-control.sh — the scan has stopped working"
    missing = sorted(h for h in helpers if h not in manifest)
    assert not missing, f"privileged helper(s) with a sudoers grant but no drift check: {missing}"


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
    # enable-cpap-wifi.sh added 2026-07-28, and the confirmation this list demands:
    #   • it writes ONLY under $TEPNA_ETC_NETWORKD / $TEPNA_ETC_SYSTEMD, which the tests redirect into
    #     tmp_path — there is no unredirectable destination;
    #   • `networkctl reload` and `systemctl daemon-reload` are each gated on their OWN real-host path,
    #     the same §E6 shape check-system-files.sh uses, so a redirected run reloads nothing;
    #   • the only other command is `ip route show` — read-only, and stubbed on PATH by the tests.
    # The three NOPASSWD helpers added 2026-08-01 (test_tepna_{clock,restart,rssi}_sh.py), each with the
    # confirmation this list demands. All three are driven with their ENTIRE external command surface
    # stubbed onto PATH — not just the read-only calls — so no real host command can be reached:
    #   • tepna-clock.sh   — writes only under $TEPNA_ETC_ROOT, redirected into tmp_path; its whole
    #     command set is systemctl / chronyc / timedatectl, all stubbed. The one test that deliberately
    #     leaves the seam unset (proving it is off by default) asserts the write FAILS as non-root, and
    #     is skipped outright when euid == 0 so it can never write a real /etc even in a root container.
    #   • tepna-restart.sh — writes nothing at all; systemctl and sleep are its only commands, stubbed.
    #   • tepna-rssi.sh    — writes nothing at all; hcitool is its only command, stubbed. The rest is
    #     awk/grep/printf on strings the test supplies.
    # tepna-usbreset.sh added 2026-08-02 — the fourth NOPASSWD helper, and the first that writes to
    # SYSFS rather than under /etc, so the confirmation is worth spelling out:
    #   • it writes ONLY under $TEPNA_USB_SYSFS, which every test redirects into tmp_path — `_run()`
    #     sets it unconditionally, so the real /sys/bus/usb/devices default is never reachable;
    #   • it runs no external command that can mutate anything — cat / basename / sleep only. No
    #     systemctl, no udevadm, no mount, no ip, no install;
    #   • the VID:PID allowlist is enforced BEFORE any write, so even an unredirected run could only
    #     bounce a docked Polar dock — never a disk, never a BLE adapter (asserted directly by
    #     test_the_bluetooth_adapter_cannot_be_deauthorized);
    #   • the non-root test asserts the write FAILS, and skips when euid == 0 so it cannot touch a real
    #     sysfs even in a root container.
    # check.sh added 2026-08-04 (test_check_script.py) — the local aggregate gate. It is the easiest
    # confirmation on this list, because the script WRITES NOTHING AT ALL:
    #   • no redirection seam is needed because there is no destination — it creates no file, no
    #     directory, and touches nothing under /etc, /sys or the repo. Its only effects are the exit
    #     codes it collects and the summary it prints;
    #   • its entire external surface is three commands — `$PYTHON -m ruff`, `shellcheck`,
    #     `$PYTHON -m pytest` — and the tests stub ALL of them: `PYTHON` is redirected to a fake
    #     interpreter and a stub `shellcheck` is prepended to PATH, so no real gate is invoked;
    #   • even an UNSTUBBED run would be read-only. ruff, shellcheck and pytest inspect the tree; the
    #     worst case is a slow test, not a mutated host. That is why this one needs no euid guard.
    # tepna-update.sh added 2026-08-04 (test_vigil_update.py) — the unattended updater, and the first
    # entry that runs git and can reach a PRIVILEGE ESCALATION seam, so the confirmation is explicit:
    #   • every destination is redirected and `_run()` sets ALL of them unconditionally, so no default
    #     is reachable: TEPNA_REPO_DIR (else /opt/tepna), TEPNA_STATUS_JSON (else /srv/tepna/…) and
    #     TEPNA_RESTART_SH (else /usr/local/lib/tepna/tepna-restart.sh);
    #   • the privilege seam TEPNA_SUDO is set to `env`, so the tests never invoke sudo — and the script
    #     reaches systemctl ONLY through $RESTART_SH, which the tests point at a stub that appends to a
    #     file. There is no direct systemctl/udevadm/mount/install anywhere in it (asserted by
    #     test_the_updater_has_no_privileged_command_outside_the_seam);
    #   • its git surface is `-C "$REPO_DIR"` on every call — status, rev-parse, fetch, merge --ff-only.
    #     No push, no reset, no clean, no checkout, and no ref-move (CLAUDE.md §2b), so the worst case
    #     against a real checkout is a read;
    #   • the only other scripts it runs are sync-apps.sh and check-system-files.sh from UNDER
    #     $REPO_DIR — i.e. from the tmp_path clone, never the developer's own tree — and the latter is
    #     invoked WITHOUT --install, which a test asserts by capturing its argv.
    # vigil.sh added 2026-08-04 (test_vigil_sh.py) — it LAUNCHES AND KILLS PROCESSES, so the confirmation
    # is about process blast radius rather than /etc:
    #   • it contains no sudo, systemctl, udevadm, mount, install, chmod/chown or address-mutating ip —
    #     `ip -4 route get` is its only ip call and is read-only (asserted by _no_privileged_command below);
    #   • every path it writes is redirected and `_run()` sets ALL of them unconditionally, so no default
    #     is reachable: VIGIL_PIDFILE (else $XDG_RUNTIME_DIR/vigil-monitor.pid), VIGIL_LOG, VIGIL_CONFIG
    #     and VIGIL_DIR. That last one matters most — its fallback is a HARD-CODED developer path, and a
    #     `stop` resolved against it would signal the author's own live daemon;
    #   • it only ever kills the pid in $PIDFILE, and only after is_vigil() confirms that pid's
    #     /proc/<pid>/cmdline contains capture.py AND its cwd is $VIGIL_DIR — i.e. inside tmp_path. A
    #     stranger that merely inherited the number is rejected (test_a_recycled_pid_… pins this);
    #   • the one mktemp is on the VIGIL_HOST branch, which no test sets.
    # tepna-btreset.sh added 2026-08-05 — the fifth NOPASSWD helper, and the one with the largest blast
    # radius on this list, because a driver unbind detaches whatever it names. The confirmation therefore
    # covers BOTH seams, not just the device tree:
    #   • it writes ONLY under $TEPNA_USB_DRIVER, and reads only under $TEPNA_USB_SYSFS. `_run()` sets
    #     BOTH unconditionally, so neither real default (/sys/bus/usb/drivers/usb, /sys/bus/usb/devices)
    #     is reachable. Two seams, both mandatory — a redirect that covered only the device tree would
    #     still have let a test unbind a real adapter;
    #   • it runs no external command that can mutate anything — cat / sleep only. No systemctl, no
    #     udevadm, no mount, no ip, no install;
    #   • the CLASS allowlist is enforced BEFORE any write, so even an unredirected run could only touch
    #     a device that reports itself `e0:01:01` — never a disk (08), never a hub (09). Both refusals are
    #     asserted directly (test_a_hub_is_refused, test_mass_storage_is_refused);
    #   • the non-root test asserts the write FAILS, and skips when euid == 0 so it cannot touch a real
    #     sysfs even in a root container.
    # tepna-wifi.sh added 2026-08-30 — the sixth NOPASSWD helper, and the first that touches the box's
    # own NETWORK rather than a device. The confirmation covers three seams, and `_run()` sets all three
    # unconditionally so no test can reach a real one:
    #   • every WRITE is to $CONF / $CTRL, both derived from $TEPNA_WIFI_RUNDIR, which `_run()` points at
    #     tmp_path. There is no other write in the file — no install, no systemctl, no mount, no udevadm;
    #   • every privileged COMMAND (ip, wpa_supplicant, wpa_cli, dhcpcd) is resolved through $PATH, and
    #     `_run()` prepends a stub bin/ holding all four, so the real binaries are unreachable;
    #   • $TEPNA_WIFI_IFACE is set to a NON-EXISTENT interface, so even an unstubbed `ip link set … up`
    #     would name nothing on this host. A third seam precisely because the first two are policy and
    #     this one is arithmetic — the interface does not exist, so there is nothing to disturb.
    # And the property that bounds all of it: the script NEVER self-elevates. It is the sudo TARGET, not
    # a sudo caller — the only `sudo` in the file is in the deploy comment. Run by the test user it has
    # exactly that user's authority, and `ip link set` / `dhcpcd` / `wpa_supplicant` all refuse it.
    # tepna-btmon.sh added 2026-09-05 — the sixth NOPASSWD helper, and the first that WRITES A FILE THE
    # CALLER NAMES, so the confirmation is about where that write can land rather than about /etc:
    #   • the write destination is validated BEFORE btmon runs and confined to $TEPNA_BTMON_OUTROOT
    #     (real default /srv/tepna/captures), which `_run()` sets unconditionally into tmp_path; a `..`
    #     component is rejected outright, so an inside-by-prefix path cannot resolve outside, and an
    #     EXISTING file is refused rather than truncated — a redirected run cannot even clobber a
    #     fixture, let alone a real capture;
    #   • $TEPNA_BTMON_SYSFS (real default /sys/class/bluetooth) is the only path READ, also redirected
    #     unconditionally, and the adapter must exist there before anything runs;
    #   • its entire external command surface is `btmon` and `timeout`, and `_run()` prepends a stub
    #     btmon onto PATH — so the real monitor socket is never opened. That matters more here than
    #     usual: unstubbed, btmon needs CAP_NET_RAW and would simply be REFUSED for the test user, which
    #     is the property that bounds an unstubbed run to nothing;
    #   • it contains no systemctl, udevadm, mount, install, ip, chmod or sudo. The one ownership call is
    #     `chown --reference=<the output dir>` on the file it just created — inside the redirected root,
    #     and `|| true` so a non-root run proceeds;
    #   • it NEVER self-elevates: like tepna-wifi.sh it is the sudo TARGET, not a sudo caller.
    assert executed <= {"check-system-files.sh", "sync-apps.sh", "sse-frames.sh", "enable-cpap-wifi.sh",
                        "tepna-clock.sh", "tepna-restart.sh", "tepna-rssi.sh",
                        "tepna-usbreset.sh", "tepna-btreset.sh", "tepna-wifi.sh", "check.sh",
                        "tepna-update.sh", "vigil.sh", "tepna-btmon.sh", "tepna-sniff.sh"}, (
        f"a test now executes {sorted(executed)} — confirm it cannot mutate real host state "
        f"(systemctl / udevadm / mount / ip / install into /etc) before adding it here")


# ── the served set is the OWNED set, not everything with a .html suffix (§C7) ────────────────────
def test_an_unbundled_editing_source_is_never_served(tmp_path):
    """THE §C7 regression. `bundles=("$SRC"/*.html)` selected on EXTENSION, so the repo root's 11
    `*.src.html` EDITING SOURCES and ~30 analysis harnesses were copied to the served directory with
    none of their `.js`/`.css`/`adapters/` siblings — 34 pages with 100 % of their references missing:

        CPAPDex.src.html      19/19 refs MISSING
        Data Unifier.src.html 27/27 refs MISSING
        Dex-Test-Suite.html   57/57 refs MISSING
    """
    src, dest = _src(tmp_path), tmp_path / "app"
    assert _run(src, dest).returncode == 0
    assert (dest / "A.html").exists(), "the owned bundle is served"
    assert not (dest / "A.src.html").exists(), "its editing source is NOT a self-contained page"
    assert not (dest / "Dex-Test-Suite.html").exists(), "nor is a harness that needs the module tree"


def test_check_is_green_only_when_the_assets_are_there_too(tmp_path):
    """`--check` compared `*.html` ONLY, which is why it reported green on exactly the broken state:
    every served page was missing its stylesheet and the check could not see it."""
    src, dest = _src(tmp_path), tmp_path / "app"
    (src / "index.html").write_text('<link href="dex-badges.css" rel="stylesheet">\n')
    (src / "dex-badges.css").write_text(".ev{}\n")
    assert _run(src, dest).returncode == 0
    assert (dest / "dex-badges.css").exists(), "a page without its assets is a blank screen"
    assert _run(src, dest, "--check").returncode == 0

    (dest / "dex-badges.css").unlink()
    r = _run(src, dest, "--check")
    assert r.returncode == 1, "a missing asset must fail the check, not be invisible to it"
    assert "dex-badges.css" in r.stdout


def test_a_referenced_asset_directory_is_mirrored(tmp_path):
    src, dest = _src(tmp_path), tmp_path / "app"
    (src / "assets" / "icons").mkdir(parents=True)
    (src / "assets" / "icons" / "apple-touch-icon-180.png").write_bytes(b"\x89PNG")
    assert _run(src, dest).returncode == 0
    assert (dest / "assets" / "icons" / "apple-touch-icon-180.png").read_bytes() == b"\x89PNG"


# ══ SUPERSEDED /etc FILES (2026-08-08) ════════════════════════════════════════════════════════
# `99-tepna-hidraw.rules` ADOPTED a rule that had been hand-installed as `99-polar-hidraw.rules` —
# in no repo, on no manifest, invisible to this gate, and one rebuild away from vanishing silently.
# Adopting it under a new name leaves the old file behind, still active: the same udev rule loaded
# twice, harmless until the two copies disagree and filename sort order picks the winner. That is
# `ambiguous()`'s problem pointed at /etc instead of the repo, so it gets the same treatment —
# reported loudly, counted as drift, and never deleted automatically.

def _tree_with_superseded(tmp_path, install_replacement=True, leave_old=True):
    src, systemd, udev = _tree(tmp_path)
    if not install_replacement:
        (udev / "99-tepna-hidraw.rules").unlink()
    if leave_old:
        (udev / "99-polar-hidraw.rules").write_text('SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0da4"\n')
    return src, systemd, udev


def test_a_superseded_etc_file_is_reported_and_reds_the_gate(tmp_path):
    src, systemd, udev = _tree_with_superseded(tmp_path)
    r = _chk(src, systemd, udev)
    assert "SUPERSEDED" in r.stdout, r.stdout
    assert "99-polar-hidraw.rules" in r.stdout
    assert r.returncode == 1, "a leftover duplicate rule must not read as green"


def test_the_superseded_report_names_the_exact_command(tmp_path):
    """An operator reading this at 2 a.m. should not have to reconstruct the path. It also states that
    the script will not do it for them, because `--install` is re-runnable and an `rm` is not."""
    src, systemd, udev = _tree_with_superseded(tmp_path)
    r = _chk(src, systemd, udev)
    assert "sudo rm" in r.stdout and str(udev / "99-polar-hidraw.rules") in r.stdout
    assert "never deletes" in r.stdout


def test_install_does_NOT_delete_the_superseded_file(tmp_path):
    """The line this script draws around itself. Everything --install writes is recoverable from the
    repo; a deletion is not, and it cannot know why an operator put a file there."""
    src, systemd, udev = _tree_with_superseded(tmp_path)
    _chk(src, systemd, udev, "--install")
    assert (udev / "99-polar-hidraw.rules").exists(), "--install must never remove an /etc file"


def test_no_superseded_report_when_the_old_file_is_gone(tmp_path):
    src, systemd, udev = _tree_with_superseded(tmp_path, leave_old=False)
    r = _chk(src, systemd, udev)
    assert "SUPERSEDED" not in r.stdout, r.stdout
    assert r.returncode == 0, r.stdout


def test_the_old_file_is_NOT_flagged_until_its_replacement_is_installed(tmp_path):
    """Order matters, and getting it wrong is dangerous: advising `rm` while the replacement is absent
    would talk an operator into deleting the only working copy of the rule and installing nothing."""
    src, systemd, udev = _tree_with_superseded(tmp_path, install_replacement=False)
    r = _chk(src, systemd, udev)
    assert "SUPERSEDED" not in r.stdout, r.stdout
    assert "NOT INSTALLED" in r.stdout, "it should be telling you to install the replacement instead"


# ── the rules file itself ─────────────────────────────────────────────────────────────────────
HIDRAW = os.path.join(HERE, "systemd", "99-tepna-hidraw.rules")


def test_both_sensors_are_covered_by_vid_pid():
    """Polar dock (adopted) and the Wellue O2Ring-S. Matching VID:PID rather than a node name is the
    only form that survives a replug — `/dev/hidraw0` is whatever enumerated first, not an identity."""
    body = open(HIDRAW, encoding="utf-8").read()
    rules = [l for l in body.splitlines() if l.startswith("SUBSYSTEM==")]
    assert len(rules) == 2, rules
    assert any('"0da4"' in l and '"0008"' in l for l in rules), "Polar dock rule missing"
    assert any('"1915"' in l and '"f33c"' in l for l in rules), "O2Ring-S rule missing"
    for l in rules:
        assert 'SUBSYSTEM=="hidraw"' in l and "MODE=" in l and "GROUP=" in l, l
        assert "hidraw0" not in l, "must not match a node NAME — it is not stable across a replug"


def test_the_o2ring_is_matched_under_nordics_vendor_id_not_viatoms():
    """The trap this file exists to document. The ring ADVERTISES as Viatom (0x036F) / OxyII (0xF34E)
    over BLE but ENUMERATES on USB under Nordic's 0x1915 — so a USB scan filtered on the vendor ids you
    know from the radio walks straight past it. Measured on the box 2026-08-08: `1915:f33c`."""
    body = open(HIDRAW, encoding="utf-8").read()
    o2 = next(l for l in body.splitlines() if l.startswith("SUBSYSTEM==") and '"1915"' in l)
    assert "036f" not in o2.lower() and "f34e" not in o2.lower()
    assert "1915" in body and "nordic" in body.lower(), "the surprise must stay documented next to the rule"


def test_the_vid_pid_are_lowercase_hex():
    """sysfs stores them lowercase and udev's == is literal, so an uppercase PID silently never matches
    — a rule that loads clean and does nothing, which is the worst failure shape available here."""
    body = open(HIDRAW, encoding="utf-8").read()
    for l in body.splitlines():
        if not l.startswith("SUBSYSTEM=="):
            continue
        for attr in re.findall(r'ATTRS\{id(?:Vendor|Product)\}=="([^"]+)"', l):
            assert attr == attr.lower(), f"{attr} must be lowercase"


def test_the_adopted_polar_rule_is_byte_identical_to_what_the_box_was_running():
    """This file ADOPTS a working hand-installed rule. Adoption must not change semantics — the same
    discipline `deploy/tepna-capture.service` followed when it absorbed its duplicate. The line below
    is what `/etc/udev/rules.d/99-polar-hidraw.rules` contained on the box, verbatim."""
    body = open(HIDRAW, encoding="utf-8").read()
    assert ('SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0da4", ATTRS{idProduct}=="0008", '
            'MODE="0660", GROUP="vigil"') in body


# ── the unit file describes a drop-in; the script must actually write it ──────────────────────────
def test_THE_DROP_IN_CONTAINS_THE_READWRITEPATHS_THE_UNIT_SAYS_IT_DOES():
    """Found 2026-08-30, on a box where every other clock signal was healthy.

    `tepna-capture.service`'s comment states that `enable-clock-control.sh` installs a drop-in carrying
    `ReadWritePaths=-/etc/chrony -/etc/systemd/timesyncd.conf.d -/run/chrony`, and explains exactly why
    each is needed — under ProtectSystem=strict, /run/chrony blocks chronyc from creating the reply
    socket it needs to reach chronyd AT ALL. The script only ever wrote `NoNewPrivileges=no`.

    The symptom was maximally misleading: `POST /api/clock/sync` answered "chronyc could not be reached
    — is chronyd running?" on a box where `chronyd` was active and `NTPSynchronized` was already yes. It
    named the one thing that was fine. Nothing could catch it, because the claim lived in a comment in
    one file and the behaviour in another — which is what this test is for."""
    unit = open(os.path.join(HERE, "deploy", "tepna-capture.service"), encoding="utf-8").read()
    script = open(os.path.join(HERE, "deploy", "enable-clock-control.sh"), encoding="utf-8").read()

    # The paths the UNIT's prose promises the drop-in carries.
    promised = set()
    for line in unit.splitlines():
        t = line.lstrip("# ").strip()
        if t.startswith("ReadWritePaths=") and "chrony" in t:
            promised |= {p.lstrip("-") for p in t.split("=", 1)[1].split()}
    assert promised, "the unit no longer documents the clock drop-in — the scan has stopped working"

    # The paths the SCRIPT actually writes into the drop-in heredoc.
    body = script.split("clock-control.conf <<'DROPIN'", 1)[1].split("DROPIN", 1)[0]
    written = set()
    for line in body.splitlines():
        t = line.strip()
        if t.startswith("ReadWritePaths="):          # a commented line is prose, not a directive
            written |= {p.lstrip("-") for p in t.split("=", 1)[1].split()}

    missing = sorted(promised - written)
    assert not missing, (
        f"tepna-capture.service says the drop-in grants {sorted(promised)}, but "
        f"enable-clock-control.sh writes {sorted(written) or 'none'} — missing {missing}. "
        f"Clock sync fails as root while chronyd is perfectly healthy."
    )
