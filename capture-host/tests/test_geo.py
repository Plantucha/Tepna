# tepna-capture — tests/test_geo.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""geo.py: elevation from an optional receiver, and the null that must never become a zero.

The assertions here are mostly about ABSENCE, because that is where this module earns its keep. A
wrong elevation does not degrade the analysis gracefully — OxyDex lowers the healthy SpO2 threshold
~1.8 %/1000 m, so a fabricated 0 m at real 2500 m invents ~4.5 % of desaturation. Every path that
cannot produce a measurement must therefore produce None, and each of those paths is pinned below.

Fixtures are REAL sentences captured from the QUESCAN UBX-M10050 on 2026-09-15 (fix quality 2, 12
sats, HDOP 0.62-0.88, 619.7 m MSL at 35.58 N / 82.57 W), not invented ones — a hand-written GGA can
agree with a hand-written parser about a format neither has seen.
"""
import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import geo  # noqa: E402

# Real sentences off the bench receiver, 2026-09-15.
GGA_GOOD = "$GNGGA,000002.00,3535.05074,N,08234.48866,W,2,12,0.62,619.7,M,-32.4,M,,0000*4F"
GGA_NOFIX = "$GNGGA,000002.00,,,,,0,00,99.99,,,,,,*56"
GGA_SPARSE = "$GNGGA,000002.00,3535.05074,N,08234.48866,W,1,03,0.90,619.7,M,-32.4,M,,0000*4A"
GGA_SCATTER = "$GNGGA,000002.00,3535.05074,N,08234.48866,W,1,09,7.40,619.7,M,-32.4,M,,0000*48"


def test_a_real_gga_yields_the_msl_altitude_not_the_ellipsoidal_one():
    """619.7 m MSL with a -32.4 m geoid separation. The SpO2 literature is keyed to MSL, so taking
    field 9 and not `field9 + field11` is a correctness claim, not a preference — the two differ by
    32 m here, which is ~0.06 % of SpO2 threshold and grows with the separation."""
    fx = geo.parse_gga(GGA_GOOD)
    assert fx["elevation_m"] == 619.7
    assert fx["quality"] == 2 and fx["sats"] == 12 and fx["hdop"] == 0.62
    assert round(fx["lat"], 4) == 35.5842 and round(fx["lon"], 4) == -82.5748


@pytest.mark.parametrize("line,why", [
    (GGA_NOFIX, "quality 0 — the receiver says it does not know"),
    ("$GNRMC,000002.00,A,3535.05,N,08234.48,W,,,150926,,,A,V*0E", "not a GGA at all"),
    ("$GNGGA,000002.00,3535.05074,N", "truncated mid-sentence"),
    ("", "empty line"),
    ("GNGGA,0,0,N,0,W,1,12,0.6,10,M,0,M,,*00", "no leading $ — not NMEA framing"),
    ("$GNGGA,000002.00,3535.05074,N,08234.48866,W,1,12,0.62,,M,-32.4,M,,0000*4F", "no altitude field"),
    ("$GNGGA,000002.00,3535.05074,N,08234.48866,W,6,12,0.62,619.7,M,-32.4,M,,*4F", "quality 6 = dead reckoning, an INFERENCE"),
    ("$GNGGA,000002.00,3535.05074,N,08234.48866,W,x,12,0.62,619.7,M,-32.4,M,,*4F", "unparseable quality"),
])
def test_every_unusable_sentence_is_None_never_a_number(line, why):
    assert geo.parse_gga(line) is None, why


def test_dead_reckoning_is_refused_because_it_is_inferred_not_measured():
    """🔴 Quality 6 is the subtle one. It carries a plausible altitude and a satellite count, so it
    looks like every other fix — but it is the receiver EXTRAPOLATING from its last real fix, which
    is a fabricated measurement in exactly the sense CLAUDE.md §∅ forbids."""
    dr = GGA_GOOD.replace(",W,2,12,", ",W,6,12,")
    assert geo.parse_gga(dr) is None


def test_a_weak_fix_is_discarded_rather_than_down_weighted():
    # 3 sats: geometry too thin for altitude, which is the weaker axis than the HDOP describes.
    assert geo.usable(geo.parse_gga(GGA_SPARSE)) is False
    # HDOP 7.4: a scatter fix.
    assert geo.usable(geo.parse_gga(GGA_SCATTER)) is False
    assert geo.usable(geo.parse_gga(GGA_GOOD)) is True
    assert geo.usable(None) is False


def test_usable_refuses_a_fix_with_fields_missing_rather_than_assuming_them():
    assert geo.usable({"elevation_m": 100.0, "sats": None, "hdop": 0.5}) is False
    assert geo.usable({"elevation_m": 100.0, "sats": 12, "hdop": None}) is False


def test_best_fix_takes_the_SHARPEST_not_the_LAST():
    """Last-seen would make the answer depend on where the read happened to stop. Lowest HDOP is a
    property of the data; read-stop position is a property of the clock."""
    sharp = GGA_GOOD                                   # hdop 0.62
    blunt = GGA_GOOD.replace(",0.62,", ",2.10,")       # hdop 2.10, still usable
    assert geo.best_fix([sharp, blunt])["hdop"] == 0.62
    assert geo.best_fix([blunt, sharp])["hdop"] == 0.62, "order must not decide it"
    assert geo.best_fix([GGA_NOFIX, GGA_SPARSE]) is None
    assert geo.best_fix([]) is None


def test_position_is_DROPPED_unless_explicitly_requested():
    """Privacy: the analysis needs altitude and has no use for coordinates. They are parsed either way
    (the altitude rides the same sentence) and then discarded, so `record_position` is a disclosure
    decision rather than a capability one — and the default must be the private one."""
    g = geo.session_geo([GGA_GOOD])
    assert g["elevation_m"] == 619.7 and g["source"] == "gnss"
    assert "lat" not in g and "lon" not in g, "coordinates must not appear by default"
    g2 = geo.session_geo([GGA_GOOD], record_position=True)
    assert round(g2["lat"], 4) == 35.5842 and round(g2["lon"], 4) == -82.5748


def test_session_geo_is_None_when_nothing_qualifies():
    assert geo.session_geo([GGA_NOFIX, "", "$GNVTG,,,,,,,,,N*2E"]) is None


# ── the OPTIONAL contract: a host with no receiver must be completely unaffected ────────────────
def test_absent_config_never_touches_a_device():
    """🔴 THE LOAD-BEARING TEST FOR A PUBLIC REPO. Almost nobody running Tepna has a GNSS wired to
    their capture host. Absent or disabled config must short-circuit before any import, any port
    open, and any log line — the reader is asserted NEVER CALLED, not merely tolerant."""
    def _never(*a, **k):
        raise AssertionError("a host without geo config must not read any device")
    assert geo.session_elevation(None, _reader=_never) is None
    assert geo.session_elevation({}, _reader=_never) is None
    assert geo.session_elevation({"geo": {}}, _reader=_never) is None
    assert geo.session_elevation({"geo": {"enabled": False, "port": "/dev/ttyUSB0"}}, _reader=_never) is None


def test_enabled_without_a_port_is_absent_not_a_guess(caplog):
    with caplog.at_level(logging.WARNING, logger="tepna-capture"):
        assert geo.session_elevation({"geo": {"enabled": True}}, _reader=lambda *a: []) is None
    assert any("no port configured" in r.getMessage() for r in caplog.records)


def test_enabled_with_no_fix_logs_that_it_is_absent_and_says_NOT_zero(caplog):
    with caplog.at_level(logging.INFO, logger="tepna-capture"):
        got = geo.session_elevation({"geo": {"enabled": True, "port": "/dev/ttyUSB0"}},
                                    _reader=lambda *a: [GGA_NOFIX])
    assert got is None
    msg = next(r.getMessage() for r in caplog.records if "no usable fix" in r.getMessage())
    assert "not 0 m" in msg, "the log must name the trap it is avoiding"


def test_enabled_with_a_good_fix_returns_the_measurement(caplog):
    with caplog.at_level(logging.INFO, logger="tepna-capture"):
        got = geo.session_elevation({"geo": {"enabled": True, "port": "/dev/ttyUSB0", "baud": 38400,
                                             "read_sec": 1}}, _reader=lambda *a: [GGA_GOOD])
    assert got["elevation_m"] == 619.7 and got["sats"] == 12
    assert any("elevation 619.7 m" in r.getMessage() for r in caplog.records)


# ── read_nmea: the only impure function, so every failure path is pinned ────────────────────────
class _FakeSerial:
    """Minimal pyserial stand-in. `lines` are returned then exhausted."""
    def __init__(self, lines=(), raises=None):
        self._lines = list(lines)
        self._raises = raises

    def Serial(self, port, baud, timeout=None):  # noqa: N802 — mirrors pyserial's class name
        if self._raises:
            raise self._raises
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def readline(self):
        return self._lines.pop(0).encode() if self._lines else b""


def test_read_nmea_collects_lines():
    got = geo.read_nmea("/dev/ttyUSB0", 38400, 0.2, _serial=_FakeSerial([GGA_GOOD, GGA_NOFIX]))
    assert GGA_GOOD in got


def test_a_missing_or_unreadable_device_yields_EMPTY_never_an_exception(caplog):
    """Fails open. A capture host must not lose a night because an optional receiver was unplugged,
    so every device-side failure converges on [] — which `session_geo` turns into an honest None."""
    for exc in (OSError("no such device"), PermissionError("denied"), ValueError("bad baud")):
        with caplog.at_level(logging.WARNING, logger="tepna-capture"):
            assert geo.read_nmea("/dev/nope", 38400, 0.2, _serial=_FakeSerial(raises=exc)) == []
    assert any("capture unaffected" in r.getMessage() for r in caplog.records)


def test_a_device_that_is_not_a_gnss_reads_as_absent_not_as_zero():
    """A CP2102 with something else behind it returns bytes that are not NMEA. The result must be the
    same None as no device at all — the failure mode of this module is a confident wrong number."""
    noise = geo.read_nmea("/dev/ttyUSB0", 38400, 0.2, _serial=_FakeSerial(["\x00garbage", "AT+OK"]))
    assert geo.session_geo(noise) is None


def test_a_corrupted_coordinate_field_yields_no_position_not_a_wrong_one():
    """A serial read can tear a sentence. The altitude may still be sound, so the fix is KEPT — but
    the coordinates must come back None rather than as a plausible wrong place. `record_position` is
    used here because that is the only mode in which a wrong coordinate could ever be written down."""
    # hemisphere blank / field truncated -> the length+hemisphere guard
    torn = "$GNGGA,000002.00,,,08234.48866,W,1,12,0.62,619.7,M,-32.4,M,,0000*4F"
    g = geo.session_geo([torn], record_position=True)
    assert g["elevation_m"] == 619.7, "a torn coordinate must not discard a sound altitude"
    assert g["lat"] is None and round(g["lon"], 4) == -82.5748

    # non-numeric digits that still pass the length check -> the float-parse guard
    garbled = "$GNGGA,000002.00,AAAA.AAAAA,N,08234.48866,W,1,12,0.62,619.7,M,-32.4,M,,0000*4F"
    g2 = geo.session_geo([garbled], record_position=True)
    assert g2["lat"] is None and g2["elevation_m"] == 619.7


def test_southern_and_eastern_hemispheres_are_signed_correctly():
    """Sign errors are the classic coordinate bug and they are silent — a wrong hemisphere is a
    plausible place on the other side of the planet, not a parse failure."""
    s = "$GNGGA,000002.00,3535.05074,S,08234.48866,E,1,12,0.62,10.0,M,0.0,M,,0000*4F"
    g = geo.session_geo([s], record_position=True)
    assert g["lat"] < 0 and g["lon"] > 0


def test_without_pyserial_the_reader_is_absent_not_broken(monkeypatch, caplog):
    """∅ A host with no pyserial is the COMMON case in a public repo — the module is optional and so
    is its dependency. Forced deterministically rather than relying on this venv, so the branch is
    covered whether or not the runner happens to have pyserial installed."""
    monkeypatch.setitem(sys.modules, "serial", None)  # makes `import serial` raise ImportError
    with caplog.at_level(logging.WARNING, logger="tepna-capture"):
        assert geo.read_nmea("/dev/ttyUSB0", 38400, 0.2) == []
    assert any("pyserial is not installed" in r.getMessage() for r in caplog.records)


def test_the_REAL_import_path_binds_when_pyserial_IS_present(monkeypatch):
    """The mirror of the no-pyserial test: on a host that HAS pyserial, `read_nmea` must bind the
    real module rather than fall through. Injected into `sys.modules` so the branch is covered on a
    runner without pyserial — which is this venv, and CI, since it is not a declared dependency.
    Without this the success path is unreachable everywhere and reads as covered only by absence."""
    monkeypatch.setitem(sys.modules, "serial", _FakeSerial([GGA_GOOD]))
    got = geo.read_nmea("/dev/ttyUSB0", 38400, 0.2)   # no _serial= : must go through `import serial`
    assert GGA_GOOD in got
    assert geo.session_geo(got)["elevation_m"] == 619.7
