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
from tests._srcscan import module_source


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
    src = module_source("capture.py")
    assert "_WORN_SINCE: dict" in src and src.index("_WORN_SINCE: dict") < src.index("async def run_polar")
    assert "elif addr not in _WORN_SINCE:" in src, "must only stamp the FIRST not-worn, not every frame"


def test_a_dropped_strap_sleeps_the_recheck_interval_not_the_error_backoff():
    src = module_source("capture.py")
    assert "elif drop_for_power:" in src
    assert "_NOT_WORN_RECHECK_S" in src.split("elif drop_for_power:")[1][:700]


# ── sdk_mode_wanted: SDK mode blinds both wear detectors, so it must not outlive a not-worn verdict ──
def test_sdk_mode_is_denied_once_the_device_is_KNOWN_not_worn():
    """The 2026-09-03 defect. With SDK mode on, a docked Verity duty-cycled at 176 Hz for hours: the
    not-worn drop fired every 180 s, but each 90 s recheck was ACCEPTED and wrote real samples, so the
    wear probe became a capture and (being inside the 300 s resume window) re-adopted the same file-set
    forever. Denying SDK mode on an established not-worn restores the firmware's own `in_charger`
    refusal, so the probe writes nothing."""
    assert capture.sdk_mode_wanted(True, False, False) is False
    assert capture.sdk_mode_wanted(True, True, False) is True, "a worn device still gets 176 Hz"


def test_charging_vetoes_sdk_mode_even_when_the_contact_bit_claims_worn():
    """A device in a dock is not on a wrist — the one signal here that is a physical fact rather than
    an inference. On 2026-08-14 the contact bit said worn for 80 minutes on a charger, so `worn` alone
    is not sufficient to authorise the rate that hides the charger."""
    assert capture.sdk_mode_wanted(True, True, True) is False
    assert capture.sdk_mode_wanted(True, None, True) is False


def test_unknown_wear_is_ALLOWED_through_and_that_is_deliberate():
    """`worn=None` means no detector was available or in domain — NOT 'not worn'. Denying on None would
    permanently deny SDK mode to hardware that cannot report wear at all (the H10 has no contact bit),
    regressing devices that never had this problem. The docked case does not need it: a strap we dropped
    republishes worn=False, not None, so the veto fires on the signal that is actually present."""
    assert capture.sdk_mode_wanted(True, None, False) is True
    assert capture.sdk_mode_wanted(True, None, None) is True


def test_the_config_switch_still_wins_when_it_is_off():
    """No wear state re-enables a feature the operator disabled."""
    for worn in (True, False, None):
        for charging in (True, False, None):
            assert capture.sdk_mode_wanted(False, worn, charging) is False
            assert capture.sdk_mode_wanted(None, worn, charging) is False


def test_the_caller_passes_PUBLISHED_wear_state_not_a_local_guess():
    """Pins the wiring: the veto is only as good as its input, and the published verdict is the one that
    went through `worn_verdict`'s combiner (where the charging veto lives). A local variable read here
    would bypass that and reintroduce the contact-bit-decides bug."""
    src = module_source("capture.py")
    call = src.split("if sdk_mode_wanted(")[1][:300]
    assert 'STATUS["devices"].get(name, {}).get("worn")' in call
    assert 'STATUS["devices"].get(name, {}).get("charging")' in call


def test_the_fix_is_NOT_in_the_resume_window():
    """CAPTURE-FILESET-RESUME collapses this exact duty cycle on purpose (2,154 sets across 76
    device-nights, 28.3x). Suppressing resume on a not-worn drop would undo a deliberate, measured
    feature to work around a different bug — so the resume path must stay free of wear conditions."""
    src = module_source("capture.py")
    resume = src.split("CAPTURE-FILESET-RESUME §2")[1][:1200]
    # COMMENTS ONLY are stripped, and string literals deliberately are NOT: the block's own prose cites
    # `drop_not_worn` as the case it exists to collapse, which documents the decision rather than being
    # a wear condition inside it. Stripping literals as well would be the wider blindness Heron measured
    # on the AS11 scan — a check that can no longer see the thing it is checking for.
    code = "\n".join(ln.split("#", 1)[0] for ln in resume.splitlines())
    assert "resumable_stamp(" in code, "guard is anchored on the resume block"
    for leaked in ("worn", "sdk_mode_wanted", "charging"):
        assert leaked not in code, f"the resume decision must not consult {leaked!r}"
