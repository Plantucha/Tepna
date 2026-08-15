# tepna-capture — tests/test_webmon_settings_post_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`POST /api/settings` — what it reports back, what it remembers, and when it declines to write.

The tests next door cover the REFUSALS thoroughly: a non-allowlisted key, an out-of-range value, an
unknown device, a stream the firmware never advertised, a rate it never offered. What they leave
unobserved is everything on the accepting side, and the mutation audit counted 69 survivors here.

Three of those matter beyond tidiness:

* **`changed` and `restart_needed` are the UI's only feedback.** A stream change takes effect at PMD
  START, i.e. at the next connect — so a response that omits `restart_needed` leaves the operator
  believing a change is live when it is queued.
* **The remembered capability lists** (`pmd_supported_seen`, `pmd_options_seen`) exist so a reboot does
  not disarm the firmware check until the sensor next connects. Nothing asserted that they were ever
  written, or ever read.
* **A no-op must not write config.yaml.** Writing it destroys the operator's comments by construction
  (`yaml.safe_dump` has no comment round-trip), so a POST that changes nothing must touch nothing.
"""
import os
import sys

import pytest
import yaml

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import webmon  # noqa: E402
from tests.test_webmon_api import H10, _mk, _post_settings, _serve  # noqa: E402

ADDR = H10["address"]


def _app(tmp_path, **kw):
    return _mk(tmp_path, **kw)


def _post(app, payload):
    async def go(c):
        r = await c.post("/api/settings", json=payload)
        return r.status, await r.json()
    return _serve(app, go)


# ── what the response says happened ─────────────────────────────────────────────────────────────────
def test_a_stream_change_is_named_and_flagged_as_needing_a_restart(tmp_path):
    """PMD START is negotiated at connect, so a stream change is queued, not live. The entry is
    `<device>.streams` — the UI shows it verbatim."""
    status, body, cfg, _ = _post_settings(tmp_path, {"streams": {ADDR: ["ecg", "acc"]}},
                                          status={"H10": {"pmd_supported": ["ecg", "acc"]}})
    assert status == 200 and body["ok"] is True
    assert body["changed"] == ["H10.streams"]
    assert body["restart_needed"] is True
    assert cfg["devices"][0]["streams"] == ["ecg", "acc"]


def test_a_rate_change_is_named_and_flagged_as_needing_a_restart(tmp_path):
    """Rate is fixed at PMD START too — same reasoning, separate code path."""
    status, body, cfg, _ = _post_settings(tmp_path, {"rates": {ADDR: {"acc": 200}}},
                                          status={"H10": {"pmd_options": {"acc": [25, 50, 200]}}})
    assert status == 200
    assert body["changed"] == ["H10.rates"]
    assert body["restart_needed"] is True
    assert cfg["devices"][0]["rates"] == {"acc": 200}


def test_the_rate_is_stored_as_an_integer(tmp_path):
    """`int(val)` — a string "200" from a form post must land as 200, not "200": capture.py hands this
    straight to the PMD START frame."""
    _s, _b, cfg, _ = _post_settings(tmp_path, {"rates": {ADDR: {"acc": "200"}}},
                                    status={"H10": {"pmd_options": {"acc": [200]}}})
    assert cfg["devices"][0]["rates"] == {"acc": 200}
    assert isinstance(cfg["devices"][0]["rates"]["acc"], int)


# ── a no-op is not a change ─────────────────────────────────────────────────────────────────────────
def test_posting_the_streams_a_device_already_has_changes_nothing(tmp_path):
    """Order-insensitive: the comparison is on sorted lists, so re-sending the same set in a different
    order is still a no-op. Writing config.yaml here would destroy the operator's comments for nothing."""
    status, body, _cfg, cfg_path = _post_settings(
        tmp_path, {"streams": {ADDR: ["ecg"]}}, status={"H10": {"pmd_supported": ["ecg"]}})
    assert status == 200 and body["changed"] == [] and body["restart_needed"] is False
    assert not os.path.exists(cfg_path), "an unchanged POST must not rewrite config.yaml"


def test_posting_a_setting_at_its_current_value_changes_nothing(tmp_path):
    app, cfg, _st, cfg_path, _bus = _mk(tmp_path)
    cfg.setdefault("watchdog", {})["interval_sec"] = 90
    status, body = _post(app, {"settings": {"watchdog.interval_sec": 90}})
    assert status == 200 and body["changed"] == []
    assert not os.path.exists(cfg_path)


# ── the rate floor, independent of any device menu ──────────────────────────────────────────────────
@pytest.mark.parametrize("hz", [1, 10_000])
def test_the_plausible_rate_range_includes_both_of_its_ends(tmp_path, hz):
    """A never-connected device offered no menu, so this floor is all there is (§D4). Both ends are
    accepted; the device's own list, when present, narrows it further."""
    status, body, *_ = _post_settings(tmp_path, {"rates": {ADDR: {"acc": hz}}})
    assert status == 200, body


@pytest.mark.parametrize("hz", [0, -1, 10_001])
def test_an_implausible_rate_is_refused_whatever_the_device_says(tmp_path, hz):
    status, body, _cfg, cfg_path = _post_settings(tmp_path, {"rates": {ADDR: {"acc": hz}}})
    assert status == 400 and "not a plausible sample rate" in body["error"]
    assert not os.path.exists(cfg_path)


def test_a_non_numeric_rate_is_refused_by_name(tmp_path):
    status, body, *_ = _post_settings(tmp_path, {"rates": {ADDR: {"acc": "fast"}}})
    assert status == 400 and "acc rate must be a number" in body["error"]


def test_an_unknown_stream_name_in_a_rate_map_is_refused(tmp_path):
    status, body, *_ = _post_settings(tmp_path, {"rates": {ADDR: {"telepathy": 50}}})
    assert status == 400 and "unknown stream" in body["error"]


# ── remembered capabilities survive a reboot ────────────────────────────────────────────────────────
def test_the_advertised_capabilities_are_persisted_when_the_device_is_connected(tmp_path):
    """Written to the device record so the check still has something to work with after a restart —
    `pmd_supported` lives in runtime status only and is gone the moment the daemon stops."""
    _s, _b, cfg, _ = _post_settings(
        tmp_path, {"streams": {ADDR: ["ecg", "acc"]}},
        status={"H10": {"pmd_supported": ["ecg", "acc"], "pmd_options": {"acc": [25, 200]}}})
    assert cfg["devices"][0]["pmd_supported_seen"] == ["ecg", "acc"]


def test_the_remembered_capabilities_still_refuse_an_unsupported_stream_after_a_restart(tmp_path):
    """THE point of remembering: status is empty (nothing has connected since boot), so without the
    persisted list the firmware check is skipped entirely and `gyro` on a chest strap is accepted."""
    dev = {**H10, "pmd_supported_seen": ["ecg", "acc"]}
    status, body, _cfg, cfg_path = _post_settings(
        tmp_path, {"streams": {ADDR: ["ecg", "gyro"]}}, devices=[dev], status={})
    assert status == 400 and "does not support" in body["error"] and "gyro" in body["error"]
    assert not os.path.exists(cfg_path)


def test_a_live_capability_list_wins_over_the_remembered_one(tmp_path):
    """Firmware can gain a stream. What the device says NOW is authoritative; the remembered list is a
    fallback for when it has said nothing yet."""
    dev = {**H10, "pmd_supported_seen": ["ecg"]}
    status, _body, cfg, _ = _post_settings(
        tmp_path, {"streams": {ADDR: ["ecg", "acc"]}}, devices=[dev],
        status={"H10": {"pmd_supported": ["ecg", "acc"]}})
    assert status == 200
    assert cfg["devices"][0]["pmd_supported_seen"] == ["ecg", "acc"], "the memory is refreshed"


def test_the_remembered_rate_menu_still_refuses_an_unoffered_rate_after_a_restart(tmp_path):
    dev = {**H10, "pmd_options_seen": {"acc": [25, 50, 100, 200]}}
    status, body, *_ = _post_settings(tmp_path, {"rates": {ADDR: {"acc": 999}}},
                                      devices=[dev], status={})
    assert status == 400 and "not offered" in body["error"]


def test_the_offered_rate_menu_is_persisted_when_the_device_is_connected(tmp_path):
    _s, _b, cfg, _ = _post_settings(tmp_path, {"rates": {ADDR: {"acc": 200}}},
                                    status={"H10": {"pmd_options": {"acc": [25, 200]}}})
    assert cfg["devices"][0]["pmd_options_seen"] == {"acc": [25, 200]}


# ── writing, and declining to ───────────────────────────────────────────────────────────────────────
def test_config_is_backed_up_before_it_is_overwritten(tmp_path):
    """`yaml.safe_dump` cannot round-trip comments, so every write destroys the operator's annotations
    (§D5). The `.bak` is the only copy of what they wrote."""
    app, _cfg, _st, cfg_path, _bus = _mk(tmp_path)

    # Both writes in ONE _serve: each call runs its own asyncio.run, and reusing an aiohttp app across
    # two loops raises "Application instance initialized with different loop".
    async def go(c):
        await c.post("/api/settings", json={"settings": {"watchdog.interval_sec": 90}})
        first = os.path.exists(cfg_path)
        await c.post("/api/settings", json={"settings": {"watchdog.interval_sec": 120}})
        return first
    assert _serve(app, go), "the first write must create config.yaml"
    assert os.path.exists(cfg_path + ".bak"), "the previous config must be kept before overwriting"
    assert yaml.safe_load(open(cfg_path + ".bak"))["watchdog"]["interval_sec"] == 90
    assert yaml.safe_load(open(cfg_path))["watchdog"]["interval_sec"] == 120


def test_a_failed_write_is_a_500_that_still_names_what_it_tried_to_change(tmp_path, monkeypatch):
    """§D2: `_save()`'s return value was discarded here while its three siblings all reported 500. The
    in-memory cfg keeps the change either way — so the UI showed the new value, the disk kept the old
    one, and the setting silently reverted at the next restart. `changed` is returned so the operator
    knows exactly what did not survive."""
    app, *_ = _mk(tmp_path)
    monkeypatch.setattr(webmon.os, "replace",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("ENOSPC")))
    status, body = _post(app, {"settings": {"watchdog.interval_sec": 90}})
    assert status == 500 and body["ok"] is False
    assert "config write failed" in body["error"]
    assert body["changed"] == ["watchdog.interval_sec"]


# ── The 2026-08-03 rate loss (DEVICE-RATE-TRUTH §6.4) ────────────────────────────────────────────────


def test_a_save_must_not_delete_a_rate_it_did_not_mention(tmp_path):
    """THE REGRESSION, reproduced. `dev["rates"] = clean` deleted every override the payload happened
    not to name — and the UI only names rates the device is currently OFFERING.

    Measured on the box: the Verity left SDK mode, its PPG menu shrank from [28,44,55,135,176] to [55]
    and ACC/GYRO to [52], so those rows rendered no <select> and were not submitted. The next unrelated
    save — someone toggling PPI on — wiped `ppg: 176, acc: 26, gyro: 26`, leaving only `mag: 10`.
    `config.yaml.bak` still holds the old values. Nothing logged and nothing failed.

    Preserving an override the device does not currently offer is the POINT: `chosen_rate` honours it
    only if offered and otherwise falls back, so a kept 176 lies dormant and re-applies by itself when
    SDK mode returns."""
    dev = dict(H10, rates={"ppg": 176, "acc": 26, "gyro": 26, "mag": 10})
    # The payload is PARTIAL, not absent — that distinction is the whole bug. The UI always sends a
    # `rates` dict; it just only contains the streams that rendered a <select>, i.e. those with >1 option
    # still on the menu. Here only `mag` still has a choice, so only `mag` is submitted. A payload with
    # no `rates` key at all never enters the loop and cannot reproduce this — an earlier version of this
    # test did exactly that and passed against the unfixed code.
    status, body, cfg, _ = _post_settings(
        tmp_path, {"rates": {ADDR: {"mag": 10}}},
        devices=[dev], status={"H10": {"pmd_options": {"mag": [10, 20, 50, 100], "ppg": [55],
                                                       "acc": [52], "gyro": [52]}}})
    assert status == 200 and body["ok"] is True
    assert cfg["devices"][0]["rates"] == {"ppg": 176, "acc": 26, "gyro": 26, "mag": 10}, \
        "an unmentioned rate was deleted — this is the 2026-08-03 loss"


def test_a_mentioned_rate_still_wins_over_the_stored_one(tmp_path):
    """Merging must not make rates unchangeable: a submitted value replaces the stored one, and only the
    keys the payload omits are carried forward."""
    dev = dict(H10, rates={"acc": 25, "mag": 10})
    _s, body, cfg, _ = _post_settings(
        tmp_path, {"rates": {ADDR: {"acc": 50}}},
        devices=[dev], status={"H10": {"pmd_options": {"acc": [25, 50, 100, 200]}}})
    assert cfg["devices"][0]["rates"] == {"acc": 50, "mag": 10}
    assert body["changed"] == ["H10.rates"] and body["restart_needed"] is True


def test_resubmitting_the_same_rates_is_still_a_no_op(tmp_path):
    """A merge that changes nothing must not report a change or rewrite config.yaml — writing it
    destroys the operator's comments by construction."""
    dev = dict(H10, rates={"acc": 50, "mag": 10})
    _s, body, cfg, cfg_path = _post_settings(
        tmp_path, {"rates": {ADDR: {"acc": 50}}},
        devices=[dev], status={"H10": {"pmd_options": {"acc": [25, 50]}}})
    assert body["changed"] == [] and body["restart_needed"] is False
    assert not os.path.exists(cfg_path), "a no-op settings post must not write config.yaml"


# ── SDK mode costs PPI and HR, and the response says so (POLAR-ONBOARD-BACKUP-FOLLOWUPS §3) ─────────
# The monitor presented SDK mode and the stream checkboxes as INDEPENDENT controls, so the config could
# express a state the hardware cannot hold and the only symptom was two streams quietly absent. The
# server WARNS rather than refusing: the exclusion is a Verity-FAMILY fact, not something any device
# reports, so a hard refusal would block a legitimate config written for other hardware. "Silently
# winning" was the defect; warning is the fix the brief asked for.
#
# `status` is deliberately omitted from these: with no remembered capability list the SDK-capability
# gate above passes, which isolates the warning from the refusal path next door.
def test_enabling_sdk_mode_warns_that_it_disables_ppi_and_hr(tmp_path):
    """The conflict is reported, the write still happens, and the warning names the streams lost."""
    status, body, cfg, _ = _post_settings(
        tmp_path, {"sdk_mode": {ADDR: True}},
        devices=[dict(H10, streams=["ecg", "ppi", "hr"])])
    assert status == 200 and body["ok"] is True
    assert cfg["devices"][0]["sdk_mode"] is True, "it WARNS — it does not refuse the write"
    assert len(body["warnings"]) == 1, body["warnings"]
    w = body["warnings"][0]
    assert "ppi" in w and "hr" in w, f"the warning must name the streams that go quiet: {w}"
    assert "H10" in w, "and which device it is about"


def test_the_sdk_conflict_is_judged_on_the_final_state_not_on_the_edge(tmp_path):
    """The mirror image: SDK mode is ALREADY on and PPI is configured. A check that only ran when
    `sdk_mode` itself CHANGED would miss this entirely — the same conflict from the other side, and the
    one an operator is more likely to create."""
    status, body, _, _ = _post_settings(
        tmp_path, {"sdk_mode": {ADDR: True}},
        devices=[dict(H10, streams=["ecg", "ppi"], sdk_mode=True)])
    assert status == 200
    assert body["changed"] == [], "sdk_mode was already true — nothing changed"
    assert len(body["warnings"]) == 1, "…and the conflict is still reported"
    assert "ppi" in body["warnings"][0]


def test_no_conflict_means_no_warning_and_the_key_is_still_present(tmp_path):
    """The paired ALLOW, and the reason `warnings` is unconditional. A key that appears only on trouble
    teaches a client to read its ABSENCE as "no trouble" — indistinguishable from a server older than
    the check. So it is always there, and empty when there is nothing to say."""
    status, body, _, _ = _post_settings(
        tmp_path, {"sdk_mode": {ADDR: True}},
        devices=[dict(H10, streams=["ecg", "acc"])])
    assert status == 200
    assert body["warnings"] == [], "no ppi/hr configured ⇒ nothing to warn about"
    assert "warnings" in body, "and the key is present even when empty"


def test_turning_sdk_mode_off_never_warns(tmp_path):
    """Disabling is always safe — the streams come back. A warning here would train the operator to
    ignore the one that matters."""
    status, body, _, _ = _post_settings(
        tmp_path, {"sdk_mode": {ADDR: False}},
        devices=[dict(H10, streams=["ecg", "ppi", "hr"], sdk_mode=True)])
    assert status == 200
    assert body["warnings"] == []
