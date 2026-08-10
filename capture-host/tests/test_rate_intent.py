# tepna-capture — tests/test_rate_intent.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""A configured rate the device does not offer must be SAID OUT LOUD.

`polar_pmd.chosen_rate` honours a configured rate only if the device offers it, and otherwise falls
back to its own preference. That is the right behaviour — a rate the firmware rejects leaves a
permanently idle stream — but it makes "I asked for something impossible" indistinguishable from
"I got what I asked for". `rates: {ppg: 176}` without SDK mode captured whole nights at 55 Hz with no
error and a config that still read 176; it took a file-by-file audit across six nights to notice.

These tests drive the REAL `run_polar` against the fake device, so what is asserted is what the daemon
actually negotiated and published — not which function it called.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import capture  # noqa: E402
import polar_pmd as pmd  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_capture_runners as T  # noqa: E402

# `run_polar` mutates process-wide state and `capture.STATUS` is module-global; without the autouse
# reset each test asserts against its predecessor's leftovers. Adopt the fixture, never re-implement it.
_clean_stop = T._clean_stop


def _drive(tmp_path, monkeypatch, dev):
    T._polar_common(monkeypatch)
    c = T.FakePolarClient()
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    T._run(capture.run_polar(dev, str(tmp_path)))
    return c


def test_an_unofferable_configured_rate_is_WARNED_not_swallowed(tmp_path, monkeypatch, caplog):
    """The fake offers ECG at 130 only. Asking for 176 must not pass in silence."""
    with caplog.at_level("WARNING"):
        _drive(tmp_path, monkeypatch, T._pdev(rates={"ecg": 176}))
    warns = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    hit = [w for w in warns if "was NOT offered" in w]
    assert hit, f"no warning about the unmet rate; got {warns}"
    msg = hit[0]
    assert "176" in msg, "the warning must name what was ASKED for"
    assert "130" in msg, "…and what was actually used, plus the device's menu"


def test_the_unmet_rate_is_published_so_a_surface_can_show_it(tmp_path, monkeypatch):
    """A log line is invisible to the monitor. The status carries want/got per stream."""
    _drive(tmp_path, monkeypatch, T._pdev(rates={"ecg": 176}))
    unmet = capture.STATUS["devices"]["H10"].get("rate_unmet") or {}
    assert unmet.get("ecg") == {"want": 176, "got": 130}


def test_a_rate_the_device_DOES_offer_is_silent(tmp_path, monkeypatch, caplog):
    """The positive control. A warning that fires on the ordinary case is one people mute."""
    with caplog.at_level("WARNING"):
        _drive(tmp_path, monkeypatch, T._pdev(rates={"ecg": 130}))
    assert not [r for r in caplog.records if "was NOT offered" in r.getMessage()]
    assert "rate_unmet" not in capture.STATUS["devices"]["H10"]


def test_no_configured_rate_at_all_is_silent(tmp_path, monkeypatch, caplog):
    """Most devices carry no override; the daemon picks its own preference and that is not a defect."""
    with caplog.at_level("WARNING"):
        _drive(tmp_path, monkeypatch, T._pdev())
    assert not [r for r in caplog.records if "was NOT offered" in r.getMessage()]


def test_the_fallback_itself_is_unchanged(tmp_path, monkeypatch):
    """⚠️ This warns, it does not REFUSE. Falling back is deliberate — a rate the firmware rejects
    leaves an idle stream — so the stream must still start, at the device's rate."""
    c = _drive(tmp_path, monkeypatch, T._pdev(rates={"ecg": 176}))
    starts = [w for w in c.writes if len(w) >= 2 and w[0] == 0x02 and w[1] == pmd.ECG]
    assert starts, "the ECG stream must still be started despite the unmet rate"
    ecgs = list((tmp_path / "captures").rglob("*_ECG.txt"))
    assert ecgs and ecgs[0].stat().st_size > 60, "…and still write data"


def test_a_configured_rate_the_device_DOES_offer_is_actually_USED(tmp_path, monkeypatch, caplog):
    """⚠️ THE OTHER HALF, and the tests above cannot see it. With a single-entry menu, `chosen_rate`
    with the override and `chosen_rate` with `None` return the same number, so dropping `_prefer`
    entirely — never honouring any override — passes every case above. Only a menu with a CHOICE
    separates them.

    SDK mode is what widens the Verity's menu, so this drives it: the fake then offers 130 AND 176,
    the built-in preference is 130, and taking 176 can only happen by honouring the config."""
    with caplog.at_level("WARNING"):
        _drive(tmp_path, monkeypatch, T._pdev(sdk_mode=True, rates={"ecg": 176}))
    opts = capture.STATUS["devices"]["H10"]["pmd_options"]["ecg"]
    assert opts == [130, 176], f"the menu must offer a real choice, got {opts}"
    assert not [r for r in caplog.records if "was NOT offered" in r.getMessage()], \
        "176 IS offered here — warning about it would be the false-positive that gets warnings muted"
    assert "rate_unmet" not in capture.STATUS["devices"]["H10"]
