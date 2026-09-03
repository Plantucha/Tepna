# tepna-capture — tests/test_monitor_device_cards.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Each remembered device carries its OWN settings, in one place — owner-requested 2026-08-29.

Everything about a sensor on that sensor's card, the way the CPAP card already works, instead of
split between the Devices view and the Settings view.

⚠️ MOVED, NOT MIRRORED. `saveSettings` collects by class across the whole document, so two copies of
a device's controls would put duplicate `data-addr` inputs in the DOM and whichever rendered last
would win — silently, including when one was stale. These tests pin the single-copy property, since
that is the part a later edit is most likely to undo.

EXECUTES the shipped JavaScript — a text scan cannot tell rendered-for-this-device from
rendered-always, and would pass against a panel wired to the wrong record.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile

import pytest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MON = os.path.join(HERE, "monitor.html")

STATE_DEVS = [
    {
        "name": "Wellue O2Ring-S",
        "vendor": "Wellue",
        "model": "O2Ring-S",
        "address": "D1:98:62:7C:92:B3",
        "streams": ["spo2"],
    },
    {
        "name": "Polar Verity Sense",
        "vendor": "Polar",
        "model": "VeritySense",
        "address": "24:AC:AC:0C:30:1E",
        "streams": ["ppg"],
    },
]
# /api/settings carries capability data /api/state does not — and in a DIFFERENT ORDER on purpose.
SETTINGS_DEVS = [
    {
        "name": "Polar Verity Sense",
        "vendor": "Polar",
        "model": "VeritySense",
        "address": "24:AC:AC:0C:30:1E",
        "streams": ["ppg"],
        "supported": ["ppg", "acc"],
        "rate_options": {"ppg": [55, 176]},
        "rates": {"ppg": 176},
        "sdk_capable": True,
        "sdk_mode": True,
        "sdk_mode_actual": None,
    },
    {
        "name": "Wellue O2Ring-S",
        "vendor": "Wellue",
        "model": "O2Ring-S",
        "address": "D1:98:62:7C:92:B3",
        "streams": ["spo2"],
        "supported": ["spo2"],
        "rate_options": {},
        "rates": {},
    },
]


def _script_blocks(src):
    """The text of every `<script>` block in `src`.

    ⚠️ NOT a regex, deliberately. `<script[^>]*>(.*?)</script>` is what CodeQL's `py/bad-tag-filter`
    flags — correctly as a pattern, even though nothing here filters untrusted HTML: this reads a file
    we commit, to run its own JavaScript. Split instead, which is both unflagged and clearer about the
    one rule that matters — a script block ends at the FIRST `</script>`, exactly as a browser ends it,
    so the extraction and the runtime agree by construction rather than by coincidence.
    """
    out = []
    for chunk in str(src).split("<script")[1:]:
        _, _, after_tag = chunk.partition(">")
        body, _, _rest = after_tag.partition("</script>")
        out.append(body)
    return out


def _extract(*names):
    """The named top-level functions, as executable source, taken from the shipped file."""
    src = open(MON, encoding="utf-8").read()
    out = []
    for n in names:
        m = re.search(r"^function " + n + r"\(.*?\n\}$", src, re.M | re.S)
        assert m, f"{n}() is gone or reshaped in monitor.html — this test is stale, fix it"
        out.append(m.group(0))
    return "\n".join(out)


def _render(settings_devs, state_devs=STATE_DEVS):
    """Render the device list with stubbed chips.

    Only the functions under test are taken from the file; `$` and the status chips are stubbed,
    because evaluating the whole page here would hit the temporal dead zone of its own `const`
    declarations. The chips have their own tests — `test_monitor_chip_scope` pins that they are
    reachable at all, which is the property this file must not silently re-break."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed — the browser-lane extraction cannot run here")
    # `pendingChecked` is extracted for REAL — `deviceSettingsBlock` calls it for every checkbox,
    # so a stub would let these tests pass against an overlay that does not exist.
    body = _extract("renderRemembered", "settingsPanel", "deviceSettingsBlock", "pendingChecked")
    prog = (
        "let __html='';\n"
        # A SINGLETON element, not a fresh object per call. `renderRemembered` delegates its
        # change-listener to the container and guards re-binding with a property ON that element —
        # `innerHTML` replaces every input on every 5 s poll, so a per-control listener would be
        # discarded by the first rebuild and edit-capture would stop silently. A stub that handed
        # back a NEW object each call would model that guard as always-unset and prove nothing about
        # it; this one persists, so `__listeners` counts real bindings across renders.
        # PENDING is EMPTY here on purpose: with no unsaved edit the overlay must be a pure
        # pass-through, so every assertion below still describes rendering from server truth. The
        # overlay's own behaviour (an edit surviving the 5 s rebuild) is pinned in
        # test_monitor_pending_edits.py, which exercises it with entries.
        "const PENDING = Object.create(null);\n"
        "const pendKey = (addr, stream) => addr + '|' + stream;\n"
        "let __listeners = 0;\n"
        "const __el = { set innerHTML(v){ __html = v; }, get innerHTML(){ return __html; },\n"
        "               addEventListener(){ __listeners++; } };\n"
        "const $ = () => __el;\n"
        "const esc = s => String(s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"
        "'\"':'&quot;',\"'\":'&#39;'}[c]));\n"
        "const chargeChip=()=>'' , wornChip=()=>'', rateChip=()=>'', battChip=()=>'',\n"
        "      deviceHealth=()=>({health:'',title:''}), rssiChip=()=>'', clkChip=()=>'',\n"
        "      presenceChip=()=>'', witnessChip=()=>'', lastSampleText=()=>'',\n"
        "      recPanelId=a=>'rec-'+a, defaultRate=(d,k,o)=>o[0], rateAdvice=()=>null,\n"
        "      STREAM_LABEL={}, PREF_RATE={}, renderRingRtc=()=>'', ringConfigRow=()=>'',\n      fmtSecs=s=>String(s), ringKnob=()=>'';\n"
        + body
        + "\n"
        f"try{{ renderRemembered({json.dumps(state_devs)}, {json.dumps(settings_devs)});\n"
        "  console.log(JSON.stringify({html: __html})); }\n"
        "catch(e){ console.log(JSON.stringify({err: e.constructor.name + ': ' + e.message})); }\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(prog)
        path = fh.name
    try:
        r = subprocess.run([node, path], capture_output=True, text=True, timeout=30)
    finally:
        os.unlink(path)
    assert r.returncode == 0, r.stderr[:2000]
    out = json.loads(r.stdout)
    assert "err" not in out, out["err"]
    return out["html"]


def test_each_card_carries_ITS_OWN_settings():
    html = _render(SETTINGS_DEVS)
    assert 'class="dev-settings"' in html
    # The Verity's PPG rate menu and SDK switch belong to the Verity's card only.
    assert 'data-addr="24:AC:AC:0C:30:1E" data-rate="ppg"' in html
    assert html.count("sdksel") == 1, "the SDK switch rendered for a device that cannot do it"


def test_the_panel_is_matched_by_ADDRESS_not_by_position():
    """🔴 The two lists come from different projections and are in different orders here on purpose.
    Pairing positionally would show one sensor's rates under another's name."""
    html = _render(SETTINGS_DEVS)
    ring_at = html.index("D1:98:62:7C:92:B3")
    verity_at = html.index("24:AC:AC:0C:30:1E")
    sdk_at = html.index("sdksel")
    assert ring_at < verity_at, "state order should drive the cards"
    assert sdk_at > verity_at, "the Verity's SDK switch landed on the wrong card"


def test_a_device_with_NO_settings_record_renders_no_panel():
    """Not an empty control set — an empty set of checkboxes reads as 'this sensor offers no
    streams', which is a claim we have not earned."""
    html = _render([SETTINGS_DEVS[0]])  # only the Verity has a record
    assert html.count('class="dev-settings"') == 1


def test_a_COLD_view_with_no_SETTINGS_yet_renders_the_cards_without_panels():
    """/api/settings arrives after /api/state on a cold Devices view. The cards must still draw."""
    html = _render(None)
    assert "Wellue O2Ring-S" in html and "Polar Verity Sense" in html
    assert "dev-settings" not in html


def test_the_controls_exist_in_exactly_ONE_place_in_the_document():
    """MOVED, not mirrored. `saveSettings` collects by class across the whole document; a second copy
    would fight this one and the later render would win, silently."""
    src = open(MON, encoding="utf-8").read()
    js = "\n".join(_script_blocks(src))
    # exactly one renderer, and the Settings view no longer builds device rows
    assert js.count("function deviceSettingsBlock(") == 1
    assert "SETTINGS.devices.map(" not in js, (
        "the Settings view is building per-device controls again — that is the duplicate-DOM hazard"
    )


def test_a_save_button_is_offered_where_the_controls_now_are():
    html = _render(SETTINGS_DEVS)
    assert "saveSettings(this)" in html, "the controls moved but their Save did not"


def test_no_devices_means_no_stray_save_button():
    html = _render(SETTINGS_DEVS, state_devs=[])
    assert "saveSettings(this)" not in html
