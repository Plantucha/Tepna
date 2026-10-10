# tepna-capture — tests/test_host_clock_chrony_sources.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The chrony "this box against every clock it can see" readers (VIGIL-GPS-STRATUM1-2026-10-10).
# Fixtures are verbatim (LAN hosts anonymised to RFC 5737 documentation addresses; columns and values untouched) `chronyc -n` output from vigil on 2026-10-10 21:30 UTC, thirty minutes after its
# own PPS became the selected source — a refclock row, a falseticker, unreachable servers, ns/us/ms cells.
import asyncio
import pytest
import host_clock as hc

SOURCES = """MS Name/IP address         Stratum Poll Reach LastRx Last sample
===============================================================================
#? GPS                           0   4   377    22   +136ms[ +136ms] +/-  200ms
#* PPS                           0   4   377    23  +3645ns[+4655ns] +/- 5981ns
^x 192.0.2.75                    1   7   377    20   -172us[ -171us] +/-  327us
^? 192.0.2.123                   1   8   377   218   -151us[ -152us] +/- 1260us
^? 129.6.15.28                   1   8   377   215   +200us[ +199us] +/-   19ms
=+ 10.0.0.9                      2   6   177   23m   -1.5ms[ -1.4ms] +/-   12ms
"""
SOURCESTATS = """Name/IP Address            NP  NR  Span  Frequency  Freq Skew  Offset  Std Dev
==============================================================================
GPS                        27  13   414     +4.078     19.520   +139ms  3395us
PPS                        14   9   205     +0.002      0.151    +24ns  7697ns
192.0.2.75                 21  16   23m     +0.018      0.021   -259us  9901ns
192.0.2.123                24  15   27m     +0.032      0.014   -191us  9241ns
"""
TRACKING = """Reference ID    : 50505300 (PPS)
Stratum         : 1
Ref time (UTC)  : Sat Oct 10 21:30:51 2026
System time     : 0.000001451 seconds fast of NTP time
Last offset     : +0.000001089 seconds
RMS offset      : 0.000026799 seconds
Frequency       : 4.183 ppm fast
Residual freq   : +0.002 ppm
Skew            : 0.161 ppm
Root delay      : 0.000000001 seconds
Root dispersion : 0.000036824 seconds
Update interval : 16.0 seconds
Leap status     : Normal
"""


@pytest.mark.parametrize(
    "text,expected",
    [
        ("+3645ns", 3.645e-6),
        ("-172us", -172e-6),
        ("+136ms", 0.136),
        ("2s", 2.0),
        (" 24ns ", 24e-9),
    ],
)
def test_qty_normalises_every_chrony_unit_to_seconds(text, expected):
    assert hc._qty_s(text) == pytest.approx(expected)


@pytest.mark.parametrize("text", ["", None, "junk", "12", "+1.5 ms", "ms"])
def test_qty_refuses_what_is_not_a_quantity(text):
    assert hc._qty_s(text) is None


def test_sources_parse_every_row_and_skip_the_header():
    rows = hc.parse_chrony_sources(SOURCES)
    assert [r["name"] for r in rows] == ["GPS", "PPS", "192.0.2.75", "192.0.2.123", "129.6.15.28", "10.0.0.9"]
    pps = rows[1]
    assert pps["mode"] == "refclock" and pps["state"] == "selected" and pps["stratum"] == 0
    assert pps["poll"] == 4 and pps["reach"] == 0o377 and pps["last_rx"] == "23"
    assert pps["offset_s"] == pytest.approx(3.645e-6) and pps["adjusted_offset_s"] == pytest.approx(4.655e-6)
    assert pps["error_s"] == pytest.approx(5.981e-6)


def test_sources_spell_out_every_mode_and_state_glyph():
    rows = {r["name"]: r for r in hc.parse_chrony_sources(SOURCES)}
    assert rows["GPS"]["state"] == "unreachable" and rows["GPS"]["mode"] == "refclock"
    assert rows["192.0.2.75"]["state"] == "falseticker" and rows["192.0.2.75"]["mode"] == "server"
    assert rows["10.0.0.9"]["mode"] == "peer" and rows["10.0.0.9"]["state"] == "combined"
    assert rows["10.0.0.9"]["last_rx"] == "23m" and rows["10.0.0.9"]["offset_s"] == pytest.approx(-1.5e-3)


def test_sources_reach_is_octal_as_chrony_prints_it():
    rows = hc.parse_chrony_sources(SOURCES)
    assert rows[-1]["reach"] == 0o177 == 127


def test_sources_is_empty_for_junk():
    assert hc.parse_chrony_sources("") == []
    assert hc.parse_chrony_sources("not a table\n^* nope\n") == []


def test_sourcestats_parse_by_name():
    st = hc.parse_chrony_sourcestats(SOURCESTATS)
    assert set(st) == {"GPS", "PPS", "192.0.2.75", "192.0.2.123"}
    assert st["PPS"] == {
        "np": 14,
        "nr": 9,
        "span": "205",
        "freq_ppm": 0.002,
        "freq_skew_ppm": 0.151,
        "offset_s": pytest.approx(24e-9),
        "stddev_s": pytest.approx(7.697e-6),
    }
    assert st["192.0.2.75"]["span"] == "23m" and st["GPS"]["stddev_s"] == pytest.approx(3.395e-3)


def test_sourcestats_is_empty_for_junk():
    assert hc.parse_chrony_sourcestats("") == {}
    assert hc.parse_chrony_sourcestats("Name NP\n====\n") == {}


@pytest.mark.parametrize(
    "line,expected",
    [
        ("System time     : 0.000001451 seconds fast of NTP time", 1.451e-6),
        ("System time     : 0.000076583 seconds slow of NTP time", -76.583e-6),
    ],
)
def test_system_offset_sign_follows_fast_or_slow(line, expected):
    assert hc.parse_chrony_system_offset(line) == pytest.approx(expected)


def test_system_offset_is_none_when_absent():
    assert hc.parse_chrony_system_offset("") is None
    assert hc.parse_chrony_system_offset("Stratum : 1\n") is None


def _go(coro):
    return asyncio.run(coro)


def _stub_run(monkeypatch, answers):
    """answers: {('chronyc','-n','sources'): (rc, text), ...}; anything else → (127, '')."""

    async def fake_run(*args, timeout=4.0):
        return answers.get(tuple(args), (127, ""))

    monkeypatch.setattr(hc, "_run", fake_run)


def test_read_sources_joins_stats_and_tracking(monkeypatch):
    _stub_run(
        monkeypatch,
        {
            ("chronyc", "-n", "sources"): (0, SOURCES),
            ("chronyc", "-n", "sourcestats"): (0, SOURCESTATS),
            ("chronyc", "-n", "tracking"): (0, TRACKING),
        },
    )
    r = _go(hc.read_sources())
    assert r["available"] is True
    by = {s["name"]: s for s in r["sources"]}
    assert by["PPS"]["stddev_s"] == pytest.approx(7.697e-6) and by["PPS"]["span"] == "205"
    assert by["129.6.15.28"]["stddev_s"] is None and by["129.6.15.28"]["span"] is None  # no stats row: absent, not 0
    t = r["tracking"]
    assert t["reference"] == "PPS" and t["host_stratum"] == 1
    assert t["system_offset_s"] == pytest.approx(1.451e-6) and t["rms_offset_us"] == pytest.approx(26.8)
    assert t["root_dispersion_ms"] == pytest.approx(0.0368) and t["skew_ppm"] == pytest.approx(0.161)


def test_read_sources_without_chronyc_says_unavailable(monkeypatch):
    _stub_run(monkeypatch, {})
    assert _go(hc.read_sources()) == {"available": False, "sources": [], "tracking": {}}


def test_read_sources_survives_missing_stats_and_tracking(monkeypatch):
    _stub_run(monkeypatch, {("chronyc", "-n", "sources"): (0, SOURCES)})
    r = _go(hc.read_sources())
    assert r["available"] is True and len(r["sources"]) == 6
    assert all(s["stddev_s"] is None for s in r["sources"]) and r["tracking"] == {}
