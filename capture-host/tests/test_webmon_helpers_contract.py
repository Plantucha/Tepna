# tepna-capture — tests/test_webmon_helpers_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The module-level helpers every handler leans on, and the clock endpoints' privilege flag.

`_body` / `_bad_body_response` decide what an unparseable request MEANS, and that question already cost
this codebase a real failure: returning `{}` for a body that did not decode let `POST /api/storage`
answer 200 and persist the deletion of the configured offload target (CAPTURE-HOST-DEEP-AUDIT §D1). The
shape of the refusal is therefore part of the contract, not decoration — the UI branches on `ok`.

`_has_comments` is the guard in front of a documented data-loss path: `yaml.safe_dump` cannot round-trip
comments, so every save silently drops the operator's notes, and this is the only thing that warns them.
It has to ignore the banner the box wrote itself — otherwise it fires on every save, which trains people
to ignore it, which is the same as not having it.

`_clock_sudo` defaults to TRUE. It reaches `clockcfg` on every clock write, and without it the calls run
unprivileged and fail on a real box.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import telemetry  # noqa: E402
import webmon  # noqa: E402
from tests.test_webmon_api import _mk, _serve  # noqa: E402


# ── the refusal an unparseable body earns ───────────────────────────────────────────────────────────
def test_the_bad_body_refusal_says_what_was_wrong_and_is_not_ok(tmp_path):
    """`ok: False` — the UI branches on it, so a `True` here reports a rejected request as applied."""
    app, cfg, *_ = _mk(tmp_path)
    cfg["archive"] = {"enabled": True, "target": {"kind": "mount", "protocol": "local",
                                                  "mountpoint": str(tmp_path)}}

    async def go(c):
        r = await c.post("/api/storage", data=b"{not json",
                         headers={"Content-Type": "application/json"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400
    assert body == {"ok": False, "error": "request body must be a JSON object"}


@pytest.mark.parametrize("raw", [b"null", b"[]", b'"x"', b"3"])
def test_valid_json_that_is_not_an_object_is_also_refused(tmp_path, raw):
    """§D3. `_body` guarded only a DECODE error, so these reached handlers as non-dicts and 500'd on
    `.get` — a malformed request reported as a server fault."""
    app, cfg, *_ = _mk(tmp_path)
    cfg["archive"] = {"enabled": True, "target": {"kind": "mount", "protocol": "local",
                                                  "mountpoint": str(tmp_path)}}

    async def go(c):
        r = await c.post("/api/storage", data=raw, headers={"Content-Type": "application/json"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 400 and body["ok"] is False


# ── the comment-loss guard ──────────────────────────────────────────────────────────────────────────
def test_an_operator_comment_is_detected(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text("# the H10 needs acc at 50 or the night is 400 MB\nroot: /srv/tepna\n",
                 encoding="utf-8")
    assert webmon._has_comments(str(p)) is True


def test_a_comment_after_the_first_line_is_still_detected(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text("root: /srv/tepna\ndevices: []\n# keep the Verity on hci1\n", encoding="utf-8")
    assert webmon._has_comments(str(p)) is True


def test_the_boxs_own_banner_is_not_mistaken_for_an_operator_comment(tmp_path):
    """The banner is written by every save. Counting it would make the warning fire on every save
    forever, which is the same as not warning at all."""
    p = tmp_path / "config.yaml"
    p.write_text(webmon._CFG_BANNER + "root: /srv/tepna\n", encoding="utf-8")
    assert webmon._has_comments(str(p)) is False


def test_a_file_with_no_comments_is_clean(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text("root: /srv/tepna\ndevices: []\n", encoding="utf-8")
    assert webmon._has_comments(str(p)) is False


def test_a_missing_file_is_not_a_comment_loss_risk(tmp_path):
    """A first save has nothing to destroy. Failing open here would warn on every fresh box."""
    assert webmon._has_comments(str(tmp_path / "never-written.yaml")) is False


def test_a_non_utf8_config_does_not_take_the_save_down_with_it(tmp_path):
    """The guard is ADVISORY, and `_save` runs it inside its own try/except — so a decode error here is
    swallowed into `return False` and surfaces as "config write failed (disk?)", a wrong reason for a
    disk that is fine. An accented device name typed in a Latin-1 editor is enough to produce it, and
    it makes the whole settings UI unusable until somebody finds the byte."""
    p = tmp_path / "config.yaml"
    p.write_bytes(b"# caf\xe9 notes\nroot: /srv\n")
    assert webmon._has_comments(str(p)) is False, "a decode error must not escape the comment check"

    # …and the save it only advises on must still go through.
    app, _cfg, _st, cfg_path, _bus = _mk(tmp_path)
    assert cfg_path == str(p)

    async def go(c):
        r = await c.post("/api/settings", json={"settings": {"watchdog.interval_sec": 90}})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True, body


def test_the_warning_names_the_file_and_latches(tmp_path, caplog):
    """Latched so it says its piece once per process rather than on every save."""
    import logging
    webmon._comment_loss_warned = False
    try:
        with caplog.at_level(logging.WARNING):
            webmon._warn_comment_loss("/srv/tepna/config.yaml")
        assert webmon._comment_loss_warned is True
        assert "/srv/tepna/config.yaml" in caplog.text
        assert "DROP" in caplog.text and "config.example.yaml" in caplog.text
    finally:
        webmon._comment_loss_warned = False


# ── the clock endpoints' privilege flag ─────────────────────────────────────────────────────────────
def _clock_app(tmp_path, clock=None, seen=None, on_tz_change=None):
    cfg = {"root": str(tmp_path), "devices": []}
    if clock is not None:
        cfg["clock"] = clock

    async def sync_now(sudo=False):
        seen.append(("sync", sudo))
        return {"ok": True}

    async def set_ntp(servers, poll_max_sec, sudo=False):
        seen.append(("ntp", servers, poll_max_sec, sudo))
        return {"ok": True}

    async def set_tz(tz, sudo=False):
        seen.append(("tz", tz, sudo))
        return {"ok": True, "timezone": tz}
    webmon.clockcfg.sync_now = sync_now
    webmon.clockcfg.set_ntp = set_ntp
    webmon.clockcfg.set_tz = set_tz
    return webmon.make_app(telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"),
                           "AA:AA", {"devices": {}}, None, on_tz_change=on_tz_change)


@pytest.fixture(autouse=True)
def _restore_clockcfg():
    saved = (webmon.clockcfg.sync_now, webmon.clockcfg.set_ntp, webmon.clockcfg.set_tz)
    yield
    webmon.clockcfg.sync_now, webmon.clockcfg.set_ntp, webmon.clockcfg.set_tz = saved


def test_clock_writes_are_privileged_unless_config_says_otherwise(tmp_path):
    """Default TRUE: on a real box these shell out to timedatectl/chronyc, which need root. Defaulting
    it off makes every clock write fail on the one deployment that matters."""
    seen = []
    app = _clock_app(tmp_path, clock=None, seen=seen)

    async def go(c):
        await c.post("/api/clock/sync")
        await c.post("/api/clock", json={"servers": "a.ntp, b.ntp"})
        await c.post("/api/clock/tz", json={"timezone": "Europe/Prague"})
    _serve(app, go)
    assert [c[-1] for c in seen] == [True, True, True], seen


def test_the_configured_sudo_flag_is_honoured(tmp_path):
    seen = []
    app = _clock_app(tmp_path, clock={"sudo": False}, seen=seen)

    async def go(c):
        await c.post("/api/clock/sync")
    _serve(app, go)
    assert seen == [("sync", False)]


def test_ntp_servers_accept_a_comma_or_space_separated_string(tmp_path):
    """The settings box is free text. Handing chronyc the raw string would configure one absurd server
    name instead of two real ones."""
    seen = []
    app = _clock_app(tmp_path, clock={"sudo": False}, seen=seen)

    async def go(c):
        await c.post("/api/clock", json={"servers": "a.ntp, b.ntp c.ntp"})
    _serve(app, go)
    assert seen[0][1] == ["a.ntp", "b.ntp", "c.ntp"]
    assert seen[0][2] == 2048, "the default poll ceiling"


def test_a_deliberate_timezone_change_re_anchors_the_capture_clock(tmp_path):
    """§A1. `_now()` reads a zone move as a DST relabelling — the offset delta equals the apparent drift
    by construction — and keeps counting in the OLD offset. Only this handler knows the change was
    intended, so without the hook the box answers ok, reports the new zone, and stamps every subsequent
    file an hour off."""
    seen, anchored = [], []
    app = _clock_app(tmp_path, clock={"sudo": False}, seen=seen, on_tz_change=anchored.append)

    async def go(c):
        return await (await c.post("/api/clock/tz", json={"timezone": "Europe/Prague"})).json()
    body = _serve(app, go)
    assert body["ok"] is True
    assert len(anchored) == 1 and "Europe/Prague" in anchored[0]


def test_a_failed_timezone_change_does_not_re_anchor(tmp_path):
    """Re-anchoring on a change that did not happen would introduce the very offset error it prevents."""
    anchored = []

    async def set_tz(tz, sudo=False):
        return {"ok": False, "error": "no such zone"}
    app = _clock_app(tmp_path, clock={"sudo": False}, seen=[], on_tz_change=anchored.append)
    webmon.clockcfg.set_tz = set_tz

    async def go(c):
        return await (await c.post("/api/clock/tz", json={"timezone": "Mars/Olympus"})).json()
    body = _serve(app, go)
    assert body["ok"] is False and anchored == []


def test_a_broken_re_anchor_hook_does_not_fail_the_timezone_change(tmp_path):
    """Never fail the tz change over its own bookkeeping — the zone was already set by then."""
    def boom(_msg):
        raise RuntimeError("re-anchor exploded")
    app = _clock_app(tmp_path, clock={"sudo": False}, seen=[], on_tz_change=boom)

    async def go(c):
        r = await c.post("/api/clock/tz", json={"timezone": "Europe/Prague"})
        return r.status, await r.json()
    status, body = _serve(app, go)
    assert status == 200 and body["ok"] is True
