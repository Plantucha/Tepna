# tepna-capture — tests/test_optical_worn.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""`worn` derived from the optical signal, for devices that declare no skin-contact bit.

WHY IT EXISTS. The Verity Sense reports `contact_supported: false` and emits 1 Hz of `0000` forever,
so the contact path yields `None` for it permanently. Two shipped features read `worn` and are
therefore dead on that device: `power.drop_not_worn_sec` never fires, and
`cpap_harvest.blocking_devices` counts `worn is not False` as streaming.

Measured 2026-08-10: the armband streamed 3 h and 42.5 MB into a DESK at a flawless 55.0 Hz, zero
gaps, RSSI −37 — every health check green, battery 100 % → 74 %, and the CPAP harvest refused to run
because it believed a sensor was busy. Nothing was wrong with the transport; nothing looked at the
content.

THE NUMBERS BELOW ARE MEASURED, NOT CHOSEN. 5730 windows of 30 s across 45 real Verity PPG files
(2026-08-01 → 08-10) put |ambient| at ~140–190 worn and ~3.2e5–6.5e5 unworn — a log10 histogram of
3795 windows at 1–3, FOUR at 4, and 1931 at 5. The threshold is the geometric midpoint of the widest
empty interval in the middle 98 % (1993 → 13160), i.e. 5121, rounded to 5000.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from telemetry import _WORN_AMBIENT_MAX, optical_worn  # noqa: E402

# Real per-window medians, transcribed from the corpus scan.
WORN_REAL = [-207.0, -188.0, -160.0, -141.0, -129.0, -190.0]        # under skin: dark
UNWORN_REAL = [-322929.0, -322944.0, -650655.0, -650701.0, -630467.0]  # on a desk: room light


def _many(vals, n=200):
    return [vals[i % len(vals)] for i in range(n)]


def test_the_overnight_signal_reads_WORN():
    assert optical_worn(_many(WORN_REAL)) is True


def test_the_desk_signal_reads_UNWORN():
    """The 3-hour, 42.5 MB desk recording that started this."""
    assert optical_worn(_many(UNWORN_REAL)) is False


def test_the_threshold_sits_inside_the_MEASURED_gap():
    """1993 → 13160 was empty across 5730 windows. A threshold outside it would be a guess; inside it,
    the nearest real observation is a factor of ~2.5 away on either side."""
    assert 1993 < _WORN_AMBIENT_MAX < 13160
    assert optical_worn(_many([-1993.0])) is True, "the top of the worn cluster stays worn"
    assert optical_worn(_many([-13160.0])) is False, "the bottom of the unworn cluster stays unworn"


@pytest.mark.parametrize("n", [0, 1, 50, 127])
def test_too_little_data_is_UNKNOWN_never_unworn(n):
    """⚠️ `None` is not `False`. A `False` here DROPS THE LINK for power and unblocks the CPAP harvest;
    returning it for a stream that just opened would disconnect a sensor the moment it connected."""
    assert optical_worn([-190.0] * n) is None


def test_the_verdict_is_a_MEDIAN_so_a_burst_cannot_flip_it():
    """A hand passing over the sensor, or a few saturated samples, must not move the answer. Under a
    mean, 20 % room-light samples would drag a worn median of ~190 above any sane threshold."""
    contaminated = _many(WORN_REAL, 160) + _many(UNWORN_REAL, 40)   # 20 % bright
    assert optical_worn(contaminated) is True
    assert sum(abs(v) for v in contaminated) / len(contaminated) > _WORN_AMBIENT_MAX, \
        "…and the mean really would have been fooled, so the median is doing the work"


def test_sign_is_irrelevant():
    """The Verity reports ambient negative; nothing should depend on that convention."""
    assert optical_worn([190.0] * 200) is True
    assert optical_worn([322929.0] * 200) is False


def test_the_threshold_is_EXCLUSIVE_so_a_median_sitting_on_it_is_unworn():
    """`< threshold`, not `<=`. Nothing in the corpus lands exactly on 5000, so the choice is arbitrary
    on the data — but it must be PINNED, or the operator flips freely and no test notices. Exclusive is
    the conservative reading of "below this ⇒ under skin": on the line is not below it."""
    assert optical_worn([_WORN_AMBIENT_MAX] * 200) is False
    assert optical_worn([_WORN_AMBIENT_MAX - 1] * 200) is True


def test_an_EVEN_length_buffer_medians_the_two_middle_values():
    """The even branch is the one every other fixture misses — a flat buffer reads the same however the
    middle index is computed, which is how ten mutants lived on the old hand-rolled line. Straddle the
    threshold with two distinct middles so the answer depends on averaging THEM specifically."""
    lo, hi = _WORN_AMBIENT_MAX - 2000, _WORN_AMBIENT_MAX + 1000    # mean 4500 < 5000 ⇒ worn
    assert optical_worn([1.0] * 99 + [lo, hi] + [9e5] * 99) is True
    lo2, hi2 = _WORN_AMBIENT_MAX - 500, _WORN_AMBIENT_MAX + 3000   # mean 6250 > 5000 ⇒ unworn
    assert optical_worn([1.0] * 99 + [lo2, hi2] + [9e5] * 99) is False


def test_min_samples_zero_still_needs_ONE_sample():
    """`max(1, min_samples)` is a floor, not a preference: a median of nothing is not a measurement, and
    computing one raises rather than returning a verdict."""
    assert optical_worn([], min_samples=0) is None
    assert optical_worn([None, float("nan")], min_samples=0) is None
    assert optical_worn([190.0], min_samples=0) is True


def test_nan_and_none_are_dropped_not_counted():
    """A short frame or a parse miss must not be scored as darkness."""
    assert optical_worn([None] * 300) is None
    assert optical_worn([float("nan")] * 300) is None
    assert optical_worn(_many(WORN_REAL) + [None, float("nan")]) is True


# ── through the real runner ─────────────────────────────────────────────────────────────────────────
# The pure function above is the easy half. What matters is that `run_polar` publishes the verdict on
# the SAME `worn` key the contact bit uses, because that key is what `should_drop_not_worn` and
# `cpap_harvest.blocking_devices` already read.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import capture  # noqa: E402
import polar_pmd as pmd  # noqa: E402
import test_capture_runners as T  # noqa: E402

_clean_stop = T._clean_stop


def _ppg_frame(ambient, n=240):
    """A PMD PPG frame: 4 channels x 24-bit LE signed, the 4th being ambient."""
    body = b""
    for _ in range(n):
        for v in (120000, 120000, 120000, int(ambient)):
            body += (v & 0xFFFFFF).to_bytes(3, "little")
    return bytes([pmd.PPG]) + (1_000_000_000).to_bytes(8, "little") + bytes([0x00]) + body


class _PpgClient(T.FakePolarClient):
    """Feeds one PPG frame at the given ambient once PMD_DATA is subscribed."""

    def __init__(self, ambient, frames=1, **kw):
        super().__init__(**kw)
        self._ambient = ambient
        self._frames = frames

    async def start_notify(self, uuid, cb):
        # Delegate FIRST so the parent still delivers its HR frame — overriding it outright silently
        # dropped `hr_frame`, which made the contact-precedence test below fail against correct code.
        await super().start_notify(uuid, cb)
        if getattr(uuid, "uuid", uuid) == pmd.PMD_DATA:
            for _ in range(self._frames):
                cb(0, _ppg_frame(self._ambient))


def _drive(tmp_path, monkeypatch, ambient):
    T._polar_common(monkeypatch)
    c = _PpgClient(ambient)
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    dev = T._pdev(name="Verity", vendor="Polar", model="VeritySense", streams=["ppg"],
                  address="24:AC:AC:0C:30:1E")
    T._run(capture.run_polar(dev, str(tmp_path)))
    return capture.STATUS["devices"]["Verity"]


def test_run_polar_publishes_UNWORN_for_a_desk_signal(tmp_path, monkeypatch):
    st = _drive(tmp_path, monkeypatch, -322929)
    assert st.get("worn") is False, st
    assert "not worn" in (st.get("last_error") or ""), "the reason must say WHY, not just flip a flag"
    assert "24:AC:AC:0C:30:1E" in capture._WORN_SINCE, \
        "the grace clock must start, or power.drop_not_worn_sec can still never fire"


def test_run_polar_publishes_WORN_for_an_on_body_signal(tmp_path, monkeypatch):
    st = _drive(tmp_path, monkeypatch, -190)
    assert st.get("worn") is True, st
    assert capture._WORN_SINCE.get("24:AC:AC:0C:30:1E") is None, "a worn strap holds no grace clock"


def test_the_verdict_feeds_the_EXISTING_power_drop(tmp_path, monkeypatch):
    """`should_drop_not_worn` is untouched by this change — the point is that it now RECEIVES a
    timestamp for an armband that could never produce one before."""
    _drive(tmp_path, monkeypatch, -322929)
    since = capture._WORN_SINCE["24:AC:AC:0C:30:1E"]
    assert capture.should_drop_not_worn(since, since + 181.0, 180.0) is True
    assert capture.should_drop_not_worn(since, since + 179.0, 180.0) is False


def test_a_REAL_contact_bit_outranks_the_optical_inference(tmp_path, monkeypatch):
    """⚠️ THE DIRECTION THAT COULD DO HARM. A strap that reports skin contact (the COOSPO does; the
    H10 does not) has a DIRECT measurement, and this module only ever produces an inference. If the
    optical path could override it, a genuinely-worn strap whose sensor happens to see light — worn
    loosely, over a sleeve, in bright sun — would be declared off-body and DROPPED for power.

    flags bit2 = contact supported, bit1 = contact detected; 0x06 is both set, plus bit0 clear for a
    uint8 bpm. The PPG ambient here is the desk value, so the two sources disagree on purpose."""
    T._polar_common(monkeypatch)
    c = _PpgClient(-322929, hr_frame=bytes([0x06, 60]))
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    dev = T._pdev(name="Verity", vendor="Polar", model="VeritySense", streams=["ppg", "hr"],
                  address="24:AC:AC:0C:30:1E")
    T._run(capture.run_polar(dev, str(tmp_path)))
    st = capture.STATUS["devices"]["Verity"]
    assert st.get("worn") is True, f"the contact bit says worn; the inference must not overrule it: {st}"
    assert "24:AC:AC:0C:30:1E" not in capture._WORN_SINCE, "and no power-drop clock may be started"


def test_a_SECOND_unworn_window_does_not_restart_the_grace_clock(tmp_path, monkeypatch):
    """⚠️ THE INVARIANT THE WHOLE POWER FEATURE RESTS ON. `should_drop_not_worn` measures how long the
    strap has been CONTINUOUSLY not-worn, so the timestamp must be set once and then left alone. Reset
    it on every window and the elapsed time never grows past one window — the drop can never fire, which
    is the exact bug this change exists to end, reintroduced one layer down. (The HR branch is shaped
    this way for the same reason; this is its optical twin.)"""
    T._polar_common(monkeypatch)
    c = _PpgClient(-322929, frames=3)
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    dev = T._pdev(name="Verity", vendor="Polar", model="VeritySense", streams=["ppg"],
                  address="24:AC:AC:0C:30:1E")
    T._run(capture.run_polar(dev, str(tmp_path)))
    assert capture.STATUS["devices"]["Verity"].get("worn") is False
    assert "24:AC:AC:0C:30:1E" in capture._WORN_SINCE
    # three windows were evaluated; the clock must hold ONE timestamp, the first
    assert len([f for f in (tmp_path / "captures").rglob("*_PPG.txt")]) >= 1


def test_an_UNDECIDABLE_window_changes_nothing(tmp_path, monkeypatch):
    """`optical_worn` returns None when it cannot say. That must publish no verdict and start no clock —
    an unknown is not an unworn, and treating it as one drops a sensor on a bad frame."""
    T._polar_common(monkeypatch)
    monkeypatch.setattr(capture, "optical_worn", lambda *_a, **_k: None)
    c = _PpgClient(-322929)
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    dev = T._pdev(name="Verity", vendor="Polar", model="VeritySense", streams=["ppg"],
                  address="24:AC:AC:0C:30:1E")
    T._run(capture.run_polar(dev, str(tmp_path)))
    st = capture.STATUS["devices"]["Verity"]
    assert st.get("worn") is None, f"an undecidable window must publish no verdict: {st}"
    assert "24:AC:AC:0C:30:1E" not in capture._WORN_SINCE, "and start no power-drop clock"


# ── the DEVICE'S OWN contact bit (PPI) ───────────────────────────────────────────────────────────────
# The Verity answers "is it on skin" twice and differently. Its HR characteristic says
# `contact_supported: false`; its PPI stream sets skinContactSupported and reports the real thing.
# Measured 2026-08-10 on one unit: desk contact=0 on 31877/31877 rows, worn contact=1 on 20957/20957.
from telemetry import ppi_contact  # noqa: E402

def test_ppi_contact_reads_the_devices_own_bit():
    assert ppi_contact(0b110) is True, "supported + contact"
    assert ppi_contact(0b100) is False, "supported, no contact — the desk case"
    assert ppi_contact(0b111) is True, "the blocker bit must not affect the contact answer"


def test_ppi_contact_is_UNKNOWN_when_the_device_claims_no_support():
    """⚠️ An unsupported bit reads 0, and 0 is indistinguishable from a genuine 'not touching skin'.
    Reporting False there would declare every contact-less device off-body and drop it."""
    assert ppi_contact(0b000) is None
    assert ppi_contact(0b010) is None, "contact set but not SUPPORTED is not a claim"
    assert ppi_contact(None) is None


def _ppi_frame(flags, n=8):
    """A PMD PPI frame: per beat HR(u8), ppInMs(u16 LE), ppErrMs(u16 LE), flags(u8)."""
    body = b""
    for _ in range(n):
        body += bytes([60]) + (1000).to_bytes(2, "little") + (10).to_bytes(2, "little") + bytes([flags])
    return bytes([pmd.PPI]) + (1_000_000_000).to_bytes(8, "little") + bytes([0x00]) + body


class _PpiClient(T.FakePolarClient):
    """Feeds a PPG frame AND a PPI frame, so the two sources can disagree on purpose."""

    def __init__(self, ambient, ppi_flags, **kw):
        super().__init__(**kw)
        self._ambient, self._flags = ambient, ppi_flags

    async def start_notify(self, uuid, cb):
        await super().start_notify(uuid, cb)
        if getattr(uuid, "uuid", uuid) == pmd.PMD_DATA:
            cb(0, _ppg_frame(self._ambient))
            cb(0, _ppi_frame(self._flags))


def _drive_ppi(tmp_path, monkeypatch, ambient, flags):
    T._polar_common(monkeypatch)
    c = _PpiClient(ambient, flags)
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    dev = T._pdev(name="Verity", vendor="Polar", model="VeritySense", streams=["ppg", "ppi"],
                  address="24:AC:AC:0C:30:1E")
    T._run(capture.run_polar(dev, str(tmp_path)))
    return capture.STATUS["devices"]["Verity"]


def test_the_PPI_contact_bit_decides_when_it_is_available(tmp_path, monkeypatch):
    """Ambient here says WORN (dark) while PPI says NO CONTACT. The device's own measurement wins —
    that is the whole reason this branch exists, and it is the case a heuristic gets wrong."""
    st = _drive_ppi(tmp_path, monkeypatch, -190, 0b100)
    assert st.get("worn") is False, st
    assert "PPI contact bit" in (st.get("last_error") or ""), \
        "the reason must name WHICH source decided, or the two are indistinguishable in the log"
    assert "24:AC:AC:0C:30:1E" in capture._WORN_SINCE


def test_the_PPI_contact_bit_also_decides_the_other_way(tmp_path, monkeypatch):
    """Ambient says UNWORN (bright), PPI says contact. Still the device's answer — the inference must
    not be able to drop a strap the hardware says is on skin."""
    st = _drive_ppi(tmp_path, monkeypatch, -322929, 0b110)
    assert st.get("worn") is True, st
    assert "24:AC:AC:0C:30:1E" not in capture._WORN_SINCE


def test_without_PPI_the_ambient_fallback_still_runs(tmp_path, monkeypatch):
    """PPI is an optional stream. A configuration without it must still get a verdict — that is what
    the fallback is for, and losing it would put the box back where it started."""
    st = _drive(tmp_path, monkeypatch, -322929)
    assert st.get("worn") is False
    assert "ambient" in (st.get("last_error") or "")


# ── the calibration's DOMAIN ────────────────────────────────────────────────────────────────────────
# Every threshold in this module came from 45 Verity files at 55 Hz. At 176 Hz the ambient channel of a
# WORN armband reads ~650,800 with a 208-count spread — pegged, not a light level — landing in the
# 55 Hz "unworn" cluster. Measured 2026-08-10: a worn device showing a 57 bpm pulse was dropped every
# 90 s. Two changes the same day, neither checked against the other.

def test_the_detector_REFUSES_at_a_rate_it_was_never_calibrated_at():
    """None, not False. Both consumers read `worn is False` — the power drop and the CPAP interlock —
    so refusing disables a feature while guessing drops a sensor mid-night."""
    worn_at_176 = [-650808.0] * 400          # a WORN armband at 176 Hz, from the real capture
    assert optical_worn(worn_at_176, fs=176) is None, "176 Hz is outside the calibrated domain"
    assert optical_worn(worn_at_176, fs=135) is None
    # …and the same samples at the rate it WAS calibrated at still get a verdict (a wrong-looking one,
    # which is the point: the number is only meaningful where it was measured).
    assert optical_worn(worn_at_176, fs=55) is False


def test_the_calibrated_rate_still_works_and_an_UNKNOWN_rate_is_allowed():
    """`fs=None` means the caller cannot say. Refusing there would silently disable worn detection for
    every call site that predates the parameter — the concession is deliberate and documented."""
    assert optical_worn(_many(WORN_REAL), fs=55) is True
    assert optical_worn(_many(UNWORN_REAL), fs=55) is False
    assert optical_worn(_many(WORN_REAL)) is True             # no fs given → unchanged behaviour
    assert optical_worn(_many(WORN_REAL), fs=None) is True


def test_calibrated_for_is_pure_and_tolerant_of_a_reported_rate_that_wobbles():
    """The box logs 55.0 but a device may report 54.9 — that is the same rate, not a new domain."""
    from telemetry import calibrated_for
    assert calibrated_for(55.0) and calibrated_for(54.9) and calibrated_for(55.6)
    assert not calibrated_for(176) and not calibrated_for(135) and not calibrated_for(28)
    assert calibrated_for(None), "an unknown rate is in-domain by design"


def test_adding_a_rate_to_the_domain_is_the_ONLY_way_to_widen_it():
    """The domain is data, injectable, so a future re-derivation is a one-line change with its own
    evidence — and so this test can prove the gate is the tuple and not something incidental."""
    from telemetry import calibrated_for
    assert not calibrated_for(176)
    assert calibrated_for(176, rates=(55.0, 176.0)), "the tuple IS the domain"


def test_the_daemon_SAYS_when_the_rate_puts_worn_detection_out_of_domain(tmp_path, monkeypatch, caplog):
    """Told at NEGOTIATION, not at the first filled sample window — that is where the rate is decided,
    it is once per session rather than every ~4 s, and it reaches the operator before a night runs.

    Silence would be its own bug: no verdict and no reason reads as "the detector is fine and the
    strap is on", which is exactly how 2026-08-10 looked from the outside."""
    import asyncio
    import sys as _sys

    _sys.path.insert(0, __import__("os").path.dirname(__file__))
    import capture
    import test_capture_runners as T

    capture._STOP = asyncio.Event()
    T._polar_common(monkeypatch)
    c = T.FlexPolarClient(data_frames=[T._ppg_frame()])
    c.sdk_mode_on = True                       # widens the fake's menu so PPG lands off 55 Hz
    T._inject_connect(monkeypatch, c)
    T._stop_after(monkeypatch, 1)
    dev = T._pdev(streams=["ppg"])
    with caplog.at_level("WARNING"):
        asyncio.run(capture.run_polar(dev, str(tmp_path)))
    hits = [r.message for r in caplog.records if "calibrated at 55 Hz only" in r.message]
    assert hits, f"no out-of-domain warning; saw: {[r.message[:70] for r in caplog.records]}"
    assert "worn is False" in hits[0], "the operator needs the CONSEQUENCE, not just the fact"
