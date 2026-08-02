# tepna-capture — tests/test_webmon_storage_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`GET /api/storage` — the offload panel's whole body, and the defaults it fills in.

The tests next door prove the interesting behaviours: the protocol catalogue is listed, an unreachable
target is reported rather than raised, a bad target is refused. What they leave free is the projection
itself — 57 surviving mutants in `_storage_cfg`, every one of them a key that could be renamed or a
default that could move, with the suite green.

Two of those defaults decide when a night leaves the box. `poll_sec` is how often the offloader looks;
`schedule` defaults to `after_settle`, which is the mode that offloads as soon as a night stops growing.
Losing either does not error — it changes when, or whether, data is mirrored, and the panel goes on
looking correct.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import storage_targets  # noqa: E402
import telemetry  # noqa: E402
import webmon  # noqa: E402
from tests.test_webmon_api import _serve  # noqa: E402

MOUNT = {"protocol": "nfs", "host": "192.168.0.142", "share": "/mnt/tank/tepna",
         "mountpoint": "/srv/tepna/archive"}


def _storage(tmp_path, archive=None, status=None):
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}, "devices": []}
    if archive is not None:
        cfg["archive"] = archive
    st = {"devices": {}}
    if status is not None:
        st.update(status)
    app = webmon.make_app(telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                          "AA:AA:AA:AA:AA:AA", st, None)

    async def go(c):
        return await (await c.get("/api/storage")).json()
    return _serve(app, go)


def test_an_unconfigured_box_reports_the_documented_defaults(tmp_path):
    """No `archive:` block at all — the state every box ships in. Each default here is a decision, not a
    placeholder: offload OFF, no target, and `after_settle` as the mode it would use once enabled."""
    body = _storage(tmp_path)
    assert body["enabled"] is False, "offload must be opt-in"
    assert body["target"] is None
    assert body["schedule"] == {"mode": "after_settle"}
    assert body["poll_sec"] == 3600
    assert body["last"] is None
    assert body["status"] == {}
    assert body["protocols"] == storage_targets.describe()
    assert "ready" not in body and "mount_unit" not in body, \
        "with no target there is nothing to report readiness for"


def test_the_configured_values_win_over_every_default(tmp_path):
    """Distinct from the defaults on purpose — a projection that ignores config and a projection that
    has none are indistinguishable when the fixture uses the default values."""
    body = _storage(tmp_path, archive={
        "enabled": True, "target": MOUNT, "poll_sec": 900,
        "schedule": {"mode": "daily", "at": "03:30", "window_min": 120}})
    assert body["enabled"] is True
    assert body["target"] == MOUNT
    assert body["poll_sec"] == 900
    assert body["schedule"] == {"mode": "daily", "at": "03:30", "window_min": 120}


def test_the_last_result_prefers_the_config_record_over_the_live_status(tmp_path):
    """`archive._last_result` is what survived a restart; `status.archive.last` is this process's own.
    The persisted one wins, so the panel does not go blank every time the daemon restarts."""
    body = _storage(tmp_path,
                    archive={"enabled": True, "_last_result": {"src": "persisted"}},
                    status={"archive": {"last": {"src": "live"}}})
    assert body["last"] == {"src": "persisted"}


def test_the_live_status_is_used_when_nothing_was_persisted(tmp_path):
    body = _storage(tmp_path, archive={"enabled": True},
                    status={"archive": {"last": {"src": "live"}, "running": True}})
    assert body["last"] == {"src": "live"}
    assert body["status"] == {"last": {"src": "live"}, "running": True}, \
        "the whole archive status block is passed through, not just `last`"


def test_the_body_carries_exactly_the_keys_the_panel_reads(tmp_path):
    assert set(_storage(tmp_path)) == {"enabled", "target", "schedule", "poll_sec", "protocols",
                                       "last", "status"}


# ── readiness, and the unit the operator has to install ─────────────────────────────────────────────
def test_a_configured_target_is_reported_ready_or_not(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_targets, "dest_status",
                        lambda t: {"ready": True, "path": t["mountpoint"], "reason": None})
    body = _storage(tmp_path, archive={"enabled": True, "target": {**MOUNT, "kind": "mount"}})
    assert body["ready"] == {"ready": True, "path": "/srv/tepna/archive", "reason": None}


def test_a_mount_target_carries_the_unit_the_operator_must_install(tmp_path):
    """The panel shows this text for copy-paste; without it a mount target can be configured and then
    never actually mounted, which reads as "configured" and offloads nothing."""
    body = _storage(tmp_path, archive={"enabled": True, "target": {**MOUNT, "kind": "mount"}})
    assert body["mount_unit"]["unit_name"] == "srv-tepna-archive.mount"
    assert "Type=nfs4" in body["mount_unit"]["unit"]


def test_a_local_path_needs_no_mount_unit(tmp_path):
    """`local` is a plain directory — there is no unit to install, and emitting one would be advice to
    run `systemctl` against something that is already mounted."""
    body = _storage(tmp_path, archive={"enabled": True, "target": {
        "protocol": "local", "kind": "mount", "mountpoint": "/srv/tepna/archive"}})
    assert "mount_unit" not in body
    assert "ready" in body, "a local path still reports readiness"


def test_a_transfer_target_needs_no_mount_unit(tmp_path):
    body = _storage(tmp_path, archive={"enabled": True, "target": {
        "protocol": "rsync", "kind": "transfer", "host": "nas", "share": "/vol", "user": "tepna"}})
    assert "mount_unit" not in body


def test_a_refused_target_reports_the_reason_instead_of_raising(tmp_path):
    """`_storage_cfg` runs on every panel poll and takes whatever is in config.yaml — including a target
    persisted before the validator grew its current checks. It must degrade to a reason, not a 500."""
    body = _storage(tmp_path, archive={"enabled": True, "target": {
        "protocol": "nfs", "kind": "mount", "host": "nas", "share": "/vol",
        "mountpoint": "/etc/systemd/system"}})
    assert body["ready"]["ready"] is False
    assert body["ready"]["path"] is None
    assert "allowed" in body["ready"]["reason"] or "root" in body["ready"]["reason"]
