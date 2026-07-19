# tepna-capture — tests/test_charging_state.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The `charging` device flag. It used to be set in exactly ONE place — the PMD START rejection path
# (status 0x0D in_charger) — which can only fire for a device that was ALREADY on the dock when the
# daemon tried to connect. A device put on charge MID-SESSION keeps its BLE link, so no START is
# attempted, so nothing ever noticed: measured 2026-07-19, a Verity climbed 35 % -> 61 % while the
# monitor reported charging=False the whole way, and an O2Ring reached 77 % with its own batt_state flag
# set to 1 in the sidecar. Two devices visibly charging, neither flagged.

import oxyii


def test_the_ring_reports_its_own_charge_state():
    """batt_state is the device's OWN flag (0 = not charging), so the ring needs no inference."""
    payload = bytes(20)
    live = oxyii.parse_live(payload)
    assert live is not None and "batt_state" in live, "parse_live must surface batt_state"


def test_ring_charge_flag_is_read_from_batt_state_not_inferred():
    src = open(__file__.replace("tests/test_charging_state.py", "capture.py"), encoding="utf-8").read()
    assert 'charging=bool(live.get("batt_state"))' in src, \
        "the O2Ring must take charging from its own batt_state, not from a battery trend"
    assert src.count('charging=bool(live.get("batt_state"))') == 2, \
        "both the worn and the NOT-worn path must report charge state — the ring keeps its link on the dock"


def test_polar_charge_is_inferred_from_a_RISING_battery():
    """A Polar exposes no charge flag mid-session. A battery that rises is unambiguous — these cells do
    not self-charge — and a battery that falls means it came off the dock."""
    src = open(__file__.replace("tests/test_charging_state.py", "capture.py"), encoding="utf-8").read()
    assert "lvl > prev" in src and "charging=True" in src
    assert "lvl < prev" in src and "charging=False" in src, \
        "coming off the dock must clear the flag, or it latches on forever"


def test_the_monitor_pill_describes_data_not_the_link():
    """The card said `live` whenever the stream was `active`, which means started — not delivering. On
    2026-07-19 seven of twelve streams read `live` at effFs 0.0."""
    html = open(__file__.replace("tests/test_charging_state.py", "monitor.html"), encoding="utf-8").read()
    assert "function streamState(" in html
    for state in ("charging", "not worn", "no data", "weak", "idle"):
        assert f"'{state}'" in html or f'"{state}"' in html, f"pill must be able to report {state!r}"
    assert "s.health === 'stall'" in html, "the pill must consult health, not just active"
    assert html.count("streamState(s") >= 2, "used on first render AND on the in-place refresh"


def test_the_pill_styles_exist_for_every_class_it_emits():
    """A class with no CSS renders as unstyled text — the state would be reported but invisible."""
    html = open(__file__.replace("tests/test_charging_state.py", "monitor.html"), encoding="utf-8").read()
    for cls in ("live", "warn", "chg"):
        assert f".ov-head .st.{cls}{{" in html, f"missing style for .st.{cls}"


def test_not_worn_and_charging_are_amber_or_blue_never_red():
    """These are NORMAL states — the user isn't wearing the sensor. Red would cry fault at an expected
    condition and train people to ignore the colour that should mean something is genuinely broken."""
    html = open(__file__.replace("tests/test_charging_state.py", "monitor.html"), encoding="utf-8").read()
    warn = html.split(".ov-head .st.warn{")[1].split("}")[0]
    chg = html.split(".ov-head .st.chg{")[1].split("}")[0]
    assert "--amber" in warn and "--red" not in warn
    assert "--blue" in chg and "--red" not in chg
