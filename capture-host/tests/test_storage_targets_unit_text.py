# tepna-capture — tests/test_storage_targets_unit_text.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""The EXACT text `mount_unit()` emits — the unit body, and the root steps.

Why a whole-text assertion rather than the substring checks next door in test_storage_targets.py: this
output is not data the box consumes, it is a systemd unit installed into /etc/systemd/system and a list
of commands the operator pastes into a ROOT SHELL. Every character is the contract, and the failure mode
of a wrong one is silent — systemd ignores a `.mount` whose filename is not the escaped mountpoint, and
mounts with `Options=` it does not recognise simply do not get those options.

The mutation audit made the gap concrete: `mount_unit` was the weakest function in the module (74
survivors) and the survivors were almost entirely its output text. `default_opts += ",credentials=…"`
could become `=` — replacing the whole option set, so uid/gid/file_mode vanish and the share mounts as
root — with the suite green, because nothing compared the Options line to anything.
"""
import pytest

import storage_targets as st


NFS = {"protocol": "nfs", "host": "192.168.0.142", "share": "/mnt/tank/tepna",
       "mountpoint": "/srv/tepna/archive"}
SMB = {"protocol": "smb", "host": "nas.local", "share": "tepna", "mountpoint": "/srv/tepna/archive"}
ISCSI = {"protocol": "iscsi", "host": "192.168.0.142", "share": "iqn.2003-01.org.linux-iscsi:tepna",
         "mountpoint": "/srv/tepna/archive"}
NVMEOF = {"protocol": "nvmeof", "host": "192.168.0.142", "share": "nqn.2014-08.org.nvmexpress:tepna",
          "mountpoint": "/srv/tepna/archive"}

_HEAD = "[Unit]\nDescription=Tepna archive target ({label})\n" \
        "After=network-online.target\nWants=network-online.target\n\n"
_TAIL = "\n\n[Install]\nWantedBy=multi-user.target\n"


def _expect(label, what, where, ftype, options):
    return (_HEAD.format(label=label)
            + f"[Mount]\nWhat={what}\nWhere={where}\nType={ftype}\nOptions={options}" + _TAIL)


# ── the unit body, in full ──────────────────────────────────────────────────────────────────────────
def test_the_nfs_unit_is_emitted_verbatim():
    """`nfs4` and `_netdev` are lowercase because that is what systemd and mount(8) accept; `soft` +
    `timeo=100` are what stop a dead NAS wedging the box in uninterruptible I/O."""
    u = st.mount_unit(st.validate(NFS))
    assert u["unit"] == _expect("UNIX (NFS) Share", "192.168.0.142:/mnt/tank/tepna",
                                "/srv/tepna/archive", "nfs4", "_netdev,noatime,soft,timeo=100")


def test_the_smb_unit_appends_the_credentials_file_to_the_defaults():
    """APPENDS. Assigning instead would drop uid/gid/file_mode/dir_mode and mount the share as root —
    every night then lands owned by root on a box whose capture daemon runs as tepna."""
    u = st.mount_unit(st.validate({**SMB, "credentials_file": "/etc/tepna/smb-credentials"}))
    assert u["unit"] == _expect(
        "Windows (SMB) Share", "//nas.local/tepna", "/srv/tepna/archive", "cifs",
        "_netdev,noatime,vers=3.1.1,uid=tepna,gid=tepna,file_mode=0644,dir_mode=0755,"
        "credentials=/etc/tepna/smb-credentials")
    assert "password" not in u["unit"].lower()


def test_the_anonymous_smb_unit_appends_guest_to_the_same_defaults():
    """An unattended box has nobody to answer a credentials prompt, so no credentials file means
    `guest` — added to the defaults, not in place of them."""
    u = st.mount_unit(st.validate(SMB))
    assert u["unit"] == _expect(
        "Windows (SMB) Share", "//nas.local/tepna", "/srv/tepna/archive", "cifs",
        "_netdev,noatime,vers=3.1.1,uid=tepna,gid=tepna,file_mode=0644,dir_mode=0755,guest")


@pytest.mark.parametrize("target,label", [(ISCSI, "Block (iSCSI) Target"),
                                          (NVMEOF, "NVMe-oF Subsystem")])
def test_a_block_target_mounts_a_placeholder_uuid_the_operator_fills_in(target, label):
    """iSCSI/NVMe-oF expose a BLOCK DEVICE, not a filesystem. Inventing a device node here would be a
    guess, so the unit names a stable by-uuid path with an obvious placeholder — uppercase precisely so
    it cannot be mistaken for a real UUID and pasted unedited."""
    u = st.mount_unit(st.validate(target))
    assert u["unit"] == _expect(label, "/dev/disk/by-uuid/REPLACE-WITH-UUID", "/srv/tepna/archive",
                                "ext4", "_netdev,noatime")


def test_configured_options_replace_the_defaults_entirely():
    """`Options={opts or default_opts}` — an operator who states options is overriding, not extending."""
    u = st.mount_unit(st.validate({**NFS, "options": "ro,_netdev"}))
    assert "\nOptions=ro,_netdev\n" in u["unit"]


# ── the unit FILENAME ───────────────────────────────────────────────────────────────────────────────
def test_the_unit_filename_is_the_systemd_escaped_mountpoint():
    """systemd derives a .mount unit's name from its mountpoint and silently IGNORES any unit whose
    filename does not match. A literal dash in a path component escapes to lowercase `\\x2d` — that is
    what `systemd-escape` emits, and an uppercase `\\x2D` names a unit systemd will never mount."""
    u = st.mount_unit(st.validate({**NFS, "mountpoint": "/srv/tepna-archive"}))
    assert u["unit_name"] == "srv-tepna\\x2darchive.mount"


# ── the root steps, in full and in order ────────────────────────────────────────────────────────────
def _steps(mp="/srv/tepna/archive", unit="srv-tepna-archive.mount"):
    return [f"sudo mkdir -p {mp}",
            f"sudo tee /etc/systemd/system/{unit} > /dev/null  # paste the unit below",
            "sudo systemctl daemon-reload",
            f"sudo systemctl enable --now {unit}"]


def test_the_nfs_steps_are_exactly_the_four_the_operator_must_run():
    assert st.mount_unit(st.validate(NFS))["steps"] == _steps()


def test_the_iscsi_login_comes_before_the_steps_that_need_the_device():
    """Order is the point: `enable --now` mounts the filesystem, which cannot exist until the target has
    been discovered and logged into. 3260 is the IANA iSCSI port — the default is what an operator who
    left `port` unset actually gets."""
    steps = st.mount_unit(st.validate(ISCSI))["steps"]
    assert steps[0] == ("sudo iscsiadm -m discovery -t st -p 192.168.0.142:3260 && "
                        "sudo iscsiadm -m node -T iqn.2003-01.org.linux-iscsi:tepna --login")
    assert steps[1:] == _steps()


def test_the_nvmeof_connect_comes_before_the_steps_that_need_the_device():
    """4420 is the IANA NVMe-oF/TCP port, same reasoning as iSCSI's 3260."""
    steps = st.mount_unit(st.validate(NVMEOF))["steps"]
    assert steps[0] == ("sudo nvme connect -t tcp -a 192.168.0.142 -s 4420 "
                        "-n nqn.2014-08.org.nvmexpress:tepna")
    assert steps[1:] == _steps()


@pytest.mark.parametrize("target,port", [(ISCSI, 3260), (NVMEOF, 4420)])
def test_a_configured_port_reaches_the_login_step(target, port):
    steps = st.mount_unit(st.validate({**target, "port": 3999}))["steps"]
    assert "3999" in steps[0] and str(port) not in steps[0]


@pytest.mark.parametrize("proto,share,port", [
    ("iscsi", "iqn.2003-01.org.linux-iscsi:tepna", 3260),
    ("nvmeof", "nqn.2014-08.org.nvmexpress:tepna", 4420),
])
def test_the_login_step_falls_back_to_the_iana_port_on_an_unvalidated_target(proto, share, port):
    """`validate()` always fills `port` in, so this literal fallback is unreachable through it — and
    reachable exactly where `mount_unit` says it defends itself: a plain dict that never went through
    validation, which on this box means a target persisted before `validate()` grew its current checks.
    That path still has to emit a correct login command, because the operator pastes it as root."""
    steps = st.mount_unit({"protocol": proto, "kind": "mount", "host": "192.168.0.142",
                           "share": share, "mountpoint": "/srv/tepna/archive"})["steps"]
    assert f":{port} " in steps[0] or f"-s {port} " in steps[0], steps[0]
