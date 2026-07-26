# tepna-capture — tests/test_storage_targets.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Offload targets: where a finished night goes, and when.

The two properties worth gating hard are (1) no secret ever reaches config.yaml or the API, and (2) an
unmounted mountpoint is NOT a usable destination — it is a writable directory on the boot disk, which
is how ~350 MB/night lands on the wrong filesystem while the operator believes it is on the NAS.
"""
import datetime as dt
import os

import pytest

import storage_targets as st


@pytest.fixture(autouse=True)
def _allow_tmp_mountpoints(monkeypatch, tmp_path):
    """Mountpoints are constrained to MOUNT_ROOTS (/srv, /mnt, …) because that path is WRITTEN to.
    pytest's tmp_path is none of those, so widen the allowlist for the duration of each test — the
    constraint itself is asserted directly in the tests below."""
    monkeypatch.setattr(st, "MOUNT_ROOTS", tuple(st.MOUNT_ROOTS) + (str(tmp_path),))


RSYNC = {"protocol": "rsync", "host": "192.168.0.142", "user": "tepna",
         "share": "/mnt/tank/tepna", "identity": "/home/tepna/.ssh/id_ed25519"}
NFS = {"protocol": "nfs", "host": "192.168.0.142", "share": "/mnt/tank/tepna",
       "mountpoint": "/srv/tepna/archive"}


# ── secrets ───────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("field", ["password", "pass", "passwd", "secret", "token", "chap_secret"])
def test_a_secret_field_is_refused_outright(field):
    """config.yaml is world-readable on the box and this API is LAN-reachable through Caddy — a typed
    password would be at rest in plaintext in both."""
    with pytest.raises(st.StorageError, match="never stores a password"):
        st.validate({**RSYNC, field: "hunter2"})


def test_an_unknown_field_is_refused_rather_than_stored():
    with pytest.raises(st.StorageError, match="unknown field"):
        st.validate({**RSYNC, "sudo_command": "rm -rf /"})


def test_a_validated_target_carries_no_secret_bearing_key():
    out = st.validate(RSYNC)
    assert not (set(out) & st._SECRET_KEYS)
    assert out["identity"] == "/home/tepna/.ssh/id_ed25519", "the PATH is kept, never the key itself"


# ── host / path validation (these values become argv) ─────────────────────────────────────────
@pytest.mark.parametrize("host", ["-e/bin/sh", "1.2.3.4 rm", "a b", "host;reboot", "", "--rsh=x"])
def test_a_host_that_could_be_read_as_an_option_is_rejected(host):
    """`-e something` in the host slot would be parsed by rsync as an OPTION, not a destination."""
    with pytest.raises(st.StorageError, match="invalid host"):
        st.validate({**RSYNC, "host": host})


@pytest.mark.parametrize("host", ["192.168.0.142", "nas.local", "[fd00::1]", "truenas"])
def test_a_real_host_is_accepted(host):
    assert st.validate({**RSYNC, "host": host})["host"] == host


def test_a_relative_or_traversing_path_is_rejected():
    with pytest.raises(st.StorageError, match="absolute"):
        st.validate({**RSYNC, "share": "tank/tepna"})
    with pytest.raises(st.StorageError, match=r"\.\."):
        st.validate({**RSYNC, "share": "/mnt/../etc"})


def test_options_cannot_inject_a_unit_directive():
    """Mount options are interpolated into a generated systemd unit; a newline would append directives."""
    with pytest.raises(st.StorageError, match="options may only contain"):
        st.validate({**NFS, "options": "ro\n[Service]\nExecStart=/bin/sh"})


def test_rsync_argv_has_no_shell_and_terminates_options():
    argv = st.rsync_argv("/srv/tepna/captures/2026-07-25", st.validate(RSYNC))
    assert argv[0] == "rsync" and "--" in argv, "operands must be after a bare --"
    assert argv.index("--") < argv.index("/srv/tepna/captures/2026-07-25/")
    assert any("BatchMode=yes" in a for a in argv), "must never hang on a password prompt"


# ── mount readiness: the isdir-vs-ismount distinction ─────────────────────────────────────────
def test_an_unmounted_mountpoint_is_NOT_ready(tmp_path):
    """THE failure this guards: an unmounted mountpoint is a present, empty, WRITABLE directory on the
    boot disk. os.path.isdir says yes and 350 MB/night lands on the wrong filesystem."""
    mp = tmp_path / "archive"
    mp.mkdir()
    t = st.validate({**NFS, "mountpoint": str(mp)})
    assert os.path.isdir(mp), "precondition: isdir would have said this is fine"
    s = st.dest_status(t)
    assert s["ready"] is False
    assert "nothing is mounted" in s["reason"]


def test_a_missing_mountpoint_is_not_ready_and_says_so(tmp_path):
    t = st.validate({**NFS, "mountpoint": str(tmp_path / "nope")})
    s = st.dest_status(t)
    assert s["ready"] is False and "does not exist" in s["reason"]


def test_a_local_path_target_is_judged_by_isdir_not_ismount(tmp_path):
    """`local` is a plain directory by definition — requiring a mount there would be wrong."""
    d = tmp_path / "usb"
    d.mkdir()
    t = st.validate({"protocol": "local", "mountpoint": str(d)})
    assert st.dest_status(t)["ready"] is True


def test_a_real_mountpoint_is_ready(monkeypatch, tmp_path):
    mp = tmp_path / "archive"
    mp.mkdir()
    monkeypatch.setattr(st.os.path, "ismount", lambda p: str(p) == str(mp))
    assert st.dest_status(st.validate({**NFS, "mountpoint": str(mp)}))["ready"] is True


# ── generated mount unit ──────────────────────────────────────────────────────────────────────
def test_the_nfs_unit_is_named_after_its_mountpoint():
    """systemd ignores a .mount unit whose filename is not the escaped mountpoint."""
    u = st.mount_unit(st.validate(NFS))
    assert u["unit_name"] == "srv-tepna-archive.mount"
    assert "What=192.168.0.142:/mnt/tank/tepna" in u["unit"] and "Type=nfs4" in u["unit"]
    assert "Where=/srv/tepna/archive" in u["unit"]


def test_the_smb_unit_references_a_credentials_FILE_not_a_password():
    t = st.validate({"protocol": "smb", "host": "nas.local", "share": "tepna",
                     "mountpoint": "/srv/tepna/archive",
                     "credentials_file": "/etc/tepna/smb-credentials"})
    u = st.mount_unit(t)
    assert "credentials=/etc/tepna/smb-credentials" in u["unit"]
    assert "password" not in u["unit"].lower()


def test_iscsi_and_nvmeof_steps_include_the_login_the_operator_must_run():
    u = st.mount_unit(st.validate({"protocol": "iscsi", "host": "192.168.0.142",
                                   "share": "iqn.2026-07.local.nas:tepna",
                                   "mountpoint": "/srv/tepna/archive"}))
    assert any("iscsiadm" in s for s in u["steps"])
    u2 = st.mount_unit(st.validate({"protocol": "nvmeof", "host": "192.168.0.142",
                                    "share": "nqn.2026-07.local.nas:tepna",
                                    "mountpoint": "/srv/tepna/archive"}))
    assert any("nvme connect" in s for s in u2["steps"])


def test_a_transfer_target_has_no_mount_unit():
    with pytest.raises(st.StorageError, match="only a mount-kind"):
        st.mount_unit(st.validate(RSYNC))


# ── schedule ──────────────────────────────────────────────────────────────────────────────────
def test_schedule_validation():
    assert st.validate_schedule(None) == {"mode": "after_settle"}
    s = st.validate_schedule({"mode": "daily", "at": "09:30", "window_min": 60})
    assert s == {"mode": "daily", "at": "09:30", "window_min": 60}
    for bad in ({"mode": "daily", "at": "9:30"}, {"mode": "daily", "at": "24:00"},
                {"mode": "daily", "at": ""}, {"mode": "hourly"}):
        with pytest.raises(st.StorageError):
            st.validate_schedule(bad)


def test_after_settle_is_always_due():
    assert st.due({"mode": "after_settle"}, dt.datetime(2026, 7, 25, 3, 0), None) is True


def test_daily_is_due_only_inside_its_window():
    sched = {"mode": "daily", "at": "09:00", "window_min": 120}
    assert st.due(sched, dt.datetime(2026, 7, 25, 8, 59), None) is False, "before the window"
    assert st.due(sched, dt.datetime(2026, 7, 25, 9, 0), None) is True
    assert st.due(sched, dt.datetime(2026, 7, 25, 10, 59), None) is True
    assert st.due(sched, dt.datetime(2026, 7, 25, 11, 1), None) is False, "after the window"


def test_daily_does_not_run_twice_in_one_window():
    sched = {"mode": "daily", "at": "09:00", "window_min": 120}
    ran = dt.datetime(2026, 7, 25, 9, 5)
    assert st.due(sched, dt.datetime(2026, 7, 25, 9, 30), ran) is False


def test_daily_anchors_on_the_window_not_on_24h_since_last_run():
    """Anchoring on '>= 24 h since last run' makes the offload drift later every day; anchoring on the
    window means a box that ran late yesterday still offloads on time today."""
    sched = {"mode": "daily", "at": "09:00", "window_min": 120}
    yesterday_late = dt.datetime(2026, 7, 24, 10, 55)
    assert st.due(sched, dt.datetime(2026, 7, 25, 9, 5), yesterday_late) is True


def test_describe_marks_which_protocols_need_root():
    by = {p["protocol"]: p for p in st.describe()}
    assert by["nfs"]["privileged"] is True and by["iscsi"]["privileged"] is True
    assert by["rsync"]["privileged"] is False
    assert by["nvmeof"]["kind"] == "mount" and by["webdav"]["kind"] == "transfer"


def test_a_local_path_is_not_advertised_as_needing_root():
    """`privileged` means "needs a one-time root step". Flagging a plain directory would train the
    operator to ignore the badge on the four protocols where it is real."""
    by = {p["protocol"]: p for p in st.describe()}
    assert by["local"]["kind"] == "mount" and by["local"]["privileged"] is False
    assert all(by[p]["privileged"] for p in ("nfs", "smb", "iscsi", "nvmeof"))


# ── A MOUNTPOINT IS A WRITE TARGET, SO ITS LOCATION IS CONSTRAINED (CodeQL py/path-injection) ──
# The mountpoint becomes archive.dest and the mirror writes ~350 MB/night into it. /api/storage is
# token-gated only when web.token is set (the documented default is a trusted LAN with no token), so
# "absolute and free of .." was never a location check — it would happily accept /etc or a home dir.

@pytest.mark.parametrize("bad", ["/etc", "/etc/systemd/system", "/boot", "/home/vigil/.ssh",
                                 "/", "/root", "/srvmalicious", "/mntevil"])
def test_a_mountpoint_outside_the_allowed_roots_is_refused(bad, monkeypatch):
    monkeypatch.setattr(st, "MOUNT_ROOTS", ("/srv", "/mnt", "/media", "/opt/tepna", "/var/lib/tepna"))
    with pytest.raises(st.StorageError, match="must live under"):
        st.validate({**NFS, "mountpoint": bad})


@pytest.mark.parametrize("good", ["/srv/tepna/archive", "/mnt/tank", "/media/usb",
                                  "/opt/tepna/archive", "/var/lib/tepna/archive"])
def test_a_conventional_mount_root_is_accepted(good, monkeypatch):
    monkeypatch.setattr(st, "MOUNT_ROOTS", ("/srv", "/mnt", "/media", "/opt/tepna", "/var/lib/tepna"))
    assert st.validate({**NFS, "mountpoint": good})["mountpoint"] == good


def test_the_root_check_is_not_a_bare_prefix_match(monkeypatch):
    """/srvmalicious must not pass as "under /srv"."""
    monkeypatch.setattr(st, "MOUNT_ROOTS", ("/srv",))
    assert st._under_allowed_root("/srv/tepna") is True
    assert st._under_allowed_root("/srv") is True
    assert st._under_allowed_root("/srvmalicious") is False


def test_traversal_cannot_escape_the_allowed_root(monkeypatch):
    """'..' is rejected outright, but normpath is what stops a survivor sneaking out."""
    monkeypatch.setattr(st, "MOUNT_ROOTS", ("/srv",))
    with pytest.raises(st.StorageError):
        st.validate({**NFS, "mountpoint": "/srv/../etc"})
    assert st._under_allowed_root("/srv/a/../../etc") is False
