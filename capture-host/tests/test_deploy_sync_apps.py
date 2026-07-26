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
