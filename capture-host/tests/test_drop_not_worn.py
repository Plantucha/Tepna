# tepna-capture — tests/test_drop_not_worn.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Auto-drop of a not-worn Polar. A chest strap off the body streams electrode noise at the full 130 Hz —
# recording nothing real and flattening its own battery over a day (observed 2026-07-19: an off-body H10
# stayed connected and streaming indefinitely). After a generous grace of CONTINUOUS not-worn contact the
# daemon drops the link, then reconnects on a slow cadence to see if it is back on.
#
# The grace must be LONG: a real wear is never not-worn for minutes, and dropping during genuine use would
# cost real data. This is a sleep-recording box — the failure to avoid is a false drop, not a slow one.

import capture
import settings_schema


G = 180.0


def test_a_worn_or_unknown_strap_is_never_dropped():
    assert capture.should_drop_not_worn(None, 1000.0, G) is False   # worn / no contact bit


def test_not_worn_under_the_grace_is_not_dropped():
    assert capture.should_drop_not_worn(1000.0, 1000.0 + G - 1, G) is False


def test_not_worn_past_the_grace_is_dropped():
    assert capture.should_drop_not_worn(1000.0, 1000.0 + G, G) is True
    assert capture.should_drop_not_worn(1000.0, 1000.0 + G + 60, G) is True


def test_the_feature_is_disabled_at_grace_zero():
    """0 must mean never-drop, even for a strap not worn for an hour."""
    assert capture.should_drop_not_worn(1000.0, 1000.0 + 3600, 0) is False


def test_a_brief_contact_glitch_during_real_wear_does_not_trigger():
    """A roll-over or strap tug is seconds. At the default 180 s grace it comes nowhere near a drop."""
    for glitch in (2, 10, 30, 60, 120):
        assert capture.should_drop_not_worn(1000.0, 1000.0 + glitch, G) is False, glitch


def test_the_grace_and_recheck_are_in_the_settings_schema():
    assert "power.drop_not_worn_sec" in settings_schema.SETTINGS
    assert "power.not_worn_recheck_sec" in settings_schema.SETTINGS


def test_schema_defaults_match_the_module_constants():
    assert settings_schema.SETTINGS["power.drop_not_worn_sec"][4] == capture._DROP_NOT_WORN_SEC
    assert settings_schema.SETTINGS["power.not_worn_recheck_sec"][4] == capture._NOT_WORN_RECHECK_S


def test_worn_since_is_module_level_so_it_survives_the_probe_reconnects():
    """If the grace clock restarted on every reconnect, each duty-cycle probe would stream for a full
    grace period and never actually drop. The timestamp must persist across sessions."""
    src = open(__file__.replace("tests/test_drop_not_worn.py", "capture.py"), encoding="utf-8").read()
    assert "_WORN_SINCE: dict" in src and src.index("_WORN_SINCE: dict") < src.index("async def run_polar")
    assert "elif addr not in _WORN_SINCE:" in src, "must only stamp the FIRST not-worn, not every frame"


def test_a_dropped_strap_sleeps_the_recheck_interval_not_the_error_backoff():
    src = open(__file__.replace("tests/test_drop_not_worn.py", "capture.py"), encoding="utf-8").read()
    assert "elif drop_for_power:" in src
    assert "_NOT_WORN_RECHECK_S" in src.split("elif drop_for_power:")[1][:700]
