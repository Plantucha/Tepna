# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The retention gate for a TRANSFER (rsync-over-ssh) archive target, 2026-09-20.

Three defects read in the tree while wiring the TrueNAS offload, none ever exercised because no night
had been pushed by this path: (1) `storage_poller` gated retention on `archive.dest` only, so a box
archiving by rsync had NO gate — `keep_nights > 0` pruned by age while the verified-push markers went
unread; (2) `rsync_argv` sent a night's CONTENTS into `share/` itself, so every night would have
flattened into one directory; (3) `include_subtrees` was honoured by the mount form and ignored by the
transfer form. Every gate here FAILS SAFE: unreachable means protect everything, never assume archived."""
import datetime as _dt
import os

import capture
import storage_targets as st
from test_capture_runners import _clean_stop, _run, _stop_after  # noqa: F401 — autouse fixture: resets _STOP/STATUS per test

RSYNC = {"protocol": "rsync", "host": "192.168.0.142", "user": "truenas_admin",
         "share": "/mnt/Storage10TB/vigil-archive/captures", "identity": "/var/lib/tepna/keys/id_ed25519_nas"}


def _target():
    return st.validate(RSYNC)


# ── (2) a night lands UNDER ITS OWN NAME ────────────────────────────────────────────────────────────
def test_rsync_argv_puts_the_night_under_share_slash_night_not_flat_into_share():
    argv = st.rsync_argv("/srv/tepna/captures/2026-09-15", _target())
    assert argv[-2] == "/srv/tepna/captures/2026-09-15/", "contents of the night…"
    assert argv[-1] == "truenas_admin@192.168.0.142:/mnt/Storage10TB/vigil-archive/captures/2026-09-15/", \
        "…into share/<night>/ — never share/ itself"
    # a trailing slash on the source is tolerated and does not eat the name
    assert st.rsync_argv("/srv/tepna/captures/2026-09-15/", _target())[-1].endswith("/2026-09-15/")
    # the same shape carries a subtree
    assert st.rsync_argv("/srv/tepna/captures/stored", _target())[-1].endswith("/captures/stored/")


# ── (1) confirm_night / confirm_nights — the truth table, fail-safe ────────────────────────────────
def _patch_run(monkeypatch, results):
    """`results`: list of (rc, out) consumed in order; records the argv of each call."""
    calls = []
    async def fake_run(argv, timeout):
        calls.append(argv)
        return results.pop(0)
    monkeypatch.setattr(st, "_run", fake_run)
    return calls


def test_confirm_night_is_true_only_for_rc0_with_nothing_pending(monkeypatch):
    calls = _patch_run(monkeypatch, [(0, "sending incremental file list\n\nsent 100 bytes\ntotal size is 5\n")])
    assert _run(st.confirm_night("/c/2026-09-15", _target())) == (True, True)
    assert "--dry-run" in calls[0] and "--itemize-changes" in calls[0]
    _patch_run(monkeypatch, [(0, "sending incremental file list\n>f.st...... Polar_H10_ECG.txt\nsent 1 bytes\n")])
    assert _run(st.confirm_night("/c/2026-09-15", _target())) == (False, True), "one pending file = not held"
    _patch_run(monkeypatch, [(23, "rsync: change_dir failed: No such file or directory\n")])
    assert _run(st.confirm_night("/c/2026-09-15", _target())) == (False, True), "remote dir missing"


def test_confirm_night_link_failures_are_unreachable_and_unconfirmed(monkeypatch):
    for rc in (255, 124, 127):
        _patch_run(monkeypatch, [(rc, "ssh: connect to host 192.168.0.142 port 22: No route to host")])
        assert _run(st.confirm_night("/c/2026-09-15", _target())) == (False, False), rc
    # a non-rsync transfer target confirms nothing, ever
    webdav = st.validate({"protocol": "webdav", "host": "nas.local", "share": "/dav"})
    assert _run(st.confirm_night("/c/2026-09-15", webdav)) == (False, False)


def test_confirm_nights_stops_at_the_first_link_failure_and_protects_the_rest(tmp_path, monkeypatch):
    for n in ("2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"):
        os.makedirs(str(tmp_path / n))
    calls = _patch_run(monkeypatch, [
        (0, "sent 1 bytes\n"),                                  # 09-13 confirmed
        (0, ">f+++++++++ x.txt\n"),                             # 09-14 pending → unconfirmed
        (255, "ssh: connection refused"),                       # 09-15 link dead → stop
    ])
    out = _run(st.confirm_nights(str(tmp_path), ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"], _target()))
    assert out == {"2026-09-14", "2026-09-15", "2026-09-16"}, "09-16 protected without being asked"
    assert len(calls) == 3
    assert _run(st.confirm_nights(str(tmp_path), [], _target())) == set() and len(calls) == 3, "no ssh for no nights"
    # a night that does not exist locally is not this gate's question
    assert _run(st.confirm_nights(str(tmp_path), ["2026-01-01"], _target())) == set() and len(calls) == 3


# ── (1) the poller: transfer target + keep_nights — held, pruned, unreachable ─────────────────────
def _nights(tmp_path, names, marked=()):
    """Settled nights: every file and dir backdated a week, or `diskguard.active_nights` would protect
    them as still-being-written and the gate under test would never see a candidate."""
    cap = tmp_path / "captures"
    old = 1_700_000_000
    for n in names:
        os.makedirs(str(cap / n), exist_ok=True)
        with open(str(cap / n / "a.txt"), "w") as fh:
            fh.write("x")
        if n in marked:
            open(str(cap / n / ".archived"), "w").close()
        for f in os.listdir(str(cap / n)):
            os.utime(str(cap / n / f), (old, old))
        os.utime(str(cap / n), (old, old))
    return cap


def _cfg(keep=1):
    return {"storage": {"keep_nights": keep, "min_free_gb": 0, "poll_sec": 1},
            "archive": {"enabled": True, "target": RSYNC}}


def test_a_transfer_target_GATES_retention_on_the_remote_not_on_age(tmp_path, monkeypatch, caplog):
    """Before: `archive_enabled = enabled and dest` ⇒ False for a target ⇒ no gate ⇒ both old nights
    pruned by age. Now: the unmarked night is held without asking; the marked one is asked of the
    remote and held when the remote does not hold it."""
    cap = _nights(tmp_path, ("2026-07-01", "2026-07-02", "2026-07-03"), marked=("2026-07-02",))
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 7, 4, 22, 0, 0))
    asked = []
    async def fake_confirm(captures, nights, target, timeout=300.0):
        asked.append(list(nights))
        return set(nights)                                   # remote holds none of them
    monkeypatch.setattr(capture.storage_targets, "confirm_nights", fake_confirm)
    _stop_after(monkeypatch, 1)
    with caplog.at_level("WARNING"):
        _run(capture.storage_poller(_cfg(), str(tmp_path)))
    assert asked == [["2026-07-02"]], "only the MARKED prune candidate costs an ssh session"
    st_ = capture.STATUS["storage"]
    assert st_["pruned"] == [] and st_["retention_held"] == ["2026-07-01", "2026-07-02"]
    assert "rsync://truenas_admin@192.168.0.142:/mnt/Storage10TB/vigil-archive/captures" in st_["retention_held_reason"]
    assert capture.diskguard.list_nights(str(cap)) == ["2026-07-01", "2026-07-02", "2026-07-03"]
    assert any("retention is HELD" in r.getMessage() for r in caplog.records)


def test_a_transfer_target_RELEASES_a_night_the_remote_confirms(tmp_path, monkeypatch):
    cap = _nights(tmp_path, ("2026-07-01", "2026-07-02", "2026-07-03"), marked=("2026-07-01", "2026-07-02"))
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 7, 4, 22, 0, 0))
    async def fake_confirm(captures, nights, target, timeout=300.0):
        return {"2026-07-02"}                                # 07-01 held on the NAS, 07-02 not
    monkeypatch.setattr(capture.storage_targets, "confirm_nights", fake_confirm)
    _stop_after(monkeypatch, 1)
    _run(capture.storage_poller(_cfg(), str(tmp_path)))
    assert capture.STATUS["storage"]["pruned"] == ["2026-07-01"]
    assert capture.diskguard.list_nights(str(cap)) == ["2026-07-02", "2026-07-03"]


def test_an_unreachable_nas_protects_EVERY_night_end_to_end(tmp_path, monkeypatch):
    """No fake at the confirm layer — the real `confirm_nights` with only `_run` replaced by a dead
    link. The 2026-07-25 shape: markers present, second copy unreachable ⇒ nothing is deleted."""
    cap = _nights(tmp_path, ("2026-07-01", "2026-07-02", "2026-07-03"), marked=("2026-07-01", "2026-07-02"))
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 7, 4, 22, 0, 0))
    async def dead(argv, timeout):
        return 255, "ssh: connect to host 192.168.0.142 port 22: No route to host"
    monkeypatch.setattr(st, "_run", dead)
    _stop_after(monkeypatch, 1)
    _run(capture.storage_poller(_cfg(), str(tmp_path)))
    assert capture.STATUS["storage"]["pruned"] == []
    assert capture.STATUS["storage"]["retention_held"] == ["2026-07-01", "2026-07-02"]
    assert capture.diskguard.list_nights(str(cap)) == ["2026-07-01", "2026-07-02", "2026-07-03"]


def test_a_transfer_target_with_retention_OFF_asks_nothing(tmp_path, monkeypatch):
    _nights(tmp_path, ("2026-07-01",), marked=("2026-07-01",))
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 7, 4, 22, 0, 0))
    async def boom(*a, **k):
        raise AssertionError("no ssh while keep_nights is 0")
    monkeypatch.setattr(capture.storage_targets, "confirm_nights", boom)
    _stop_after(monkeypatch, 1)
    _run(capture.storage_poller(_cfg(keep=0), str(tmp_path)))
    assert capture.STATUS["storage"]["pruned"] == []
    # and the uncovered-subtree reporter now runs for a transfer target too
    assert capture.STATUS["storage"]["uncovered"] == []


def test_a_non_rsync_target_is_not_an_archive_for_the_gate(tmp_path, monkeypatch):
    """`webdav`/`ftp` transfers are not implemented on the box; a config naming one must not read as
    "archived" — with no gate possible, retention behaves as if no archive were configured."""
    _nights(tmp_path, ("2026-07-01", "2026-07-02"), marked=("2026-07-01",))
    monkeypatch.setattr(capture, "_now", lambda: _dt.datetime(2026, 7, 4, 22, 0, 0))
    _stop_after(monkeypatch, 1)
    cfg = {"storage": {"keep_nights": 0, "min_free_gb": 0, "poll_sec": 1},
           "archive": {"enabled": True, "target": {"protocol": "webdav", "host": "nas.local", "share": "/dav"}}}
    _run(capture.storage_poller(cfg, str(tmp_path)))
    assert capture.STATUS["storage"]["uncovered"] == [], "reporter off: archive_enabled is False for it"


# ── (3) the transfer form pushes the subtrees the mount form mirrors ─────────────────────────────
def test_archive_transfer_pushes_include_subtrees_after_the_nights_and_never_incoming(tmp_path, monkeypatch):
    cap = tmp_path / "captures"
    for d in ("2026-07-01", "stored", "cpap", "incoming"):
        os.makedirs(str(cap / d))
        with open(str(cap / d / "f"), "w") as fh:
            fh.write("x")
    pushed = []
    async def fake_push(src, target, timeout=1800.0):
        pushed.append(os.path.basename(src))
        return {"ok": True, "verified": True, "detail": "copied and verified byte-for-byte"}
    monkeypatch.setattr(capture.storage_targets, "push_night", fake_push)
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda captures, settle: set())
    _run(capture._archive_transfer(str(cap), _target(), 0.0, {"mode": "after_settle"},
                                   ["stored", "cpap", "incoming", "absent"]))
    assert pushed == ["2026-07-01", "stored", "cpap"], "nights first, then the named subtrees; incoming refused, absent skipped"
    assert os.path.exists(str(cap / "2026-07-01" / ".archived"))
    assert capture.STATUS["archive"]["subtrees"]["stored"]["verified"] is True
    assert not os.path.exists(str(cap / "stored" / ".archived")), "no marker on a growing tree"


def test_archive_transfer_stops_at_the_first_failing_subtree(tmp_path, monkeypatch, caplog):
    cap = tmp_path / "captures"
    for d in ("stored", "cpap"):
        os.makedirs(str(cap / d))
    pushed = []
    async def fake_push(src, target, timeout=1800.0):
        pushed.append(os.path.basename(src))
        return {"ok": False, "verified": False, "detail": "rsync exit 255"}
    monkeypatch.setattr(capture.storage_targets, "push_night", fake_push)
    monkeypatch.setattr(capture.diskguard, "active_nights", lambda captures, settle: set())
    with caplog.at_level("WARNING"):
        _run(capture._archive_transfer(str(cap), _target(), 0.0, {"mode": "after_settle"}, ["stored", "cpap"]))
    assert pushed == ["stored"], "a failing link fails for every tree; stop rather than hammer"
    assert any("subtree stored NOT pushed" in r.getMessage() for r in caplog.records)


def test_archive_poller_hands_the_subtrees_to_the_transfer(tmp_path, monkeypatch):
    got = {}
    async def fake_transfer(captures, target, settle, schedule, subtrees=()):
        got["subtrees"] = list(subtrees)
        capture._STOP.set()
    monkeypatch.setattr(capture, "_archive_transfer", fake_transfer)
    async def no_sleep(_s):
        pass
    monkeypatch.setattr(capture.asyncio, "sleep", no_sleep)
    cfg = {"archive": {"enabled": True, "target": {**RSYNC, "kind": "transfer"}, "include_subtrees": ["stored"]}}
    _run(capture.archive_poller(cfg, str(tmp_path)))
    assert got["subtrees"] == ["stored"]
