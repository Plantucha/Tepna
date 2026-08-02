# tepna-capture — tests/test_webmon_remember_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/remember` — re-remembering a known sensor must not undo its tuning.

The tests next door prove the identity gate (an unidentified device is refused and nothing is written)
and the allowlist (extra keys cannot be smuggled into config.yaml). What they do not check is the MERGE,
and the merge is the part with a history.

Two real failures live here, both recorded in the handler's own comments and neither of them gated:

* **Last-write-wins erased tuned keys.** Re-remembering an already-known sensor used to drop the stored
  entry and rebuild it from the 8-key allowlist, so one pass through the pairing screen erased `rates:`
  from the H10 (acc 50) and the Verity (acc 52, mag 20) — the decision that cut 71 % of the box's bytes.
  A re-remember is how the UI handles an ordinary re-scan, so it has to be idempotent on everything the
  caller did not send.
* **A guessed `device_id` overwrote a real one.** The browser derives an id from the MAC when it cannot
  read the serial; on this box that turned the Verity's `0C301E3F` into `AC0C301E` and split one night
  across two identities. The id is interpolated into every capture filename, so an established one wins.

Neither failure raises, and both look like success in the UI.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import webmon  # noqa: E402
from tests.test_webmon_api import H10, _mk, _serve  # noqa: E402


def _remember(tmp_path, payload, devices=None, spawned=None):
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path, devices=devices,
                                        spawn_device=spawned.append if spawned is not None else None)

    async def go(c):
        r = await c.post("/api/remember", json=payload)
        return r.status, await r.json()
    return (*_serve(app, go), cfg, cfg_path)


# ── the merge ───────────────────────────────────────────────────────────────────────────────────────
def test_re_remembering_preserves_keys_the_caller_did_not_send(tmp_path):
    """`rates` is not in the allowlist the pairing screen sends, so a rebuild drops it — and the daemon
    then negotiates defaults while nightqc grades coverage against a nominal nobody chose."""
    tuned = {**H10, "rates": {"acc": 50}, "optional": True, "pmd_supported_seen": ["ecg", "acc"]}
    _s, body, cfg, _ = _remember(tmp_path, {**H10, "streams": ["ecg", "acc"]}, devices=[tuned])
    stored = cfg["devices"][0]
    assert body["ok"] is True
    assert stored["rates"] == {"acc": 50}, "tuned rates must survive an ordinary re-scan"
    assert stored["optional"] is True
    assert stored["pmd_supported_seen"] == ["ecg", "acc"]
    assert stored["streams"] == ["ecg", "acc"], "…while what the caller DID send is applied"


def test_re_remembering_does_not_add_a_second_entry(tmp_path):
    _s, body, cfg, _ = _remember(tmp_path, dict(H10), devices=[dict(H10)])
    assert len(cfg["devices"]) == 1 and body["remembered"] == 1


def test_an_established_device_id_wins_over_an_incoming_guess(tmp_path):
    """The id is interpolated into every capture filename, so changing it renames the sensor's whole
    future output and orphans it from its own history. Correcting it is a deliberate config edit."""
    _s, _b, cfg, _ = _remember(tmp_path, {**H10, "device_id": "AC0C301E"},
                               devices=[{**H10, "device_id": "0C301E3F"}])
    assert cfg["devices"][0]["device_id"] == "0C301E3F"


def test_a_device_with_no_established_id_accepts_the_incoming_one(tmp_path):
    """The rule is "an established id wins", not "the incoming id is always ignored" — a device stored
    before the id existed must still be able to acquire one."""
    prior = {k: v for k, v in H10.items() if k != "device_id"}
    _s, _b, cfg, _ = _remember(tmp_path, {**H10, "device_id": "NEW12345"}, devices=[prior])
    assert cfg["devices"][0]["device_id"] == "NEW12345"


def test_a_new_device_is_appended_with_only_the_allowlisted_keys(tmp_path):
    _s, body, cfg, _ = _remember(tmp_path, {**H10, "address": "11:22:33:44:55:66",
                                            "root": "/etc", "rates": {"acc": 999}})
    assert body["remembered"] == 2
    added = cfg["devices"][-1]
    assert added["address"] == "11:22:33:44:55:66"
    assert "root" not in added
    assert "rates" not in added, "a NEW device carries only what the allowlist admits"


# ── the hot start ───────────────────────────────────────────────────────────────────────────────────
def test_the_merged_device_is_what_gets_hot_started(tmp_path):
    """`saved`, not `cfg['devices'][-1]`: a merged device keeps its ORIGINAL position, so an index-based
    lookup hot-starts whichever sensor happens to be last — a different device entirely."""
    other = {"name": "Ring", "vendor": "Wellue", "model": "O2Ring-S", "device_id": "S8AW",
             "address": "D1:98:62:7C:92:B3", "streams": ["spo2"], "rates": {}}
    spawned = []
    _remember(tmp_path, {**H10, "streams": ["ecg", "acc"]},
              devices=[dict(H10), other], spawned=spawned)
    assert len(spawned) == 1
    assert spawned[0]["address"] == H10["address"], f"hot-started the wrong device: {spawned[0]}"
    assert spawned[0]["streams"] == ["ecg", "acc"], "and it must carry the merged values"


def test_a_new_device_is_hot_started_too(tmp_path):
    spawned = []
    _remember(tmp_path, {**H10, "address": "11:22:33:44:55:66"}, spawned=spawned)
    assert len(spawned) == 1 and spawned[0]["address"] == "11:22:33:44:55:66"


# ── a failed write is not a success ─────────────────────────────────────────────────────────────────
def test_a_failed_config_write_is_a_500_and_starts_nothing(tmp_path, monkeypatch):
    """Hot-starting a device whose config never reached disk gives a sensor that records tonight and
    vanishes at the next restart — the confusing half-state this ordering avoids."""
    spawned = []
    monkeypatch.setattr(webmon.os, "replace",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("ENOSPC")))
    status, body, _cfg, _ = _remember(tmp_path, {**H10, "address": "11:22:33:44:55:66"},
                                      spawned=spawned)
    assert status == 500 and body["ok"] is False and "config write failed" in body["error"]
    assert spawned == [], "nothing may be hot-started when the config did not persist"


def test_an_invalid_mac_is_refused_before_anything_is_written(tmp_path):
    status, body, cfg, cfg_path = _remember(tmp_path, {**H10, "address": "not-a-mac"})
    assert status == 400 and "invalid device address" in body["error"]
    assert len(cfg["devices"]) == 1 and not os.path.exists(cfg_path)
