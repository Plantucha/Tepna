# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""nights_index — the per-night, per-analyzer index behind the monitor's Ledger and Capture pages.
Built on a synthetic captures tree with the box's real file layouts: ISO-stamped Polar streams, the
O2Ring's DMY `_SPO2.csv`, an EDF whose header states its span, and the two CPAP trees keyed by date."""

import json
import os


import nights_index as ni

ISO_ROWS = (
    "Phone timestamp;sensor timestamp [ns];v\n"
    + "\n".join(f"2026-09-19T22:00:{s:02d}.000;{s};{s}" for s in range(0, 40))
    + "\n"
)


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
        _w(
            os.path.join(d, "Wellue_O2Ring-S_S8AW2100_20260919220000_SPO2.csv"),
            "Time,Oxygen Level,Pulse Rate,Motion\n22:45:27 19/09/2026,91,65,0\n05:45:27 20/09/2026,97,58,0\n",
        )
        _w(os.path.join(d, "Wellue_O2Ring-S_S8AW2100_20260919220000_PPG.txt"), ISO_ROWS)
    if cpap:
        _edf(os.path.join(root, "captures", "cpap-ble", "DATALOG", night.replace("-", ""), "20260919_220000_BRP.edf"))
    return d


# ── stamps ───────────────────────────────────────────────────────────────────────────────────────
def test_parse_stamp_reads_iso_and_the_o2ring_dmy_layout_and_refuses_the_rest():
    assert ni.parse_stamp("2026-09-19T22:45:27.953;;1").isoformat() == "2026-09-19T22:45:27"
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
    assert e["ECGDex"]["files"] == [
        f"2026-09-19/Polar_H10_02849638_20260919220000_{s}.txt" for s in ("ACC", "ECG", "HR", "RR")
    ]
    assert e["ECGDex"]["bytes"] == 4 * len(ISO_ROWS.encode()) and e["ECGDex"]["hours"] == 0.01
    assert e["OxyDex"]["hours"] == 7.0 and e["OxyDex"]["files"] == [
        "2026-09-19/Wellue_O2Ring-S_S8AW2100_20260919220000_SPO2.csv"
    ]
    assert e["CPAPDex"]["hours"] == 1.0 and e["CPAPDex"]["files"] == [
        "cpap-ble/DATALOG/20260919/20260919_220000_BRP.edf"
    ]
    assert e["GlucoDex"] is None and e["EEGDex"] is None, "no CGM, no Muse: absent, never 0"
    assert e["Integrator"]["loadable"] is False and e["ECGDex"]["loadable"] is True
    assert e["3 corner hat"] is True and e["PAT"] is True
    assert set(e) == {"night", "arrival", *ni.COLUMNS}


def test_a_night_without_the_h10_loses_its_ecg_columns_and_the_derived_tools(tmp_path):
    root = str(tmp_path)
    d = _night(root, h10=False)
    e = ni.night_entry(os.path.join(root, "captures"), d)
    assert e["ECGDex"] is None
    # HRVDex still has the Verity's PPI, but its PRIMARY (the H10 RR) is gone: bytes stay, hours is None
    assert (
        e["HRVDex"]["files"] == ["2026-09-19/Polar_VeritySense_0C301E3F_20260919220000_PPI.txt"]
        and e["HRVDex"]["hours"] is None
    )
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
    _stream(p, [(0, 100), (150, 100)])  # 100 s, a 50 s hole, 100 s → span 249 s
    st = ni.stream_stats(str(p))
    assert st["fragments"] == 2 and abs(st["coverage"] - (1 - 50 / 249)) < 0.01 and st["gap_s"] == 5.0
    assert ni.stream_stats(str(p), gap_s=60.0)["fragments"] == 1  # an explicit cut is honoured as given


def test_the_gap_threshold_follows_the_stream_s_own_cadence(tmp_path):
    """Verity PPI arrives in ~5 s batches sharing one stamp; a fixed 2 s cut read a whole night as 4 434
    fragments at 0 % coverage. The cut is 5× the head's p95 step, floored at 2 s — and the floor alone
    when there are too few rows to know the cadence."""
    p = tmp_path / "ppi.txt"
    _stream(p, [(0, 600)], step=5.0)  # one row every 5 s, no holes
    st = ni.stream_stats(str(p))
    assert st["fragments"] == 1 and st["coverage"] == 1.0 and st["gap_s"] == 25.0
    q = tmp_path / "few.txt"
    _stream(q, [(0, 3), (3600, 3)])  # six rows, an hour apart in the middle
    assert ni._cadence_gap(str(q)) == ni.GAP_S and ni.stream_stats(str(q))["fragments"] == 2


def test_the_seconds_lost_survive_a_ratio_that_rounds_them_away(tmp_path):
    """E10′ / residue 2026-09-29-two-gap-measures-one-surface. `coverage` is `1 - gaps/span` rounded to
    3 dp, so on a long stream it rounds a REAL hole to nothing and the surface is left with a count and no
    magnitude — "2 fragments" reads as damage where "2 fragments, 2.8 s of 6.8 h" reads as the 0.01 %
    non-finding it is. Measured on the box: 2026-09-28's H10 ECG holds `fragments: 2, coverage: 1.0,
    gaps_s: 2.8, span_s: 24367.1`, and `(1 - coverage) * span` recovers 0 s, not 2.8.

    So the test asserts the SECONDS, not the ratio — the ratio is the thing that cannot carry them."""
    # ⚠️ THE STEP HAS TO PUT `gap_s` ON ITS FLOOR, and the first version of this test did not — it used
    # 1 Hz rows, whose `_cadence_gap` is 5 × 1 s = 5.0 s, so the 2.8 s hole was BELOW the cut and was
    # correctly not counted. The test failed and the CODE WAS RIGHT. The real ECG stream runs at ~130 Hz,
    # so its cadence gap is 5 × 0.008 s floored to `GAP_S` = 2.0 s and a 2.8 s hole clears it. 0.1 s rows
    # reproduce that floor in a file a test can afford.
    p = tmp_path / "fast.txt"
    _stream(p, [(0, 3000), (3002.8, 3000)], step=0.1)  # 60 002 rows, one 2.8 s hole, span 6 002.8 s
    st = ni.stream_stats(str(p))
    assert st["gap_s"] == ni.GAP_S, st  # the cut is on its floor, as it is for the real stream
    assert st["fragments"] == 2, st
    assert st["coverage"] == 1.0, "the ratio rounds the hole away — that is the defect, not a bug in the test"
    assert st["gaps_s"] == 2.8, st  # the magnitude the ratio discarded, in seconds
    assert round((1 - st["coverage"]) * st["span_s"], 1) == 0.0, "the ratio cannot be inverted back to it"
    # ANTI-VACUITY: the same file read with a cut ABOVE the hole is one fragment and loses nothing, so the
    # assertions above are about a hole that was really counted rather than a number that is always there.
    clean = ni.stream_stats(str(p), gap_s=10.0)
    assert clean["fragments"] == 1 and clean["gaps_s"] == 0.0, clean


def test_gaps_s_is_zero_not_absent_on_an_unbroken_stream(tmp_path):
    """§∅ in the other direction: a stream with no hole lost ZERO seconds, which is a measurement, and it
    must not arrive as `None` — the surface distinguishes "none lost" from "not measured"."""
    p = tmp_path / "whole.txt"
    _stream(p, [(0, 300)], step=1.0)
    st = ni.stream_stats(str(p))
    assert st["fragments"] == 1 and st["gaps_s"] == 0.0 and st["coverage"] == 1.0, st


def test_the_night_payload_carries_the_bound_and_the_magnitude(tmp_path):
    """The chip can only state a threshold and a loss if the payload carries them. Pins the keys rather
    than their values, because the values are the stream's business and these are the surface's."""
    import inspect

    src = inspect.getsource(ni)
    for key in ('"gaps_s": stats["gaps_s"]', '"gap_s": stats["gap_s"]', '"span_s": stats["span_s"]'):
        assert key in src, key


def test_stream_stats_survives_midnight(tmp_path):
    p = tmp_path / "m.txt"
    _stream(p, [(0, 120)], start="2026-09-20T23:59:00")
    st = ni.stream_stats(str(p))
    assert st["fragments"] == 1 and st["span_s"] == 119.0


def test_cached_stats_is_keyed_on_size_and_mtime_and_honours_the_deadline(tmp_path, monkeypatch):
    import time

    captures = tmp_path / "captures"
    captures.mkdir()
    p = captures / "s.txt"
    _stream(p, [(0, 100), (150, 100)])
    ni._cache.clear()
    ni._cache_loaded_from = None
    st, pending = ni.cached_stats(str(captures), str(p), deadline=time.monotonic() - 1)  # no time left
    assert st is None and pending is True
    st, pending = ni.cached_stats(str(captures), str(p), deadline=None)
    assert st["fragments"] == 2 and pending is False
    assert (tmp_path / "run" / ni._CACHE_NAME).exists()
    calls = []
    monkeypatch.setattr(
        ni,
        "stream_stats",
        lambda path, gap_s=None: calls.append(path) or {"fragments": 9, "coverage": 0.1, "span_s": 1.0, "gap_s": 2.0},
    )
    st, _ = ni.cached_stats(str(captures), str(p), deadline=time.monotonic() - 1)  # cache hit beats the deadline
    assert st["fragments"] == 2 and calls == []
    _stream(p, [(0, 100), (150, 100), (300, 100)])  # the file grew
    st, _ = ni.cached_stats(str(captures), str(p), deadline=None)
    assert st["fragments"] == 9 and calls == [str(p)]


def test_index_nights_fills_newest_first_within_the_budget_and_marks_the_rest_pending(tmp_path):
    root = tmp_path
    for night in ("2026-09-18", "2026-09-19"):
        _night(root, night)
    ni._cache.clear()
    ni._cache_loaded_from = None
    rows = ni.index_nights(str(root), 5, budget_s=0.0)
    assert ni.pending_count(rows) > 0 and all(r["ECGDex"]["pending"] for r in rows)
    rows = ni.index_nights(str(root), 5, budget_s=None)
    assert ni.pending_count(rows) == 0 and rows[-1]["night"] == "2026-09-19"
    assert (
        rows[-1]["ECGDex"]["fragments"] is not None and rows[-1]["CPAPDex"]["fragments"] is None
    )  # EDF: no row stamps


def test_stream_stats_edge_rows_and_unreadable_paths(tmp_path):
    """Header/blank/garbled rows are skipped, not counted; a one-row or unreadable stream is None."""
    p = tmp_path / "e.txt"
    p.write_text(
        "Phone timestamp;x\n\n2026-09-20T22:00:00.000;1\nnot a stamp\n2026-09-20T22:00:0X.000;1\n"
        "2026-09-20T22:00:01.000;1\n2026-09-20T22:00:02.000;1\n"
    )
    assert ni.stream_stats(str(p)) == {"fragments": 1, "coverage": 1.0, "gaps_s": 0.0, "span_s": 2.0, "gap_s": 2.0}
    one = tmp_path / "one.txt"
    one.write_text("Phone timestamp;x\n2026-09-20T22:00:00.000;1\n")
    assert ni.stream_stats(str(one)) is None
    assert ni.stream_stats(str(tmp_path / "missing.txt")) is None
    assert ni._cadence_gap(str(tmp_path / "missing.txt")) == ni.GAP_S
    hdr = tmp_path / "hdr.txt"
    hdr.write_text("Phone timestamp;x\n")
    assert ni._cadence_gap(str(hdr)) == ni.GAP_S and ni.stream_stats(str(hdr)) is None


def test_cadence_reads_only_the_head_of_a_long_stream(tmp_path):
    p = tmp_path / "long.txt"
    _stream(p, [(0, 3000)])  # 3 000 rows at 1 s; the cadence pass stops after 2 000 steps
    assert ni._cadence_gap(str(p)) == 5.0


def test_the_cache_is_reloaded_from_disk_and_survives_an_unwritable_run_dir(tmp_path, monkeypatch):
    import json

    captures = tmp_path / "captures"
    captures.mkdir()
    p = captures / "s.txt"
    _stream(p, [(0, 100)])
    ni._cache.clear()
    ni._cache_loaded_from = None
    ni.cached_stats(str(captures), str(p), None)
    disk = json.load(open(tmp_path / "run" / ni._CACHE_NAME))
    assert disk["s.txt"]["stats"]["fragments"] == 1
    # a fresh process finds the file and reads it back: no recount
    ni._cache.clear()
    ni._cache_loaded_from = None
    monkeypatch.setattr(ni, "stream_stats", lambda *a, **k: (_ for _ in ()).throw(AssertionError("recounted")))
    st, pending = ni.cached_stats(str(captures), str(p), None)
    assert st["fragments"] == 1 and pending is False
    # a malformed cache file reads as empty; an unwritable run dir is not an error
    (tmp_path / "run" / ni._CACHE_NAME).write_text("{not json")
    ni._cache.clear()
    ni._cache_loaded_from = None
    ni._cache_load(str(captures))
    assert ni._cache == {}
    monkeypatch.setattr(ni.os, "replace", lambda *a: (_ for _ in ()).throw(OSError("read-only")))
    ni._cache["k"] = {"key": "x", "stats": None}
    ni._cache_save(str(captures))  # swallowed: recomputed next time
    # a file that vanishes between listing and stat is (None, not pending)
    assert ni.cached_stats(str(captures), str(captures / "gone.txt"), None) == (None, False)


def test_parse_host_stamp_lands_a_zoned_stamp_where_its_zoneless_twin_lands():
    """Clock Contract §2 rule 2 on the Python side: the zone is authoritative for the OFFSET, and the time
    itself is the components AS WRITTEN — so these two must be the same instant-as-written, not two
    instants an offset apart, and neither may come back AWARE. An aware value is what raised
    `TypeError: can't compare offset-naive and offset-aware datetimes` out of `solid_night_inputs`, where
    it escaped an `except ValueError` and cost the night its whole verdict."""
    zoned = ni.parse_host_stamp("2026-09-27T01:14:17.123+02:00;5;1")
    bare = ni.parse_host_stamp("2026-09-27T01:14:17.123;5;1")
    assert zoned == bare, "components as written, not shifted by the offset"
    assert zoned.tzinfo is None and bare.tzinfo is None, "and never aware — that is the whole defect"
    # a negative offset, and one with no minutes part
    assert ni.parse_host_stamp("2026-09-27T01:14:17.123-05:00;5;1") == bare
    assert ni.parse_host_stamp("2026-09-27T01:14:17.123Z;5;1") == bare


def test_parse_host_stamp_keeps_the_SUB_SECOND_digits_parse_stamp_drops():
    """Why this is a sibling and not a widened `parse_stamp`: its callers measure in hours, where the
    milliseconds are noise, while `residual_scan` quantises a batch residual to the host stamp's own 1 ms
    resolution. Widening the existing one would have added microseconds to every caller silently."""
    line = "2026-09-27T01:14:17.123;5;1"
    assert ni.parse_host_stamp(line).microsecond == 123000
    assert ni.parse_stamp(line).microsecond == 0, "the hours-precision reader is unchanged"
    assert ni.parse_host_stamp("2026-09-27T01:14:17.123456;5;1").microsecond == 123456


def test_parse_host_stamp_falls_back_to_the_other_layout_and_never_fabricates():
    """The O2Ring layout still resolves, through `parse_stamp`, and an unreadable stamp is None — never
    `now`, never a zero (§∅)."""
    import datetime as _dtm

    assert ni.parse_host_stamp("01:14:17 27/09/2026") == _dtm.datetime(2026, 9, 27, 1, 14, 17)
    assert ni.parse_host_stamp("not a stamp") is None
    assert ni.parse_host_stamp("") is None
    assert ni.parse_host_stamp("2026-13-45T99:99:99.000") is None, "range-invalid, not rolled"


def test_the_arrival_sidecars_of_both_polar_devices_are_listed_and_the_ring_s_is_not(tmp_path):
    """PAT Feasibility's corrected lag is anchored on each Polar device's packet-arrival floor, so the index hands
    the monitor both sidecars as their own per-night field (never inside a node's ingest list). The ring's sidecar
    carries no PMD stream PAT uses. A night without sidecars lists none — an empty list, not a missing key."""
    root = str(tmp_path)
    d = _night(root)
    for name in (
        "Polar_H10_02849638_20260919220000_PMDARRIVAL.csv",
        "Polar_VeritySense_0C301E3F_20260919220000_PMDARRIVAL.csv",
        "Wellue_O2Ring-S_S8AW2100_20260919220000_PMDARRIVAL.csv",
    ):
        _w(os.path.join(d, name), "Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n")
    e = ni.night_entry(os.path.join(root, "captures"), d)
    assert e["arrival"] == [
        "2026-09-19/Polar_H10_02849638_20260919220000_PMDARRIVAL.csv",
        "2026-09-19/Polar_VeritySense_0C301E3F_20260919220000_PMDARRIVAL.csv",
    ]
    assert not any("PMDARRIVAL" in f for c in ni.NODES if e[c] for f in e[c]["files"]), (
        "a sidecar leaked into an ingest list"
    )
    bare = str(tmp_path / "b")
    e2 = ni.night_entry(os.path.join(bare, "captures"), _night(bare))
    assert e2["arrival"] == []


# ── night_entry, observed where the mutation gate found it unobserved (PR #3150, 2026-09-27) ─────────
def test_the_primary_is_read_from_the_same_cpap_tree_the_files_came_from(tmp_path):
    """The SD set wins the CPAP night when it exists, and the covered span must come from THAT tree's BRP. With
    an SD set that holds no BRP, reading the BLE pull's BRP instead would state hours for files not loaded."""
    root = str(tmp_path)
    d = _night(root)  # cpap-ble holds a BRP (1.0 h)
    _w(os.path.join(root, "captures", "cpap", "DATALOG", "20260919", "20260919_220000_PLD.edf"), "x")
    e = ni.night_entry(os.path.join(root, "captures"), d)
    assert e["CPAPDex"]["files"] == ["cpap/DATALOG/20260919/20260919_220000_PLD.edf"], e["CPAPDex"]["files"]
    assert e["CPAPDex"]["hours"] is None, "hours read from the other tree's BRP"


def test_an_edf_primary_is_never_pending(tmp_path):
    """`pending` is a boolean the monitor counts; an EDF primary has no row stats to wait for, so it is False —
    never None, which the pending tally would read as a third state."""
    root = str(tmp_path)
    e = ni.night_entry(os.path.join(root, "captures"), _night(root))
    assert e["CPAPDex"]["pending"] is False and e["ECGDex"]["pending"] is False


def test_the_covered_span_comes_from_the_largest_primary_not_the_last_named(tmp_path):
    """Two H10 ECG sessions: the LARGER one is the night. It must set `hours` even when a smaller session's name
    sorts after it (a late reconnect fragment)."""
    root = str(tmp_path)
    d = _night(root)
    big = (
        "Phone timestamp;sensor timestamp [ns];v\n"
        + "\n".join(f"2026-09-19T22:{m:02d}:00.000;{m};{m}" for m in range(0, 60))
        + "\n"
    )
    _w(os.path.join(d, "Polar_H10_02849638_20260919210000_ECG.txt"), big)  # earlier name, 59 min, larger
    e = ni.night_entry(os.path.join(root, "captures"), d)
    assert e["ECGDex"]["hours"] == round(59 / 60, 2), e["ECGDex"]["hours"]


# The facts that make the remaining night_entry mutants equivalent, asserted so each claim in
# tools/mutate-equivalence.json rests on a check rather than on prose.
def test_arrival_and_derived_globs_are_root_free():
    """`_expand` uses `root` only for a pattern containing "/" (the CPAP trees), so a root-free glob cannot
    observe which root it was handed."""
    assert not any("/" in p for p in ni.ARRIVAL)
    assert not any("/" in p for req in ni.DERIVED.values() for p in req)


def test_node_patterns_have_at_most_one_alternative_and_it_is_last():
    """`tree` records the alternative index of a node's pattern list; with at most one alternative, placed last,
    "first alternative seen" and "last pattern's index" are the same index."""
    for node, (patterns, _primary) in ni.NODES.items():
        alts = [i for i, p in enumerate(patterns) if isinstance(p, tuple)]
        assert len(alts) <= 1 and (not alts or alts[0] == len(patterns) - 1), node


def test_every_node_with_inputs_names_a_primary():
    for node, (patterns, primary) in ni.NODES.items():
        assert not patterns or primary is not None, node


# ── THE FOUR BEHAVIOURS A "SECONDS LOST" NUMBER DEPENDS ON ───────────────────────────────────────────
# Pulled into scope by E10′: the diff-scoped mutation gate is per FUNCTION, so touching `stream_stats`
# made every untested line in it mine. These are not bookkeeping — each one silently changes the number
# the monitor now publishes, and none had a test observing it. Each asserts the OUTPUT the mutant moves,
# never a count of anything.


def test_the_gap_cut_is_strict_so_a_hole_exactly_at_the_threshold_is_not_one(tmp_path):
    """`if t - prev > gap_s` — the mutant is `>=`. A hole EXACTLY at the cut is the cadence, not a gap:
    a 5 s stream whose rows are 5 s apart is unbroken, and `>=` would call every row a fragment."""
    p = tmp_path / "exact.txt"
    _stream(p, [(0, 60)], step=5.0)  # every step is exactly 5 s; the cadence cut for this stream is 25 s
    assert ni.stream_stats(str(p), gap_s=5.0) == {
        "fragments": 1,
        "coverage": 1.0,
        "gaps_s": 0.0,
        "span_s": 55.0,
        "gap_s": 5.0,
    }
    # and one microsecond past the cut IS a gap, so the boundary is where it is claimed to be
    q = tmp_path / "past.txt"
    _stream(q, [(0, 10), (15.001, 10)], step=1.0)
    st = ni.stream_stats(str(q), gap_s=5.0)
    assert st["fragments"] == 2 and st["gaps_s"] == 6.0, st


def test_every_hole_is_summed_not_only_the_last(tmp_path):
    """`gaps += t - prev` — the mutant is `gaps = t - prev`, which reports ONLY THE FINAL hole. That is
    the exact defect this PR exists to prevent: a night losing three minutes across three holes would
    publish the last one and read as a tenth of its real loss."""
    p = tmp_path / "three.txt"
    _stream(p, [(0, 10), (30, 10), (60, 10), (90, 10)], step=1.0)  # three 21 s holes (9 s of rows each)
    st = ni.stream_stats(str(p), gap_s=5.0)
    assert st["fragments"] == 4, st
    assert st["gaps_s"] == 63.0, st  # 3 × 21 s summed — `gaps =` would give 21.0
    assert st["gaps_s"] != 21.0, "only the last hole was counted — the accumulator became an assignment"


def test_the_midnight_wrap_boundary_is_twelve_hours_back_not_more(tmp_path):
    """`if t < prev - 43200` — mutants are `<=` and `43201`.

    ⚠️ `_row_seconds` returns SECONDS OF DAY, not an absolute instant: the date in the stamp is ignored.
    My first version of this test built the two cases from wall-clock dates and measured nothing — a
    23:59:59 row reads 86 399.999, which is a step FORWARD from noon, not back. The wrap is about the
    seconds-of-day counter running backwards, so the cases have to be built in that space.

    A step back of EXACTLY 43 200 s is not a wrap: the stream reverses, `prev <= first`, and the answer
    is None. `<=` would wrap it and invent a 12-hour span out of a backwards stream.
    A step back of 43 200.5 s IS a wrap: it becomes the next day and the span is real. `43201` would
    refuse it and return None instead."""
    hdr = "Phone timestamp;v"
    # 13:53:20.000 = 50 000 s of day; 01:53:20.000 = 6 800 s → exactly 43 200 s back
    at_cut = tmp_path / "at_cut.txt"
    at_cut.write_text(hdr + "\n2026-09-28T13:53:20.000;1\n2026-09-28T01:53:20.000;1\n")
    assert ni.stream_stats(str(at_cut), gap_s=5.0) is None, "exactly 12 h back is not a wrap — `<=` would wrap it"
    # 01:53:19.500 = 6 799.5 s → 43 200.5 s back, past the cut
    past_cut = tmp_path / "past_cut.txt"
    past_cut.write_text(hdr + "\n2026-09-28T13:53:20.000;1\n2026-09-28T01:53:19.500;1\n")
    st = ni.stream_stats(str(past_cut), gap_s=5.0)
    assert st is not None and st["span_s"] == 43199.5, st  # `43201` would refuse this and return None


def test_a_stream_whose_span_is_zero_or_backwards_yields_none_not_a_division(tmp_path):
    """`if first is None or prev is None or prev <= first` — the mutant is `and`, which lets a
    single-row (or non-advancing) stream through to `1 - gaps/span` and a ZeroDivisionError. A stream
    that spans nothing has no coverage to report; None is the answer, not a crash and not 100 %."""
    one = tmp_path / "one.txt"
    one.write_text("Phone timestamp;v\n2026-09-28T21:00:00.000;1\n")
    assert ni.stream_stats(str(one)) is None
    flat = tmp_path / "flat.txt"
    flat.write_text("Phone timestamp;v\n2026-09-28T21:00:00.000;1\n2026-09-28T21:00:00.000;1\n")
    assert ni.stream_stats(str(flat)) is None


def test_the_rounding_precision_is_pinned_by_a_value_that_distinguishes_it(tmp_path):
    """`round(gaps, 1)` / `round(span, 1)` / `round(gap_s, 2)` — the mutants change the decimal place.
    A value whose 1 dp and 2 dp readings are EQUAL cannot see them, which is how the first version of
    the E10′ test let `round(gaps, 2)` survive while asserting `== 2.8`. These values differ at the dp."""
    p = tmp_path / "dp.txt"
    _stream(p, [(0, 10), (16.06, 10)], step=1.0)  # a 7.06 s hole: 1 dp → 7.1, 2 dp → 7.06
    st = ni.stream_stats(str(p), gap_s=5.0)
    assert st["gaps_s"] == 7.1, st  # kills round(gaps, 2) and round(gaps, None)
    assert st["span_s"] == 25.1, st  # 1 dp; kills round(span, 2)/None
    assert ni.stream_stats(str(p), gap_s=5.005)["gap_s"] == 5.0, "gap_s is 2 dp"  # kills round(gap_s, 3)
    assert ni.stream_stats(str(p), gap_s=5.006)["gap_s"] == 5.01, "…and rounds at the 2nd dp"


def test_the_o2_ring_csv_is_parsed_by_its_own_format_not_iso(tmp_path):
    """`iso = False` — mutants are `None` and `True`.

    The flag is latched ONCE from the first recognisable row and then drives `_row_seconds`' slice: ISO
    rows are `YYYY-MM-DDTHH:MM:SS.mmm`, the ring's CSV is `HH:MM:SS DD/MM/YYYY`. Reading one with the
    other's offsets yields nonsense or None, so a ring stream must be scored by the ring's format.
    `iso = None` re-enters detection on every row (the latch never holds); `iso = True` reads the ring's
    `HH:MM:SS` with ISO offsets. Both change the NUMBER, which is what is asserted."""
    p = tmp_path / "ring.txt"
    rows = ["21:00:00 28/09/2026;98", "21:00:05 28/09/2026;98", "21:00:30 28/09/2026;97"]
    p.write_text("Time;SpO2\n" + "\n".join(rows) + "\n")
    st = ni.stream_stats(str(p), gap_s=10.0)
    assert st is not None, "the ring's own CSV format must be readable at all"
    assert st["span_s"] == 30.0, st  # 21:00:00 → 21:00:30, by the ring's slice
    assert st["fragments"] == 2 and st["gaps_s"] == 25.0, st  # the 25 s hole clears a 10 s cut


def test_the_night_payload_carries_the_measured_values_not_just_the_keys(tmp_path):
    """`"gaps_s"/"gap_s"/"span_s": stats[…] if stats else None` — the mutant is `if (stats) and False`,
    which keeps the KEYS and makes every value None. A test that only checks the keys exist cannot see
    it — mine did not, which is why it survived — so this one drives the real `night_entry` over a real
    night directory and asserts the VALUES arrived."""
    root = tmp_path
    nd = root / "2026-09-28"
    nd.mkdir()
    _stream(nd / "Polar_H10_02849638_20260928213612_ECG.txt", [(0, 60), (75, 60)], step=0.1)
    e = ni.night_entry(str(root), str(nd), deadline=None)
    ecg = e.get("ECGDex")
    assert isinstance(ecg, dict), e
    assert ecg["fragments"] == 2, ecg
    assert ecg["gaps_s"] is not None and ecg["gaps_s"] > 0, ecg  # the magnitude, not just the key
    assert ecg["gap_s"] == ni.GAP_S, ecg  # the bound the count was taken above
    assert ecg["span_s"] is not None and ecg["span_s"] > 100, ecg


def test_a_stream_with_undecodable_bytes_is_read_not_raised(tmp_path):
    """`errors="replace"` — mutants are `errors=None` and dropping the argument. A capture file can hold
    a torn multi-byte sequence (a write interrupted mid-character at a power cut is the ordinary case),
    and the scanner's job is to score the rows it CAN read, not to raise and leave the night unscored.
    With strict errors this read raises UnicodeDecodeError and `stream_stats` returns nothing at all."""
    p = tmp_path / "torn.txt"
    good = "Phone timestamp;v\n2026-09-28T21:00:00.000;1\n2026-09-28T21:00:01.000;1\n"
    tail = "2026-09-28T21:00:02.000;1\n"
    p.write_bytes(good.encode("utf-8") + b"\xff\xfe\n" + tail.encode("utf-8"))
    st = ni.stream_stats(str(p), gap_s=5.0)
    assert st is not None, "a torn byte must not take the whole stream down"
    assert st["span_s"] == 2.0, st  # the readable rows are still scored end to end


def test_the_format_is_latched_by_the_first_recognisable_row_not_re_detected(tmp_path):
    """`iso = False` — the surviving mutant is `iso = None`, which un-latches the flag so every row
    re-runs detection. The latch is the contract: the FIRST recognisable row decides how the whole
    stream is sliced, and a later row that happens to match the other pattern does not change it.

    That matters for a torn or concatenated file. Here the ring's `HH:MM:SS DD/MM/YYYY` rows latch the
    O2 format, and a stray ISO-shaped row must still be read with the ring's offsets — `2026-09-28T…`
    sliced as `HH:MM:SS` gives `20:26:-9` → ValueError → None → skipped, so the span stays the ring's.
    With `iso = None` the stray row re-detects as ISO, is read as 21:00 and joins the span."""
    p = tmp_path / "mixed.txt"
    p.write_text(
        "Time;v\n"
        "21:00:00 28/09/2026;1\n"
        "21:00:02 28/09/2026;1\n"
        "2026-09-28T23:00:00.000;1\n"  # ISO-shaped, arriving AFTER the latch
        "21:00:04 28/09/2026;1\n"
    )
    st = ni.stream_stats(str(p), gap_s=10.0)
    assert st is not None, st
    assert st["span_s"] == 4.0, st  # the ring's four seconds; the stray row contributed nothing
    assert st["fragments"] == 1 and st["gaps_s"] == 0.0, st


# ── `night_entry`'s own wiring, pulled into scope by E10′ ────────────────────────────────────────────
# Four mutants survived on lines this branch did not touch, because adding three keys put the whole
# function in the diff-scoped gate's sight. Each is a real behaviour with no test observing it.


def test_the_primary_reads_from_the_tree_the_files_came_from(tmp_path):
    """`tree = i if tree is None else tree` — the mutant is `or True`, which keeps the LAST alternative's
    index instead of the first. CPAPDex's patterns are alternatives (`cpap/…` then `cpap-ble/…`), and
    `_expand_alt`'s docstring states the contract: the primary must read from the tree the files came
    from. With the mutant, a night whose EDFs live in `cpap/` is asked for its primary from `cpap-ble/`
    and finds none."""
    # ⚠️ A pattern containing "/" resolves against the capture ROOT, not the night dir (`_expand`:
    # `base = root if "/" in pattern else night_dir`). My first fixture put the EDF inside the night
    # folder and CPAPDex came back None — the layout is the contract, and it is worth stating here
    # because the same mistake reads as "the node found nothing" rather than "the test built it wrong".
    nd = tmp_path / "2026-09-28"
    nd.mkdir()
    (tmp_path / "cpap" / "DATALOG" / "20260928").mkdir(parents=True)
    (tmp_path / "cpap" / "DATALOG" / "20260928" / "20260928_215854_BRP.edf").write_bytes(b"0" * 64)
    e = ni.night_entry(str(tmp_path), str(nd), deadline=None)
    cp = e.get("CPAPDex")
    assert isinstance(cp, dict), e
    assert cp["files"], "the first alternative's files must be found"
    assert all("cpap-ble" not in f for f in cp["files"]), cp["files"]


def test_a_node_with_no_primary_yields_no_fragments_rather_than_asking_for_one(tmp_path):
    """`prims = … if primary else []` — the mutant is `if (primary) or True`, which calls `_expand_alt`
    with `primary=None` even for a node that declares none. GlucoDex and EEGDex have no primary: the
    honest answer is `fragments: None`, not a lookup against a pattern that does not exist."""
    nd = tmp_path / "2026-09-28"
    nd.mkdir()
    e = ni.night_entry(str(tmp_path), str(nd), deadline=None)
    for node in ("GlucoDex", "EEGDex"):
        v = e.get(node)
        assert v is None or (isinstance(v, dict) and v.get("fragments") is None), (node, v)


def test_a_derived_tool_and_the_arrival_list_resolve_against_the_capture_ROOT(tmp_path):
    """`_expand(root, …)` → `_expand(None, …)` in the DERIVED loop and in the `arrival` line. `_expand`
    picks `base = root if "/" in pattern else night_dir`, so `root` is what makes a pattern reach
    outside the night directory — and passing None raises rather than returning nothing. Both call
    sites are exercised here on a night that satisfies a derived tool and carries an arrival sidecar."""
    nd = tmp_path / "2026-09-28"
    nd.mkdir()
    for name in (
        "Polar_H10_02849638_20260928213612_HR.txt",
        "Polar_VeritySense_0C301E3F_20260928210610_PPG.txt",
        "Wellue_O2Ring-S_S8AW2100_20260928213651_SPO2.csv",
        "Polar_H10_02849638_20260928213612_PMDARRIVAL.csv",
    ):
        (nd / name).write_text("Phone timestamp;v\n2026-09-28T21:00:00.000;1\n")
    e = ni.night_entry(str(tmp_path), str(nd), deadline=None)
    assert e["3 corner hat"] is True, e["3 corner hat"]  # the DERIVED loop resolved every required pattern
    assert e["arrival"] and any("PMDARRIVAL" in a for a in e["arrival"]), e["arrival"]
    # …and the paths are relative to ROOT, which is the thing `root` is for
    assert all(a.startswith("2026-09-28/") for a in e["arrival"]), e["arrival"]


# ── the cache entry's SHAPE is part of its key (the 2026-10-03 "no nights on disk" outage) ───────────


def test_an_entry_written_BEFORE_a_key_existed_is_recomputed_not_read_as_a_hit(tmp_path):
    """The outage, planted. #3233 added `gaps_s` to the stats dict and `night_entry` reads it
    unconditionally — right, because the magnitude exists and publishing null for it would be
    absence-as-value in reverse. But the key was size+mtime, and a captured file that has stopped growing
    never changes either, so every entry the pre-#3233 build wrote for a FINISHED night stayed a hit
    while lacking the key. `/api/nights` raised `KeyError: gaps_s` and the Vigil Nights page read "no
    nights on disk" for about 3.5 days."""
    captures = tmp_path / "captures"
    captures.mkdir()
    p = captures / "s.txt"
    _stream(p, [(0, 100), (150, 100)])
    st = os.stat(p)
    (tmp_path / "run").mkdir()
    # exactly what the old build wrote: the old key, and stats WITHOUT `gaps_s`
    (tmp_path / "run" / ni._CACHE_NAME).write_text(
        json.dumps(
            {
                "s.txt": {
                    "key": f"{st.st_size}:{st.st_mtime_ns}",
                    "stats": {"fragments": 2, "coverage": 1.0, "span_s": 250.0, "gap_s": 2.0},
                }
            }
        )
    )
    ni._cache.clear()
    ni._cache_loaded_from = None
    stats, pending = ni.cached_stats(str(captures), str(p), None)
    assert pending is False
    # 51 s is the real hole in this fixture (rows stop at t=99 and resume at t=150), measured from the
    # file — not a null standing in for a key the entry never had.
    assert stats["gaps_s"] == 51.0, "recomputed from the file, not read back short a key"
    assert set(stats) == set(ni._STATS_KEYS)
    # ... and the entry is rewritten, so the next process does not pay for it again
    disk = json.load(open(tmp_path / "run" / ni._CACHE_NAME))
    assert disk["s.txt"]["key"].endswith(f":{ni._STATS_SHAPE}")
    assert "gaps_s" in disk["s.txt"]["stats"]


def test_CONTROL_an_entry_of_the_CURRENT_shape_is_still_a_hit(tmp_path, monkeypatch):
    """The cache must still save its seconds — the whole point of it is that a finished night is scanned
    once. A fingerprint that invalidated every entry would turn a 15 s budget into a rescan of the box."""
    captures = tmp_path / "captures"
    captures.mkdir()
    p = captures / "s.txt"
    _stream(p, [(0, 100), (150, 100)])
    ni._cache.clear()
    ni._cache_loaded_from = None
    first, _ = ni.cached_stats(str(captures), str(p), None)
    ni._cache.clear()
    ni._cache_loaded_from = None
    monkeypatch.setattr(ni, "stream_stats", lambda *a, **k: (_ for _ in ()).throw(AssertionError("recounted")))
    again, pending = ni.cached_stats(str(captures), str(p), None)
    assert again == first and pending is False


def test_the_declared_stats_shape_is_what_stream_stats_actually_RETURNS(tmp_path):
    """The mechanism that stops this recurring. A version number someone has to remember to bump is the
    same defect waiting for the next key; this reds the suite the moment `_STATS_KEYS` and `stream_stats`
    disagree in either direction, which is what makes the cache key self-invalidating."""
    p = tmp_path / "s.txt"
    _stream(p, [(0, 100), (150, 100)])
    assert set(ni.stream_stats(str(p))) == set(ni._STATS_KEYS)


def test_ONE_bad_night_does_not_take_the_other_eighty_nine_down(tmp_path, monkeypatch):
    """`index_nights` was a bare comprehension, so the first night that raised took the whole listing with
    it and `/api/nights` returned one `{"error": …}` for a box holding 90 nights. The failing night keeps
    its DATE and names what failed — omitting it would read as a night that was never captured, which is
    the same absence-as-value trap one level up from the field."""
    _night(tmp_path, "2026-09-19")
    _night(tmp_path, "2026-09-20")
    real = ni.night_entry

    def boom(captures, night_dir, deadline):
        if night_dir.endswith("2026-09-19"):
            raise KeyError("gaps_s")
        return real(captures, night_dir, deadline)

    monkeypatch.setattr(ni, "night_entry", boom)
    rows = ni.index_nights(str(tmp_path), 60)
    assert [r["night"] for r in rows] == ["2026-09-19", "2026-09-20"], "both nights are still listed"
    bad = next(r for r in rows if r["night"] == "2026-09-19")
    assert bad["error"] == "KeyError: 'gaps_s'"
    assert not any(k in bad for k in ni.COLUMNS), "an error row carries no node key to be mistaken for data"
    assert next(r for r in rows if r["night"] == "2026-09-20")["OxyDex"] is not None
    assert ni.pending_count(rows) >= 0, "the error row does not break the pending tally"


def test_a_deadline_not_yet_PASSED_still_allows_the_work(tmp_path, monkeypatch):
    """`>` not `>=`, pinned at the one instant that separates them. The budget is a deadline, so the work
    is deferred once the clock is PAST it — at exactly the deadline there is still time, and deferring
    there would make a zero-length budget defer everything while reading as if it had tried."""
    captures = tmp_path / "captures"
    captures.mkdir()
    p = captures / "s.txt"
    _stream(p, [(0, 100)])
    ni._cache.clear()
    ni._cache_loaded_from = None
    monkeypatch.setattr(ni.time, "monotonic", lambda: 1000.0)
    st, pending = ni.cached_stats(str(captures), str(p), deadline=1000.0)
    assert pending is False and st["fragments"] == 1, "at the deadline, not past it"
    # A SECOND FILE, because the first is now IN the cache and a hit beats the deadline by design — the
    # one-line version of this test asserted the deferral against an entry it had just written.
    p2 = captures / "t.txt"
    _stream(p2, [(0, 100)])
    st, pending = ni.cached_stats(str(captures), str(p2), deadline=999.999)
    assert pending is True and st is None, "past it, the work is deferred and says so"


def test_the_listing_defaults_to_SIXTY_nights_and_a_FIFTEEN_second_budget(tmp_path, monkeypatch):
    """Both defaults are the contract `/api/nights` relies on when it passes neither, and a signature-
    reading test cannot see them: mutmut applies a mutated default at CALL time while leaving the visible
    `def` alone (`ext:memory/a-signature-reading-test-cannot-see-a-mutated-default`). So they are observed
    through behaviour — how many nights come back, and what deadline the per-night call is handed."""
    monkeypatch.setattr(ni, "list_nights", lambda root: [f"2026-07-{d:02d}" for d in range(1, 10)] * 7)
    seen: list = []

    def rec(captures, night_dir, deadline):
        seen.append(deadline)
        return {"night": os.path.basename(night_dir)}

    monkeypatch.setattr(ni, "night_entry", rec)
    monkeypatch.setattr(ni.time, "monotonic", lambda: 5000.0)
    rows = ni.index_nights(str(tmp_path))
    assert len(rows) == 60, "the newest sixty, which is what the page asks for when it asks for nothing"
    assert seen and all(d == 5015.0 for d in seen), "a fifteen-second budget, handed to every night"
