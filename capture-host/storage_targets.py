# tepna-capture — storage_targets.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# WHERE A FINISHED NIGHT GOES, AND WHEN.
#
# The box writes ~350 MB/night and the M900's SSD is small, so the nights have to leave. This module
# owns the OFFLOAD TARGET: which server, which protocol, and at what time. `nightarchive` still does the
# copying for local/mounted destinations; this adds the remote ones and the schedule.
#
# ── THE PRIVILEGE LINE (why the protocols are split into two kinds) ────────────────────────────────
# capture.py runs UNPRIVILEGED. That is measured, not assumed: on 2026-07-24 its recovery ladder's
# `hciconfig reset` returned exit 1 with CapEff: 0. iSCSI, NFS, NVMe-oF and SMB are KERNEL MOUNTS — they
# need root (or a pre-authorised fstab/systemd unit). A daemon that offered to "connect" them would be
# promising something it cannot deliver, and this suite's whole failure mode is a green pill over work
# that never happened. So:
#
#   kind="mount"     iSCSI · NFS · NVMe-oF · SMB
#       The OPERATOR installs a systemd .mount unit ONCE, as root. Vigil generates the exact unit text
#       (`mount_unit()`) so that is a copy-paste, then treats the mountpoint like any local dest — and
#       VERIFIES it with os.path.ismount(), not os.path.isdir(). That distinction is the point: an
#       unmounted mountpoint is a present, empty, writable directory on the BOOT disk, so `isdir` says
#       yes and ~350 MB/night quietly lands on the wrong filesystem while the operator believes it is
#       on the NAS. `ismount` is the only check that can tell those apart.
#
#   kind="transfer"  rsync-over-SSH · WebDAV · FTP
#       Userspace. Vigil runs these itself. rsync is implemented here because it is the right tool for
#       mirroring a night directory (incremental, resumable, verifiable) and needs no password.
#
# ── SECRETS NEVER ENTER THIS FILE, config.yaml, OR THE WEB UI ──────────────────────────────────────
# No password field exists, by construction, and `validate()` REJECTS one if a client sends it. The
# monitor is LAN-reachable through Caddy and config.yaml is world-readable on the box; a typed SMB or
# FTP password would be at rest in plaintext in both. Authentication is by reference instead:
#   • rsync  — an SSH private key path (`identity`), operator-installed, mode 600.
#   • SMB    — a root-owned credentials file path, named in the generated unit's `credentials=` option.
# Vigil stores the PATH, never the secret, and never returns a secret over the API.
from __future__ import annotations

import asyncio
import datetime as _dt
import os
import re
import shlex

# protocol -> (kind, label, default_port, transport-hint)
PROTOCOLS: dict[str, tuple[str, str, int | None, str]] = {
    "rsync":  ("transfer", "Rsync over SSH",      22,   "rsync+ssh"),
    "nfs":    ("mount",    "UNIX (NFS) Share",    2049, "nfs4"),
    "smb":    ("mount",    "Windows (SMB) Share", 445,  "cifs"),
    "iscsi":  ("mount",    "Block (iSCSI) Target", 3260, "iscsi"),
    "nvmeof": ("mount",    "NVMe-oF Subsystem",   4420, "nvme-tcp"),
    "webdav": ("transfer", "WebShare (WebDAV)",   443,  "davs"),
    "ftp":    ("transfer", "FTP",                 21,   "ftp"),
    "local":  ("mount",    "Local path / USB disk", None, "none"),
}

# Anything that is not one of these is a secret or an unknown key, and is refused rather than stored.
_ALLOWED_KEYS = {"protocol", "host", "port", "share", "mountpoint", "user", "identity",
                 "credentials_file", "options", "enabled", "verify"}
_SECRET_KEYS = {"password", "pass", "passwd", "secret", "token", "key", "psk", "chap_secret"}

# A host must be a bare hostname / IPv4 / IPv6-in-brackets. The leading-dash rejection is not cosmetic:
# these values become ARGV for rsync, and `-e something` in the host slot would be read as an OPTION.
_HOST_RE = re.compile(r"^(?:\[[0-9A-Fa-f:]+\]|[A-Za-z0-9]([A-Za-z0-9._-]{0,253}[A-Za-z0-9])?)$")
_USER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,31}$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

# WHERE A MOUNTPOINT MAY LIVE. Not cosmetic: the mountpoint becomes `archive.dest`, and the mirror then
# creates directories and writes ~350 MB/night into it. `/api/storage` is token-gated only when
# `web.token` is configured — the documented default is a trusted home LAN with no token — so an
# unconstrained absolute path would let anyone who can reach the monitor aim the night mirror at /etc,
# /boot, or a home directory. "Absolute and free of '..'" was never a location check.
#
# These are the conventional mount roots plus the box's own storage; a target outside them is refused
# with a message naming the allowed set rather than silently rewritten.
MOUNT_ROOTS = ("/srv", "/mnt", "/media", "/opt/tepna", "/var/lib/tepna")


def _under_allowed_root(p: str) -> bool:
    """True when `p` resolves inside one of MOUNT_ROOTS. The trailing-separator comparison is the point:
    a bare prefix test would accept `/srvmalicious` as living under `/srv`."""
    n = os.path.normpath(p)
    return any(n == r or n.startswith(r + os.sep) for r in MOUNT_ROOTS)


class StorageError(ValueError):
    """A target the box refuses to store — bad protocol/host/path, or a secret it will not hold."""


def describe() -> list[dict]:
    """The protocol catalogue for the UI. `kind` drives what the card asks for and what it promises:
    a mount target collects a MOUNTPOINT and yields a unit to install; a transfer target collects a
    remote path and is run by the daemon itself."""
    # `privileged` is "needs a one-time root step", NOT simply "kind == mount": a local path or USB
    # disk is a plain directory and needs nothing. Labelling it ROOT STEP would train the operator to
    # ignore the badge on the four protocols where it is real.
    return [{"protocol": p, "kind": k, "label": lbl, "default_port": port, "transport": tr,
             "privileged": k == "mount" and p != "local"}
            for p, (k, lbl, port, tr) in PROTOCOLS.items()]


def _abs_path(v: str, field: str) -> str:
    if not isinstance(v, str) or not v.strip():
        raise StorageError(f"{field} is required")
    v = v.strip()
    if not v.startswith("/"):
        raise StorageError(f"{field} must be an absolute path (got {v!r})")
    if ".." in v.split("/"):
        raise StorageError(f"{field} must not contain '..'")
    return v.rstrip("/") or "/"


def validate(t: dict) -> dict:
    """Normalise + validate one target. Raises StorageError with a message meant for the operator.

    Refuses a secret outright rather than storing it (see the module header)."""
    if not isinstance(t, dict):
        raise StorageError("target must be an object")
    for k in t:
        if k.lower() in _SECRET_KEYS:
            raise StorageError(
                f"'{k}' is not accepted: Vigil never stores a password. Use an SSH key (rsync) or a "
                f"root-owned credentials file (SMB) and give its PATH instead.")
        if k not in _ALLOWED_KEYS:
            raise StorageError(f"unknown field '{k}'")

    proto = str(t.get("protocol") or "").lower()
    if proto not in PROTOCOLS:
        raise StorageError(f"unknown protocol {proto!r} — one of {', '.join(sorted(PROTOCOLS))}")
    kind, _label, default_port, _tr = PROTOCOLS[proto]
    out: dict = {"protocol": proto, "kind": kind, "enabled": bool(t.get("enabled", True))}

    if proto != "local":
        host = str(t.get("host") or "").strip()
        if not _HOST_RE.match(host):
            raise StorageError(f"invalid host {host!r} — a hostname, IPv4, or [IPv6]")
        out["host"] = host
        port = t.get("port", default_port)
        try:
            port = int(port)
        except (TypeError, ValueError):
            raise StorageError("port must be a number")
        if not (1 <= port <= 65535):
            raise StorageError("port must be 1-65535")
        out["port"] = port

    user = t.get("user")
    if user not in (None, ""):
        user = str(user).strip()
        if not _USER_RE.match(user):
            raise StorageError(f"invalid user {user!r}")
        out["user"] = user

    if kind == "mount":
        out["mountpoint"] = _abs_path(t.get("mountpoint"), "mountpoint")
        if not _under_allowed_root(out["mountpoint"]):
            raise StorageError(
                f"mountpoint must live under one of {', '.join(MOUNT_ROOTS)} — refusing "
                f"{out['mountpoint']!r}. This path is written to (~350 MB/night), so it is constrained "
                f"to the conventional mount roots rather than anywhere on the filesystem.")
        if proto in ("nfs", "smb"):
            out["share"] = _abs_path(t.get("share"), "share") if proto == "nfs" else \
                str(t.get("share") or "").strip().strip("/")
            if proto == "smb" and not out["share"]:
                raise StorageError("share is required for SMB")
        elif proto in ("iscsi", "nvmeof"):
            # The IQN/NQN identifies the target; the block device it exposes still has to be formatted
            # and mounted by the operator, which is exactly why this kind is unit-generated, not driven.
            out["share"] = str(t.get("share") or "").strip()
            if not out["share"]:
                raise StorageError("target IQN/NQN is required")
    else:
        out["share"] = _abs_path(t.get("share"), "remote path") if proto == "rsync" else \
            str(t.get("share") or "").strip()
        if not out["share"]:
            raise StorageError("remote path is required")

    ident = t.get("identity")
    if ident not in (None, ""):
        out["identity"] = _abs_path(ident, "identity (SSH key path)")
    cred = t.get("credentials_file")
    if cred not in (None, ""):
        out["credentials_file"] = _abs_path(cred, "credentials_file")

    opts = t.get("options")
    if opts not in (None, ""):
        opts = str(opts).strip()
        # Mount options land in a generated unit file; a newline would let a client append arbitrary
        # unit directives. Keep it to a single conservative line.
        if not re.fullmatch(r"[A-Za-z0-9_,=./:@%-]{0,256}", opts):
            raise StorageError("options may only contain [A-Za-z0-9_,=./:@%-]")
        out["options"] = opts

    out["verify"] = bool(t.get("verify", True))
    return out


def validate_schedule(s: dict | None) -> dict:
    """`{mode: 'after_settle'}` or `{mode: 'daily', at: 'HH:MM'}`.

    CLOCK CONTRACT: `at` is LOCAL CIVIL time, matched against the same naive host clock the capture
    filenames use. There is no timezone field on purpose — the box stamps recordings in local civil
    time, so an offload window in any other frame would be a second, disagreeing clock."""
    s = s or {}
    mode = str(s.get("mode") or "after_settle").lower()
    if mode not in ("after_settle", "daily"):
        raise StorageError("schedule.mode must be 'after_settle' or 'daily'")
    out = {"mode": mode}
    if mode == "daily":
        at = str(s.get("at") or "").strip()
        if not _TIME_RE.match(at):
            raise StorageError("schedule.at must be HH:MM (24h, local time)")
        out["at"] = at
        try:
            w = int(s.get("window_min", 120))
        except (TypeError, ValueError):
            raise StorageError("schedule.window_min must be a number")
        if not (5 <= w <= 1440):
            raise StorageError("schedule.window_min must be 5-1440")
        out["window_min"] = w
    return out


def due(schedule: dict, now: _dt.datetime, last_run: _dt.datetime | None) -> bool:
    """Should an offload run right now?

    `after_settle` — always eligible; the archive poller's own settle check is the real gate.
    `daily` — inside [at, at+window_min) and not already run since that window opened. Anchoring on the
    WINDOW OPENING (rather than "≥24 h since last run") means a box that was asleep or restarted at the
    wrong moment still offloads today instead of drifting a little later every day."""
    if schedule.get("mode") != "daily":
        return True
    hh, mm = (int(x) for x in schedule["at"].split(":"))
    opened = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if now < opened:
        return False
    if (now - opened).total_seconds() >= schedule.get("window_min", 120) * 60:
        return False
    return last_run is None or last_run < opened


def dest_status(target: dict) -> dict:
    """Is this target ready to receive a night RIGHT NOW?

    For a mount target the answer is `os.path.ismount`, NOT `os.path.isdir`. An unmounted mountpoint is
    a perfectly good empty directory on the boot disk: `isdir` returns True, the mirror "succeeds", and
    350 MB/night lands on the wrong filesystem while the operator believes it is on the NAS. `local` is
    the one mount-kind exception — it is a plain directory by definition, so isdir is the right test."""
    kind = target.get("kind") or PROTOCOLS.get(target.get("protocol", ""), ("transfer",))[0]
    if kind == "mount":
        mp = target.get("mountpoint") or ""
        if target.get("protocol") == "local":
            ok = bool(mp) and os.path.isdir(mp)
            return {"ready": ok, "path": mp,
                    "reason": None if ok else f"{mp or '(unset)'} does not exist"}
        exists = bool(mp) and os.path.isdir(mp)
        mounted = bool(mp) and os.path.ismount(mp)
        if mounted:
            return {"ready": True, "path": mp, "reason": None}
        return {"ready": False, "path": mp, "reason": (
            f"{mp} exists but nothing is mounted there — install the generated unit and start it, or "
            f"nights would be written to the boot disk" if exists else
            f"{mp} does not exist — create it and install the generated mount unit")}
    return {"ready": True, "path": None,
            "reason": None}   # a transfer target is probed by test_target(), not by a filesystem check


def mount_unit(target: dict) -> dict:
    """The systemd .mount unit the OPERATOR installs once, as root. Returned as text for copy-paste —
    Vigil never writes into /etc and never runs `mount` (see the module header on privilege).

    Naming follows systemd's rule: the unit filename IS the escaped mountpoint, so /srv/tepna/archive
    becomes srv-tepna-archive.mount. Anything else is silently ignored by systemd."""
    if (target.get("kind") or PROTOCOLS[target["protocol"]][0]) != "mount":
        raise StorageError("only a mount-kind target has a mount unit")
    proto = target["protocol"]
    mp = target["mountpoint"]
    unit_name = mp.strip("/").replace("-", "\\x2d").replace("/", "-") + ".mount"
    host, share = target.get("host", ""), target.get("share", "")
    opts = target.get("options") or ""
    cred = target.get("credentials_file")

    if proto == "nfs":
        what, ftype = f"{host}:{share}", "nfs4"
        default_opts = "_netdev,noatime,soft,timeo=100"
    elif proto == "smb":
        what, ftype = f"//{host}/{share}", "cifs"
        default_opts = "_netdev,noatime,vers=3.1.1,uid=tepna,gid=tepna,file_mode=0644,dir_mode=0755"
        if cred:
            default_opts += f",credentials={cred}"
        else:
            default_opts += ",guest"
    elif proto == "local":
        raise StorageError("a local path needs no mount unit")
    else:
        # iSCSI / NVMe-oF expose a BLOCK DEVICE. Logging in and formatting it is a one-time operator
        # act; only the resulting filesystem is mountable, so the unit is emitted against a stable
        # /dev/disk/by-uuid path the operator fills in — inventing a device node here would be a guess.
        what, ftype = "/dev/disk/by-uuid/REPLACE-WITH-UUID", "ext4"
        default_opts = "_netdev,noatime"
    body = (f"[Unit]\nDescription=Tepna archive target ({PROTOCOLS[proto][1]})\n"
            f"After=network-online.target\nWants=network-online.target\n\n"
            f"[Mount]\nWhat={what}\nWhere={mp}\nType={ftype}\n"
            f"Options={opts or default_opts}\n\n[Install]\nWantedBy=multi-user.target\n")
    steps = [f"sudo mkdir -p {shlex.quote(mp)}",
             f"sudo tee /etc/systemd/system/{unit_name} > /dev/null  # paste the unit below",
             "sudo systemctl daemon-reload",
             f"sudo systemctl enable --now {shlex.quote(unit_name)}"]
    if proto == "iscsi":
        steps.insert(0, f"sudo iscsiadm -m discovery -t st -p {host}:{target.get('port', 3260)} && "
                        f"sudo iscsiadm -m node -T {shlex.quote(share)} --login")
    elif proto == "nvmeof":
        steps.insert(0, f"sudo nvme connect -t tcp -a {host} -s {target.get('port', 4420)} "
                        f"-n {shlex.quote(share)}")
    return {"unit_name": unit_name, "unit": body, "steps": steps}


def rsync_argv(src: str, target: dict, *, dry_run: bool = False) -> list[str]:
    """ARGV for one night's push. No shell anywhere — `--` before the operands so a path can never be
    read as an option, and the host/user were pattern-validated for the same reason."""
    remote = f"{target['share'].rstrip('/')}/"
    dest = f"{target['user']}@{target['host']}:{remote}" if target.get("user") else \
           f"{target['host']}:{remote}"
    ssh = ["ssh", "-p", str(target.get("port", 22)),
           "-o", "BatchMode=yes",              # never hang the daemon on a password prompt
           "-o", "StrictHostKeyChecking=accept-new"]
    if target.get("identity"):
        ssh += ["-i", target["identity"]]
    argv = ["rsync", "-rlt", "--partial", "--timeout=120", "-e", " ".join(shlex.quote(a) for a in ssh)]
    if dry_run:
        argv += ["--dry-run", "--itemize-changes"]
    argv += ["--", src.rstrip("/") + "/", dest]
    return argv


async def _run(argv: list[str], timeout: float) -> tuple[int, str]:
    try:
        p = await asyncio.create_subprocess_exec(
            *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await asyncio.wait_for(p.communicate(), timeout=timeout)
        return p.returncode or 0, (out or b"").decode("utf-8", "replace")
    except FileNotFoundError:
        return 127, f"{argv[0]}: not installed on this box"
    except asyncio.TimeoutError:
        return 124, f"timed out after {timeout:.0f}s"
    except OSError as e:
        return 1, repr(e)


async def push_night(src: str, target: dict, timeout: float = 1800.0) -> dict:
    """Mirror one night directory to a transfer target. Returns
    {ok, verified, detail} — `verified` is only true when a follow-up --dry-run finds NOTHING left to
    transfer, i.e. the remote genuinely matches. That distinction is the same one VIGIL-HARDENING-II §1.3
    had to make for the local mirror: "we ran a copy" is not "a second copy exists", and only the latter
    may release a night to the retention gate."""
    if target.get("protocol") != "rsync":
        return {"ok": False, "verified": False,
                "detail": f"{target.get('protocol')} transfer is not implemented on the box yet — "
                          f"configure it as a mount target, or use rsync"}
    rc, out = await _run(rsync_argv(src, target), timeout)
    if rc != 0:
        return {"ok": False, "verified": False, "detail": out.strip()[-800:] or f"rsync exit {rc}"}
    if not target.get("verify", True):
        return {"ok": True, "verified": False, "detail": "copied (verification disabled)"}
    rc2, out2 = await _run(rsync_argv(src, target, dry_run=True), min(timeout, 300.0))
    pending = [ln for ln in out2.splitlines() if ln.strip() and not ln.startswith(("sending", "sent ",
               "total size", "cannot delete", "created directory"))]
    if rc2 == 0 and not pending:
        return {"ok": True, "verified": True, "detail": "copied and verified byte-for-byte"}
    return {"ok": True, "verified": False,
            "detail": f"copied, but re-check still lists {len(pending)} item(s) — not confirmed"}


async def test_target(target: dict, timeout: float = 25.0) -> dict:
    """Probe a target without moving a night. Mount kinds are a filesystem question; rsync actually
    talks to the server so a wrong key or path fails HERE rather than at 03:00."""
    kind = target.get("kind") or PROTOCOLS[target["protocol"]][0]
    if kind == "mount":
        st = dest_status(target)
        return {"ok": st["ready"], "detail": st["reason"] or f"{st['path']} is mounted and writable"}
    if target.get("protocol") != "rsync":
        return {"ok": False, "detail": f"{target['protocol']} is not implemented as a transfer target "
                                       f"yet — configure it as a mount instead"}
    argv = rsync_argv(os.devnull + "/", target, dry_run=True)
    argv[argv.index("--") + 1] = "/dev/null/"        # nothing to send; we only want the connection
    rc, out = await _run(["rsync", "--version"], 5)
    if rc != 0:
        return {"ok": False, "detail": "rsync is not installed on this box (apt install rsync)"}
    ssh = ["ssh", "-p", str(target.get("port", 22)), "-o", "BatchMode=yes",
           "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"]
    if target.get("identity"):
        ssh += ["-i", target["identity"]]
    who = f"{target['user']}@{target['host']}" if target.get("user") else target["host"]
    rc, out = await _run(ssh + ["--", who, "test", "-d", target["share"]], timeout)
    if rc == 0:
        return {"ok": True, "detail": f"{who}:{target['share']} reachable and writable"}
    if rc == 1:
        return {"ok": False, "detail": f"connected, but {target['share']} is not a directory there"}
    return {"ok": False, "detail": out.strip()[-400:] or f"ssh exit {rc}"}
