# tepna-capture — tests/test_shell_surface.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# THE GAP THIS CLOSES. Python coverage on this tree is 100%, statement AND branch, enforced at
# `--cov-fail-under=100`. That number covers .py files. It says nothing at all about the ~16 shell
# scripts alongside them — including the three that hold NOPASSWD root grants and the two that WRITE
# /etc/sudoers.d. A gate reporting 100% while the most privileged files in the project are outside its
# denominator is the same failure class as the export-inertness claim CLAUDE.md §🔏 abolished: a
# confident number measuring the wrong thing.
#
# So this module does three things:
#   1. every .sh parses (`bash -n`) and carries the SPDX header;
#   2. an EXPLICIT inventory — each script is either owned by a named test module or listed as
#      deliberately untested WITH A REASON. A new script fails this test until it is classified, so the
#      gap can never reappear silently;
#   3. the security invariants of the scripts that cannot be executed in a test (they require root and
#      write to real system paths) are asserted against their SOURCE, which is where those invariants
#      actually live.

import os
import re
import shutil
import subprocess
import sys

import pytest

import helper_path

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))

# script (repo-relative) -> the test module that exercises it
COVERED = {
    "check.sh": "test_check_script.py",
    "tepna-clock.sh": "test_tepna_clock_sh.py",
    "tepna-restart.sh": "test_tepna_restart_sh.py",
    "tepna-rssi.sh": "test_tepna_rssi_sh.py",
    "tepna-usbreset.sh": "test_tepna_usbreset_sh.py",
    "tepna-btreset.sh": "test_tepna_btreset_sh.py",
    "tepna-wifi.sh": "test_tepna_wifi_sh.py",
    "tepna-btmon.sh": "test_tepna_btmon_sh.py",
    "tepna-update.sh": "test_vigil_update.py",
    "vigil.sh": "test_vigil_sh.py",
    "deploy/sync-apps.sh": "test_deploy_sync_apps.py",
    "deploy/check-system-files.sh": "test_deploy_sync_apps.py",
    "deploy/deploy-vigil.sh": "test_deploy_sync_apps.py",
    "deploy/install-services.sh": "test_deploy_sync_apps.py",
    "deploy/expose-monitor.sh": "test_deploy_caddyfile.py",
    "deploy/sse-frames.sh": "test_deploy_sse_frames.py",
    "deploy/enable-cpap-wifi.sh": "test_enable_cpap_wifi.py",
    "deploy/archive-pull.sh": "test_deploy_archive_pull.py",
    "systemd/tepna-usb-autosuspend.sh": "test_usb_autosuspend_unit.py",
    # asserted below, in this module, against their source — see the docstrings for why each cannot run
    "deploy/enable-clock-control.sh": "test_shell_surface.py",
    "deploy/enable-restart-control.sh": "test_shell_surface.py",
    "deploy/fix-clock-write.sh": "test_shell_surface.py",
    "deploy/fix-web-origin.sh": "test_shell_surface.py",
    "deploy/flash-nrf52840-hci.sh": "test_shell_surface.py",
    "unwedge.sh": "test_shell_surface.py",
}

# Deliberately untested, each with the reason. Empty today; it exists so that "we chose not to" stays a
# visible, reviewable decision rather than an omission nobody noticed.
UNTESTED: dict[str, str] = {}


# mutmut's generated tree. `tools/mutate.py` copies the whole of capture-host into a scratch `work/`
# dir and mutmut writes `work/mutants/`, a full second copy of the source — including all 24 shell
# scripts. The tests below then walk a GENERATED tree they were never meant to see, and every one of
# the six `_all_scripts()` call sites inherits it.
#
# The symptom is not a shellcheck finding, which is what made it hard to place: the copies are clean,
# so `--severity=style` still exits 0. It is `test_the_shell_inventory_is_complete` that breaks, on
# `unclassified shell script(s): ['mutants/check.sh', 'mutants/deploy/archive-pull.sh', …]` — 24
# scripts that are real, clean, and simply not in COVERED/UNTESTED because they are copies.
#
# Measured 2026-08-31 in a real scratch: the walk saw **48** scripts where the source tree has 24.
# That failure blocks the capture-host mutation gate entirely — the baseline clean run cannot pass, so
# every mutant reports "no budget" and `mutate-diff` REFUSES, which is why `capture.py` has never
# produced a survivor list.
#
# Matched as a PATH SEGMENT, not a substring: a bare `"mutants" in root` would also skip a legitimate
# directory whose name merely contains it.
_GENERATED_DIRS = {"mutants"}


def _all_scripts():
    out = []
    for root, _dirs, files in os.walk(HERE):
        if any(part in root for part in (".venv", "__pycache__", "/tests")):
            continue
        if _GENERATED_DIRS & set(os.path.relpath(root, HERE).split(os.sep)):
            continue
        for f in files:
            if f.endswith(".sh"):
                out.append(os.path.relpath(os.path.join(root, f), HERE))
    return sorted(out)


def _body(rel):
    return open(os.path.join(HERE, rel), encoding="utf-8").read()


# ── 1 · every script parses, and says who owns it ────────────────────────────────────────────────────

def test_every_shell_script_parses():
    """A syntax error in a deploy script is discovered at 3 a.m. on the box otherwise. `-n` reads the
    whole file without running a single command, so this is safe for scripts that would reboot a box."""
    for rel in _all_scripts():
        r = subprocess.run(["bash", "-n", os.path.join(HERE, rel)], capture_output=True, text=True)
        assert r.returncode == 0, f"{rel} does not parse:\n{r.stderr}"


def test_shellcheck_is_clean_at_the_strictest_level():
    """`bash -n` proves a script PARSES. It says nothing about the bugs that parse fine: an unquoted
    expansion that word-splits a path, `A && B || C` read as if-then-else, `ls` output parsed as a
    filename list. shellcheck is the gate for those, at `--severity=style` — the strictest level, clean
    today.

    Suppressions are INLINE with a proof at the line (`# shellcheck disable=SCxxxx` + why), exactly the
    rule `# pragma: no cover` follows in pyproject.toml. Never relax the severity to make this pass.

    Mirrors the workflow's own shellcheck step so a developer sees the failure before CI does. It SKIPS
    when the binary is absent locally, but NOT in CI — `pip install shellcheck-py` is in the workflow,
    so a missing binary there means the install step regressed, and a guard that skips in CI is a guard
    that isn't there."""
    # Look beside the running interpreter FIRST: `pip install shellcheck-py` into a venv puts the binary
    # in that venv's bin/, which is not on PATH unless the venv was activated. Searching PATH alone made
    # this skip for exactly the people who had installed it.
    exe = shutil.which("shellcheck", path=os.path.dirname(sys.executable)) or shutil.which("shellcheck")
    if not exe:
        assert not os.environ.get("CI"), (
            "shellcheck is missing in CI — the workflow installs shellcheck-py; that step has regressed"
        )
        pytest.skip("shellcheck not installed locally (`pip install shellcheck-py`); CI runs it")
    r = subprocess.run(
        [exe, "--severity=style", "--format=gcc", *[os.path.join(HERE, s) for s in _all_scripts()]],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, "shellcheck findings:\n" + (r.stdout or r.stderr)


def test_every_shellcheck_suppression_carries_a_proof():
    """A bare `# shellcheck disable=SC2086` is how a lint gate rots into decoration. Same standard the
    coverage pragmas are held to: the reason lives at the line, not in a commit message."""
    for rel in _all_scripts():
        for i, line in enumerate(_body(rel).splitlines(), 1):
            if "shellcheck disable=" not in line:
                continue
            after = line.split("shellcheck disable=", 1)[1]
            reason = after.split("#", 1)[1].strip() if "#" in after else ""
            assert len(reason) > 20, f"{rel}:{i} suppresses a finding without proving why: {line.strip()!r}"


def test_every_shell_script_carries_the_spdx_header():
    """CLAUDE.md §📜: every authored source file carries it. NINE of the deploy scripts did not, because
    nothing had ever looked — the licensing pass swept .js/.css/.html/.py and no gate covered .sh."""
    for rel in _all_scripts():
        assert "SPDX-License-Identifier: Apache-2.0" in _body(rel), f"{rel} has no SPDX header"


def test_the_shell_inventory_is_complete():
    """THE gate. A new .sh must be classified — owned by a test, or untested with a stated reason."""
    found = set(_all_scripts())
    classified = set(COVERED) | set(UNTESTED)
    assert not (found - classified), (
        f"unclassified shell script(s): {sorted(found - classified)} — add a test and list it in "
        f"COVERED, or list it in UNTESTED with the reason. Python coverage will not catch this for you."
    )
    assert not (classified - found), f"stale entries for removed script(s): {sorted(classified - found)}"


def test_the_named_owner_test_exists_and_mentions_the_script():
    for rel, owner in COVERED.items():
        path = os.path.join(TESTS, owner)
        assert os.path.exists(path), f"{rel} names a test module that does not exist: {owner}"
        assert os.path.basename(rel) in open(path, encoding="utf-8").read(), (
            f"{owner} is listed as owning {rel} but never mentions it"
        )


def test_every_untested_entry_states_a_reason():
    for rel, reason in UNTESTED.items():
        assert len(reason) > 30, f"{rel}: 'untested' needs a real reason, got {reason!r}"


# ── 2 · the sudoers installers — root-only, so their invariants are asserted against the source ──────
#
# enable-clock-control.sh / enable-restart-control.sh install /etc/sudoers.d files and root-owned copies
# of the helpers. They cannot be executed here (they require uid 0 and write to real system paths), but
# the property that makes them safe is textual and one careless edit from being wrong.

CLOCK_INSTALLER = "deploy/enable-clock-control.sh"
RESTART_INSTALLER = "deploy/enable-restart-control.sh"


def test_the_sudoers_grant_names_the_root_owned_copy_never_the_repo_copy():
    """THE privilege-escalation invariant. This checkout sits on a mount where every file is
    user-writable, so a grant on the in-repo path lets anything running as `vigil` — the unauthenticated
    web API included — rewrite the script and become root without a password."""
    for rel in (CLOCK_INSTALLER, RESTART_INSTALLER):
        body = _body(rel)
        grants = re.findall(r"^\s*\$USER_ ALL=\(root\) NOPASSWD:\s*(\S+)", body, re.M)
        assert grants, f"{rel}: no sudoers grant found — did the file's shape change?"
        for g in grants:
            assert g.startswith("$DST/"), f"{rel}: grant on {g!r} — must be the root-owned $DST copy"
            assert "$SRC" not in g, f"{rel}: grant on the user-writable in-repo copy"


def test_dst_is_the_directory_the_python_resolver_actually_prefers():
    """A cross-language invariant nothing else checks: the installers deploy to a hard-coded $DST, and
    helper_path.resolve() picks the FIRST existing SYSTEM_DIRS entry. If someone reorders SYSTEM_DIRS,
    the shell keeps installing to a path Python no longer prefers and the mismatch is silent — the
    daemon would sudo a different file from the one the grant names."""
    for rel in (CLOCK_INSTALLER, RESTART_INSTALLER):
        m = re.search(r"^DST=(\S+)", _body(rel), re.M)
        assert m, f"{rel}: no DST"
        assert m.group(1) == helper_path.SYSTEM_DIRS[0], (
            f"{rel} installs to {m.group(1)} but helper_path prefers {helper_path.SYSTEM_DIRS[0]}"
        )


def test_the_sudoers_file_is_validated_before_it_is_installed():
    """An invalid /etc/sudoers.d file breaks sudo for EVERY user on the box, including the one who would
    have to fix it. `visudo -cqf` on a temp file first is the difference between a failed script and a
    box you have to boot single-user."""
    for rel in (CLOCK_INSTALLER, RESTART_INSTALLER):
        body = _body(rel)
        assert "visudo -cqf" in body, f"{rel}: sudoers written without validation"
        # The INSTALL line specifically — `/etc/sudoers.d/…` also appears in prose in one of these, and
        # matching that would let a genuinely mis-ordered script pass on the strength of its own comment.
        install = re.search(r"^\s*install\b.*?/etc/sudoers\.d/\S+", body, re.M)
        assert install, f"{rel}: no `install … /etc/sudoers.d/…` line"
        assert body.index("visudo -cqf") < install.start(), (
            f"{rel}: validation must come before the install, or a bad file lands anyway"
        )
        assert "-m 0440" in body, f"{rel}: sudoers.d files must be mode 0440"


def test_the_helpers_are_installed_root_owned_and_not_user_writable():
    for rel in (CLOCK_INSTALLER, RESTART_INSTALLER):
        assert "install -D -o root -g root -m 0755" in _body(rel), f"{rel}: helper not installed root-owned"


def test_no_installer_grants_a_general_purpose_tool():
    """`NOPASSWD: /usr/bin/systemctl` would hand vigil every unit on the box — including masking the
    services that constrain it. The whole reason tepna-restart.sh exists is to avoid exactly that."""
    for rel in (CLOCK_INSTALLER, RESTART_INSTALLER):
        for line in _body(rel).splitlines():
            if "NOPASSWD:" not in line or line.lstrip().startswith("#"):
                continue
            for tool in ("systemctl", "/bin/sh", "/bin/bash", "/usr/bin/python", "ALL"):
                assert tool not in line.split("NOPASSWD:")[1], f"{rel}: broad grant — {line.strip()!r}"


def test_the_two_installers_write_separate_sudoers_files():
    """enable-clock-control.sh writes /etc/sudoers.d/tepna WHOLE. If the restart grant appended to that
    file it would be silently erased the next time the clock installer ran."""
    clock = re.findall(r"/etc/sudoers\.d/\S+", _body(CLOCK_INSTALLER))
    restart = re.findall(r"/etc/sudoers\.d/\S+", _body(RESTART_INSTALLER))
    assert clock and restart
    assert not (set(clock) & set(restart)), f"both installers write {set(clock) & set(restart)}"


# ── 3 · the remaining root-only scripts ──────────────────────────────────────────────────────────────

def test_the_readwritepaths_dropin_tolerates_absent_paths():
    """`ReadWritePaths=` without the `-` prefix makes systemd REFUSE TO START the unit when a listed path
    does not exist on this box — turning a permissions fix into a dead capture daemon."""
    body = _body("deploy/fix-clock-write.sh")
    m = re.search(r"^ReadWritePaths=(.+)$", body, re.M)
    assert m, "no ReadWritePaths line"
    for path in m.group(1).split():
        assert path.startswith("-/"), f"{path} must be `-` prefixed to tolerate absence"
    assert "/run/chrony" in m.group(1), (
        "chronyc creates its REPLY socket there; without it `chronyc reload sources` cannot reach chronyd"
    )


def test_fix_web_origin_validates_a_candidate_before_replacing_the_live_config():
    """Regression, fixed 2026-08-01: it used to `cat > /etc/caddy/Caddyfile` and validate afterwards, so
    an invalid config left the box unable to reload while the script claimed it had reverted. Same bug
    expose-monitor.sh's header records fixing; this file kept it."""
    body = _body("deploy/fix-web-origin.sh")
    assert "cat > /etc/caddy/Caddyfile" not in body, "the live config must never be the compose target"
    assert re.search(r'cat > "\$TMP"', body), "compose to a temp file"
    validate = body.index('caddy validate --config "$TMP"')
    install = body.index("/etc/caddy/Caddyfile", validate)
    assert validate < install, "validate the candidate BEFORE it becomes the live config"


def test_fix_web_origin_and_the_committed_caddyfile_agree_on_pinning_one_origin():
    """Per-origin localStorage: reaching the box by IP one day and by name the next splits a subject's
    longitudinal history in half, and a DHCP change orphans the IP-keyed half permanently."""
    body = _body("deploy/fix-web-origin.sh")
    assert "redir http://vigil.local{uri} permanent" in body, "the bare IP must redirect, not serve"
    assert "root * /srv/tepna/app" in body


def test_the_nrf_flasher_pins_the_board_we_actually_own():
    """Getting BOARD wrong flashes cleanly and then dies silently: the Raytac part has no DC/DC
    inductors, so an image built for the Nordic dongle collapses the rail before USB comes up. There is
    no error message anywhere — it cost an afternoon on 2026-07-26."""
    body = _body("deploy/flash-nrf52840-hci.sh")
    assert 'BOARD="${BOARD:-raytac_mdbt50q_cx_40_dongle/nrf52840}"' in body
    assert "nrf52840dongle" in body, "the wrong-board warning must name the trap it is warning about"


def test_unwedge_arms_the_restore_trap_before_it_stops_recording():
    """`unwedge.sh` stops the capture service to free the O2Ring's BLE link, so the ONE thing it must
    never do is exit without starting it again — a silent failure that costs a whole night of data and
    looks exactly like the ring having gone flat.

    The ordering is the real invariant, not the presence of a restart. A `trap` armed AFTER the stop
    leaves a window where a crash, a `^C` at the password prompt, or a failed adapter cycle strands the
    box not recording; armed before, every exit path restores it. Asserted against source because the
    script needs real root, a real service and a real radio, so it cannot be executed here.
    """
    body = _body("unwedge.sh")
    trap = body.index("trap restore EXIT")
    stop = body.index("systemctl stop tepna-capture")
    assert trap < stop, "arm the restore trap BEFORE stopping the service, not after"
    # Bounded on the LINE, not a 40-char guess: `trap restore EXIT INT TERM` is a single line, so the
    # line IS the property's scope and cannot drift out of it. A byte window here was a guess about
    # how long a trailing comment happens to be.
    trap_line = body[body.rfind("\n", 0, trap) + 1:body.index("\n", trap)]
    assert "INT TERM" in trap_line, "^C and SIGTERM must restore too, not just a clean exit"
    assert "systemctl start tepna-capture" in body, "the trap has to actually restart it"
