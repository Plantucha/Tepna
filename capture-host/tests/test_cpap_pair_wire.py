# tepna-capture — tests/test_cpap_pair_wire.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The daemon wiring for AS11 pairing: capture._build_cpap_pairer, the one-link guard `_either_busy`,
and the hot-adoption registry `_as11_adopt_creds` that decides whether a fresh pairing is `live` or
`restart_required`. The pairing protocol itself is tests/test_as11_pair.py; the endpoint is
tests/test_webmon_cpap_pair_contract.py. What must hold HERE: the factory resolves the creds path, radio
and timeouts from config exactly as _build_cpap_controller does; the session refuses while the live
stream is busy; a re-pair defaults to the stored address (then the configured one, then nothing); a
verified pairing re-keys every registered consumer IN PLACE — the dict object the shadow/spool loops hold,
not a copy — and reports live only when no consumer was skipped at boot for want of creds."""
import json
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import as11_pair  # noqa: E402
import capture  # noqa: E402


def _isolate_registry(monkeypatch, live=(), skipped=()):
    monkeypatch.setattr(capture, "_AS11_CREDS_LIVE", list(live))
    monkeypatch.setattr(capture, "_AS11_CREDS_SKIPPED", list(skipped))


# ── _either_busy — the AS11 has ONE BLE slot ─────────────────────────────────────────────────────────
def test_either_busy_without_a_second_source_is_the_primary_itself():
    def primary():
        return True
    assert capture._either_busy(primary) is primary
    assert capture._either_busy(primary, None) is primary


def test_either_busy_is_true_when_either_holds_the_link():
    flags = {"a": False, "b": False}
    f = capture._either_busy(lambda: flags["a"], lambda: flags["b"])
    assert f() is False
    flags["b"] = True
    assert f() is True                       # pairing holds the link, stream idle
    flags["a"], flags["b"] = True, False
    assert f() is True                       # stream holds it, no pairing
    flags["b"] = True
    assert f() is True


# ── _as11_adopt_creds — re-key in place, report live honestly ────────────────────────────────────────
def test_adopt_rekeys_every_registered_dict_in_place_and_is_live_when_nothing_was_skipped(monkeypatch):
    shadow = {"masterPairKey": "old", "clientId": "c0", "ble_addr": "AA"}
    spool = {"masterPairKey": "old", "clientId": "c0", "ble_addr": "AA", "stale_extra": 1}
    _isolate_registry(monkeypatch, live=[shadow, spool])
    new = {"masterPairKey": "ff00", "clientId": "c9", "ble_addr": "BB", "paired_at": "2026-09-05T00:00:00Z"}
    assert capture._as11_adopt_creds(new) is True
    assert shadow == new and spool == new    # same objects, new contents — the loops read them per cycle
    assert "stale_extra" not in spool        # a stale member does not survive the re-key
    new["masterPairKey"] = "mutated-later"
    assert shadow["masterPairKey"] == "ff00"  # a copy, not an alias of the caller's dict


def test_adopt_reports_not_live_when_a_consumer_was_skipped_at_boot(monkeypatch, caplog):
    held = {"masterPairKey": "old"}
    _isolate_registry(monkeypatch, live=[held], skipped=["CPAP stored-spool pull"])
    with caplog.at_level("INFO"):
        assert capture._as11_adopt_creds({"masterPairKey": "n", "clientId": "c", "ble_addr": "A"}) is False
    assert held["masterPairKey"] == "n"      # the live consumer is still re-keyed
    assert "restart needed for CPAP stored-spool pull" in caplog.text


def test_adopt_with_no_consumers_at_all_is_live(monkeypatch):
    """A daemon with neither shadow nor spool enabled: the live-stream controller re-reads the file per
    start, so nothing needs a restart."""
    _isolate_registry(monkeypatch)
    assert capture._as11_adopt_creds({"masterPairKey": "n", "clientId": "c", "ble_addr": "A"}) is True


# ── the starters register what they hold, or that they were skipped ─────────────────────────────────
def _shadow_cfg():
    return {"as11_detector": {"enabled": True}, "cpap": {"ble_stream": {"creds_path": "as11_creds.json"}}}


def _fake_create_task(coro):
    coro.close()
    return SimpleNamespace(cancelled=False)


def test_shadow_starter_registers_its_creds_dict_for_hot_adoption(tmp_path, monkeypatch):
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_running=lambda: False, _busy=lambda: False)
    creds = {"masterPairKey": "aa", "clientId": "c", "ble_addr": "AA"}
    tasks = []
    task = capture._maybe_start_as11_shadow(_shadow_cfg(), str(tmp_path / "config.yaml"), str(tmp_path), ctl,
                                            tasks, load_creds=lambda p: creds, connect_factory=lambda c: None,
                                            create_task=_fake_create_task, also_busy=lambda: False)
    assert task is not None
    assert capture._AS11_CREDS_LIVE and capture._AS11_CREDS_LIVE[0] is creds   # the very dict, not a copy
    assert capture._AS11_CREDS_SKIPPED == []


def test_shadow_starter_records_the_skip_when_there_are_no_creds(tmp_path, monkeypatch):
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_running=lambda: False, _busy=lambda: False)
    assert capture._maybe_start_as11_shadow(_shadow_cfg(), str(tmp_path / "config.yaml"), str(tmp_path), ctl,
                                            [], load_creds=lambda p: None) is None
    assert capture._AS11_CREDS_SKIPPED == ["AS11 shadow detector"] and capture._AS11_CREDS_LIVE == []


def _spool_cfg():
    return {"cpap": {"spool_pull": {"enabled": True}, "ble_stream": {"creds_path": "as11_creds.json"}}}


def test_spool_starter_registers_its_creds_dict_for_hot_adoption(tmp_path, monkeypatch):
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_running=lambda: False, _busy=lambda: False)
    creds = {"masterPairKey": "aa", "clientId": "c", "ble_addr": "AA"}
    task = capture._maybe_start_cpap_spool_pull(_spool_cfg(), str(tmp_path / "config.yaml"), str(tmp_path), ctl,
                                                [], load_creds=lambda p: creds, connect_factory=lambda c: None,
                                                create_task=_fake_create_task, also_busy=lambda: False)
    assert task is not None
    assert capture._AS11_CREDS_LIVE == [creds] and capture._AS11_CREDS_LIVE[0] is creds
    assert capture._AS11_CREDS_SKIPPED == []


def test_spool_starter_records_the_skip_when_there_are_no_creds(tmp_path, monkeypatch):
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_running=lambda: False, _busy=lambda: False)
    assert capture._maybe_start_cpap_spool_pull(_spool_cfg(), str(tmp_path / "config.yaml"), str(tmp_path), ctl,
                                                [], load_creds=lambda p: None) is None
    assert capture._AS11_CREDS_SKIPPED == ["CPAP stored-spool pull"] and capture._AS11_CREDS_LIVE == []


# ── _build_cpap_pairer — pure wiring from config ─────────────────────────────────────────────────────
def _cfg(**ble_stream):
    return {"cpap": {"ble_stream": {"creds_path": "as11_creds.json", **ble_stream}}}


async def _noop_connect(addr):
    raise AssertionError("connect must not run at build time")


def test_build_pairer_resolves_the_creds_path_beside_the_config_and_the_timeouts(tmp_path, monkeypatch):
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_busy=lambda: True, _running=lambda: False)
    cfgp = str(tmp_path / "config.yaml")
    s = capture._build_cpap_pairer(_cfg(pair_timeout_sec=45), cfgp, ctl, connect=_noop_connect, on_paired=None)
    assert isinstance(s, as11_pair.PairingSession)
    assert s._creds_path == str(tmp_path / "as11_creds.json")
    assert s._connect is _noop_connect
    assert s._timeout == 45.0
    assert s._other_busy is ctl._busy            # the live stream's BUSY, at start-INTENT
    assert s._on_paired is capture._as11_adopt_creds   # default: hot adoption


def test_build_pairer_defaults_the_passkey_timeout_and_honours_an_injected_on_paired(tmp_path, monkeypatch):
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_busy=lambda: False)
    def on_paired(c):
        return True
    s = capture._build_cpap_pairer(_cfg(), str(tmp_path / "config.yaml"), ctl, connect=_noop_connect,
                                   on_paired=on_paired)
    assert s._timeout == as11_pair.DEFAULT_PASSKEY_TIMEOUT_S and s._on_paired is on_paired


def test_build_pairer_default_addr_prefers_the_stored_creds_then_config_then_nothing(tmp_path, monkeypatch):
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_busy=lambda: False)
    cfgp = str(tmp_path / "config.yaml")
    # nothing stored, nothing configured
    s = capture._build_cpap_pairer(_cfg(), cfgp, ctl, connect=_noop_connect)
    assert s._default_addr() is None
    # configured only
    s = capture._build_cpap_pairer(_cfg(ble_addr="CC:CC:CC:CC:CC:CC"), cfgp, ctl, connect=_noop_connect)
    assert s._default_addr() == "CC:CC:CC:CC:CC:CC"
    # stored creds win — a re-pair goes back to the machine that was paired
    (tmp_path / "as11_creds.json").write_text(json.dumps(
        {"masterPairKey": "aa", "clientId": "c", "ble_addr": "DD:DD:DD:DD:DD:DD"}))
    assert s._default_addr() == "DD:DD:DD:DD:DD:DD"


def test_build_pairer_refuses_to_start_while_the_live_stream_is_busy(tmp_path, monkeypatch):
    """End to end through the real session: the guard the factory wires is the one the endpoint hits."""
    import asyncio
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_busy=lambda: True)
    s = capture._build_cpap_pairer(_cfg(ble_addr="AA"), str(tmp_path / "config.yaml"), ctl, connect=_noop_connect)
    res = asyncio.run(s.op("start"))
    assert res["ok"] is False and "live CPAP stream holds the link" in res["error"]


def test_build_pairer_hands_the_session_the_RADIO_it_pairs_on(tmp_path, monkeypatch):
    """The box has three radios and only one is pinned for the CPAP. `status()` reports it so the
    pairing panel can name it — "which adapter am I pairing to?" had no answer in the UI before
    2026-09-06, and the answer matters because a key stored against the wrong radio never reconnects."""
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_busy=lambda: False, _running=lambda: False)
    s = capture._build_cpap_pairer(_cfg(adapter="28:0C:50:0C:18:FD"), str(tmp_path / "config.yaml"),
                                   ctl, connect=_noop_connect, on_paired=None)
    assert s._adapter == "28:0C:50:0C:18:FD"
    st = s.status()
    assert st["adapter"] == "28:0C:50:0C:18:FD" and st["adapter_usable"] is True


def test_build_pairer_reports_the_DEFAULT_radio_when_config_pins_none(tmp_path, monkeypatch):
    """`hci1` is the documented default and the session must say so rather than reporting nothing —
    'not pinned' and 'pinned to the default' are different facts to an operator deciding whether the
    pairing landed where they meant."""
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_busy=lambda: False, _running=lambda: False)
    s = capture._build_cpap_pairer(_cfg(), str(tmp_path / "config.yaml"),
                                   ctl, connect=_noop_connect, on_paired=None)
    assert s.status()["adapter"] == "hci1"


def test_a_pinned_radio_with_no_public_address_is_reported_UNUSABLE_through_the_wiring(tmp_path, monkeypatch):
    """End to end from config: a Zephyr/nRF52840 dongle reports an all-zero BD address and refuses a
    host-side public pin (0x0c Not Supported). `capture._addressable` already keeps the failover ladder
    off such an adapter; this puts the same fact where the person pressing 'Start pairing' can see it."""
    _isolate_registry(monkeypatch)
    ctl = SimpleNamespace(_busy=lambda: False, _running=lambda: False)
    s = capture._build_cpap_pairer(_cfg(adapter="00:00:00:00:00:00"), str(tmp_path / "config.yaml"),
                                   ctl, connect=_noop_connect, on_paired=None)
    assert s.status()["adapter_usable"] is False
