# tepna-capture — tests/test_settings_schema.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# settings_schema is the ALLOWLIST standing between the monitor's HTTP surface and the daemon's
# config.yaml. Its failure mode is not a wrong number on a page — it is a headless Pi that has written
# itself out of its own radio, web surface or storage with no way back except editing the file by hand.
# So these tests are about the boundary (what may be written, and within what range), not about coverage.

import math
import re
import os

import pytest

import settings_schema as ss
from settings_schema import SettingsError, coerce, describe, get_nested, set_nested


# ── the boundary ────────────────────────────────────────────────────────────────────────────────────
# The keys that must NEVER become settable. Each one, if writable, bricks a headless box: a bad adapter
# loses the radio, a bad web.host loses the monitor, a bad root loses the captures. The module comment
# says they are "absent from this table ON PURPOSE" — this asserts that intent instead of trusting it.
FORBIDDEN = ["adapter", "root", "web.host", "web.port", "web.enabled", "incoming_subdir",
             "devices", "devices.0.address"]


@pytest.mark.parametrize("key", FORBIDDEN)
def test_dangerous_keys_are_not_settable(key):
    assert key not in ss.SETTINGS, f"{key} must never be UI-settable — it can lock the box out of itself"
    with pytest.raises(SettingsError, match="not a settable key"):
        coerce(key, "anything")


def test_an_unknown_key_is_rejected_rather_than_passed_through():
    with pytest.raises(SettingsError, match="not a settable key"):
        coerce("watchdog.enabledd", True)          # typo must fail closed, not create a dead key
    with pytest.raises(SettingsError):
        coerce("", 1)


# ── range enforcement, both directions ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("key,lo,hi", [(k, v[1], v[2]) for k, v in ss.SETTINGS.items() if v[1] is not None])
def test_every_bounded_setting_rejects_out_of_range_and_accepts_the_edges(key, lo, hi):
    assert coerce(key, lo) == lo                    # inclusive lower edge
    assert coerce(key, hi) == hi                    # inclusive upper edge
    with pytest.raises(SettingsError, match="must be between"):
        coerce(key, lo - 1)
    with pytest.raises(SettingsError, match="must be between"):
        coerce(key, hi + 1)


def test_a_number_is_coerced_to_the_declared_type():
    assert coerce("watchdog.grace_checks", "3") == 3
    assert isinstance(coerce("watchdog.grace_checks", "3"), int)
    assert coerce("link.rssi_interval_sec", "25") == 25.0
    assert isinstance(coerce("link.rssi_interval_sec", "25"), float)


def test_a_non_numeric_value_is_rejected():
    with pytest.raises(SettingsError, match="expects float"):
        coerce("link.rssi_interval_sec", "not-a-number")
    with pytest.raises(SettingsError, match="expects int"):
        coerce("watchdog.grace_checks", "two")


def test_nan_is_rejected():
    """An empty field in the UI used to arrive here as float('nan'), which slips past a naive < / >
    comparison (every NaN comparison is False) and would have been written to config.yaml."""
    with pytest.raises(SettingsError, match="empty/invalid"):
        coerce("link.rssi_interval_sec", float("nan"))
    with pytest.raises(SettingsError, match="empty/invalid"):
        coerce("link.rssi_interval_sec", "nan")
    # the guard must not reject legitimate infinities-adjacent-but-valid values by accident
    assert coerce("link.rssi_interval_sec", 25) == 25


def test_infinity_is_out_of_range_not_accepted():
    with pytest.raises(SettingsError, match="must be between"):
        coerce("link.rssi_interval_sec", math.inf)


# ── booleans ────────────────────────────────────────────────────────────────────────────────────────
def test_bools_accept_real_bools_and_the_two_json_ish_strings():
    assert coerce("watchdog.enabled", True) is True
    assert coerce("watchdog.enabled", False) is False
    assert coerce("watchdog.enabled", "true") is True
    assert coerce("watchdog.enabled", "TRUE") is True
    assert coerce("watchdog.enabled", "False") is False


@pytest.mark.parametrize("bad", [1, 0, "yes", "no", "1", "", None, "on"])
def test_bools_reject_everything_else(bad):
    """Notably 1/0 and "yes"/"on": accepting them invites a silent truthiness bug at the HTTP boundary,
    where a checkbox posting "on" would otherwise be read as the string it is."""
    with pytest.raises(SettingsError, match="expects a boolean"):
        coerce("watchdog.enabled", bad)


# ── nested get/set ──────────────────────────────────────────────────────────────────────────────────
def test_get_nested_walks_and_returns_none_for_missing_or_non_dict():
    cfg = {"watchdog": {"enabled": True, "interval_sec": 60}}
    assert get_nested(cfg, "watchdog.enabled") is True
    assert get_nested(cfg, "watchdog.missing") is None
    assert get_nested(cfg, "nope.nope") is None
    assert get_nested({"watchdog": 5}, "watchdog.enabled") is None   # scalar mid-path, not a crash


def test_set_nested_creates_missing_levels_and_replaces_a_scalar_branch():
    cfg = {}
    set_nested(cfg, "watchdog.enabled", False)
    assert cfg == {"watchdog": {"enabled": False}}
    set_nested(cfg, "watchdog.interval_sec", 90)          # existing dict is extended, not replaced
    assert cfg["watchdog"] == {"enabled": False, "interval_sec": 90}
    scalar = {"watchdog": 5}                              # a scalar where a dict is needed
    set_nested(scalar, "watchdog.enabled", True)
    assert scalar == {"watchdog": {"enabled": True}}


def test_set_nested_round_trips_through_get_nested_for_every_key():
    cfg = {}
    for key, (_t, _lo, _hi, _r, dflt, _h) in ss.SETTINGS.items():
        set_nested(cfg, key, dflt)
    for key, (_t, _lo, _hi, _r, dflt, _h) in ss.SETTINGS.items():
        assert get_nested(cfg, key) == dflt


# ── describe() ──────────────────────────────────────────────────────────────────────────────────────
def test_describe_falls_back_to_the_default_and_flags_it():
    rows = {r["key"]: r for r in describe({}, {})}
    assert set(rows) == set(ss.SETTINGS), "describe must cover exactly the allowlist"
    for key, (typ, lo, hi, restart, dflt, help_) in ss.SETTINGS.items():
        r = rows[key]
        assert r["value"] == dflt and r["is_default"] is True
        assert r["default"] == dflt and r["type"] == typ.__name__
        assert r["min"] == lo and r["max"] == hi
        assert r["needs_restart"] is restart and r["help"] == help_


def test_describe_reports_an_override_as_not_default():
    cfg = {"watchdog": {"interval_sec": 90}}
    row = {r["key"]: r for r in describe(cfg, {})}["watchdog.interval_sec"]
    assert row["value"] == 90 and row["is_default"] is False


def test_describe_marks_a_value_equal_to_the_default_as_default():
    cfg = {"watchdog": {"interval_sec": ss.SETTINGS["watchdog.interval_sec"][4]}}
    row = {r["key"]: r for r in describe(cfg, {})}["watchdog.interval_sec"]
    assert row["is_default"] is True, "explicitly writing the default must not look like an override"


# ── the documented invariant ────────────────────────────────────────────────────────────────────────
def test_every_declared_default_is_a_valid_value_for_its_own_setting():
    """A default outside its own bounds would make the UI advertise a value the API then refuses."""
    for key, (_t, _lo, _hi, _r, dflt, _h) in ss.SETTINGS.items():
        assert coerce(key, dflt) == dflt, f"{key}'s default is not accepted by its own validator"


def test_schema_defaults_match_the_daemon_fallbacks():
    """THE claim in the module header: "The default is the SINGLE SOURCE OF TRUTH — it is the same value
    the daemon falls back to." Prose, until now. capture.py reads config with `.get("leaf", <fallback>)`;
    if the two drift, the monitor advertises a default the daemon does not actually use, and a user who
    "resets to default" silently changes behaviour. Scanned from source because importing capture and
    reaching those lines needs a running BLE daemon."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "capture.py"), encoding="utf-8").read()
    found = {}
    for leaf, raw in re.findall(r'\.get\(\s*"([a-z_]+)"\s*,\s*([^)\n,]+?)\s*\)', src):
        found.setdefault(leaf, set()).add(raw.strip())

    checked = 0
    for key, (typ, _lo, _hi, _r, dflt, _h) in ss.SETTINGS.items():
        leaf = key.split(".")[-1]
        if leaf not in found:
            continue                                  # not read via a literal .get fallback (e.g. ppg_fs)
        for raw in found[leaf]:
            if raw in ("True", "False"):
                actual = raw == "True"
            else:
                try:
                    actual = float(raw)
                except ValueError:
                    continue                          # a named constant, not a literal — covered below
            assert actual == dflt, (
                f"{key}: schema default {dflt!r} != capture.py fallback {raw!r} — "
                "the monitor would advertise a default the daemon does not use")
            checked += 1
    assert checked >= 8, f"expected to verify most fallbacks against source, only matched {checked}"


def test_the_two_named_constant_defaults_match_capture():
    """ppg_fs and rtc_resync_sec are read from module constants rather than a literal .get fallback, so
    the source scan above cannot see them. Import capture (no BLE needed at import) and compare."""
    import capture
    assert ss.SETTINGS["o2ring.ppg_fs"][4] == capture.O2PPG_FS_DEFAULT
    assert ss.SETTINGS["o2ring.rtc_resync_sec"][4] == capture._OXYII_RTC_RESYNC_SEC
