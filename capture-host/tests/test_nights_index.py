# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""nights_index — the per-night, per-analyzer index behind the monitor's Ledger and Capture pages.
Built on a synthetic captures tree with the box's real file layouts: ISO-stamped Polar streams, the
O2Ring's DMY `_SPO2.csv`, an EDF whose header states its span, and the two CPAP trees keyed by date."""
import os


import nights_index as ni

ISO_ROWS = "Phone timestamp;sensor timestamp [ns];v\n" + "\n".join(
    f"2026-09-19T22:00:{s:02d}.000;{s};{s}" for s in range(0, 40)) + "\n"


def _w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def _edf(path, records=120, dur_s=30.0):
    hdr = bytearray(b" " * 256)
    hdr[236:244] = f"{records:<8d}".encode()
    hdr[244:252] = f"{dur_s:<8g}".encode()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(bytes(hdr))


def _night(root, night="2026-09-19", *, h10=True, verity=True, ring=True, cpap=True):
    d = os.path.join(root, "captures", night)
    os.makedirs(d, exist_ok=True)
    if h10:
        for s in ("ECG", "ACC", "HR", "RR"):
            _w(os.path.join(d, f"Polar_H10_02849638_20260919220000_{s}.txt"), ISO_ROWS)
    if verity:
        for s in ("PPG", "PPI", "ACC"):
            _w(os.path.join(d, f"Polar_VeritySense_0C301E3F_20260919220000_{s}.txt"), ISO_ROWS)
    if ring:
        _w(os.path.join(d, "Wellue_O2Ring-S_S8AW2100_20260919220000_SPO2.csv"),
           "Time,Oxygen Level,Pulse Rate,Motion\n22:45:27 19/09/2026,91,65,0\n05:45:27 20/09/2026,97,58,0\n")
        _w(os.path.join(d, "Wellue_O2Ring-S_S8AW2100_20260919220000_PPG.txt"), ISO_ROWS)
    if cpap:
        _edf(os.path.join(root, "captures", "cpap-ble", "DATALOG", night.replace("-", ""), "20260919_220000_BRP.edf"))
    return d


# ── stamps ───────────────────────────────────────────────────────────────────────────────────────
def test_parse_stamp_reads_iso_and_the_o2ring_dmy_layout_and_refuses_the_rest():
    assert ni.parse_stamp("2026-09-19T22:45:27.953;;1") .isoformat() == "2026-09-19T22:45:27"
    assert ni.parse_stamp("22:45:27 19/09/2026,91,65,0").isoformat() == "2026-09-19T22:45:27"
    assert ni.parse_stamp("Time,Oxygen Level") is None
    assert ni.parse_stamp("22:45:27 99/99/2026,91") is None, "an impossible calendar date is not a stamp"


def test_span_hours_reads_only_head_and_tail_and_nulls_what_it_cannot_read(tmp_path):
    p = str(tmp_path / "s.txt")
    _w(p, ISO_ROWS)
    assert ni.span_hours(p) == round(39 / 3600, 2)
    _w(str(tmp_path / "hdr.txt"), "Phone timestamp;x\n")
    assert ni.span_hours(str(tmp_path / "hdr.txt")) is None, "header-only → no span, not 0"
    _w(str(tmp_path / "one.txt"), "2026-09-19T22:00:00.000;1\n")
    assert ni.span_hours(str(tmp_path / "one.txt")) is None, "one stamp → no positive span"
    _w(str(tmp_path / "o2.csv"), "Time,x\n22:45:27 19/09/2026,1\n05:45:27 20/09/2026,1\n")
    assert ni.span_hours(str(tmp_path / "o2.csv")) == 7.0
    assert ni.span_hours(str(tmp_path / "absent.txt")) is None
    # a head stamp with a tail that carries none within the window it reads: no span, not a guess
    _w(str(tmp_path / "tailless.txt"), "2026-09-19T22:00:00.000;1\n" + "not a stamp\n" * 600)
    assert ni.span_hours(str(tmp_path / "tailless.txt")) is None
    # twenty unstamped lines then a stamp: the head window is bounded, so this reads as unstamped
    _w(str(tmp_path / "late.txt"), "x\n" * 25 + "2026-09-19T22:00:00.000;1\n2026-09-19T23:00:00.000;1\n")
    assert ni.span_hours(str(tmp_path / "late.txt")) is None


def test_edf_hours_is_records_times_duration_from_the_header(tmp_path):
    p = str(tmp_path / "a.edf")
    _edf(p, records=840, dur_s=30.0)
    assert ni.edf_hours(p) == 7.0
    _edf(str(tmp_path / "z.edf"), records=0)
    assert ni.edf_hours(str(tmp_path / "z.edf")) is None
    _w(str(tmp_path / "bad.edf"), "not an edf")
    assert ni.edf_hours(str(tmp_path / "bad.edf")) is None
    assert ni.edf_hours(str(tmp_path / "missing.edf")) is None


# ── the entry ────────────────────────────────────────────────────────────────────────────────────
def test_a_full_trio_night_fills_every_column_from_its_own_files(tmp_path):
    root = str(tmp_path)
    d = _night(root)
    e = ni.night_entry(os.path.join(root, "captures"), d)
    assert e["night"] == "2026-09-19"
    assert e["ECGDex"]["files"] == [f"2026-09-19/Polar_H10_02849638_20260919220000_{s}.txt" for s in ("ACC", "ECG", "HR", "RR")]
    assert e["ECGDex"]["bytes"] == 4 * len(ISO_ROWS.encode()) and e["ECGDex"]["hours"] == 0.01
    assert e["OxyDex"]["hours"] == 7.0 and e["OxyDex"]["files"] == ["2026-09-19/Wellue_O2Ring-S_S8AW2100_20260919220000_SPO2.csv"]
    assert e["CPAPDex"]["hours"] == 1.0 and e["CPAPDex"]["files"] == ["cpap-ble/DATALOG/20260919/20260919_220000_BRP.edf"]
    assert e["GlucoDex"] is None and e["EEGDex"] is None, "no CGM, no Muse: absent, never 0"
    assert e["Integrator"]["loadable"] is False and e["ECGDex"]["loadable"] is True
    assert e["3 corner hat"] is True and e["PAT"] is True
    assert set(e) == {"night", *ni.COLUMNS}


def test_a_night_without_the_h10_loses_its_ecg_columns_and_the_derived_tools(tmp_path):
    root = str(tmp_path)
    d = _night(root, h10=False)
    e = ni.night_entry(os.path.join(root, "captures"), d)
    assert e["ECGDex"] is None
    # HRVDex still has the Verity's PPI, but its PRIMARY (the H10 RR) is gone: bytes stay, hours is None
    assert e["HRVDex"]["files"] == ["2026-09-19/Polar_VeritySense_0C301E3F_20260919220000_PPI.txt"] and e["HRVDex"]["hours"] is None
    assert e["PulseDex"]["files"] == ["2026-09-19/Polar_VeritySense_0C301E3F_20260919220000_PPI.txt"]
    assert e["MotionDex"]["hours"] == 0.01
    assert e["3 corner hat"] is False and e["PAT"] is False


def test_a_stream_present_but_unstamped_keeps_its_bytes_and_reports_hours_None(tmp_path):
    root = str(tmp_path)
    d = _night(root, h10=False, verity=False, ring=False, cpap=False)
    _w(os.path.join(d, "Polar_H10_02849638_20260919220000_ECG.txt"), "Phone timestamp;x\n")
    e = ni.night_entry(os.path.join(root, "captures"), d)
    assert e["ECGDex"]["bytes"] > 0 and e["ECGDex"]["hours"] is None


# ── the index ────────────────────────────────────────────────────────────────────────────────────
def test_index_lists_only_night_directories_newest_last_and_honours_the_limit(tmp_path):
    root = str(tmp_path)
    for n in ("2026-09-17", "2026-09-18", "2026-09-19"):
        _night(root, n, cpap=False)
    os.makedirs(os.path.join(root, "captures", "stored"))
    _w(os.path.join(root, "captures", "status.json"), "{}")
    _w(os.path.join(root, "captures", "2026-09-99"), "a file, not a night")
    rows = ni.index_nights(root, limit=2)
    assert [r["night"] for r in rows] == ["2026-09-18", "2026-09-19"]
    assert [r["night"] for r in ni.index_nights(root, limit=0)] == ["2026-09-19"], "limit floors at 1"
    assert ni.index_nights(str(tmp_path / "nowhere")) == []
