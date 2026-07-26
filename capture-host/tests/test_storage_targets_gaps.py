"""storage_targets.py gap-fill — validation refusals and the transfer/probe paths.

This module decides whether a night is safely off-box, and `VIGIL-HARDENING-II §1.3` is the rule it
exists to enforce: "we ran a copy" is NOT "a second copy exists", and only the latter may release a
night to the retention gate. So the tests that matter most here are the ones asserting `verified` is
False whenever the second copy is unproven.
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import storage_targets as stg  # noqa: E402

RSYNC = {"protocol": "rsync", "host": "nas", "user": "tepna",
         "share": "/vol/tepna", "port": 22}


def _run(coro):
    return asyncio.run(coro)


def _fake_run(monkeypatch, results):
    """Queue (rc, out) tuples for successive _run calls."""
    it = iter(results)
    calls = []

    async def fake(argv, timeout):
        calls.append(argv)
        return next(it)
    monkeypatch.setattr(stg, "_run", fake)
    return calls


# ── validate: every refusal ─────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("t,frag", [
    ("not-a-dict", "must be an object"),
    ({"protocol": "carrier-pigeon"}, "unknown protocol"),
    ({"protocol": "rsync", "host": "nas", "share": "/v", "port": "abc"}, "port must be"),
    ({"protocol": "rsync", "host": "nas", "share": "/v", "port": 70000}, "port must be"),
    ({"protocol": "rsync", "host": "nas", "share": "/v", "user": "bad user!"}, "invalid user"),
    ({"protocol": "nfs", "host": "nas", "share": "/v"}, "required"),
])
def test_validate_refuses_bad_targets(t, frag):
    """Every rejection is phrased for the operator — the message goes straight to the monitor."""
    with pytest.raises(stg.StorageError) as e:
        stg.validate(t)
    assert frag in str(e.value)


def test_validate_requires_a_share_name():
    """An empty share reaches `What=` in a generated systemd unit, so it is refused at the door."""
    # smb routes `share` through _share_name (nfs treats it as a path), so this is the protocol that
    # exercises the empty-share refusal.
    with pytest.raises(stg.StorageError, match="required"):
        stg.validate({"protocol": "smb", "host": "nas", "share": "   ", "mountpoint": "/mnt/x"})


def test_validate_keeps_explicit_mount_options():
    t = stg.validate({"protocol": "nfs", "host": "nas", "share": "/vol/x",
                      "mountpoint": "/mnt/x", "options": "ro,soft"})
    assert t["options"] == "ro,soft"


# ── validate_schedule ───────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("s", [{"mode": "daily", "at": "03:00", "window_min": "abc"},
                               {"mode": "daily", "at": "03:00", "window_min": 4},
                               {"mode": "daily", "at": "03:00", "window_min": 5000}])
def test_validate_schedule_bounds_the_window(s):
    with pytest.raises(stg.StorageError, match="window_min"):
        stg.validate_schedule(s)


# ── _under_allowed_root ─────────────────────────────────────────────────────────────────────────────
def test_under_allowed_root_is_false_when_the_path_cannot_be_resolved(monkeypatch):
    """A path that cannot be realpath'd is not provably inside an allowed root, so it is refused.
    Failing closed is the only safe direction for a check that gates where nights get written."""
    def boom(_p):
        raise OSError("ELOOP")
    monkeypatch.setattr(stg.os.path, "realpath", boom)
    assert stg._under_allowed_root("/mnt/x") is False


def test_under_allowed_root_skips_a_root_it_cannot_compare(monkeypatch):
    """commonpath raises ValueError on a relative-vs-absolute mix. That is simply "no match" for that
    root — the loop continues to the next one rather than propagating, but still fails closed."""
    real = stg.os.path.realpath

    def rel_roots(p):
        return "relative/root" if p in stg.MOUNT_ROOTS else real(p)
    monkeypatch.setattr(stg.os.path, "realpath", rel_roots)
    assert stg._under_allowed_root("/mnt/x") is False


# ── mount_unit ──────────────────────────────────────────────────────────────────────────────────────
def test_mount_unit_refuses_a_local_path():
    with pytest.raises(stg.StorageError, match="needs no mount unit"):
        stg.mount_unit(stg.validate({"protocol": "local", "mountpoint": "/srv/tepna-archive"}))


def test_mount_unit_adds_guest_for_an_anonymous_smb_share():
    u = stg.mount_unit(stg.validate({"protocol": "smb", "host": "nas", "share": "media",
                                     "mountpoint": "/mnt/media"}))
    # No credentials file configured, so the generated unit must mount anonymously rather than
    # silently prompting — an unattended box has nobody to answer.
    assert "guest" in u["unit"]


# ── rsync_argv ──────────────────────────────────────────────────────────────────────────────────────
def test_rsync_argv_dry_run_itemizes():
    argv = stg.rsync_argv("/srv/tepna/captures/2026-07-25", stg.validate(RSYNC), dry_run=True)
    assert "--dry-run" in argv and "--itemize-changes" in argv


# ── _run ────────────────────────────────────────────────────────────────────────────────────────────
def test_run_reports_a_missing_binary_rather_than_raising():
    rc, out = _run(stg._run(["definitely-not-a-real-binary-xyz"], 5))
    assert rc == 127 and "not installed" in out


def test_run_times_out_cleanly():
    rc, out = _run(stg._run(["sleep", "10"], 0.2))
    assert rc == 124 and "timed out" in out


def test_run_reports_a_non_enoent_os_error(tmp_path):
    """A path that exists but cannot be executed raises PermissionError (an OSError that is NOT
    FileNotFoundError), and must come back as a verdict rather than an exception."""
    p = tmp_path / "notexec"
    p.write_text("#!/bin/sh\ntrue\n")
    p.chmod(0o644)
    rc, out = _run(stg._run([str(p)], 5))
    assert rc == 1 and "PermissionError" in out


def test_run_returns_output_on_success():
    rc, out = _run(stg._run(["echo", "hello"], 5))
    assert rc == 0 and "hello" in out


# ── push_night — the verified/unverified distinction ────────────────────────────────────────────────
def test_push_night_refuses_a_protocol_it_cannot_transfer():
    r = _run(stg.push_night("/srv/x", {"protocol": "nfs"}))
    assert r["ok"] is False and r["verified"] is False and "not implemented" in r["detail"]


def test_push_night_reports_failure_with_the_rsync_output(monkeypatch):
    _fake_run(monkeypatch, [(23, "rsync: permission denied")])
    r = _run(stg.push_night("/srv/x", stg.validate(RSYNC)))
    assert r["ok"] is False and r["verified"] is False and "permission denied" in r["detail"]


def test_push_night_copied_but_unverified_when_verification_is_disabled(monkeypatch):
    """`ok` without `verified` must never release a night: we ran a copy, we did not prove one exists."""
    _fake_run(monkeypatch, [(0, "sent 1 byte")])
    t = dict(stg.validate(RSYNC)); t["verify"] = False
    r = _run(stg.push_night("/srv/x", t))
    assert r["ok"] is True and r["verified"] is False


def test_push_night_verified_only_when_the_recheck_finds_nothing_left(monkeypatch):
    _fake_run(monkeypatch, [(0, "sent 10 bytes"),
                            (0, "sending incremental file list\nsent 12 bytes\ntotal size is 0")])
    r = _run(stg.push_night("/srv/x", stg.validate(RSYNC)))
    assert r["ok"] is True and r["verified"] is True and "byte-for-byte" in r["detail"]


def test_push_night_not_verified_when_the_recheck_still_lists_items(monkeypatch):
    """The whole point of the second pass: rsync exiting 0 is not proof the remote matches."""
    _fake_run(monkeypatch, [(0, "sent 10 bytes"),
                            (0, "sending incremental file list\n>f+++++++++ 20260725_BRP.edf\nsent 12 bytes")])
    r = _run(stg.push_night("/srv/x", stg.validate(RSYNC)))
    assert r["ok"] is True and r["verified"] is False and "not confirmed" in r["detail"]


# ── test_target ─────────────────────────────────────────────────────────────────────────────────────
def test_test_target_for_a_mount_defers_to_dest_status(monkeypatch):
    monkeypatch.setattr(stg, "dest_status",
                        lambda t: {"ready": True, "path": "/mnt/x", "reason": None})
    t = stg.validate({"protocol": "nfs", "host": "nas", "share": "/v", "mountpoint": "/mnt/x"})
    r = _run(stg.test_target(t))
    assert r["ok"] is True and "mounted and writable" in r["detail"]


def test_test_target_refuses_an_unimplemented_transfer_protocol():
    r = _run(stg.test_target({"kind": "transfer", "protocol": "sftp", "host": "h", "share": "/s"}))
    assert r["ok"] is False and "not implemented" in r["detail"]


def test_test_target_reports_a_missing_rsync(monkeypatch):
    _fake_run(monkeypatch, [(127, "rsync: not installed on this box")])
    r = _run(stg.test_target(stg.validate(RSYNC)))
    assert r["ok"] is False and "apt install rsync" in r["detail"]


def test_test_target_ok_when_the_remote_share_is_a_directory(monkeypatch):
    calls = _fake_run(monkeypatch, [(0, "rsync 3.2.7"), (0, "")])
    r = _run(stg.test_target(stg.validate(RSYNC)))
    assert r["ok"] is True and "reachable and writable" in r["detail"]
    assert any("BatchMode=yes" in " ".join(a) for a in calls)   # never prompt on an unattended box


def test_test_target_distinguishes_connected_but_wrong_path(monkeypatch):
    """ssh exit 1 means we got there and `test -d` said no — a different operator problem from
    "cannot connect", and worth its own message."""
    _fake_run(monkeypatch, [(0, "rsync 3.2.7"), (1, "")])
    r = _run(stg.test_target(stg.validate(RSYNC)))
    assert r["ok"] is False and "not a directory" in r["detail"]


def test_test_target_surfaces_the_ssh_error_otherwise(monkeypatch):
    _fake_run(monkeypatch, [(0, "rsync 3.2.7"), (255, "Permission denied (publickey).")])
    r = _run(stg.test_target(stg.validate(RSYNC)))
    assert r["ok"] is False and "publickey" in r["detail"]


def test_test_target_passes_an_identity_file_when_configured(monkeypatch):
    calls = _fake_run(monkeypatch, [(0, "rsync 3.2.7"), (0, "")])
    t = dict(stg.validate(RSYNC)); t["identity"] = "/home/vigil/.ssh/id_nas"
    _run(stg.test_target(t))
    assert any("-i" in a and "/home/vigil/.ssh/id_nas" in a for a in calls)
