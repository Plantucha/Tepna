# tepna-capture — tests/test_device_identity.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""One physical sensor, one identity — across a device_id correction.

`device_id` is interpolated into every capture filename AND is an editable config field. On
2026-07-26 the Verity's id was corrected from `AC0C301E` to `0C301E3F` at 06:51, and everything
recorded before that instantly stopped being attributable: nightqc saw 795 ACC rows for a device
that had written 85 MB across seven sessions, and reported the night as `ppg 0%, acc 0%, gyro 0%,
mag 0%`. Nothing was lost and nothing was logged — the files were simply invisible.

Two defects, fixed together because either alone leaves the split reachable:

  * the WRONG ID WAS DERIVED IN THE FIRST PLACE. The monitor pulled a device id out of the advertised
    name with `/(\\d{6,})/` — six or more consecutive DIGITS. `Polar H10 02849638` matches, so the H10
    was right by luck of an all-numeric serial. `Polar Sense 0C301E3F` is HEX, matches nothing, and
    fell through to a MAC-derived slice. Every hex-serial Polar was mis-identified from the moment it
    was bonded, and the "correction" that split this corpus was someone fixing it by hand.
  * files were matched with `device_id in filename`, a substring test with no notion of history.
    Exact-field matching plus an explicit `device_id_aliases` list makes a corrected id additive
    rather than destructive.
"""
import re

import nightqc
import writers


# ── the filename's id FIELD ───────────────────────────────────────────────────────────────────
def test_file_device_id_reads_the_field_before_the_stamp():
    assert writers.file_device_id("Polar_H10_02849638_20260726072555_ECG.txt") == "02849638"
    assert writers.file_device_id("Polar_VeritySense_AC0C301E_20260726045731_PPG.txt") == "AC0C301E"
    assert writers.file_device_id("Wellue_O2Ring-S_S8AW2100_20260726020105_PPG.txt") == "S8AW2100"


def test_file_device_id_is_not_a_substring_search():
    """A shorter serial inside a longer one must not match, and a model name is not an id."""
    n = "Polar_H10_02849638_20260726072555_ECG.txt"
    assert writers.file_device_id(n) != "2849638"
    assert writers.file_device_id("Tepna_20260726000006_LINK.csv") != "Tepna"


def test_file_device_id_rejects_a_non_capture_name():
    assert writers.file_device_id("QC-SUMMARY.json") is None
    assert writers.file_device_id("notes.txt") is None


# ── identity across a correction ──────────────────────────────────────────────────────────────
def test_device_ids_includes_the_aliases():
    dev = {"device_id": "0C301E3F", "device_id_aliases": ["AC0C301E"]}
    assert writers.device_ids(dev) == ("0C301E3F", "AC0C301E")


def test_device_ids_is_just_the_current_id_when_there_is_no_history():
    assert writers.device_ids({"device_id": "02849638"}) == ("02849638",)


def test_device_ids_ignores_blanks_and_duplicates():
    dev = {"device_id": "A1", "device_id_aliases": ["A1", "", None, " B2 "]}
    assert writers.device_ids(dev) == ("A1", "B2")


# ── the real regression, end to end ───────────────────────────────────────────────────────────
def _night(tmp_path, rows=1000):
    d = tmp_path / "2026-07-26"
    d.mkdir()
    hdr = "Phone timestamp;x\n"
    for name in ("Polar_VeritySense_AC0C301E_20260726041816_PPG.txt",
                 "Polar_VeritySense_0C301E3F_20260726084644_PPG.txt"):
        (d / name).write_text(hdr + "".join("2026-07-26T04:18:16.000;1\n" for _ in range(rows)))
    return str(d)


def test_nightqc_counts_files_written_under_a_previous_device_id(tmp_path):
    """THE regression. Both files are this one armband; QC must see both."""
    night = _night(tmp_path)
    dev = {"name": "Polar Verity Sense", "vendor": "Polar", "model": "VeritySense",
           "device_id": "0C301E3F", "device_id_aliases": ["AC0C301E"],
           "address": "24:AC:AC:0C:30:1E", "streams": ["ppg"]}
    got = nightqc.summarize(night, [dev])
    rows = next(d["streams"].get("ppg", 0) for d in got["devices"] if d["name"] == dev["name"])
    assert rows == 2000, f"expected both sessions (2000 rows), got {rows}"


def test_nightqc_without_the_alias_sees_only_the_current_id(tmp_path):
    """The control: this is exactly what the box was doing, and why the night read as near-empty."""
    night = _night(tmp_path)
    dev = {"name": "Polar Verity Sense", "vendor": "Polar", "model": "VeritySense",
           "device_id": "0C301E3F", "address": "24:AC:AC:0C:30:1E", "streams": ["ppg"]}
    got = nightqc.summarize(night, [dev])
    rows = next(d["streams"].get("ppg", 0) for d in got["devices"] if d["name"] == dev["name"])
    assert rows == 1000, "without an alias only the current id is attributable — by design"


def test_nightqc_does_not_cross_match_a_substring_device_id(tmp_path):
    """`did in filename` let a shorter serial claim a longer one's files."""
    d = tmp_path / "2026-07-26"
    d.mkdir()
    (d / "Polar_H10_02849638_20260726072555_ECG.txt").write_text("h\n" + "x\n" * 500)
    dev = {"name": "Other", "vendor": "Polar", "model": "H10", "device_id": "2849638",
           "address": "AA", "streams": ["ecg"]}
    got = nightqc.summarize(night_dir=str(d), devices=[dev])
    rows = next(x["streams"].get("ecg", 0) for x in got["devices"] if x["name"] == "Other")
    assert rows == 0, "'2849638' must not claim the file belonging to '02849638'"


# ── the root cause: the id pulled out of the advertised name ──────────────────────────────────
def _name_regex():
    """The regex the SHIPPED monitor uses, extracted from monitor.html rather than re-typed — a
    re-typed copy would only prove the test agrees with itself."""
    html = open(__file__.replace("tests/test_device_identity.py", "monitor.html"),
                encoding="utf-8").read()
    line = next((ln for ln in html.splitlines() if "device_id = m[1]" in ln), None)
    assert line, "could not find the device-id extraction line in monitor.html"
    m = re.search(r"\.match\(/(.+?)/\s*\)", line)
    assert m, f"could not read the pattern out of: {line.strip()}"
    return re.compile(m.group(1))


def test_a_hex_polar_serial_is_extracted_from_the_advertised_name():
    """THE root cause. `Polar Sense 0C301E3F` has no run of six digits, so the digits-only pattern
    fell through to a MAC slice and the armband was bonded under the wrong identity."""
    m = _name_regex().search("Polar Sense 0C301E3F")
    assert m and m.group(1) == "0C301E3F", f"got {m.group(1) if m else None!r}"


def test_the_numeric_serial_that_already_worked_still_works():
    """The H10 was right by luck; it must stay right."""
    m = _name_regex().search("Polar H10 02849638")
    assert m and m.group(1) == "02849638"
    m2 = _name_regex().search("COOSPO 808S 0022265")
    assert m2 and m2.group(1) == "0022265"


def test_a_name_with_no_serial_yields_no_match():
    """No serial must leave the MAC fallback in charge rather than inventing one."""
    assert not _name_regex().search("Polar Verity Sense")
