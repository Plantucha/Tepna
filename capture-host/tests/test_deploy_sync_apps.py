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
    systemd = tmp_path / "etc-systemd"; systemd.mkdir()
    udev = tmp_path / "etc-udev"; udev.mkdir()
    (src / "99-tepna-btdongle.rules").write_text('ACTION=="add", ATTR{idVendor}=="2357"\n')
    (src / "tepna-usb-autosuspend.service").write_text("[Service]\nType=oneshot\n")
    unit = "[Service]\nUser={u}\nGroup={u}\nReadWritePaths=/srv/tepna\nExecStart=/x\n"
    (src / "tepna-capture.service").write_text(unit.format(u=capture_user_repo))
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


def test_a_site_customised_unit_is_NOT_reported_as_drift(tmp_path):
    """User/Group/ReadWritePaths are the site's to set. Flagging them would make the check cry wolf
    on every box and train the operator to ignore it."""
    src, sd, ud = _tree(tmp_path, capture_user_repo="tepna", capture_user_etc="vigil")
    r = _chk(src, sd, ud)
    assert r.returncode == 0, r.stdout
    assert "same but for site keys" in r.stdout


def test_a_templated_unit_that_drifts_BEYOND_the_site_keys_is_reported(tmp_path):
    """Normalising the site keys must not blind the check to a real change in the rest of the unit."""
    src, sd, ud = _tree(tmp_path, capture_user_repo="tepna", capture_user_etc="vigil")
    (sd / "tepna-capture.service").write_text(
        "[Service]\nUser=vigil\nGroup=vigil\nReadWritePaths=/srv/tepna\nExecStart=/x\nRestart=no\n")
    r = _chk(src, sd, ud)
    assert r.returncode == 1
    assert "DRIFTED beyond the site keys" in r.stdout


def test_install_never_writes_the_templated_unit(tmp_path):
    """The repo's copy names a user the box may not have. Writing it would stop capture."""
    src, sd, ud = _tree(tmp_path, capture_user_repo="tepna", capture_user_etc="vigil")
    before = (sd / "tepna-capture.service").read_text()
    _chk(src, sd, ud, "--install")
    assert (sd / "tepna-capture.service").read_text() == before, \
        "--install must never touch a site-templated unit"


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
