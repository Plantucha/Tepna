# tepna-capture — tests/test_tepna_sysfiles_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# tepna-sysfiles.sh — the NOPASSWD drift installer (owner ruling 2026-10-12, option A).
#
# THE PROPERTY WORTH PINNING IS WHERE THE BYTES COME FROM. `vigil` owns the checkout, so the helper must
# run the checker from a fresh clone of the remote, at a commit that is on `main`, and never from the
# checkout. Each test below gives the checkout a DIFFERENT checker from the upstream one, so a helper
# that ran the checkout's copy prints the wrong marker.
#
# The suite runs as an ordinary user, where the helper reads its overrides. As root it reads none; that
# half is asserted on the source, because a test cannot become root.

import os
import re
import subprocess

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "tepna-sysfiles.sh")
_GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@t",
}


def _git(d, *a):
    subprocess.run(["git", "-C", str(d), *a], check=True, capture_output=True, env={**os.environ, **_GIT_ENV})


def _sha(d):
    return subprocess.run(["git", "-C", str(d), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()


def _checker(marker, rc=0):
    # The stub prints its marker, its args and the dir it runs from, so a test sees WHICH copy ran.
    return f'#!/usr/bin/env bash\necho "{marker} ARGS:[$*] FROM:[$(dirname "$0")]"\nexit {rc}\n'


def _commit_checker(repo, body, msg):
    d = repo / "capture-host" / "deploy"
    d.mkdir(parents=True, exist_ok=True)
    (d / "check-system-files.sh").write_text(body)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", msg)


@pytest.fixture
def box(tmp_path):
    if os.geteuid() == 0:
        pytest.skip("as root the helper ignores every override and would install from GitHub for real")
    up = tmp_path / "upstream"
    up.mkdir()
    _git(up, "init", "-q", "-b", "main")
    _commit_checker(up, _checker("UPSTREAM-V1"), "v1")
    repo = tmp_path / "opt-tepna"
    subprocess.run(["git", "clone", "-q", str(up), str(repo)], check=True, capture_output=True)
    # The checkout's own copy is the one `vigil` can rewrite. It must never be the one that runs.
    (repo / "capture-host" / "deploy" / "check-system-files.sh").write_text(_checker("CHECKOUT"))
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    return {"up": up, "repo": repo, "scratch": scratch}


def _run(box, *args, **env):
    e = {
        **os.environ,
        # file:// and not a bare path: git ignores --depth on a local-path clone.
        "TEPNA_SYSFILES_REMOTE": f"file://{box['up']}",
        "TEPNA_REPO_DIR": str(box["repo"]),
        "TMPDIR": str(box["scratch"]),
        **env,
    }
    return subprocess.run(["bash", SH, *args], capture_output=True, text=True, env=e)


def test_check_runs_the_UPSTREAM_checker_from_a_clone_never_the_checkout(box):
    r = _run(box, "check")
    assert r.returncode == 0, r.stderr
    assert "UPSTREAM-V1 ARGS:[]" in r.stdout
    assert "CHECKOUT" not in r.stdout
    assert f"FROM:[{box['repo']}" not in r.stdout
    assert f"@ {_sha(box['repo'])[:12]}" in r.stdout


def test_install_installs_then_returns_the_verdict_of_a_clean_recheck(box):
    r = _run(box, "install")
    assert r.returncode == 0, r.stderr
    assert (
        r.stdout.index("UPSTREAM-V1 ARGS:[--install]")
        < r.stdout.index("verify:")
        < r.stdout.index("UPSTREAM-V1 ARGS:[]")
    )


def test_the_recheck_exit_code_is_the_verdict(box):
    _commit_checker(box["up"], _checker("UPSTREAM-RED", rc=1), "red")
    _git(box["repo"], "checkout", "-q", "--", ".")
    _git(box["repo"], "pull", "-q", "--ff-only")
    r = _run(box, "install")
    assert r.returncode == 1 and "UPSTREAM-RED ARGS:[]" in r.stdout


def test_it_installs_the_commit_the_CHECKOUT_is_on_not_the_tip_of_main(box):
    v1 = _sha(box["repo"])
    _commit_checker(box["up"], _checker("UPSTREAM-V2"), "v2")
    r = _run(box, "check")
    assert "UPSTREAM-V1" in r.stdout and "UPSTREAM-V2" not in r.stdout
    assert f"@ {v1[:12]}" in r.stdout


def test_a_commit_that_is_not_on_main_is_refused_and_nothing_runs(box):
    """A pull-request commit is fetchable from GitHub by sha. A checkout moved onto one must not get its
    files installed as root."""
    (box["repo"] / "local.txt").write_text("x\n")
    _git(box["repo"], "add", "local.txt")
    _git(box["repo"], "commit", "-qm", "local only")
    r = _run(box, "install")
    assert r.returncode == 1
    assert "not on main" in r.stderr and "nothing installed" in r.stderr
    assert "ARGS:" not in r.stdout


def test_a_main_commit_older_than_the_depth_is_refused(box):
    for i in range(3):
        _commit_checker(box["up"], _checker(f"UPSTREAM-N{i}"), f"n{i}")
    r = _run(box, "check", TEPNA_SYSFILES_DEPTH="2")
    assert r.returncode == 1 and "within the last 2 commits" in r.stderr


def test_an_unreachable_remote_installs_nothing(box, tmp_path):
    r = _run(box, "install", TEPNA_SYSFILES_REMOTE=f"file://{tmp_path / 'absent'}")
    assert r.returncode == 1 and "cannot clone" in r.stderr and "ARGS:" not in r.stdout


def test_an_unreadable_checkout_installs_nothing(box, tmp_path):
    r = _run(box, "install", TEPNA_REPO_DIR=str(tmp_path / "absent"))
    assert r.returncode == 1 and "cannot read the commit" in r.stderr


def test_a_commit_with_no_checker_installs_nothing(box):
    (box["up"] / "capture-host" / "deploy" / "check-system-files.sh").unlink()
    (box["up"] / "README").write_text("x\n")
    _git(box["up"], "add", "-A")
    _git(box["up"], "commit", "-qm", "no checker")
    _git(box["repo"], "checkout", "-q", "--", ".")
    _git(box["repo"], "pull", "-q", "--ff-only")
    r = _run(box, "install")
    assert r.returncode == 1 and "has no capture-host/deploy/check-system-files.sh" in r.stderr


@pytest.mark.parametrize("argv", [[], ["install", "x"], ["--install"], ["restart"], [""]])
def test_the_verb_surface_is_check_and_install_only(box, argv):
    r = _run(box, *argv)
    assert r.returncode == 2 and "usage:" in r.stderr
    assert "ARGS:" not in r.stdout


def test_the_temp_clone_is_removed_after_a_run_and_after_a_refusal(box):
    _run(box, "install")
    _run(box, "check", TEPNA_SYSFILES_DEPTH="0")
    assert [p.name for p in box["scratch"].iterdir()] == ["tepna-sysfiles.lock"]


def test_a_second_run_while_the_first_holds_the_lock_is_refused(box):
    lock = box["scratch"] / "tepna-sysfiles.lock"
    holder = subprocess.Popen(["flock", "-x", str(lock), "sleep", "5"])
    try:
        subprocess.run(["sleep", "0.3"])
        r = _run(box, "check")
    finally:
        holder.kill()
        holder.wait()
    assert r.returncode == 1 and "holds" in r.stderr


def test_the_etc_redirects_reach_the_checker_and_nothing_else_does(box):
    body = '#!/usr/bin/env bash\necho "SYSTEMD=[${TEPNA_ETC_SYSTEMD-unset}] SRC=[${TEPNA_SRC-unset}]"\n'
    _commit_checker(box["up"], body, "env probe")
    _git(box["repo"], "checkout", "-q", "--", ".")
    _git(box["repo"], "pull", "-q", "--ff-only")
    r = _run(box, "check", TEPNA_ETC_SYSTEMD="/x/systemd", TEPNA_SRC="/opt/tepna/capture-host")
    assert "SYSTEMD=[/x/systemd] SRC=[unset]" in r.stdout, r.stdout


# ── as root: the source is the only witness ──────────────────────────────────────────────────────────


def _body():
    return open(SH, encoding="utf-8").read()


def test_as_root_every_override_is_ignored():
    """Under sudo the remote, the checkout, the depth and the temp dir are constants. Every `TEPNA_` read
    and the TMPDIR read sit inside the non-root branch, and PATH is reset before anything runs."""
    body = _body()
    branch = re.search(r'^if \[ "\$\(id -u\)" != 0 \]; then\n(.*?)^fi\n', body, re.M | re.S)
    assert branch, "the non-root override branch is gone"
    outside = body.replace(branch.group(0), "")
    code = "\n".join(l for l in outside.splitlines() if not l.lstrip().startswith("#"))
    assert not re.search(r"\$\{?(TEPNA_|TMPDIR)", code), "an override is read outside the non-root branch"
    assert body.index("export PATH=/usr/sbin:/usr/bin:/sbin:/bin") < body.index('if [ "$(id -u)" != 0 ]')


def test_as_root_the_remote_is_the_canonical_https_url_never_the_checkouts_config():
    body = _body()
    assert re.search(r"^REMOTE=https://github\.com/Plantucha/Tepna\.git$", body, re.M)
    assert "get-url" not in body and "remote." not in body


def test_as_root_the_checkout_is_read_as_its_owner_and_nothing_of_it_runs():
    body = _body()
    assert 'AS_USER=(runuser -u "$CHECKOUT_USER" -- env HOME=/nonexistent)' in body
    assert re.search(r'^chk="\$src/capture-host/deploy/check-system-files\.sh"$', body, re.M)
    # The checkout appears only in the commit read and in messages.
    uses = [l for l in body.splitlines() if re.search(r"\$CHECKOUT\b(?!_)", l) and not l.lstrip().startswith("#")]
    for line in uses:
        assert "rev-parse" in line or "die " in line or "echo " in line or "CHECKOUT=" in line, line
