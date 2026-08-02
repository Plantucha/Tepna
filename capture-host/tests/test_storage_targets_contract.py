# tepna-capture — tests/test_storage_targets_contract.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""What `validate()` RETURNS, and what its refusals SAY.

The tests next door prove that a bad target is refused. These prove the other half, which the mutation
audit found unasserted: that a good target comes back normalised the way the rest of the box expects,
and that a refusal names the field the operator has to go and fix.

Three concrete holes this closes, all of which survived a suite at 100 % coverage:

* `enabled` defaulting to False instead of True — a target configured without the key would be created
  disabled, and the offload would simply never run, with nothing in the logs saying why.
* every `_abs_path(value, "mountpoint")` field label replaceable by `None`, so the whole validator
  degrades to "None is required" / "None must be an absolute path" for every field at once. `/api/storage`
  hands these strings straight to the UI; they ARE the diagnosis.
* the port and window_min boundaries, none of which had a test on either side.
"""
import pytest

import storage_targets as st


RSYNC = {"protocol": "rsync", "host": "192.168.0.142", "user": "tepna", "share": "/mnt/tank/tepna"}
NFS = {"protocol": "nfs", "host": "192.168.0.142", "share": "/mnt/tank/tepna",
       "mountpoint": "/srv/tepna/archive"}


# ── the normalised output ───────────────────────────────────────────────────────────────────────────
def test_a_target_is_enabled_unless_it_says_otherwise():
    """The default is what every target written before `enabled` existed gets. False here would disable
    them all on upgrade — an offload that stops silently is the worst shape of this bug."""
    assert st.validate(NFS)["enabled"] is True
    assert st.validate({**NFS, "enabled": False})["enabled"] is False


def test_verification_is_on_unless_it_says_otherwise():
    """`verify` is what separates 'we ran a copy' from 'a second copy exists' — and only the latter may
    release a night to the retention gate, so defaulting it off would let nights be pruned unverified."""
    assert st.validate(RSYNC)["verify"] is True
    assert st.validate({**RSYNC, "verify": False})["verify"] is False


def test_the_protocol_default_port_is_filled_in_and_returned():
    """Downstream reads `target['port']` — rsync_argv, the iscsiadm step, the NVMe connect. Omitting the
    key must yield the protocol's IANA port, not None."""
    assert st.validate(NFS)["port"] == 2049
    assert st.validate({**NFS, "port": 12049})["port"] == 12049


def test_the_user_survives_validation():
    assert st.validate(RSYNC)["user"] == "tepna"
    assert "user" not in st.validate({k: v for k, v in RSYNC.items() if k != "user"})


@pytest.mark.parametrize("port", [1, 65535])
def test_the_port_range_includes_both_of_its_ends(port):
    assert st.validate({**NFS, "port": port})["port"] == port


@pytest.mark.parametrize("port", [0, 65536])
def test_a_port_outside_the_range_is_refused(port):
    with pytest.raises(st.StorageError, match="1-65535"):
        st.validate({**NFS, "port": port})


# ── refusals name the field ─────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("target,field", [
    ({"protocol": "nfs", "host": "nas", "share": "/vol", "mountpoint": "not-absolute"}, "mountpoint"),
    ({"protocol": "nfs", "host": "nas", "share": "rel", "mountpoint": "/srv/tepna"}, "share"),
    ({"protocol": "smb", "host": "nas", "mountpoint": "/srv/tepna"}, "share"),
    ({"protocol": "iscsi", "host": "nas", "mountpoint": "/srv/tepna"}, "target IQN/NQN"),
    ({"protocol": "rsync", "host": "nas"}, "remote path"),
    ({"protocol": "webdav", "host": "nas"}, "remote path"),
    ({**RSYNC, "identity": "rel"}, "identity (SSH key path)"),
    ({"protocol": "smb", "host": "nas", "share": "s", "mountpoint": "/srv/tepna",
      "credentials_file": "rel"}, "credentials_file"),
])
def test_a_refusal_names_the_field_the_operator_must_fix(target, field):
    with pytest.raises(st.StorageError) as e:
        st.validate(target)
    assert str(e.value).startswith(field), f"the message must lead with {field!r}, got {e.value!r}"


def test_mount_unit_refusals_name_their_field_too():
    """`mount_unit` re-validates its own input (it emits paste-as-root text), so it has its own copies of
    these labels and its own way to lose them."""
    with pytest.raises(st.StorageError, match="^mountpoint"):
        st.mount_unit({"protocol": "nfs", "kind": "mount", "host": "nas", "share": "/vol",
                       "mountpoint": "not-absolute"})
    with pytest.raises(st.StorageError, match="^share"):
        st.mount_unit({"protocol": "nfs", "kind": "mount", "host": "nas", "share": "rel",
                       "mountpoint": "/srv/tepna/archive"})


# ── validate_schedule ───────────────────────────────────────────────────────────────────────────────
def test_the_daily_window_defaults_to_two_hours():
    """120 minutes is the window a `daily` schedule gets when the operator states only a time; `due()`
    reads it directly, so drifting it moves when every offload is allowed to start."""
    assert st.validate_schedule({"mode": "daily", "at": "03:30"})["window_min"] == 120


@pytest.mark.parametrize("w", [5, 1440])
def test_the_window_range_includes_both_of_its_ends(w):
    assert st.validate_schedule({"mode": "daily", "at": "03:30", "window_min": w})["window_min"] == w


@pytest.mark.parametrize("w", [4, 1441])
def test_a_window_outside_the_range_is_refused(w):
    with pytest.raises(st.StorageError, match="5-1440"):
        st.validate_schedule({"mode": "daily", "at": "03:30", "window_min": w})


def test_the_schedule_refusals_say_what_is_wrong():
    with pytest.raises(st.StorageError, match="after_settle"):
        st.validate_schedule({"mode": "hourly"})
    with pytest.raises(st.StorageError, match="HH:MM"):
        st.validate_schedule({"mode": "daily", "at": "3am"})


# ── rsync_argv: the actual offload command ──────────────────────────────────────────────────────────
# Asserted whole, for the same reason mount_unit's text is: this list IS the transfer. The existing test
# next door checks the shape (argv[0], a bare `--`, BatchMode) — which leaves the ssh port, the identity
# flag, the trailing-slash semantics and the dry_run default all free to move.
def _argv(**over):
    return st.rsync_argv("/srv/tepna/captures/2026-07-25", st.validate({**RSYNC, **over}))


_SSH = "ssh -p 22 -o BatchMode=yes -o StrictHostKeyChecking=accept-new"


def test_the_offload_command_is_exactly_this():
    assert _argv() == ["rsync", "-rlt", "--partial", "--timeout=120", "-e", _SSH,
                       "--", "/srv/tepna/captures/2026-07-25/",
                       "tepna@192.168.0.142:/mnt/tank/tepna/"]


def test_a_real_offload_is_not_a_dry_run():
    """`push_night` calls rsync_argv with no dry_run for the REAL copy. If that default were True the
    box would 'succeed' every night while transferring nothing — and the verify pass, which is itself a
    --dry-run finding nothing pending, would then report 'copied and verified byte-for-byte'. Silent,
    total data loss with a green status card."""
    assert "--dry-run" not in _argv()
    assert "--dry-run" in st.rsync_argv("/srv/x", st.validate(RSYNC), dry_run=True)


def test_the_dry_run_flags_are_added_to_the_command_not_substituted_for_it():
    argv = st.rsync_argv("/srv/tepna/captures/2026-07-25", st.validate(RSYNC), dry_run=True)
    assert argv[:6] == ["rsync", "-rlt", "--partial", "--timeout=120", "-e", _SSH]
    assert argv[6:8] == ["--dry-run", "--itemize-changes"]


def test_both_operands_end_in_a_slash_so_rsync_copies_contents_not_the_directory():
    """rsync's trailing slash is semantic: `src/` copies the CONTENTS of src, `src` creates src inside
    the destination — a night nested one directory deeper than the mirror expects."""
    argv = _argv()
    assert argv[-2] == "/srv/tepna/captures/2026-07-25/"
    assert argv[-1].endswith(":/mnt/tank/tepna/")
    assert st.rsync_argv("/srv/tepna/captures/2026-07-25/", st.validate(RSYNC))[-2] == \
        "/srv/tepna/captures/2026-07-25/", "an src the caller already slashed must not gain a second"


def test_the_remote_path_stays_absolute():
    """Stripping from the left instead of the right turns /mnt/tank/tepna into a path relative to the
    ssh user's home — which usually exists, so the nights land somewhere plausible and wrong."""
    host, _, remote = _argv()[-1].partition(":")
    assert remote.startswith("/"), f"the remote path must stay absolute, got {remote!r}"
    assert remote == "/mnt/tank/tepna/"


def test_a_userless_target_omits_the_at_sign():
    argv = st.rsync_argv("/srv/x", st.validate({k: v for k, v in RSYNC.items() if k != "user"}))
    assert argv[-1] == "192.168.0.142:/mnt/tank/tepna/"


def test_a_configured_ssh_port_and_identity_reach_the_ssh_command():
    argv = _argv(port=2222, identity="/home/tepna/.ssh/id_ed25519")
    assert argv[argv.index("-e") + 1] == (
        "ssh -p 2222 -o BatchMode=yes -o StrictHostKeyChecking=accept-new "
        "-i /home/tepna/.ssh/id_ed25519")


# ── dest_status: ready means READY ──────────────────────────────────────────────────────────────────
def test_a_local_path_that_does_not_exist_is_not_ready(tmp_path, monkeypatch):
    """`bool(mp) and isdir(mp)` — an `or` here makes any non-empty string 'ready', so the mirror writes
    350 MB/night into a directory that was never created. This is the same class as the isdir-vs-ismount
    distinction the module header is about: a destination that looks fine and is not there."""
    monkeypatch.setattr(st, "MOUNT_ROOTS", tuple(st.MOUNT_ROOTS) + (str(tmp_path),))
    missing = str(tmp_path / "nope")
    got = st.dest_status({"protocol": "local", "kind": "mount", "mountpoint": missing})
    assert got["ready"] is False and "does not exist" in got["reason"]
    (tmp_path / "yes").mkdir()
    ok = st.dest_status({"protocol": "local", "kind": "mount", "mountpoint": str(tmp_path / "yes")})
    assert ok["ready"] is True and ok["reason"] is None


def test_a_transfer_target_is_always_ready_to_be_tried():
    """A transfer target has no local filesystem to inspect — readiness is only decided by actually
    talking to the server, which is test_target's job. Reporting it as NOT ready would grey out the
    button that performs the only real check."""
    got = st.dest_status(st.validate(RSYNC))
    assert got["ready"] is True and got["path"] is None
