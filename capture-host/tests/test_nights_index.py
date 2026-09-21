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


# ── FRAGMENTS + COVERAGE ───────────────────────────────────────────────────────────────────────────

def _stream(path, segments, step=1.0, start="2026-09-20T22:00:00"):
    """ISO rows at `step` s within each (offset_s, seconds) segment — the holes between segments are gaps."""
    import datetime as dt
    t0 = dt.datetime.fromisoformat(start)
    lines = ["Phone timestamp;x"]
    for off, secs in segments:
        t = 0.0
        while t < secs:
            lines.append((t0 + dt.timedelta(seconds=off + t)).isoformat(timespec="milliseconds") + ";1")
            t += step
    path.write_text("\n".join(lines) + "\n")


def test_stream_stats_counts_the_holes_a_span_cannot_see(tmp_path):
    """2026-09-20 and 2026-09-17 both spanned 6.1 h; the 09-20 H10 held 41 % of it in 154 fragments."""
    p = tmp_path / "s.txt"
    _stream(p, [(0, 100), (150, 100)])            # 100 s, a 50 s hole, 100 s → span 249 s
    st = ni.stream_stats(str(p))
    assert st["fragments"] == 2 and abs(st["coverage"] - (1 - 50 / 249)) < 0.01 and st["gap_s"] == 5.0
    assert ni.stream_stats(str(p), gap_s=60.0)["fragments"] == 1        # an explicit cut is honoured as given


def test_the_gap_threshold_follows_the_stream_s_own_cadence(tmp_path):
    """Verity PPI arrives in ~5 s batches sharing one stamp; a fixed 2 s cut read a whole night as 4 434
    fragments at 0 % coverage. The cut is 5× the head's p95 step, floored at 2 s — and the floor alone
    when there are too few rows to know the cadence."""
    p = tmp_path / "ppi.txt"
    _stream(p, [(0, 600)], step=5.0)              # one row every 5 s, no holes
    st = ni.stream_stats(str(p))
    assert st["fragments"] == 1 and st["coverage"] == 1.0 and st["gap_s"] == 25.0
    q = tmp_path / "few.txt"
    _stream(q, [(0, 3), (3600, 3)])               # six rows, an hour apart in the middle
    assert ni._cadence_gap(str(q)) == ni.GAP_S and ni.stream_stats(str(q))["fragments"] == 2


def test_stream_stats_survives_midnight(tmp_path):
    p = tmp_path / "m.txt"
    _stream(p, [(0, 120)], start="2026-09-20T23:59:00")
    st = ni.stream_stats(str(p))
    assert st["fragments"] == 1 and st["span_s"] == 119.0


def test_cached_stats_is_keyed_on_size_and_mtime_and_honours_the_deadline(tmp_path, monkeypatch):
    import time

    captures = tmp_path / "captures"; captures.mkdir()
    p = captures / "s.txt"
    _stream(p, [(0, 100), (150, 100)])
    ni._cache.clear(); ni._cache_loaded_from = None
    st, pending = ni.cached_stats(str(captures), str(p), deadline=time.monotonic() - 1)   # no time left
    assert st is None and pending is True
    st, pending = ni.cached_stats(str(captures), str(p), deadline=None)
    assert st["fragments"] == 2 and pending is False
    assert (tmp_path / "run" / ni._CACHE_NAME).exists()
    calls = []
    monkeypatch.setattr(ni, "stream_stats", lambda path, gap_s=None: calls.append(path) or {"fragments": 9, "coverage": 0.1, "span_s": 1.0, "gap_s": 2.0})
    st, _ = ni.cached_stats(str(captures), str(p), deadline=time.monotonic() - 1)         # cache hit beats the deadline
    assert st["fragments"] == 2 and calls == []
    _stream(p, [(0, 100), (150, 100), (300, 100)])                                          # the file grew
    st, _ = ni.cached_stats(str(captures), str(p), deadline=None)
    assert st["fragments"] == 9 and calls == [str(p)]


def test_index_nights_fills_newest_first_within_the_budget_and_marks_the_rest_pending(tmp_path):
    root = tmp_path
    for night in ("2026-09-18", "2026-09-19"):
        _night(root, night)
    ni._cache.clear(); ni._cache_loaded_from = None
    rows = ni.index_nights(str(root), 5, budget_s=0.0)
    assert ni.pending_count(rows) > 0 and all(r["ECGDex"]["pending"] for r in rows)
    rows = ni.index_nights(str(root), 5, budget_s=None)
    assert ni.pending_count(rows) == 0 and rows[-1]["night"] == "2026-09-19"
    assert rows[-1]["ECGDex"]["fragments"] is not None and rows[-1]["CPAPDex"]["fragments"] is None   # EDF: no row stamps


def test_stream_stats_edge_rows_and_unreadable_paths(tmp_path):
    """Header/blank/garbled rows are skipped, not counted; a one-row or unreadable stream is None."""
    p = tmp_path / "e.txt"
    p.write_text("Phone timestamp;x\n\n2026-09-20T22:00:00.000;1\nnot a stamp\n2026-09-20T22:00:0X.000;1\n"
                 "2026-09-20T22:00:01.000;1\n2026-09-20T22:00:02.000;1\n")
    assert ni.stream_stats(str(p)) == {"fragments": 1, "coverage": 1.0, "span_s": 2.0, "gap_s": 2.0}
    one = tmp_path / "one.txt"; one.write_text("Phone timestamp;x\n2026-09-20T22:00:00.000;1\n")
    assert ni.stream_stats(str(one)) is None
    assert ni.stream_stats(str(tmp_path / "missing.txt")) is None
    assert ni._cadence_gap(str(tmp_path / "missing.txt")) == ni.GAP_S
    hdr = tmp_path / "hdr.txt"; hdr.write_text("Phone timestamp;x\n")
    assert ni._cadence_gap(str(hdr)) == ni.GAP_S and ni.stream_stats(str(hdr)) is None


def test_cadence_reads_only_the_head_of_a_long_stream(tmp_path):
    p = tmp_path / "long.txt"
    _stream(p, [(0, 3000)])                        # 3 000 rows at 1 s; the cadence pass stops after 2 000 steps
    assert ni._cadence_gap(str(p)) == 5.0


def test_the_cache_is_reloaded_from_disk_and_survives_an_unwritable_run_dir(tmp_path, monkeypatch):
    import json

    captures = tmp_path / "captures"; captures.mkdir()
    p = captures / "s.txt"; _stream(p, [(0, 100)])
    ni._cache.clear(); ni._cache_loaded_from = None
    ni.cached_stats(str(captures), str(p), None)
    disk = json.load(open(tmp_path / "run" / ni._CACHE_NAME))
    assert disk["s.txt"]["stats"]["fragments"] == 1
    # a fresh process finds the file and reads it back: no recount
    ni._cache.clear(); ni._cache_loaded_from = None
    monkeypatch.setattr(ni, "stream_stats", lambda *a, **k: (_ for _ in ()).throw(AssertionError("recounted")))
    st, pending = ni.cached_stats(str(captures), str(p), None)
    assert st["fragments"] == 1 and pending is False
    # a malformed cache file reads as empty; an unwritable run dir is not an error
    (tmp_path / "run" / ni._CACHE_NAME).write_text("{not json")
    ni._cache.clear(); ni._cache_loaded_from = None
    ni._cache_load(str(captures))
    assert ni._cache == {}
    monkeypatch.setattr(ni.os, "replace", lambda *a: (_ for _ in ()).throw(OSError("read-only")))
    ni._cache["k"] = {"key": "x", "stats": None}
    ni._cache_save(str(captures))                  # swallowed: recomputed next time
    # a file that vanishes between listing and stat is (None, not pending)
    assert ni.cached_stats(str(captures), str(captures / "gone.txt"), None) == (None, False)
