# tepna-capture — tests/test_tepna_btmon_sh.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# tepna-btmon.sh — a NOPASSWD helper that runs a privileged capture and WRITES A FILE the caller
# names. That combination is the whole reason these tests exist: the argument validation is not a
# nicety, it is the security surface. A sudoers grant on this script means every guard below is the
# only thing standing between "record HCI traffic for a night" and "let a non-root caller aim a
# root-owned writer at a path of their choosing".
#
# Every guard rejects BEFORE btmon is invoked, so all of it is testable unprivileged — which is the
# point: a test that needed CAP_NET_RAW would have to be skipped exactly where the risk lives.
# `btmon` and the adapter tree are stubbed the way test_tepna_btreset_sh.py stubs its sysfs.

import os
import subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SH = os.path.join(HERE, "tepna-btmon.sh")


def _run(tmp_path, *args, btmon_body=None, btmon_rc=0):
    """Run the helper against a fake adapter tree, a fake capture root and a stub btmon."""
    sysfs = tmp_path / "sys"
    (sysfs / "hci1").mkdir(parents=True, exist_ok=True)
    outroot = tmp_path / "captures"
    outroot.mkdir(exist_ok=True)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    # The stub writes through to whatever -w names, so the size/empty logic is exercised for real.
    body = btmon_body if btmon_body is not None else 'printf "HCIDUMP" > "$out"'
    (bin_dir / "btmon").write_text(
        "#!/bin/sh\n"
        'out=""\n'
        'while [ $# -gt 0 ]; do case "$1" in -w) out="$2"; shift 2 ;; *) shift ;; esac; done\n'
        f"{body}\n"
        f"exit {btmon_rc}\n"
    )
    (bin_dir / "btmon").chmod(0o755)
    env = dict(os.environ,
               TEPNA_BTMON_SYSFS=str(sysfs),
               TEPNA_BTMON_OUTROOT=str(outroot),
               PATH=f"{bin_dir}:{os.environ['PATH']}")
    argv = [str(a).replace("@OUT@", str(outroot)) for a in args]
    return subprocess.run(["bash", SH, *argv], capture_output=True, text=True, env=env, timeout=60)


# ── the security surface: every rejection ───────────────────────────────────────────────────────────
def test_a_capture_writes_and_reports_its_size(tmp_path):
    r = _run(tmp_path, "hci1", "1", "@OUT@/ok.btsnoop")
    assert r.returncode == 0, r.stderr
    assert "captured 7 bytes" in r.stdout
    assert (tmp_path / "captures" / "ok.btsnoop").read_text() == "HCIDUMP"


def test_an_output_outside_the_capture_root_is_refused(tmp_path):
    """The one that matters most: a root-owned writer must not be aimable at /etc or a dotfile."""
    r = _run(tmp_path, "hci1", "1", "/etc/cron.d/pwn")
    assert r.returncode == 2 and "output must be under" in r.stderr


def test_path_traversal_out_of_the_capture_root_is_refused(tmp_path):
    """`<root>/../../etc/x` is INSIDE the root by prefix and outside it in fact."""
    r = _run(tmp_path, "hci1", "1", "@OUT@/../../etc/pwn")
    assert r.returncode == 2 and ".." in r.stderr


def test_an_existing_file_is_never_overwritten(tmp_path):
    (tmp_path / "captures").mkdir(exist_ok=True)
    (tmp_path / "captures" / "night.btsnoop").write_text("last night")
    r = _run(tmp_path, "hci1", "1", "@OUT@/night.btsnoop")
    assert r.returncode == 2 and "refusing to overwrite" in r.stderr
    assert (tmp_path / "captures" / "night.btsnoop").read_text() == "last night"


def test_a_malformed_adapter_name_is_refused(tmp_path):
    """Exit 2 is the VALIDATION rejection. An empty adapter is a different thing — a MISSING argument,
    caught one line earlier by bash's `${1:?}` with exit 1 — so it is asserted separately below rather
    than folded in here; conflating them would let a validation regression hide behind the usage guard."""
    for bad in ("hci1; rm -rf /", "../hci1", "eth0", "hci", "hci1x"):
        r = _run(tmp_path, bad, "1", "@OUT@/x.btsnoop")
        assert r.returncode == 2, bad


def test_an_empty_adapter_is_refused_as_a_missing_argument(tmp_path):
    r = _run(tmp_path, "", "1", "@OUT@/x.btsnoop")
    assert r.returncode != 0
    assert "usage" in (r.stderr + r.stdout)


def test_a_nonexistent_adapter_is_refused_rather_than_recorded_empty(tmp_path):
    """btmon on an absent index writes an EMPTY file, which reads exactly like a quiet night."""
    r = _run(tmp_path, "hci7", "1", "@OUT@/x.btsnoop")
    assert r.returncode == 2 and "no such adapter" in r.stderr


def test_a_nonnumeric_or_zero_duration_is_refused(tmp_path):
    for bad in ("0", "-5", "abc", "1e9"):
        r = _run(tmp_path, "hci1", bad, "@OUT@/x.btsnoop")
        assert r.returncode == 2, bad


def test_the_duration_cap_is_enforced(tmp_path):
    """A forgotten invocation must not hold a privileged capture open for days."""
    r = _run(tmp_path, "hci1", "999999", "@OUT@/x.btsnoop")
    assert r.returncode == 2 and "exceeds the" in r.stderr


def test_a_missing_output_directory_is_refused(tmp_path):
    r = _run(tmp_path, "hci1", "1", "@OUT@/nope/x.btsnoop")
    assert r.returncode == 2 and "no such directory" in r.stderr


# ── outcome honesty ─────────────────────────────────────────────────────────────────────────────────
def test_an_empty_capture_is_reported_as_a_failure_not_a_success(tmp_path):
    """0 bytes and 'no traffic' are the same output otherwise — this repo's dominant defect."""
    r = _run(tmp_path, "hci1", "1", "@OUT@/empty.btsnoop", btmon_body=': > "$out"')
    assert r.returncode == 3
    assert "EMPTY" in r.stderr


def test_running_the_full_duration_is_success_not_failure(tmp_path):
    """`timeout` exits 124 when the command ran the whole time — which is the NORMAL outcome for a
    deliberately time-boxed capture. Treating it as an error would make every full run look broken."""
    r = _run(tmp_path, "hci1", "1", "@OUT@/full.btsnoop",
             btmon_body='printf "DATA" > "$out"; sleep 5', btmon_rc=0)
    assert r.returncode == 0, r.stderr
    assert "captured 4 bytes" in r.stdout


def test_a_real_btmon_failure_is_not_reported_as_a_capture(tmp_path):
    r = _run(tmp_path, "hci1", "1", "@OUT@/bad.btsnoop",
             btmon_body='printf "x" > "$out"', btmon_rc=7)
    assert r.returncode == 7 and "btmon failed" in r.stderr


def test_usage_is_printed_when_arguments_are_missing(tmp_path):
    r = _run(tmp_path)
    assert r.returncode != 0 and "usage" in (r.stderr + r.stdout)
