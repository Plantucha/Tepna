# tepna-capture — tests/test_webmon_settings_contract.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`GET /api/settings` — the per-device stream menu and its cost table.

This response builds the settings page: which streams a device may be asked for, which rates its
firmware will accept, and what each one costs in bytes/sec. All three are consequential — an offered
stream the firmware lacks is a checkbox that can only ever produce a START rejection and an idle card,
and a wrong cost figure is how somebody fills a disk.

The mutation audit found the classifier underneath it entirely unasserted: 28 survivors in `_model_of`
alone, a three-line function whose whole job is to pick which measured byte-rate table applies. Every
one of its comparisons could be inverted or case-flipped unnoticed, because nothing ever asked it about
a Verity.

The device fixtures below deliberately separate `verity` from `sense`: the real product is "Verity
Sense", which contains BOTH tokens, so a fixture using only the real name cannot tell
`or` from `and`.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.test_webmon_api import _mk, _serve  # noqa: E402


def _settings(tmp_path, devices, status=None):
    app, *_ = _mk(tmp_path, devices=devices, status=status)

    async def go(c):
        return await (await c.get("/api/settings")).json()
    return _serve(app, go)


def _dev(**kw):
    d = {"name": "dev", "vendor": "Polar", "model": "", "device_id": "1", "address": "A", "rates": {}}
    d.update(kw)
    return d


# ── the model classifier, through the cost table it selects ─────────────────────────────────────────
@pytest.mark.parametrize("model,name,expect", [
    # H10 wins outright, on either field, in either case
    ("H10", "chest", "H10"),
    ("", "Polar H10 12345678", "H10"),
    ("h10", "", "H10"),
    # `verity` ALONE — the token without "sense"
    ("Verity", "armband", "Verity"),
    # `sense` ALONE — the other arm of the same OR, which "Verity Sense" alone cannot distinguish
    ("", "Sense armband", "Verity"),
    ("Verity Sense", "Polar Verity Sense", "Verity"),
    # anything else is the ring
    ("O2Ring-S", "Ring", "O2Ring"),
    ("", "", "O2Ring"),
])
def test_the_device_model_selects_its_measured_cost_table(tmp_path, model, name, expect):
    """`_model_of` picks which of the three measured tables applies. Getting it wrong does not raise —
    it quotes another device's byte-rates, and the Verity/H10 confusion is a 4x error on `acc` alone
    (H10 200 Hz / 11.4 kB/s vs Verity 52 Hz / 2.9 kB/s)."""
    body = _settings(tmp_path, [_dev(model=model, name=name or "dev")])
    got = body["devices"][0]["bps"]
    expected = {k: v[0] for k, v in body["bps_by_model"][expect].items()}
    assert got == expected, f"model={model!r} name={name!r} must cost like a {expect}"


def test_the_cost_table_is_published_verbatim_with_its_reference_rates(tmp_path):
    """`bps_ref` is `[bytes_per_sec, at_rate_hz]` so the UI can SCALE the estimate by the selected rate;
    a bare MB figure would start lying the moment somebody uses the dropdown, which is the point of it.
    These numbers were measured on this host over real captures — pinned so a re-guess is visible."""
    body = _settings(tmp_path, [_dev(model="H10", name="H10")])
    assert body["bps_by_model"]["H10"] == {"ecg": [7800, 130], "acc": [11400, 200], "hr": [35, 1]}
    assert body["bps_by_model"]["Verity"] == {"ppg": [3750, 55], "acc": [2950, 52],
                                              "gyro": [2800, 52], "mag": [2950, 50], "ppi": [30, 1]}
    assert body["bps_by_model"]["O2Ring"] == {"spo2": [60, 1], "ppg": [6200, 125.738]}
    d = body["devices"][0]
    assert d["bps_ref"] == {"ecg": [7800, 130], "acc": [11400, 200], "hr": [35, 1]}
    assert d["bps"] == {"ecg": 7800, "acc": 11400, "hr": 35}, "bps is the rate-free first element"


# ── what the page is allowed to offer ───────────────────────────────────────────────────────────────
def test_only_streams_the_firmware_advertises_are_offered(tmp_path):
    body = _settings(tmp_path, [_dev(name="H10", model="H10")],
                     status={"H10": {"pmd_supported": ["ecg", "acc"]}})
    assert body["devices"][0]["supported"] == ["ecg", "acc"]


def test_capability_flags_are_not_offered_as_streams(tmp_path):
    """The PMD feature bitmask also reports MODES — the Verity advertises 0x9 SDK_MODE, 0xd
    OFFLINE_RECORDING, 0xe OFFLINE_HR. polar_pmd names what it can decode and leaves the rest as hex, so
    an unnamed `0x…` entry means exactly "not a stream we can capture". Offering one is a checkbox that
    can never work."""
    body = _settings(tmp_path, [_dev(name="V", model="Verity")],
                     status={"V": {"pmd_supported": ["ppg", "0x9", "acc", "0xd", "0xe"]}})
    assert body["devices"][0]["supported"] == ["ppg", "acc"]
    # …but 0x9 is exactly what the SDK-mode switch keys off, so the same flag that must NOT become a
    # stream MUST become the capability. The two readings of one bitmask entry are both asserted here
    # so neither can be "fixed" into the other.
    assert body["devices"][0]["sdk_capable"] is True


def test_a_device_that_advertised_nothing_offers_nothing_rather_than_an_empty_menu(tmp_path):
    """`None`, not `[]` — the UI distinguishes "we have not read the bitmask yet" from "this device
    supports no streams", and only the first is a state worth waiting through."""
    body = _settings(tmp_path, [_dev(name="H10", model="H10")], status={"H10": {}})
    assert body["devices"][0]["supported"] is None
    body2 = _settings(tmp_path, [_dev(name="V", model="Verity")],
                      status={"V": {"pmd_supported": ["0x9", "0xd"]}})
    assert body2["devices"][0]["supported"] is None, "flags-only is the same as nothing capturable"


@pytest.mark.parametrize("vendor", ["Wellue", "Viatom"])
def test_the_ring_has_a_fixed_capturable_set_because_it_has_no_bitmask(tmp_path, vendor):
    """The O2Ring exposes no PMD feature bitmask, so its menu is known rather than read. `ppg` is the
    125 Hz pleth decoded out of the same 0x04 frame as the 1 Hz summary — the second largest stream on
    the box, and it went a long time with no toggle at all."""
    body = _settings(tmp_path, [_dev(name="Ring", model="O2Ring-S", vendor=vendor)],
                     status={"Ring": {"pmd_supported": ["ecg"]}})
    assert body["devices"][0]["supported"] == ["spo2", "ppg", "ppg2w", "acc"], \
        "the ring's set is fixed, and must not inherit a Polar bitmask"


def test_every_stream_the_RING_CAN_WRITE_is_offerable(tmp_path):
    """DERIVED from `capture.run_oxyii`, not a second hardcoded list — because a hardcoded list is what
    broke it.

    For a device with no capability read, this offer set IS the capability declaration. A capturable
    stream missing from it is not merely un-toggleable: `saveSettings` posts only the rendered
    checkboxes and the server assigns the WHOLE list per address, so the first ordinary save after such
    a stream is enabled silently DELETES it from config.yaml. Measured — the O2Ring wrote 110 MB of
    `_PPG2W` on the night of 2026-08-09 and 0 rows on 2026-08-10, with the config backups bracketing the
    loss to a routine settings save. `write_ppg2w` existed the whole time.

    So this asserts against the source of truth rather than a copy: every stream name `run_oxyii` gates
    a writer on must be offerable. Add a stream to capture.py and forget this list, and this test says
    so — which a second hardcoded list could never do."""
    import re

    from tests._srcscan import module_source
    src = module_source("capture.py")
    # `ppg2wr = (StreamWriter(...) if "ppg2w" in (dev.get("streams") or []) else None)`
    gated = set(re.findall(r'"([a-z0-9_]+)" in \(dev\.get\("streams"\)', src))
    assert gated, "found no stream gates in capture.py — the scan pattern has drifted, not the code"
    body = _settings(tmp_path, [_dev(name="Ring", vendor="Wellue", model="O2Ring-S",
                                     address="CC:DD", streams=["spo2"])])
    offered = set(body["devices"][0]["supported"])
    missing = sorted(g for g in gated if g not in offered)
    assert not missing, (
        f"capture.py can write {missing} for the ring but the settings page never offers them — they "
        f"cannot be switched on, and any save wipes them from config.yaml. Offered: {sorted(offered)}")


def test_each_device_projects_the_keys_the_settings_page_reads(tmp_path):
    body = _settings(tmp_path, [_dev(name="H10", model="H10", address="AA:BB", streams=["ecg"],
                                     rates={"ecg": 130})],
                     status={"H10": {"pmd_options": {"ecg": [130]}}})
    d = body["devices"][0]
    assert set(d) == {"name", "address", "vendor", "streams", "supported", "bps", "bps_ref",
                      "rate_options", "rates", "sdk_capable", "sdk_mode", "sdk_mode_actual"}
    # THREE keys for SDK mode, not one, because they answer different questions: can this hardware do
    # it (feature 0x9), was it asked for (config), and did the device CONFIRM it (null = never said).
    # An H10 advertises no such feature, so the switch is not offered for it at all.
    assert d["sdk_capable"] is False and d["sdk_mode"] is False and d["sdk_mode_actual"] is None
    assert d["name"] == "H10" and d["address"] == "AA:BB" and d["vendor"] == "Polar"
    assert d["streams"] == ["ecg"] and d["rates"] == {"ecg": 130}
    assert d["rate_options"] == {"ecg": [130]}, \
        "the device's own menu of legal rates — a dropdown built from this cannot offer an illegal one"


def test_missing_stream_and_rate_collections_read_as_empty_not_null(tmp_path):
    d = _settings(tmp_path, [_dev(name="H10", model="H10")])["devices"][0]
    assert d["streams"] == [] and d["rates"] == {} and d["rate_options"] == {}
