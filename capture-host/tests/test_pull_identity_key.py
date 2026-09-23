# tepna-capture — tests/test_pull_identity_key.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The ledger key of a stored-session pull must not change when the ring's identity read (0xE1) times
# out. Until 2026-09-05 `_pull_once` fell back to the AUTH `serial` argument — the 4-byte "0000"
# protocol default that every caller passes — so a transient timeout re-keyed the session as
# `0000/<stamp>`, `oxy_restart.plan` found no COMMITTED row under it, and the same bytes were pulled
# again. Measured on vigil (inventory.jsonl, 23 sessions since 2026-08-25): 2026-08-29 22:20 the
# identity read answered and the pull said "committed and unchanged on disk — skipping"; 22:24 it
# timed out (3 of 75 pulls do) and session 20260829030105 was downloaded a second time, its sidecar's
# `device_serial: 2592302100` overwritten with null. Same again 2026-08-30 21:23.
#
# The fix: the caller's KNOWN identity (`dev["device_id"]`) is the fallback, the address after it,
# and the auth serial never. These tests re-run the incident against the real `_pull_once`.

import asyncio
import json

import oxy_inventory as inv
import oxyii
import pull_session
from test_pull_session import DEV, FakeRing, _install

ADDR = "D1:98:62:7C:92:B3"
TS = "20260829030105"
BLOB = bytes([0x01, 0x03, 0, 0, 0, 0, 0, 0, 0x04, 0x00]) + bytes([96, 50, 0]) * 60 + bytes(48)


class MuteIdentityRing(FakeRing):
    """A ring whose 0xE1 read fails the way vigil's did — the read raises (a TimeoutError on the box),
    every other op answers normally. Raising rather than staying silent keeps the test off the real
    6 s identity bound; the swallow-and-continue branch is the same either way."""

    async def write_gatt_char(self, char, frame, response=None):
        if frame[1] == oxyii.OP_GET_INFO:
            raise TimeoutError()
        await super().write_gatt_char(char, frame, response)


def _run(coro):
    return asyncio.run(coro)


def _pull(tmp_path, ring, **kw):
    return _run(pull_session._pull_once(ADDR, str(tmp_path), "latest", 0, None, "0000", **kw))


def _keys(tmp_path):
    return sorted({r["device_id"] for r in inv.load_rows(str(tmp_path / "inventory.jsonl"))})


def test_an_identity_timeout_does_not_re_pull_a_committed_session(tmp_path, monkeypatch, capsys):
    """The vigil incident, end to end: pull 1 answers 0xE1 and commits under the ring's serial; pull 2
    (identity read fails, caller passes the id it knows) must SKIP — same key, no second download, the
    sidecar untouched."""
    _install(monkeypatch, FakeRing([TS], BLOB))
    got = _pull(tmp_path, None)
    assert len(got) == 1
    meta_path = got[0] + ".meta.json"
    meta_before = open(meta_path).read()
    assert json.loads(meta_before)["device_serial"] == DEV
    rows_before = len(inv.load_rows(str(tmp_path / "inventory.jsonl")))

    _install(monkeypatch, MuteIdentityRing([TS], BLOB))
    got2 = _pull(tmp_path, None, device_id=DEV)
    out = capsys.readouterr().out
    assert "device identity not read" in out, "the identity read must have failed for this to test anything"
    assert f"{TS}: committed and unchanged on disk — skipping download." in out
    assert got2 == [], "nothing written — the session was already held"
    assert len(inv.load_rows(str(tmp_path / "inventory.jsonl"))) == rows_before, "no rows under a second key"
    assert _keys(tmp_path) == [DEV]
    assert open(meta_path).read() == meta_before, "the good sidecar must not be overwritten with a null one"


def test_the_auth_serial_is_never_a_ledger_key(tmp_path, monkeypatch):
    """No caller identity and no identity read: key on the ADDRESS (stable per ring), never on the
    "0000" auth default that every ring shares."""
    _install(monkeypatch, MuteIdentityRing([TS], BLOB))
    got = _pull(tmp_path, None)
    assert len(got) == 1, "the pull itself still lands — the identity read is non-fatal"
    assert _keys(tmp_path) == [ADDR], _keys(tmp_path)
    assert inv.current(inv.load_rows(str(tmp_path / "inventory.jsonl")))[inv.identity(ADDR, TS)]["state"] \
        == inv.COMMITTED


def test_the_ring_s_own_serial_outranks_the_caller_s_id(tmp_path, monkeypatch):
    """When 0xE1 answers, the device's serial is authoritative — the caller's id is a fallback, not an
    override (a mis-configured device_id must not re-key a ring that says who it is)."""
    _install(monkeypatch, FakeRing([TS], BLOB))
    _pull(tmp_path, None, device_id="CONFIGURED-ELSEWHERE")
    assert _keys(tmp_path) == [DEV]


def test_the_daemon_passes_the_ring_s_configured_id_to_the_pull(tmp_path, monkeypatch):
    """`pull_oxyii_session` is the one path every trigger takes (monitor button, doff pull, charger
    poller, autopull) — it must hand `dev["device_id"]` to `pull_session.pull` as `device_id`, and keep
    the auth serial as the protocol default."""
    import capture
    capture._OXYII_PAUSE.clear()
    seen = {}

    async def fake_pull(address, out_dir, **kw):
        seen.update(kw)
        return []
    monkeypatch.setattr(pull_session, "pull", fake_pull)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(capture.asyncio, "sleep", no_sleep)
    capture.STATUS["devices"]["Ring"] = {"connected": False}
    dev = {"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "2592302100", "address": ADDR}
    r = _run(capture.pull_oxyii_session(dev, str(tmp_path)))
    assert r["ok"] is True
    assert seen["device_id"] == "2592302100" and seen["serial"] == "0000", seen
