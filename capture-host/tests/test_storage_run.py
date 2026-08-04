# tepna-capture — tests/test_storage_run.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# `storage_targets._run` is the async sibling of `cpap_harvest._sh`: every rsync and every ssh probe the
# offload issues goes through it. CAPTURE-HOST-SUBPROCESS-SURFACE-2026-08-04 §4 step 4.
#
# Like `_sh` it NEVER RAISES — every failure becomes a return code the caller branches on. Nothing
# asserted on the call, so the stream redirection, the return-code normalisation and the decode were
# unobservable, and with them the difference between "the copy failed" and "the copy succeeded".

import asyncio

import storage_targets as st


def _run(coro):
    return asyncio.run(coro)


# ── the call ────────────────────────────────────────────────────────────────────────────────────────
def test_stderr_is_folded_into_stdout_so_rsync_errors_survive(recorded_exec, fake_proc):
    """`stderr=asyncio.subprocess.STDOUT`. rsync reports every failure on stderr, and the caller returns
    `out.strip()[-800:]` as the operator-visible detail. Redirecting only stdout leaves that detail
    EMPTY on exactly the runs that failed — `push_night` then reports `rsync exit 23` with no reason.

    Dropping the kwarg entirely is worse than setting it wrong: the default is INHERIT, so the child
    writes to the daemon's own stderr and the text never returns at all."""
    recorded_exec.reply = lambda argv: fake_proc(0, b"ok\n", b"")
    _run(st._run(["rsync", "-a", "x", "y"], 5))

    kw = recorded_exec.last.kw
    assert kw["stdout"] is asyncio.subprocess.PIPE, "unread output is no output"
    assert kw["stderr"] is asyncio.subprocess.STDOUT, \
        "rsync's failures are on stderr; they must arrive in the same stream the caller reads"
    assert recorded_exec.last.argv == ["rsync", "-a", "x", "y"], "argv must arrive intact"


def test_a_nonzero_exit_stays_nonzero(recorded_exec, fake_proc):
    """`p.returncode or 0` normalises a None to 0 — a process that somehow reports no code is not a
    failure. Turning that into `and` inverts the whole contract: every NONZERO code becomes 0, so a
    failed rsync returns success and `push_night` reports the night as copied. This is the difference
    between an offload that failed loudly and one that silently did not happen."""
    recorded_exec.reply = lambda argv: fake_proc(23, b"rsync: some files could not be transferred\n", b"")
    rc, out = _run(st._run(["rsync", "x", "y"], 5))
    assert rc == 23, "a failing rsync must not read as success"
    assert "could not be transferred" in out


def test_a_none_returncode_reads_as_success(recorded_exec, fake_proc):
    recorded_exec.reply = lambda argv: fake_proc(None, b"", b"")
    assert _run(st._run(["rsync", "--version"], 5))[0] == 0


def test_undecodable_output_is_replaced_rather_than_raising(recorded_exec, fake_proc):
    """`.decode("utf-8", "replace")`. rsync echoes FILENAMES, and a filename is bytes — a stray latin-1
    byte in one of 300 nights would otherwise raise UnicodeDecodeError out of a function whose entire
    contract is that it never raises, taking down the offload for an encoding detail."""
    recorded_exec.reply = lambda argv: fake_proc(0, b"sending \xff\xfe.edf\n", b"")
    rc, out = _run(st._run(["rsync", "x", "y"], 5))
    assert rc == 0
    assert "�" in out, "undecodable bytes become the replacement char, not an exception"


# ── it never raises ─────────────────────────────────────────────────────────────────────────────────
def test_a_missing_rsync_is_127_not_an_exception(recorded_exec):
    recorded_exec.reply = lambda argv: FileNotFoundError()
    rc, out = _run(st._run(["rsync", "x", "y"], 5))
    assert rc == 127 and "rsync" in out and "not installed" in out


def test_a_timeout_is_124_and_names_the_bound(recorded_exec, monkeypatch):
    async def boom(proc, timeout, stdin=None):
        raise asyncio.TimeoutError()

    monkeypatch.setattr(st.proc_util, "communicate", boom)
    rc, out = _run(st._run(["rsync", "x", "y"], 1800))
    assert rc == 124 and "1800s" in out


def test_an_os_error_is_1_and_carries_the_exception(recorded_exec):
    recorded_exec.reply = lambda argv: OSError("no such device")
    rc, out = _run(st._run(["rsync", "x", "y"], 5))
    assert rc == 1 and "OSError" in out and "no such device" in out


# ── push_night: "we ran a copy" is not "a second copy exists" ───────────────────────────────────────
def test_a_failed_transfer_is_never_reported_as_verified(recorded_exec, fake_proc):
    """VIGIL-HARDENING-II §1.3's distinction. `verified` may only be true when a follow-up --dry-run
    finds nothing left to send."""
    recorded_exec.reply = lambda argv: fake_proc(23, b"rsync error: partial transfer\n", b"")
    res = _run(st.push_night("/srv/night", {"protocol": "rsync", "host": "nas", "share": "/vol"}))
    assert res["ok"] is False and res["verified"] is False
    assert "partial transfer" in res["detail"]


def test_a_dry_run_that_still_lists_files_is_copied_but_not_verified(recorded_exec, fake_proc):
    """The second rsync is the verification. If it still has something to send, the remote does NOT
    match — reporting `verified` there is the exact claim VIGIL-HARDENING-II says must be earned."""
    seq = iter([fake_proc(0, b"sent 1 bytes\n", b""), fake_proc(0, b"still/pending.edf\n", b"")])
    recorded_exec.reply = lambda argv: next(seq)
    res = _run(st.push_night("/srv/night", {"protocol": "rsync", "host": "nas", "share": "/vol"}))
    assert res["ok"] is True and res["verified"] is False


def test_a_clean_dry_run_verifies(recorded_exec, fake_proc):
    """Only rsync's own bookkeeping lines remain, so nothing is pending."""
    seq = iter([fake_proc(0, b"sent 10 bytes\n", b""),
                fake_proc(0, b"sending incremental file list\nsent 5 bytes\ntotal size is 5\n", b"")])
    recorded_exec.reply = lambda argv: next(seq)
    res = _run(st.push_night("/srv/night", {"protocol": "rsync", "host": "nas", "share": "/vol"}))
    assert res["ok"] is True and res["verified"] is True


def test_verification_can_be_disabled_without_claiming_it_happened(recorded_exec, fake_proc):
    recorded_exec.reply = lambda argv: fake_proc(0, b"sent 10 bytes\n", b"")
    res = _run(st.push_night("/srv/night",
                             {"protocol": "rsync", "host": "nas", "share": "/vol", "verify": False}))
    assert res["ok"] is True and res["verified"] is False
    assert len(recorded_exec.calls) == 1, "verification disabled means the second rsync is not run"


def test_a_non_rsync_protocol_is_refused_before_any_process_starts(recorded_exec):
    res = _run(st.push_night("/srv/night", {"protocol": "nfs", "host": "nas", "share": "/vol"}))
    assert res["ok"] is False and res["verified"] is False
    assert recorded_exec.calls == [], "an unimplemented protocol must not spawn anything"


def test_the_verification_pass_is_bounded_more_tightly_than_the_transfer(recorded_exec, fake_proc):
    """`min(timeout, 300.0)`. The copy may legitimately take 30 minutes; a dry-run that lists what is
    already there must not, and letting it inherit the transfer's bound means a hung verification holds
    the offload for the full half hour."""
    seen = []

    async def spy(argv, timeout):
        seen.append(timeout)
        return 0, "sent 1 bytes\n"

    import unittest.mock as _m
    with _m.patch.object(st, "_run", spy):
        _run(st.push_night("/srv/night", {"protocol": "rsync", "host": "nas", "share": "/vol"},
                           timeout=1800.0))
    assert seen == [1800.0, 300.0], "the transfer gets its full bound; the verification is capped at 300"


# ── dest_status: an unmounted mountpoint is a good empty directory ──────────────────────────────────
def test_a_mountpoint_that_exists_but_is_not_mounted_is_not_ready(tmp_path, monkeypatch):
    """`os.path.ismount`, NOT `os.path.isdir`. The docstring records why: an unmounted mountpoint is a
    perfectly good empty directory on the boot disk, so `isdir` returns True, the mirror "succeeds",
    and 350 MB/night lands on the wrong filesystem while the operator believes it is on the NAS.

    The two must be asked SEPARATELY, because the reason distinguishes them — "exists but nothing is
    mounted" tells the operator to start the unit; "does not exist" tells them to create the directory.
    Collapsing either into the other sends them to the wrong fix."""
    mp = tmp_path / "srv" / "tepna" / "archive"
    mp.mkdir(parents=True)
    monkeypatch.setattr(st, "MOUNT_ROOTS", (str(tmp_path / "srv"),))
    monkeypatch.setattr(st.os.path, "ismount", lambda p: False)

    res = st.dest_status({"protocol": "nfs", "kind": "mount", "mountpoint": str(mp)})
    assert res["ready"] is False, "an empty directory is not a mounted filesystem"
    assert "nothing is mounted" in res["reason"] and "boot disk" in res["reason"]


def test_a_genuinely_mounted_path_is_ready_with_no_reason(tmp_path, monkeypatch):
    mp = tmp_path / "srv" / "tepna" / "archive"
    mp.mkdir(parents=True)
    monkeypatch.setattr(st, "MOUNT_ROOTS", (str(tmp_path / "srv"),))
    monkeypatch.setattr(st.os.path, "ismount", lambda p: True)
    res = st.dest_status({"protocol": "nfs", "kind": "mount", "mountpoint": str(mp)})
    assert res == {"ready": True, "path": str(mp), "reason": None}


def test_an_absent_mountpoint_says_create_it_rather_than_start_the_unit(tmp_path, monkeypatch):
    mp = tmp_path / "srv" / "tepna" / "gone"
    monkeypatch.setattr(st, "MOUNT_ROOTS", (str(tmp_path / "srv"),))
    monkeypatch.setattr(st.os.path, "ismount", lambda p: False)
    res = st.dest_status({"protocol": "nfs", "kind": "mount", "mountpoint": str(mp)})
    assert res["ready"] is False and "does not exist" in res["reason"]


def test_a_local_target_is_a_directory_check_not_a_mount_check(tmp_path, monkeypatch):
    """`local` is the one kind where an ordinary directory IS the destination — asking ismount there
    would reject every correctly-configured local mirror."""
    mp = tmp_path / "srv" / "tepna" / "local"
    mp.mkdir(parents=True)
    monkeypatch.setattr(st, "MOUNT_ROOTS", (str(tmp_path / "srv"),))
    monkeypatch.setattr(st.os.path, "ismount", lambda p: False)
    assert st.dest_status({"protocol": "local", "kind": "mount", "mountpoint": str(mp)})["ready"] is True


def test_a_mountpoint_outside_the_allowed_roots_is_refused_before_any_stat(tmp_path, monkeypatch):
    """The containment check runs FIRST, so a configured path outside the allowed roots is rejected
    without the filesystem being consulted at all."""
    monkeypatch.setattr(st, "MOUNT_ROOTS", (str(tmp_path / "srv"),))
    called = []
    monkeypatch.setattr(st.os.path, "ismount", lambda p: called.append(p) or True)
    res = st.dest_status({"protocol": "nfs", "kind": "mount", "mountpoint": "/etc"})
    assert res["ready"] is False and "not under an allowed mount root" in res["reason"]
    assert called == [], "containment is decided before the filesystem is touched"


def test_no_mountpoint_configured_says_so(monkeypatch):
    res = st.dest_status({"protocol": "nfs", "kind": "mount", "mountpoint": ""})
    assert res["ready"] is False and res["reason"] == "no mountpoint configured"


# ── test_target: the ssh probe's exit codes are three different answers ─────────────────────────────
def test_a_missing_rsync_is_reported_as_such_and_stops_the_probe(recorded_exec, fake_proc):
    recorded_exec.reply = lambda argv: fake_proc(127, b"", b"")
    res = _run(st.test_target({"protocol": "rsync", "host": "nas", "share": "/vol"}))
    assert res["ok"] is False and "rsync is not installed" in res["detail"]
    assert len(recorded_exec.calls) == 1, "no ssh probe once rsync is known to be absent"


def test_exit_one_means_connected_but_wrong_path_not_unreachable(recorded_exec, fake_proc):
    """`test -d` exits 1 when the path is not a directory — the host ANSWERED. Folding that into the
    generic arm reports a connection problem for a configuration one, and the operator debugs the
    network instead of the share path."""
    seq = iter([fake_proc(0, b"rsync 3.2\n", b""), fake_proc(1, b"", b"")])
    recorded_exec.reply = lambda argv: next(seq)
    res = _run(st.test_target({"protocol": "rsync", "host": "nas", "share": "/vol"}))
    assert res["ok"] is False
    assert "connected, but" in res["detail"] and "/vol" in res["detail"]


def test_a_successful_probe_names_what_it_reached(recorded_exec, fake_proc):
    seq = iter([fake_proc(0, b"rsync 3.2\n", b""), fake_proc(0, b"", b"")])
    recorded_exec.reply = lambda argv: next(seq)
    res = _run(st.test_target({"protocol": "rsync", "host": "nas", "share": "/vol", "user": "tepna"}))
    assert res["ok"] is True and "tepna@nas:/vol" in res["detail"]


def test_the_ssh_probe_is_batch_mode_and_bounded(recorded_exec, fake_proc):
    """BatchMode=yes is what makes this a PROBE: without it ssh prompts for a password from a daemon
    with no terminal and hangs until the timeout. ConnectTimeout bounds the TCP wait separately from
    the caller's own deadline, and accept-new lets a first contact succeed without pre-seeding
    known_hosts while still pinning the key afterwards."""
    seq = iter([fake_proc(0, b"rsync 3.2\n", b""), fake_proc(0, b"", b"")])
    recorded_exec.reply = lambda argv: next(seq)
    _run(st.test_target({"protocol": "rsync", "host": "nas", "share": "/vol", "port": 2222}))
    ssh = recorded_exec.calls[1].argv
    assert ssh[:2] == ["ssh", "-p"] and ssh[2] == "2222", "the configured port must reach ssh"
    joined = " ".join(ssh)
    assert "BatchMode=yes" in joined, "a prompt would hang the daemon"
    assert "ConnectTimeout=10" in joined
    assert "StrictHostKeyChecking=accept-new" in joined
    assert ssh[-4:] == ["--", "nas", "test", "-d"] or "test" in ssh, "the probe is `test -d <share>`"


def test_an_identity_file_is_passed_when_configured(recorded_exec, fake_proc):
    seq = iter([fake_proc(0, b"rsync 3.2\n", b""), fake_proc(0, b"", b"")])
    recorded_exec.reply = lambda argv: next(seq)
    _run(st.test_target({"protocol": "rsync", "host": "nas", "share": "/vol", "identity": "/k/id"}))
    ssh = recorded_exec.calls[1].argv
    assert "-i" in ssh and ssh[ssh.index("-i") + 1] == "/k/id"


def test_a_mount_target_is_answered_from_the_filesystem_not_from_ssh(recorded_exec, tmp_path, monkeypatch):
    mp = tmp_path / "srv" / "tepna" / "archive"
    mp.mkdir(parents=True)
    monkeypatch.setattr(st, "MOUNT_ROOTS", (str(tmp_path / "srv"),))
    monkeypatch.setattr(st.os.path, "ismount", lambda p: True)
    res = _run(st.test_target({"protocol": "nfs", "kind": "mount", "mountpoint": str(mp)}))
    assert res["ok"] is True
    assert recorded_exec.calls == [], "a mount target must not spawn ssh"


def test_an_unimplemented_transfer_protocol_is_refused_before_spawning(recorded_exec):
    res = _run(st.test_target({"protocol": "webdav", "kind": "transfer", "host": "h"}))
    assert res["ok"] is False and "not implemented" in res["detail"]
    assert recorded_exec.calls == []


def test_the_probes_default_port_and_bounds_are_what_reaches_run(recorded_exec):
    """Two things no other test here can see, because they only appear when nothing overrides them.

    The DEFAULT port: every other case configures one, so `target.get("port", 22)` is never exercised
    and a changed default is invisible — while in production most targets omit it.

    The version probe's own bound: `rsync --version` is a local, instant call and gets 5s, separate
    from the caller's timeout. That number is not visible through create_subprocess_exec, because the
    deadline is applied by proc_util.communicate, so it has to be observed at the _run boundary."""
    seen = []

    async def spy(argv, timeout):
        seen.append((list(argv), timeout))
        return (0, "rsync 3.2\n") if "--version" in argv else (0, "")

    import unittest.mock as _m
    with _m.patch.object(st, "_run", spy):
        _run(st.test_target({"protocol": "rsync", "host": "nas", "share": "/vol"}))

    ver_argv, ver_timeout = seen[0]
    assert ver_argv == ["rsync", "--version"] and ver_timeout == 5, \
        "the version probe is local and instant — 5s, not the caller's transfer bound"
    ssh_argv, _ = seen[1]
    assert ssh_argv[:3] == ["ssh", "-p", "22"], "an unconfigured target must use ssh's port 22"
