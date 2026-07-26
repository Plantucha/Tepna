"""Tests for cpap_harvest — CPAP-AUTOHARVEST-2026-07-26-BRIEF.

The pure functions carry every decision that can silently corrupt a night, so they are what is tested:
listing parse (metadata/anchor alignment), STR.edf casing, skip-if-present, short-read detection, the
daily window, and the streaming interlock. Real card fixtures, captured 2026-07-26.
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cpap_harvest as ch  # noqa: E402

# Verbatim from the real card (night 20260725). The leading spaces and the split date/time formatting
# are exactly as served — they are the reason a naive parser mis-aligns.
NIGHT_HTML = """
   2026- 7-25   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CDATALOG%5C20260725"> .</a>
   2026- 7-25   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CDATALOG"> ..</a>
   2026- 7-26    3:50:50           1KB  <a href="http://192.168.4.1/download?file=D%5C202607~1.EDF"> 20260725_225050_CSL.edf</a>
   2026- 7-26    6:42:26           2KB  <a href="http://192.168.4.1/download?file=D%5C202607~2.EDF"> 20260725_225050_EVE.edf</a>
   2026- 7-26   10:10:56         204KB  <a href="http://192.168.4.1/download?file=D%5C202607~3.EDF"> 20260725_225058_PLD.edf</a>
   2026- 7-26   10:10:58          91KB  <a href="http://192.168.4.1/download?file=D%5C202607~4.EDF"> 20260725_225058_SA2.edf</a>
   2026- 7-26   10:10:58        2229KB  <a href="http://192.168.4.1/download?file=D%5C202607~5.EDF"> 20260725_225058_BRP.edf</a>
   Total Entries: 7 Total Size: 2527KB
"""

ROOT_HTML = """
   2026- 7-26    3:50:50           1KB  <a href="http://192.168.4.1/download?file=JOURNAL.JNL"> JOURNAL.JNL</a>
   2026- 7-26   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CDATALOG"> DATALOG</a>
   2026- 7-26   17: 0: 0         &lt;DIR&gt;   <a href="dir?dir=A:%5CSETTINGS"> SETTINGS</a>
   2026- 7-26    6:42:26         105KB  <a href="http://192.168.4.1/download?file=STR.EDF"> STR.EDF</a>
   2026- 7-26    6:42:26           1KB  <a href="http://192.168.4.1/download?file=EZSHARE.CFG"> ezshare.cfg</a>
"""


def test_parse_aligns_metadata_with_the_right_file():
    """The bug this guards: metadata PRECEDES the anchor, so anchor-first parsing shifts every row by
    one. It looks plausible and is wrong — during Phase 0 it attributed a 91KB size to the 2229KB BRP
    file and produced a bogus throughput figure."""
    rows = ch.parse_listing(NIGHT_HTML)
    assert len(rows) == 5, [r["name"] for r in rows]          # . / .. dropped, footer not a file
    by = {r["name"]: r for r in rows}
    assert by["20260725_225050_CSL.edf"]["size"] == "1KB"
    assert by["20260725_225050_CSL.edf"]["mtime"] == "2026-7-26 3:50:50"
    assert by["20260725_225058_BRP.edf"]["size"] == "2229KB"   # the big one, correctly attributed
    assert by["20260725_225058_SA2.edf"]["size"] == "91KB"
    assert all(not r["isdir"] for r in rows)


def test_footer_is_not_mistaken_for_a_file():
    assert not any("Total" in r["name"] for r in ch.parse_listing(NIGHT_HTML))


def test_ignore_list_applied_and_dirs_flagged():
    rows = ch.parse_listing(ROOT_HTML)
    names = {r["name"] for r in rows}
    assert "JOURNAL.JNL" not in names and "ezshare.cfg" not in names   # device noise + card credentials
    assert {"DATALOG", "SETTINGS", "STR.EDF"} <= names
    assert {r["name"] for r in rows if r["isdir"]} == {"DATALOG", "SETTINGS"}


def test_str_edf_is_lowercased_and_nothing_else_is():
    """OSCAR and the resmed-edf adapter expect STR.edf. On a case-sensitive filesystem the served
    uppercase form yields a night with session EDFs and NO summary — partial data, not an obvious bug."""
    assert ch.local_name("STR.EDF") == "STR.edf"
    assert ch.local_name("STR.edf") == "STR.edf"
    assert ch.local_name("20260725_225058_BRP.edf") == "20260725_225058_BRP.edf"
    assert ch.local_name("Identification.json") == "Identification.json"


def test_size_kb_units():
    assert ch.size_kb("2229KB") == 2229
    assert ch.size_kb("1.5MB") == 1536
    assert ch.size_kb("832B") == 832 / 1024
    assert ch.size_kb("") == 0.0


def test_should_fetch_skips_present_refetches_wrong_size(tmp_path):
    e = {"name": "x.edf", "size": "100KB"}
    p = tmp_path / "x.edf"
    assert ch.should_fetch(e, str(p))                          # absent
    p.write_bytes(b"\0" * 100 * 1024)
    assert not ch.should_fetch(e, str(p))                      # right size -> skip (steady state is free)
    p.write_bytes(b"\0" * 40 * 1024)
    assert ch.should_fetch(e, str(p))                          # truncated on disk -> re-fetch, not trust


def test_short_read_detected():
    """A card that truncates under load writes an EDF that parses far enough to look real — the same
    class of failure as the part-decoded PMD frame in VIGIL-HARDENING-III §1."""
    e = {"name": "b.edf", "size": "2229KB"}
    assert ch.short_read(e, 1000 * 1024)
    assert not ch.short_read(e, 2229 * 1024)
    assert not ch.short_read(e, 2200 * 1024)                   # rounding tolerance
    assert not ch.short_read({"name": "x", "size": ""}, 5)      # unknown size never claims a short read


def test_due_now_fires_once_per_day_after_the_hour():
    d = dt.date(2026, 7, 26)
    before = dt.datetime(2026, 7, 26, 12, 59)
    at = dt.datetime(2026, 7, 26, 13, 0)
    later = dt.datetime(2026, 7, 26, 23, 59)
    assert not ch.due_now(before, 13, None)                    # too early
    assert ch.due_now(at, 13, None)                            # due
    assert ch.due_now(later, 13, None)                         # a late boot still catches the day
    assert not ch.due_now(later, 13, d)                        # already ran today
    assert ch.due_now(dt.datetime(2026, 7, 27, 13, 0), 13, d)  # next day fires again


def test_nine_am_would_have_missed_the_waveform():
    """Regression guard on the schedule decision itself. Real mtimes from 20260725: the flow waveform
    (BRP) was written at 10:10. Anything scheduled before that hour is wrong for this machine."""
    rows = {r["name"]: r["mtime"] for r in ch.parse_listing(NIGHT_HTML)}
    brp_hour = int(rows["20260725_225058_BRP.edf"].split()[1].split(":")[0])
    assert brp_hour == 10
    assert brp_hour > 9, "09:00 would have missed BRP.edf — see brief §3.2"


def test_any_connected_device_blocks_the_harvest():
    devs = {"Polar H10": {"connected": True}, "O2Ring": {"connected": False}, "COOSPO": {}}
    assert ch.blocking_devices(devs) == ["Polar H10"]
    assert ch.blocking_devices({"a": {"connected": False}}) == []
    assert ch.blocking_devices({}) == []
    assert ch.blocking_devices(None) == []


def test_is_night_dir():
    assert ch.is_night_dir({"isdir": True, "name": "20260725"})
    assert not ch.is_night_dir({"isdir": True, "name": "SETTINGS"})
    assert not ch.is_night_dir({"isdir": False, "name": "20260725"})
