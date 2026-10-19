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
    """⚠️ THE SESSION STAMP NOW FOLLOWS THE FOLDER, and before 2026-10-10 it did not: every file was
    written with a hard-coded `20260919220000` whatever `night` said. Under folder-keyed row identity
    that was invisible — the row came from the folder's NAME. Under `(night band, recording start)` the
    STAMP decides, so three folders all claiming 2026-09-19 22:00 collapsed into one row and three
    listing tests failed. Real captures cannot be in this state: `writers.night_dir()` files a session's
    files under its own start date, which is the property this fixture now reproduces."""
    d = os.path.join(root, "captures", night)
    os.makedirs(d, exist_ok=True)
    stamp = f"{night.replace('-', '')}220000"
    if h10:
        for s in ("ECG", "ACC", "HR", "RR"):
            _w(os.path.join(d, f"Polar_H10_02849638_{stamp}_{s}.txt"), ISO_ROWS)
    if verity:
        for s in ("PPG", "PPI", "ACC"):
            _w(os.path.join(d, f"Polar_VeritySense_0C301E3F_{stamp}_{s}.txt"), ISO_ROWS)
    if ring:
        _w(
            os.path.join(d, f"Wellue_O2Ring-S_S8AW2100_{stamp}_SPO2.csv"),
            "Time,Oxygen Level,Pulse Rate,Motion\n22:45:27 19/09/2026,91,65,0\n05:45:27 20/09/2026,97,58,0\n",
        )
        _w(os.path.join(d, f"Wellue_O2Ring-S_S8AW2100_{stamp}_PPG.txt"), ISO_ROWS)
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
    assert e["Integrator"]["loadable"] is True and e["ECGDex"]["loadable"] is True
    assert e["3 corner hat"] is True and e["PAT"] is True
    # `recordings`/`recordings_unassigned` joined the entry on 2026-10-05: the folder is not the recording,
    # so the index publishes the band grouping BESIDE the folder-wide view. Additive by design — every key
    # below is unchanged — and named here because the key set is the API's contract.
    assert set(e) == {"night", "arrival", "recordings", "recordings_unassigned", *ni.COLUMNS}


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


def test_EVERY_device_s_arrival_sidecar_is_listed_including_a_device_added_later(tmp_path):
    """PAT Feasibility re-times each leg on its own packet-arrival floor, so the index hands the monitor the
    sidecars as their own per-night field (never inside a node's ingest list).

    🔴 THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-10-05 — "and the ring's is not" — on the premise that the
    ring's sidecar carried no PMD stream PAT uses. That was true when written and E11 (#3267) ended it: the
    ring now writes one `PPG_FRAME` row per frame. The list was not revisited, so the monitor handed over two
    sidecars of three and the page printed "no arrival sidecar for the O2Ring" for a night that has one.

    So the assertion is now about the SHAPE of the rule, not about today's device roster: a sidecar is
    identified by the only name `PmdArrivalLogWriter` writes, and the UNKNOWN device below is the real
    regression guard — under an allowlist keyed on device name it falls out silently, and the page explains
    its absence with a reason that is false. A night without sidecars lists none — an empty list, not a
    missing key."""
    root = str(tmp_path)
    d = _night(root)
    names = (
        "Polar_H10_02849638_20260919220000_PMDARRIVAL.csv",
        "Polar_VeritySense_0C301E3F_20260919220000_PMDARRIVAL.csv",
        "Wellue_O2Ring-S_S8AW2100_20260919220000_PMDARRIVAL.csv",
        # a device this repo has never seen: the thing an allowlist cannot admit
        "Acme_FutureSensor_ABCD1234_20260919220000_PMDARRIVAL.csv",
    )
    for name in names:
        _w(os.path.join(d, name), "Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n")
    e = ni.night_entry(os.path.join(root, "captures"), d)
    assert e["arrival"] == sorted("2026-09-19/" + n for n in names), (
        "every sidecar in the folder is handed over, the ring's and an unknown device's included"
    )
    assert any("O2Ring" in f for f in e["arrival"]), "the ring's sidecar is the one E11 made usable"
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

    # ⚠️ THE DOUBLE MIRRORS THE REAL SIGNATURE, and it gained `stamps` on 2026-10-10: `_night_row` now
    # tells `night_entry` WHICH recording the row is for, because one band can carry two. A 3-argument
    # stub raised `TypeError: … 4 were given` and the test read as a listing failure — a double that has
    # drifted from the function it stands in for reports on nothing.
    def boom(captures, night_dir, deadline, stamps=None):
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
    # 🔴 THE SEAM MOVED, DELIBERATELY. This stubbed `list_nights`, which `index_nights` NO LONGER CALLS:
    # row identity is `(night band, recording start)` (owner ruling 2026-10-10), so the listing enumerates
    # BANDS over the union of folders via `_recordings`. A stub on the old seam intercepted nothing and
    # the test saw 0 rows — the "a double that no longer doubles anything" failure, which is worse than a
    # break because a differently-shaped suite could have gone green on it.
    monkeypatch.setattr(
        ni, "_recordings", lambda captures: [(f"2026-07-{d:02d}", frozenset({float(d)})) for d in range(1, 10)] * 7
    )
    seen: list = []

    def rec(captures, night_dir, deadline, stamps=None):
        seen.append(deadline)
        return {"night": os.path.basename(night_dir)}

    monkeypatch.setattr(ni, "night_entry", rec)
    monkeypatch.setattr(ni.time, "monotonic", lambda: 5000.0)
    rows = ni.index_nights(str(tmp_path))
    assert len(rows) == 60, "the newest sixty, which is what the page asks for when it asks for nothing"
    assert seen and all(d == 5015.0 for d in seen), "a fifteen-second budget, handed to every night"


# ── the folder is not the recording (NIGHT-IS-THE-RECORDING-2026-10-05 §⑥) ───────────────────────────


def test_a_folder_holding_TWO_NIGHTS_is_published_as_TWO_RECORDINGS(tmp_path):
    """A calendar folder holds every session stamped that DATE, which is not one night's sleep. Measured on
    2026-10-04: a 00:26 session (the night that began 10-03) and a 22:00 one, 18 files, handed to a page as
    one set — and `pat-three-corner` re-grouped it wrong, taking the largest file per device independently
    and computing a -14.94 h three-way overlap.

    Grouping is `nightqc.night_key_band`, the noon-to-noon window the owner ruled on 2026-10-13. The QC
    verdict is scoped by the SLEEP band, and the two answer different questions — which night a session
    belongs to, and what counts as that night's signal — so a monitor click and a verdict still cannot
    disagree about which sessions are one night. The folder-wide keys stay as they were —
    this is an additive field, because an existing reader of `files` must not silently receive a subset."""
    root = str(tmp_path)
    d = os.path.join(root, "captures", "2026-10-04")
    os.makedirs(d, exist_ok=True)
    # the night that BEGAN 10-03: a 00:26 session, before the 18:00 band edge
    _w(os.path.join(d, "Polar_H10_02849638_20261004002801_ECG.txt"), ISO_ROWS)
    _w(os.path.join(d, "Polar_H10_02849638_20261004002801_PMDARRIVAL.csv"), "Phone timestamp;device;meas\n")
    # the night that BEGAN 10-04: a 22:00 session, after it
    _w(os.path.join(d, "Polar_H10_02849638_20261004220206_ECG.txt"), ISO_ROWS)
    _w(os.path.join(d, "Polar_H10_02849638_20261004220206_PMDARRIVAL.csv"), "Phone timestamp;device;meas\n")

    # 🔴 THE CONTRACT CHANGED ON PURPOSE (owner ruling 2026-10-10). Row identity is
    # `(night band, recording start)`, so one folder holding two nights is TWO ROWS of the listing — not
    # two entries inside one folder's row. The folder is no longer the unit, which is the whole point:
    # the 00:26 session BELONGS to the night that began 10-03 and is now listed there, under a band whose
    # own folder was never created (ADOPTION). Before this ruling it was filed under 2026-10-04 because
    # that is the folder its bytes landed in, and the page showed one night as two.
    rows = ni.index_nights(root, budget_s=None)
    names = [r["night"] for r in rows]
    assert names == ["2026-10-03", "2026-10-04"], (
        "one folder, two recordings, each listed under the EVENING its band is anchored on and ordered "
        f"as the nights happened: {names}"
    )
    first, second = rows
    # ⚠️ AND 2026-10-03 HAS NO FOLDER AT ALL — the row exists because the BAND does. Enumerating folders
    # is exactly what dropped this session from the listing.
    assert not os.path.isdir(os.path.join(root, "captures", "2026-10-03"))
    assert first["ECGDex"]["files"] == ["2026-10-04/Polar_H10_02849638_20261004002801_ECG.txt"]
    assert second["ECGDex"]["files"] == ["2026-10-04/Polar_H10_02849638_20261004220206_ECG.txt"]
    assert first["arrival"] == ["2026-10-04/Polar_H10_02849638_20261004002801_PMDARRIVAL.csv"]
    assert second["arrival"] == ["2026-10-04/Polar_H10_02849638_20261004220206_PMDARRIVAL.csv"]
    # the recording start is the second half of the identity, so two rows are distinguishable
    assert first["recording_start"] == "2026-10-04 00:28" and second["recording_start"] == "2026-10-04 22:02"
    # 🔴 CONSECUTIVE KEY BANDS ABUT, BY OWNER RULING (2026-10-13): "no session falls between two
    # nights". These are the bands the LISTING keys by, and they are noon-to-noon, so they tile the clock
    # and every stamp has exactly one night.
    #
    # ⏪ THEY USED TO SIT 8 H APART, and that gap is now the SLEEP band's, not the key's. A sleep band is
    # 16 h (18:00→10:00), so 10:00–18:00 belongs to no night's SIGNAL — wear there is excluded from the
    # night with its span named (NIGHT-IS-THE-RECORDING §scope) rather than folded into whichever night
    # is nearer. The exclusion survives this change: the gap moved from the key to admission, where the
    # numbers are actually read. `nightqc._NIGHT_BEGIN_H`'s comment carries the 24-test measurement.
    b1, b2 = first["recordings"][0], second["recordings"][0]
    assert b2["begin"] - b1["end"] == 0.0, (
        f"the key bands tile, so night D+1 opens where night D closed: {b1['end']} → {b2['begin']}"
    )
    assert b1["end"] - b1["begin"] == 24 * 3600.0
    # and the SLEEP band it is keyed beside still leaves the 8 h daytime window to neither night
    import nightqc as _nq

    s1 = _nq.night_band(first["recordings"][0]["first"])
    s2 = _nq.night_band(second["recordings"][0]["first"])
    assert s2[0] - s1[1] == 8 * 3600.0, f"the sleep bands still stand 8 h apart: {s1} → {s2}"
    assert s1[1] - s1[0] == 16 * 3600.0


def test_a_file_with_NO_SESSION_STAMP_is_named_not_filed_under_a_guessed_band(tmp_path):
    """∅ The CPAP trees are keyed by DATE and carry no session stamp. Assigning them to whichever band the
    folder's name suggests would be a guess presented as grouping, and dropping them would make the
    monitor's own handoff lossy — so they are returned separately and the caller says so."""
    entry = {
        "arrival": ["2026-10-04/Polar_H10_02849638_20261004220206_PMDARRIVAL.csv"],
        "ECGDex": {"files": ["2026-10-04/Polar_H10_02849638_20261004220206_ECG.txt"]},
        "CPAPDex": {"files": ["2026-10-04/cpap/DATALOG/20261004/20261004_220000_BRP.edf"]},
    }
    recs, unassigned = ni.recordings_of(entry)
    assert [r["recording"] for r in recs] == ["2026-10-04"]
    assert recs[0]["files"] == {"ECGDex": ["2026-10-04/Polar_H10_02849638_20261004220206_ECG.txt"]}, (
        "the stamped file bands; the CPAP tree does not appear under it"
    )
    assert unassigned == ["2026-10-04/cpap/DATALOG/20261004/20261004_220000_BRP.edf"]
    assert all("cpap" not in f for r in recs for v in r["files"].values() for f in v)


def test_session_epoch_refuses_a_serial_and_an_impossible_instant(tmp_path):
    """The stamp is anchored between separators for the reason `pat-feasibility.js` is: a loose 8-then-6
    scan grabs the H10's device serial instead of the date, which is the zero-nights bug. And a stamp that
    looks real but names no instant is None, never a rolled-over date."""
    assert ni.session_epoch("Polar_H10_H10-01_ECG.txt") is None
    assert ni.session_epoch("Polar_X_20261332999999_ECG.txt") is None, "month 13 is not a time"
    assert ni.session_epoch("cpap/DATALOG/20261004/x_BRP.edf") is None
    assert ni.session_epoch("Polar_H10_02849638_20261004220206_ECG.txt") is not None
    assert ni.session_epoch("Polar_H10_02849638_20260919_220000_ECG.txt") is not None, "both layouts parse"


def test_an_unstamped_file_does_not_STOP_the_grouping_and_first_is_the_EARLIEST_session(tmp_path):
    """Two mutants of `recordings_of` that the tests above could not see, each needing its own shape.

    `continue` → `break`: a file with no session stamp must be SKIPPED, not end the walk. One unstamped
    file at the end of a list cannot show the difference — the loop was finishing anyway. So the list here
    puts the CPAP tree FIRST, with stamped files after it: under `break` those never band and the recording
    loses them silently, which is the §∅ failure (a dropped file reported as an absent night).

    `r["first"] = min(...)` → `None`: a recording's `first` is the earliest session IN it, and a band holds
    several. A single-session recording cannot see this — min(x, x) is x either way — so this band carries
    three sessions and the assertion names the earliest, which is also what makes `first` usable as "when
    did this night actually start" rather than "whichever session was walked last"."""
    entry = {
        "arrival": [],
        "CPAPDex": {
            "files": [
                # FIRST in the list, and unstamped: the position is the point
                "2026-10-04/cpap/DATALOG/20261004/20261004_220000_BRP.edf",
            ]
        },
        "ECGDex": {
            "files": [
                "2026-10-04/cpap/DATALOG/20261004/nostamp_BRP.edf",
                "2026-10-04/Polar_H10_02849638_20261004233000_ECG.txt",
                "2026-10-04/Polar_H10_02849638_20261004220206_ECG.txt",
                "2026-10-04/Polar_H10_02849638_20261005010000_ECG.txt",
            ]
        },
    }
    recs, unassigned = ni.recordings_of(entry)
    assert [r["recording"] for r in recs] == ["2026-10-04"], recs
    got = recs[0]["files"]["ECGDex"]
    assert len(got) == 3, f"an unstamped file must not end the walk — the three stamped files band: {got}"
    assert len(unassigned) == 2

    want = ni.session_epoch("Polar_H10_02849638_20261004220206_ECG.txt")
    assert recs[0]["first"] == want, (
        "`first` is the EARLIEST session in the recording (22:02), not the last one walked (01:00) "
        f"and not None: {recs[0]['first']} != {want}"
    )
    assert recs[0]["begin"] <= recs[0]["first"] < recs[0]["end"]


def test_ARRIVAL_FILES_BAND_AND_SORT_and_TWO_KEY_BANDS_STAY_TWO_RECORDINGS(tmp_path):
    """Four more mutants of `recordings_of` that the tests above could not see (#3650's diff-scoped
    gate). All four need one shape: an `arrival` list that is NON-EMPTY and spans two key bands.

    `entry.get("arrival") or []` -> `and []`, and `entry.get("arrival")` -> `entry.get(None)`: both hand
    back an EMPTY arrival list. Every test above passes `arrival: []` already, and an empty list cannot
    tell an emptied one from itself.

    `r["arrival"] = sorted(r["arrival"])` -> `None`: a recording's arrival files are SORTED, so this
    fixture lists them out of walk order and the assertion names the order rather than the membership.

    `by_band.setdefault(name, ...)` -> `setdefault(None, ...)`: one key for every band merges two nights
    into ONE recording carrying the first name. A single-band fixture cannot see it, so this one spans
    two — which is also the §(6) property stated through `recordings_of` directly rather than through
    `index_nights`."""
    entry = {
        "arrival": [
            # OUT OF ORDER on purpose: the later session is listed first
            "2026-10-04/Polar_H10_02849638_20261004233000_PMDARRIVAL.csv",
            "2026-10-04/Polar_H10_02849638_20261004220206_PMDARRIVAL.csv",
            # and this one sits in the NEXT key band, 15:00 the following afternoon
            "2026-10-05/Polar_H10_02849638_20261005150000_PMDARRIVAL.csv",
        ],
    }
    recs, unassigned = ni.recordings_of(entry)
    assert [r["recording"] for r in recs] == ["2026-10-04", "2026-10-05"], recs
    assert recs[0]["arrival"] == [
        "2026-10-04/Polar_H10_02849638_20261004220206_PMDARRIVAL.csv",
        "2026-10-04/Polar_H10_02849638_20261004233000_PMDARRIVAL.csv",
    ], f"the arrival files band, and they are sorted rather than kept in walk order: {recs[0]['arrival']}"
    assert recs[1]["arrival"] == ["2026-10-05/Polar_H10_02849638_20261005150000_PMDARRIVAL.csv"]
    assert unassigned == []
    assert recs[1]["begin"] == recs[0]["end"], "the key bands abut, so the two recordings are adjacent"


# ══ ONE NIGHT IS ONE ROW, EVEN WHEN THE POLAR STREAMS START AFTER MIDNIGHT (owner report 2026-10-09→10) ══
# The night of 10-09→10-10 is ONE recording: ring at 21:25 in folder 2026-10-09, Verity at 01:47 and H10
# at 01:50 in folder 2026-10-10. The page showed it as TWO nights — 10-09 (OxyDex) and 10-10 (the Polar
# nodes plus an OxyDex "0 kB / ?" cell). Nothing was wrong with the capture; the listing grouped by folder.


def _last_night(root):
    """Last night's real shape, from the box reading: one recording across two folders, plus the morning
    daytime ring session whose stream files are 0-byte buffered headers (brief §④′)."""
    d9, d10 = os.path.join(root, "2026-10-09"), os.path.join(root, "2026-10-10")
    for d in (d9, d10):
        os.makedirs(d, exist_ok=True)
    open(os.path.join(d9, "Wellue_O2Ring-S_ABC_20261009212546_SPO2.csv"), "w").write("x" * 587000)
    for suf, sz in (("ECG", 5000), ("ACC", 1000)):
        open(os.path.join(d10, f"Polar_H10_02849638_20261010015024_{suf}.txt"), "w").write("x" * sz)
    for suf, sz in (("PPG", 4000), ("ACC", 1000)):
        open(os.path.join(d10, f"Polar_VeritySense_0C301E3F_20261010014748_{suf}.txt"), "w").write("x" * sz)
    for suf in ("PPG", "PLETHA", "PPG2W", "ACCRAW"):
        open(os.path.join(d10, f"Wellue_O2Ring-S_ABC_20261010091801_{suf}.txt"), "w").close()
    open(os.path.join(d10, "Wellue_O2Ring-S_ABC_20261010091801_SPO2.csv"), "w").close()
    return d9, d10


def _nodes(entry):
    return sorted(k for k, v in entry.items() if isinstance(v, dict) and v.get("files"))


def test_a_night_whose_polar_streams_start_after_midnight_is_ONE_row(tmp_path):
    """🔴 THE PLANT, red on main. The evening folder's row must carry every device of the recording,
    including the sets whose BYTES live under the next date — membership by session START, which is what
    `solid_night_inputs.in_band` decides and what makes the two-folder bound structural.

    On main this row holds OxyDex alone and the five Polar columns appear under 2026-10-10."""
    d9, _d10 = _last_night(str(tmp_path))
    got = _nodes(ni.night_entry(str(tmp_path), d9))
    for node in ("OxyDex", "ECGDex", "PPGDex", "MotionDex"):
        assert node in got, f"{node} missing from the evening row: {got}"


def test_the_MORNING_folder_no_longer_carries_a_phantom_night(tmp_path):
    """The other half of the split, and the "0 kB / ?" cell the owner actually saw: folder 2026-10-10
    held only sessions belonging to 10-09's band, so it must contribute NO row of its own — rather than a
    second night whose OxyDex cell is a 0-byte buffered header read as a night with no data."""
    _d9, d10 = _last_night(str(tmp_path))
    entry = ni.night_entry(str(tmp_path), d10)
    assert _nodes(entry) == [], f"the morning folder still claims a night: {_nodes(entry)}"
    zero = [k for k, v in entry.items() if isinstance(v, dict) and v.get("bytes") == 0]
    assert zero == [], f"a 0-byte cell is still published as a night's data: {zero}"


def test_TWO_GENUINELY_SEPARATE_NIGHTS_STAY_TWO_ROWS(tmp_path):
    """THE CONTROL that keeps this from being a merge-everything change. Two evenings, each with its own
    first donning after 18:00, must remain two rows — if band membership were widened to "any file under
    either folder" this is what would fail, and the fix would read as working on the plant alone."""
    root = str(tmp_path)
    for day, stamp in (("2026-10-01", "20261001213000"), ("2026-10-02", "20261002220000")):
        d = os.path.join(root, day)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, f"Wellue_O2Ring-S_ABC_{stamp}_SPO2.csv"), "w").write("x" * 1000)
        open(os.path.join(d, f"Polar_H10_02849638_{stamp}_ECG.txt"), "w").write("x" * 1000)
    for day in ("2026-10-01", "2026-10-02"):
        got = _nodes(ni.night_entry(root, os.path.join(root, day)))
        assert "OxyDex" in got and "ECGDex" in got, (day, got)
    # and neither night swallowed the other's files
    e1 = ni.night_entry(root, os.path.join(root, "2026-10-01"))
    assert all("2026-10-02" not in f for f in e1["OxyDex"]["files"]), e1["OxyDex"]["files"]


def test_a_DATE_KEYED_tree_is_not_expanded_across_folders(tmp_path):
    """⚠️ THE CPAP TREES ARE ROOT-RELATIVE AND CARRY NO SESSION STAMP, so they are deliberately left on
    the old path. `session_epoch` returns None for them (its docstring says why), meaning there is no
    start to judge membership by — globbing them across a second date would file one day's tree under
    another night on the strength of a guess, which is the fabrication this change exists to remove."""
    root = str(tmp_path)
    os.makedirs(os.path.join(root, "2026-10-09"), exist_ok=True)
    for ymd in ("20261009", "20261010"):
        d = os.path.join(root, "cpap", "DATALOG", ymd)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, f"{ymd}_000000_BRP.edf"), "w").write("x" * 100)
    cell = ni.night_entry(root, os.path.join(root, "2026-10-09")).get("CPAPDex")
    assert cell and all("20261009" in f for f in cell["files"]), cell


# ══ THE RECORDING ENUMERATION'S OWN EDGES (2026-10-10) ═════════════════════════════════════════════


def test_ONE_BAND_CARRIES_TWO_ROWS_when_a_doff_gap_splits_it(tmp_path):
    """🔴 LAST NIGHT, AND THE CASE THE OWNER REPORTED. Row identity is `(night band, recording start)`, so
    the ring at 21:25 and the Polar sets at 01:47/01:50 — which land in DIFFERENT folders — are ONE row,
    while the 09:18 morning session is a SECOND row in the same band.

    ⚠️ AND THE CHAIN IS MEASURED END-TO-START, which my first version got wrong. The ring begins 21:25
    and the H10 01:50 — 4 h 22 m apart by START, so a start-to-start gap split the night in two. The
    Polar sessions begin INSIDE the ring's 5.8 h recording, so the wear never stopped; what separates
    09:18 is that it begins 6 h after the chain's furthest END."""
    import time as _t

    root = str(tmp_path)
    c = os.path.join(root, "captures")
    ep = lambda s: _t.mktime(_t.strptime(s, "%Y%m%d%H%M%S"))  # noqa: E731

    def put(day, name, size, end):
        d = os.path.join(c, day)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, name)
        open(p, "w").write("x" * size)
        os.utime(p, (end, end))

    put("2026-10-09", "Wellue_O2Ring-S_A_20261009212546_SPO2.csv", 587000, ep("20261010031500"))
    put("2026-10-10", "Polar_H10_02849638_20261010015024_ECG.txt", 5000, ep("20261010064500"))
    put("2026-10-10", "Wellue_O2Ring-S_A_20261010091801_SPO2.csv", 100, ep("20261010101500"))
    rows = ni.index_nights(root, budget_s=None)
    assert [r["night"] for r in rows] == ["2026-10-09", "2026-10-09"], [r["night"] for r in rows]
    starts = [r["recording_start"] for r in rows]
    assert starts == ["2026-10-09 21:25", "2026-10-10 09:18"], starts
    night, morning = rows
    # the night carries BOTH devices despite their bytes living under two dates — the reported defect
    assert night["OxyDex"] and night["ECGDex"], night
    # and the morning session is its own row, not merged into the night and not a "0 kB / ?" cell on a
    # phantom 2026-10-10 night
    assert morning["OxyDex"] and morning.get("ECGDex") is None, morning


def test_a_DATE_KEYED_night_with_no_session_stamp_anywhere_still_gets_a_row(tmp_path):
    """🔴 THE LOSS I ALMOST SHIPPED. The CPAP trees are date-keyed and carry no session stamp, so a night
    whose only data is CPAP produces NO recording — and enumerating recordings alone gave ZERO rows for a
    night that is on disk. That is `_night_row`'s own trap one level up: "an omitted night reads as a
    night that was never captured"."""
    root = str(tmp_path)
    os.makedirs(os.path.join(root, "captures", "2026-10-07"), exist_ok=True)
    _edf(os.path.join(root, "captures", "cpap", "DATALOG", "20261007", "20261007_000000_BRP.edf"))
    rows = ni.index_nights(root, budget_s=None)
    assert [r["night"] for r in rows] == ["2026-10-07"], rows
    assert rows[0]["CPAPDex"], rows[0]
    # it has no recording, so it carries no recording_start — the identity's second half is absent, not 0
    assert "recording_start" not in rows[0]


def test_an_EMPTY_date_folder_claims_no_night_and_a_stampless_file_is_not_a_session(tmp_path):
    """Two absences that must NOT become rows. A folder whose files all band to the previous evening must
    stay rowless — otherwise the phantom second row the owner reported comes straight back — and a file
    with no session stamp contributes no session start to chain on."""
    root = str(tmp_path)
    d = os.path.join(root, "captures", "2026-10-11")
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "notes.txt"), "w").write("no session stamp here")
    assert ni.index_nights(root, budget_s=None) == []


def test_a_file_that_vanishes_between_the_glob_and_the_stat_is_skipped(tmp_path, monkeypatch):
    """The capture tree is written while it is read. A file listed by the glob and gone by the `stat`
    must drop out of the span map rather than taking the whole listing down — `index_nights` is the
    endpoint the Nights page calls, and one racing unlink must not empty it."""
    root = str(tmp_path)
    _night(root, "2026-09-19", cpap=False)
    real = ni.os.path.getmtime

    def vanishing(p):
        if p.endswith("_ECG.txt"):
            raise OSError(2, "No such file or directory")
        return real(p)

    monkeypatch.setattr(ni.os.path, "getmtime", vanishing)
    rows = ni.index_nights(root, budget_s=None)
    assert [r["night"] for r in rows] == ["2026-09-19"], rows


def test_an_EMPTY_date_keyed_tree_is_not_a_night(tmp_path):
    """The other side of the date-keyed row: a `DATALOG/<ymd>` directory that exists but holds no file is
    not a night. The daemon creates the tree before the first EDF lands, so an empty one is a night that
    has not arrived — and publishing it would be the mirror of the omission it exists to prevent."""
    root = str(tmp_path)
    os.makedirs(os.path.join(root, "captures", "cpap", "DATALOG", "20261008"), exist_ok=True)
    assert ni.index_nights(root, budget_s=None) == []


def test_a_MIDDAY_session_IS_KEYED_TO_ITS_OWN_DAY_not_the_previous_evening(tmp_path):
    """🔴 THE OWNER'S NOON-TO-NOON RULING (2026-10-13), at the one site that used to get it wrong. A
    14:00 session now keys to its OWN day, because the key band runs 12:00 to 12:00 and contains it.

    ⏪ WHAT IT USED TO DO, kept because it is why there are two bands. The sleep band is 16 h
    (18:00→10:00), so 10:00–18:00 belongs to no night under it. I expected `night_band` to return None
    there and asserted it; it does not. For a stamp before 18:00 it anchors to the PREVIOUS evening, so
    14:00 was handed `[prev 18:00, 10:00)` — a band ENDING FOUR HOURS BEFORE IT. That is still true of
    the sleep band and is asserted below, which is the point: a band that does not contain the stamp can
    decide ADMISSION but must never decide the KEY.

    The listing consequence is still that a midday session gets its OWN row rather than vanishing or
    merging into a night's cells. Only the row's key moved."""
    import nightqc

    root = str(tmp_path)
    d = os.path.join(root, "captures", "2026-10-10")
    os.makedirs(d, exist_ok=True)
    _w(os.path.join(d, "Polar_H10_02849638_20261010140000_ECG.txt"), ISO_ROWS)
    t = nightqc.floating_stamp_s("20261010140000")
    band = nightqc.night_band(t)
    assert band is not None and band[1] < t, (
        "the SLEEP band still returns the previous evening's window for a midday stamp — one that does "
        f"not contain it: {band} vs {t}"
    )
    kb = nightqc.night_key_band(t)
    assert kb[0] <= t < kb[1], f"the KEY band must contain the stamp it keys: {kb} vs {t}"
    rows = ni.index_nights(root, budget_s=None)
    assert [r["night"] for r in rows] == ["2026-10-10"], rows
    assert rows[0]["recording_start"] == "2026-10-10 14:00", rows[0]


def test_a_STAMPLESS_file_does_not_STOP_the_scan_of_the_folder(tmp_path):
    """🔴 `continue` → `break` in `_session_spans`, named by CI as a survivor. A folder holds stampless
    files beside stamped ones (`status.json`, a note, a sidecar), and a `break` on the first one would
    abandon every session after it — the night would list with fewer devices, or not at all.

    ⚠️ THE STAMPLESS FILE MUST COME FIRST IN THE SCAN ORDER, or the mutant cannot be seen: after the
    last element `continue` and `break` do the same thing. `glob` here is unsorted, so the fixture uses
    a name that sorts before the capture files AND one that sorts after, which covers the mutant
    whichever order the filesystem returns."""
    root = str(tmp_path)
    d = os.path.join(root, "captures", "2026-10-09")
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "AAA-no-stamp.txt"), "w").write("x")  # sorts first
    _w(os.path.join(d, "Polar_H10_02849638_20261009220000_ECG.txt"), ISO_ROWS)
    open(os.path.join(d, "zzz-no-stamp.txt"), "w").write("x")  # sorts last
    rows = ni.index_nights(root, budget_s=None)
    assert [r["night"] for r in rows] == ["2026-10-09"], rows
    assert rows[0]["ECGDex"], "the stamped session after a stampless file must still be scanned"


def test_DROPPING_THE_SCOPE_narrows_the_row_to_its_own_folder(tmp_path):
    """The scope-passing survivors (`_expand(root, night_dir, p, None)` and the argument dropped). With
    the scope the row reaches the recording's second folder; without it the enumeration is this folder
    alone — which is the documented degrade, and now observably different rather than silently equal.

    Before this was simplified the two agreed, because `_expand` recomputed the band from `night_dir`
    when the scope was absent — a second definition of the band that made every scope-dropping mutant
    unkillable."""
    root = str(tmp_path)
    c = os.path.join(root, "captures")
    for day in ("2026-10-09", "2026-10-10"):
        os.makedirs(os.path.join(c, day), exist_ok=True)
    _w(os.path.join(c, "2026-10-09", "Wellue_O2Ring-S_A_20261009212546_SPO2.csv"), "Time,Oxygen Level\n")
    _w(os.path.join(c, "2026-10-10", "Polar_H10_02849638_20261010015024_ECG.txt"), ISO_ROWS)
    d9 = os.path.join(c, "2026-10-09")
    import solid_night_inputs as si

    scope = si.recording_scope(d9)
    with_scope = ni._expand(c, d9, "Polar_H10_*_ECG.txt", scope)
    without = ni._expand(c, d9, "Polar_H10_*_ECG.txt", None)
    assert len(with_scope) == 1, with_scope
    assert without == [], "without the scope the enumeration is this folder alone"


def test_a_file_that_is_not_a_FILE_is_not_a_session(tmp_path):
    """The other half of `_session_spans`' skip: a DIRECTORY whose name carries a session stamp (an
    operator's copy, an unpacked archive) is not a session. `session_epoch` reads the name and would
    return a start for it, so the `isfile` half of the guard is what keeps a folder out of the span map."""
    root = str(tmp_path)
    d = os.path.join(root, "captures", "2026-10-09")
    # ⚠️ THE DIRECTORY'S STAMP IS EARLIER THAN THE FILE'S, deliberately. My first version used a LATER
    # stamp and the mutant survived: freshly written fixtures all carry mtime=now, so the chain's reach
    # swallowed the later stamp and the row was identical either way. An earlier stamp moves
    # `recording_start`, which is the one field that cannot absorb it.
    os.makedirs(os.path.join(d, "Polar_H10_02849638_20261009200000_ECG.txt"), exist_ok=True)  # a DIR, 20:00
    _w(os.path.join(d, "Polar_H10_02849638_20261009220000_ECG.txt"), ISO_ROWS)
    rows = ni.index_nights(root, budget_s=None)
    assert len(rows) == 1, rows
    assert rows[0]["recording_start"] == "2026-10-09 22:00", (
        "a directory whose NAME carries a session stamp is not a session: " + str(rows[0])
    )


def test_the_span_END_comes_from_the_nights_RECORDED_writer_offset(tmp_path):
    """🔴 THE END IS AN INSTANT AND THE START IS CIVIL, so one of them has to cross a frame — and the
    night's own recorded offset is the only place `SESSION-SPAN-WRITER-OFFSET-2026-09-28-BRIEF.md` §1
    allows that crossing. This asserts the crossing happened with THAT number, which is what tells a
    read of `STARTS.csv` apart from a value computed and then dropped.

    ⚠️ THE FIXTURE'S ZONE IS DELIBERATELY NOT THE RUNNER'S. `utc_offset_sec` is UTC+12 here, so the
    recorded conversion lands 12 h from the mtime whatever zone the suite runs in — while the host-zone
    fallback lands 0 h away under `TZ=UTC` and 4 h away under EDT. A fixture recording the runner's own
    offset would agree with the fallback on one machine and hide the difference."""
    root = str(tmp_path)
    d = os.path.join(root, "captures", "2026-10-09")
    f = os.path.join(d, "Polar_H10_02849638_20261009220000_ECG.txt")
    _w(f, ISO_ROWS)
    # The HEADER names the column; `recorded_writer_offset` addresses it by name, and a five-column
    # pre-2026-10-05 file must read as "nothing recorded" instead of a parse error.
    _w(
        os.path.join(d, "STARTS.csv"),
        "Phone timestamp;pid;git;dirty;adapter;utc_offset_sec\n2026-10-09T22:00:00;1;abc0000;0;hci0;43200\n",
    )
    import nightqc

    t = nightqc.floating_stamp_s("20261009220000")
    spans = ni._session_spans(root)
    # 43200 EAST of UTC is a raise of -43200, so the floating end sits 12 h AFTER the mtime. The sign is
    # the half of this that a `+` for a `-` would survive without.
    want = os.path.getmtime(f) + 43200.0
    assert abs(spans[t] - want) < 1e-6, (spans[t], want, "the end must cross on the RECORDED offset")


def test_a_night_that_recorded_NO_offset_falls_back_to_the_HOSTS_zone(tmp_path):
    """The other branch, and the one every night before 2026-10-05 takes. `_floating_mtime` reads the
    host's zone at the file's own instant, which is a PREMISE: it holds while the index runs on the box
    that wrote the files. The assertion states the premise rather than restating the conversion — the
    fallback must equal what a night would get had it recorded the host's own offset for that instant."""
    p = os.path.join(str(tmp_path), "f.txt")
    _w(p, "x")
    import datetime as _dt

    import nightqc

    m = os.path.getmtime(p)
    # EAST of UTC from the host's own rules AT THAT INSTANT, negated into the raise convention. Reading
    # the zone at the instant rather than at import time is what carries a span across a DST seam.
    east = _dt.datetime.fromtimestamp(m).astimezone().utcoffset()
    assert east is not None
    declared = nightqc.declared_offset(-east.total_seconds())
    assert abs(ni._floating_mtime(p, None) - ni._floating_mtime(p, declared)) < 1e-6, (
        "the fallback is the host's own zone at the file's instant, stated as a premise"
    )


def test_the_PRIMARY_re_read_takes_the_scope_too(tmp_path):
    """`_expand_alt`'s `pick` branch — the one that re-reads the chosen alternative so a node's primary
    comes from the tree its files came from. CI named `_expand(root, night_dir, pat[pick], None)` as a
    survivor: with the scope dropped the re-read falls back to this folder alone, so a node whose primary
    lives in the recording's SECOND folder would lose its `hours` and stats while keeping its files.

    Driven through the `pick` path explicitly, because nothing else in the suite reaches it with a scope
    that matters."""
    root = str(tmp_path)
    c = os.path.join(root, "captures")
    for day in ("2026-10-09", "2026-10-10"):
        os.makedirs(os.path.join(c, day), exist_ok=True)
    _w(os.path.join(c, "2026-10-09", "Wellue_O2Ring-S_A_20261009212546_SPO2.csv"), "Time,Oxygen Level\n")
    _w(os.path.join(c, "2026-10-10", "Polar_VeritySense_0C30_20261010014748_PPG.txt"), ISO_ROWS)
    d9 = os.path.join(c, "2026-10-09")
    import solid_night_inputs as si

    scope = si.recording_scope(d9)
    pats = ni.NODES["PPGDex"][0]
    got, pick = ni._expand_alt(c, d9, pats, None, scope)
    assert got and pick == 0, (got, pick)
    # the re-read with an explicit `pick` must reach the same file — this is the branch CI named
    again, _ = ni._expand_alt(c, d9, pats, pick, scope)
    assert again == got, (again, got)
    assert ni._expand_alt(c, d9, pats, pick, None)[0] == [], "without the scope the re-read sees nothing"


def test_the_STAMP_FILTER_is_what_keeps_one_recording_out_of_the_others_arrival(tmp_path):
    """CI named the stamps filter in `_recording_files` as a survivor, and it was: every fixture until
    now had a stamp set covering all the files in scope, so switching the filter off changed nothing.

    Two recordings in ONE band is the input that separates them — the night's arrival sidecar and the
    morning session's must not appear in each other's row."""
    import time as _t

    root = str(tmp_path)
    c = os.path.join(root, "captures")
    os.makedirs(os.path.join(c, "2026-10-09"), exist_ok=True)
    ep = lambda s: _t.mktime(_t.strptime(s, "%Y%m%d%H%M%S"))  # noqa: E731
    for stamp, end in (("20261009220000", "20261010030000"), ("20261010083000", "20261010093000")):
        for suf in ("ECG", "PMDARRIVAL"):
            ext = "csv" if suf == "PMDARRIVAL" else "txt"
            p = os.path.join(c, "2026-10-09", f"Polar_H10_02849638_{stamp}_{suf}.{ext}")
            _w(p, "Phone timestamp;device;meas\n" if suf == "PMDARRIVAL" else ISO_ROWS)
            os.utime(p, (ep(end), ep(end)))
    rows = ni.index_nights(root, budget_s=None)
    assert len(rows) == 2, [r.get("recording_start") for r in rows]
    for r in rows:
        stamp = "20261009220000" if r["recording_start"].endswith("22:00") else "20261010083000"
        assert r["arrival"] and all(stamp in a for a in r["arrival"]), (r["recording_start"], r["arrival"])


def _put(c, day, name, body, end):
    """A capture file with an explicit mtime — the session END the chaining reads."""
    import time as _t

    d = os.path.join(c, day)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name)
    _w(p, body)
    ep = _t.mktime(_t.strptime(end, "%Y%m%d%H%M%S"))
    os.utime(p, (ep, ep))
    return p


def test_a_gap_EXACTLY_the_session_threshold_BREAKS_the_chain(tmp_path):
    """`>=` → `>` on the chain break, named by CI. The two differ on EXACTLY ONE input: a gap of exactly
    `nightqc._SESSION_GAP_SEC`. Anything else cannot see it, which is why the boundary is the fixture —
    a threshold test that does not sit on the threshold tests the wrong side of it."""
    import nightqc

    root = str(tmp_path)
    c = os.path.join(root, "captures")
    gap = nightqc._SESSION_GAP_SEC
    assert gap == 3600.0, gap
    # evening session ends 22:30; the next starts exactly 3600 s later at 23:30
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009220000_ECG.txt", ISO_ROWS, "20261009223000")
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009233000_ECG.txt", ISO_ROWS, "20261009234000")
    rows = ni.index_nights(root, budget_s=None)
    assert len(rows) == 2, "a gap of exactly the threshold is a NEW recording: " + str(
        [r.get("recording_start") for r in rows]
    )
    assert [r["recording_start"] for r in rows] == ["2026-10-09 22:00", "2026-10-09 23:30"], rows


def test_a_SESSION_END_is_the_LATEST_write_across_all_of_its_files(tmp_path):
    """Three survivors lived on `spans[t] = max(spans.get(t, end), end, t)`: dropping the accumulation
    (`max(end, t)`), dropping the new end (`max(spans.get(...), t)`), and keying the lookup on None.

    The input that separates them is one session with TWO files whose mtimes differ, where the file
    scanned FIRST has the LATER write. Accumulating keeps that later end; any of the three mutants
    forgets it, the chain's reach falls back to the earlier end, and the next session — which should
    chain — breaks away into a second row."""
    root = str(tmp_path)
    c = os.path.join(root, "captures")
    # one session, two files: the alphabetically-first carries the LATER mtime (23:50)
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009220000_ACC.txt", ISO_ROWS, "20261009235000")
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009220000_ECG.txt", ISO_ROWS, "20261009223000")
    # a session 1 h 10 m after the EARLIER end but inside the accumulated one
    _put(c, "2026-10-09", "Polar_VeritySense_0C30_20261009234000_PPG.txt", ISO_ROWS, "20261010010000")
    rows = ni.index_nights(root, budget_s=None)
    assert len(rows) == 1, "the session end is the LATEST write across its files, so the 23:40 session chains: " + str(
        [r.get("recording_start") for r in rows]
    )


def test_a_SESSION_END_is_never_EARLIER_than_its_own_start(tmp_path):
    """`max(..., end, t)` → the `t` dropped, named by CI. A file can carry an mtime BEFORE its session
    stamp — a copy, a restore, an `utime` — and an end earlier than the start is not a span. Without the
    `t` floor the chain's reach goes backwards and the next session breaks away for no reason."""
    root = str(tmp_path)
    c = os.path.join(root, "captures")
    # mtime 19:00, two hours BEFORE the 21:00 session stamp
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009210000_ECG.txt", ISO_ROWS, "20261009190000")
    _put(c, "2026-10-09", "Polar_VeritySense_0C30_20261009214000_PPG.txt", ISO_ROWS, "20261009230000")
    rows = ni.index_nights(root, budget_s=None)
    assert len(rows) == 1, (
        "the end is floored at the start, so the 21:40 session is 40 min from reach and chains: "
        + str([r.get("recording_start") for r in rows])
    )


def test_a_FILE_THAT_VANISHES_does_not_abandon_the_files_after_it(tmp_path, monkeypatch):
    """`continue` → `break` in the OSError arm, named by CI. The capture tree is written while it is
    read, so one racing unlink must cost one file — not every file the sorted scan had not reached yet.

    ⚠️ The raising file must sort BEFORE the one that matters, which is what the now-sorted scan makes
    possible to guarantee: `AAA` precedes `Polar_…`, so a `break` loses the session entirely."""
    root = str(tmp_path)
    c = os.path.join(root, "captures")
    _put(c, "2026-10-09", "AAA_Polar_H10_02849638_20261009200000_ECG.txt", ISO_ROWS, "20261009210000")
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009220000_ECG.txt", ISO_ROWS, "20261009230000")
    real = ni.os.path.getmtime

    def vanishing(p):
        if os.path.basename(p).startswith("AAA_"):
            raise OSError(2, "No such file or directory")
        return real(p)

    monkeypatch.setattr(ni.os.path, "getmtime", vanishing)
    rows = ni.index_nights(root, budget_s=None)
    assert [r.get("recording_start") for r in rows] == ["2026-10-09 22:00"], rows


def test_a_LATER_write_scanned_SECOND_still_extends_the_session(tmp_path):
    """The mirror of the accumulation test above, and it is a separate fixture for a measured reason:
    with the later mtime scanned FIRST, `max(spans.get(t, end), t)` keeps the accumulated value and the
    mutant that DROPS the new `end` survives. Only the reverse order — later write scanned SECOND —
    distinguishes it. Both orders are needed; neither alone covers the pair."""
    root = str(tmp_path)
    c = os.path.join(root, "captures")
    # one session, two files: the alphabetically-first carries the EARLIER mtime this time
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009220000_ACC.txt", ISO_ROWS, "20261009223000")
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009220000_ECG.txt", ISO_ROWS, "20261009235000")
    _put(c, "2026-10-09", "Polar_VeritySense_0C30_20261009234000_PPG.txt", ISO_ROWS, "20261010010000")
    rows = ni.index_nights(root, budget_s=None)
    assert len(rows) == 1, "the new write must extend the session even when it is scanned second: " + str(
        [r.get("recording_start") for r in rows]
    )


def test_a_DERIVED_tool_sees_the_half_of_its_inputs_in_the_NEXT_folder(tmp_path):
    """`_recording_files(night_dir, p, None, stamps)` in the DERIVED loop, named by CI. "PAT" needs an
    H10 ECG AND a Verity PPG; put one in the evening folder and the other in the morning's, and the
    boolean is True only if the enumeration spans the recording. Without the scope it reads False — the
    page would say the night cannot be PAT-analysed when it can."""
    root = str(tmp_path)
    c = os.path.join(root, "captures")
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009210000_ECG.txt", ISO_ROWS, "20261010030000")
    _put(c, "2026-10-10", "Polar_VeritySense_0C30_20261010011500_PPG.txt", ISO_ROWS, "20261010060000")
    rows = ni.index_nights(root, budget_s=None)
    assert len(rows) == 1, [r.get("recording_start") for r in rows]
    assert rows[0]["PAT"] is True, "both PAT inputs are in the recording, across two folders"


def test_a_DERIVED_tool_does_NOT_borrow_the_OTHER_recordings_inputs(tmp_path):
    """`_recording_files(night_dir, p, scope, None)` — the stamps dropped — named by CI. Two recordings
    in ONE band: the night has the H10 only, the morning session has the Verity only. Neither row can
    claim "PAT", and without the stamp filter the night's row borrows the morning's Verity and says it
    can — a tool offered on a night whose inputs were never worn together."""
    root = str(tmp_path)
    c = os.path.join(root, "captures")
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009210000_ECG.txt", ISO_ROWS, "20261009233000")
    _put(c, "2026-10-10", "Polar_VeritySense_0C30_20261010090000_PPG.txt", ISO_ROWS, "20261010093000")
    rows = ni.index_nights(root, budget_s=None)
    assert len(rows) == 2, [r.get("recording_start") for r in rows]
    night = next(r for r in rows if r["recording_start"].endswith("21:00"))
    assert night["PAT"] is False, "the night has no Verity of its own — it must not borrow the morning's"


def test_a_REFUSED_scope_does_not_lend_its_band_to_the_filter(tmp_path, monkeypatch):
    """🔴 THE SITE THE GATE RENDERED AS AN EMPTY DIFF. CI printed
    `- scope: dict / + scope: dict` for `x_night_entry__mutmut_18`, which looks unkillable; generating
    the mutant locally showed the real change was
    `_sc if (_sc.get("ok")) or True else None` — the log had truncated the line at the type annotation.

    It matters because a REFUSED scope is not an empty one: `recording_scope`'s two-folder tripwire
    computes the band BEFORE refusing, so a scope with `ok: False` still carries one. Trusting it would
    filter this folder's files by a band the judgement explicitly declined to use. A refusal must degrade
    to this folder alone, unfiltered — which is what `_scope_parts` now guarantees in one place."""
    import solid_night_inputs as si

    root = str(tmp_path)
    c = os.path.join(root, "captures")
    # a 22:00 session whose band is 2026-10-09; the refused scope below names 2026-10-11's band
    _put(c, "2026-10-09", "Polar_H10_02849638_20261009220000_ECG.txt", ISO_ROWS, "20261009233000")
    d9 = os.path.join(c, "2026-10-09")
    far = si.band_of(os.path.join(c, "2026-10-11"))
    monkeypatch.setattr(
        si,
        "recording_scope",
        lambda night_dir, **kw: {
            "ok": False,
            "reason": "the recording would span 3 folders and the bound is 2 — refusing",
            "band": far,  # a REFUSED scope still carries a band
            "searched_dirs": [os.path.basename(night_dir)],
        },
    )
    entry = ni.night_entry(c, d9)
    assert entry["ECGDex"], (
        "a refused scope must not filter this folder's own files by a band it declined to judge: " + str(entry)
    )


def test_a_DAYTIME_file_in_the_recordings_folder_set_is_NOT_admitted(tmp_path):
    """🔴 THE BAND FILTER MUST BE OBSERVABLE, and the gate proved it was not: `_expand_recording(dirs,
    band, …)` → `(dirs, None, …)` survived on BOTH call paths. `in_band(p, None)` returns True, so a
    dropped band silently admits everything in the folder set — and every existing fixture agreed with
    the mutant, because no test had a file that the band EXCLUDES.

    It needs one: a recording spanning two folders admits folder D+1, and a 14:00 file sitting in D+1 is
    a different session in the daytime gap. Membership is by the stamp in the NAME, so it must be
    excluded even though its folder is in scope. Without the band this file appears in the row."""
    c = os.path.join(str(tmp_path), "captures")
    # ONE recording across midnight: 21:00 in D, resuming 00:30 in D+1 (inside the 18:00→10:00 band)
    _put(c, "2026-10-09", "Polar_H10_0284_20261009210000_PMDARRIVAL.csv", "t\n1\n", "20261009233000")
    _put(c, "2026-10-10", "Polar_H10_0284_20261010003000_PMDARRIVAL.csv", "t\n1\n", "20261010013000")
    # and a SEPARATE daytime session in the same folder — in `dirs`, out of `band`
    _put(c, "2026-10-10", "Polar_H10_0284_20261010143000_PMDARRIVAL.csv", "t\n1\n", "20261010150000")
    d9 = os.path.join(c, "2026-10-09")
    arrival = ni.night_entry(c, d9).get("arrival") or []
    names = [os.path.basename(p) for p in arrival]
    assert "Polar_H10_0284_20261009210000_PMDARRIVAL.csv" in names, names
    assert "Polar_H10_0284_20261010003000_PMDARRIVAL.csv" in names, (
        "the recording crosses midnight, so D+1's 00:30 file belongs to this row: " + str(names)
    )
    assert "Polar_H10_0284_20261010143000_PMDARRIVAL.csv" not in names, (
        "a 14:00 session is NOT in the 18:00→10:00 band — admitting its folder must not admit its "
        "files, or the band filter is doing nothing: " + str(names)
    )


def test_expand_applies_the_band_too_not_just_the_folder_set(tmp_path):
    """The same mutant on `_expand`'s own plain-pattern branch, which the node cells reach through
    `_expand_alt`. Asserted here directly because the two call paths are separate mutation sites: killing
    one leaves the other, which is exactly what the gate reported."""
    import solid_night_inputs as si

    c = os.path.join(str(tmp_path), "captures")
    _put(c, "2026-10-09", "Polar_H10_0284_20261009210000_ECG.txt", "t\n1\n", "20261009233000")
    _put(c, "2026-10-10", "Polar_H10_0284_20261010143000_ECG.txt", "t\n1\n", "20261010150000")
    d9 = os.path.join(c, "2026-10-09")
    scope = si.recording_scope(d9)
    got = [os.path.basename(p) for p in ni._expand(c, d9, "*_ECG.txt", scope)]
    assert "Polar_H10_0284_20261009210000_ECG.txt" in got, got
    assert "Polar_H10_0284_20261010143000_ECG.txt" not in got, (
        "a daytime session in an admitted folder must still be excluded by band: " + str(got)
    )


def test_THREE_recordings_in_one_band_each_get_their_own_row(tmp_path):
    """🔴 `continue` → `break` IN THE CHAINING LOOP, which survived because no fixture had a THIRD
    recording. After the first gap the mutant appends the chain it just started and stops, so every
    later session in that band is silently lost — and a fixture with two recordings cannot see it: the
    break's final append produces the same two rows.

    The triggering element has to sit in the MIDDLE with something after it the assertion checks, which
    is the general shape of a loop-verb mutant ([[a-fixture-can-hit-the-line-and-still-not-see-the-mutant]])."""
    c = os.path.join(str(tmp_path), "captures")
    # three sessions in the 2026-10-09 band, each separated by 1.5 h — well past the 3600 s gap
    _put(c, "2026-10-09", "Polar_H10_0284_20261009190000_ECG.txt", "t\n1\n", "20261009193000")
    _put(c, "2026-10-09", "Polar_H10_0284_20261009210000_ECG.txt", "t\n1\n", "20261009213000")
    _put(c, "2026-10-09", "Polar_H10_0284_20261009230000_ECG.txt", "t\n1\n", "20261009233000")
    recs = ni._recordings(str(tmp_path))
    assert len(recs) == 3, f"three recordings, three rows — a break after the first gap loses the rest: {recs}"
    assert [k for k, _ in recs] == ["2026-10-09"] * 3, recs
    starts = sorted(min(s) for _k, s in recs)
    assert len(set(starts)) == 3, f"each row carries its own start: {starts}"


def _span_rows(start, minutes):
    """Phone-stamped rows one minute apart from `start` (YYYY-MM-DDTHH:MM) — a stream with a real span."""
    import datetime as _d

    t0 = _d.datetime.fromisoformat(start)
    rows = (f"{(t0 + _d.timedelta(minutes=m)).isoformat(timespec='milliseconds')};{m};{m}" for m in range(minutes + 1))
    return "Phone timestamp;sensor timestamp [ns];v\n" + "\n".join(rows) + "\n"


def test_an_AFTER_MIDNIGHT_device_s_cell_is_MEASURED_not_just_listed(tmp_path):
    """🔴 2026-10-09 ON THE BOX: the row listed the H10 and Verity files from the 2026-10-10 folder, and
    both cells read `hours: null` — "not measured yet" beside a measured ring. The file list took the
    recording's scope; the primary re-read in `night_entry` did not, so it looked in the evening folder
    alone and found nothing to measure. `test_a_night_whose_polar_streams_start_after_midnight_is_ONE_row`
    asserts presence only, which is why it stayed green over a cell with no number in it."""
    c = os.path.join(str(tmp_path), "captures")
    _put(c, "2026-10-09", "Wellue_O2Ring-S_SYN_20261009212546_SPO2.csv", "Time,Oxygen Level\n", "20261010030000")
    for dev, stamp, start, minutes, end in (
        ("Polar_H10_SYNTH01", "20261010015024", "2026-10-10T01:50", 120, "20261010035024"),
        ("Polar_VeritySense_SYNTH02", "20261010014748", "2026-10-10T01:47", 90, "20261010031748"),
    ):
        for suf in ("ECG", "RR") if "H10" in dev else ("PPG", "PPI"):
            _put(c, "2026-10-10", f"{dev}_{stamp}_{suf}.txt", _span_rows(start, minutes), end)
    rows = ni.index_nights(str(tmp_path), budget_s=None)
    night = [r for r in rows if r["night"] == "2026-10-09"]
    assert len(night) == 1, [(r["night"], r.get("recording_start")) for r in rows]
    r = night[0]
    assert r["ECGDex"]["hours"] == 2.0 and r["ECGDex"]["fragments"] == 1, r["ECGDex"]
    assert r["PPGDex"]["hours"] == 1.5, r["PPGDex"]
    assert r["PulseDex"]["hours"] == 1.5, r["PulseDex"]
    assert r["HRVDex"]["hours"] == 2.0, r["HRVDex"]


def test_the_PRIMARY_is_THIS_row_s_recording_when_a_band_holds_two(tmp_path):
    """The chain half of the same rule. A morning session in the same band, in the same folder and with
    the LARGER file, is a second row; the night row must measure its own ECG, never the morning's because
    `max(…, key=getsize)` saw both."""
    c = os.path.join(str(tmp_path), "captures")
    for stamp, start, minutes, end in (
        ("20261009220000", "2026-10-09T22:00", 60, "20261009230000"),
        ("20261010083000", "2026-10-10T08:30", 90, "20261010100000"),
    ):
        _put(c, "2026-10-09", f"Polar_H10_SYNTH01_{stamp}_ECG.txt", _span_rows(start, minutes), end)
    rows = ni.index_nights(str(tmp_path), budget_s=None)
    assert len(rows) == 2, [r.get("recording_start") for r in rows]
    by_start = {r["recording_start"][-5:]: r["ECGDex"]["hours"] for r in rows}
    assert by_start == {"22:00": 1.0, "08:30": 1.5}, by_start


def test_a_node_with_files_and_NO_PRIMARY_lists_them_unmeasured(tmp_path, monkeypatch):
    """`prims = … if primary else []`: a node may declare capture patterns without a primary to measure
    (a stream the page lists but cannot time). Its cell lists the files with `hours: None` — it does not
    crash the night row by expanding a `None` pattern. No node in today's `NODES` has that shape, so the
    branch is driven with a patched table; the guard is what keeps a future one from emptying the page."""
    c = os.path.join(str(tmp_path), "captures")
    _put(
        c,
        "2026-10-09",
        "Polar_H10_SYNTH01_20261009220000_ECG.txt",
        _span_rows("2026-10-09T22:00", 60),
        "20261009230000",
    )
    monkeypatch.setattr(ni, "NODES", {"ECGDex": (("Polar_H10_*_ECG.txt",), None)})
    cell = ni.night_entry(c, os.path.join(c, "2026-10-09"))["ECGDex"]
    assert cell["files"] == ["2026-10-09/Polar_H10_SYNTH01_20261009220000_ECG.txt"], cell
    assert cell["hours"] is None and cell["fragments"] is None and cell["pending"] is False, cell


def test_THE_SCREENSHOT_NIGHT_is_one_row_and_the_daytime_sitting_is_flagged(tmp_path):
    """🔴 THE OWNER'S QUESTION, 2026-10-12: "why does the 18:00 rule not show on the HTML monitor?" —
    from a Nights view where 2026-10-09 read "Polar Sense, Polar H10 failed / not measured yet" beside a
    fully green 2026-10-10.

    This fixture IS that night: the ring at 21:25 in folder 2026-10-09, the Verity at 01:47 and the H10
    at 01:50 in folder 2026-10-10. Band keying (#3385) already joins them, so the FIRST assertion is a
    REGRESSION PIN, not new work, and it is here because the screenshot is what the deployed box shows,
    not what this tree does.

    The new facts are the other two rows the same band carries, and they are DIFFERENT QUESTIONS:
      · 09:18 is INSIDE `[18:00, 10:00)`, so its files are admitted and it is a second RECORDING — not
        daytime. The 10:00 edge is an owner ruling; moving it to catch this would move every span.
      · 13:00 is keyed to ITS OWN day by the owner's noon-to-noon ruling (2026-10-13), so it is no
        longer an empty row among this night's rows. Its cells are still every one `None`, because the
        SLEEP band correctly says 13:00 is not night signal — a session that recorded fine, published as
        a night that recorded nothing. `daytime` is what stops that reading (§∅)."""
    root = str(tmp_path)
    c = os.path.join(root, "captures")
    _put(c, "2026-10-09", "Wellue_O2Ring-S_S8AW_20261009212500_SPO2.csv", "Time,SpO2,PR\n", "20261010031300")
    _put(c, "2026-10-10", "Polar_VeritySense_A1B2_20261010014700_PPG.txt", "t\n1\n", "20261010074700")
    _put(c, "2026-10-10", "Polar_H10_0284_20261010015000_ECG.txt", "t\n1\n", "20261010075000")
    _put(c, "2026-10-10", "Wellue_O2Ring-S_S8AW_20261010091800_SPO2.csv", "Time,SpO2,PR\n", "20261010094800")
    _put(c, "2026-10-10", "Polar_H10_0284_20261010130000_ECG.txt", "t\n1\n", "20261010133000")

    rows = ni.index_nights(root, budget_s=None)
    by_start = {r["recording_start"][11:]: r for r in rows}
    assert sorted(by_start) == ["09:18", "13:00", "21:25"], sorted(by_start)
    assert {by_start[k]["night"] for k in ("21:25", "09:18")} == {"2026-10-09"}, (
        "the 21:25 donning and the 09:18 sitting key to the 10-09 evening — one night, two rows: "
        + str([r["night"] for r in rows])
    )
    assert by_start["13:00"]["night"] == "2026-10-10", (
        "a 13:00 start is at or after the key band's noon, so it keys to its OWN day: "
        + str(by_start["13:00"]["night"])
    )

    # ① THE NIGHT IS ONE ROW, ACROSS TWO FOLDERS — the screenshot's two half-nights.
    night = by_start["21:25"]
    assert night["OxyDex"] and night["PPGDex"] and night["ECGDex"], (
        "the ring (folder 10-09) and the two after-midnight Polar streams (folder 10-10) are ONE row"
    )
    assert any("2026-10-09/" in f for f in night["OxyDex"]["files"]), night["OxyDex"]["files"]
    assert any("2026-10-10/" in f for f in night["ECGDex"]["files"]), night["ECGDex"]["files"]
    assert night["daytime"] is False

    # ② 09:18 — its own row, files ADMITTED, and NOT daytime. The band edge is the owner's.
    morning = by_start["09:18"]
    assert morning["daytime"] is False, "09:18 is inside [18:00, 10:00); flagging it needs a wear rule"
    assert morning["OxyDex"] and morning["OxyDex"]["files"], "its files are in the band and stay listed"
    assert morning["ECGDex"] is None, "and it carries only its own session's streams"

    # ③ 13:00 — flagged, and the flag is the ONLY thing distinguishing it from an empty night.
    day = by_start["13:00"]
    assert day["daytime"] is True
    assert all(day[k] is None for k in ("OxyDex", "PPGDex", "ECGDex")), (
        "the band admits nothing, which is exactly why the row needs the flag: " + str(_nodes(day))
    )

    # ANTI-VACUITY ON THE FLAG ITSELF: it must discriminate, not be constant over the population.
    assert {r["daytime"] for r in rows} == {True, False}, [r["daytime"] for r in rows]


def test_the_daytime_flag_sits_on_nightqc_s_OWN_DAYTIME_edges(tmp_path):
    """A second copy of 10 and 18 would drift the moment the owner moves an edge again — the sleep band
    was already moved once (20 → 18 by ruling, 2026-10-05) and the key band once more (noon-to-noon,
    2026-10-13). So the edges are read from `nightqc` and the test MONKEYPATCHES them: a flag computed
    from literals stays `True` at 13:00 and this reds.

    ⚠️ IT IS `_DAYTIME_*` IT READS, NOT THE BAND. The flag used to be the sleep band's uncovered gap,
    `_NIGHT_END_H <= h < _NIGHT_BEGIN_H`, which gave the same two hours by coincidence. The owner ruled
    the flag separately, so patching a SLEEP edge must no longer move it — which is the second half of
    what this asserts."""
    import nightqc

    root = str(tmp_path)
    c = os.path.join(root, "captures")
    _put(c, "2026-10-10", "Polar_H10_0284_20261010130000_ECG.txt", "t\n1\n", "20261010133000")
    d = os.path.join(c, "2026-10-09")
    os.makedirs(d, exist_ok=True)

    recs = ni._recordings(root)
    assert len(recs) == 1, recs
    stamps = recs[0][1]
    assert ni.night_entry(root, d, None, stamps)["daytime"] is True

    lo, hi = nightqc._DAYTIME_BEGIN_H, nightqc._DAYTIME_END_H
    try:
        nightqc._DAYTIME_BEGIN_H, nightqc._DAYTIME_END_H = 14, 18  # 13:00 is now below the flag's floor
        assert ni.night_entry(root, d, None, stamps)["daytime"] is False, (
            "the flag read a literal 10 instead of nightqc._DAYTIME_BEGIN_H"
        )
    finally:
        nightqc._DAYTIME_BEGIN_H, nightqc._DAYTIME_END_H = lo, hi

    # AND A SLEEP EDGE MUST NOT MOVE IT. Same stamp, same expectation, with the band patched instead.
    end, begin = nightqc._NIGHT_END_H, nightqc._NIGHT_BEGIN_H
    try:
        nightqc._NIGHT_END_H, nightqc._NIGHT_BEGIN_H = 14, 18
        assert ni.night_entry(root, d, None, stamps)["daytime"] is True, (
            "the flag still reads the sleep band — the owner ruled the two separately"
        )
    finally:
        nightqc._NIGHT_END_H, nightqc._NIGHT_BEGIN_H = end, begin


def test_BOTH_DAYTIME_EDGES_ARE_INCLUSIVE_ONE_SIDE_ONLY(tmp_path):
    """`<=` → `<` on the left edge and `<` → `<=` on the right, both named by CI as survivors of the
    test above: 13:00 is strictly inside the gap, so it cannot see either. Each mutant differs from the
    rule on EXACTLY ONE hour, and those two hours are the band's own edges.

    The asymmetry is the band, not a style choice. `_NIGHT_END_H` 10 is where the previous evening's
    band ENDS, so a session beginning at 10:00 belongs to no band and is daytime; `_NIGHT_BEGIN_H` 18 is
    where the next band BEGINS, so a session beginning at 18:00 is that night's and is not. Read the
    other way round, a 10:00 start would be charged to a band that had already closed and an 18:00 start
    would be charged to nothing — both publishing "no night covers this" over a session a band does."""
    for hhmmss, want, why in (
        ("100000", True, "10:00 is where the previous band ENDS — the session belongs to no band"),
        ("180000", False, "18:00 is where the next band BEGINS — the session is that night's"),
    ):
        root = str(tmp_path / hhmmss)
        c = os.path.join(root, "captures")
        _put(
            c,
            "2026-10-10",
            f"Polar_H10_0284_20261010{hhmmss}_ECG.txt",
            "t\n1\n",
            "20261010" + ("103000" if hhmmss == "100000" else "183000"),
        )
        d = os.path.join(c, "2026-10-09")
        os.makedirs(d, exist_ok=True)

        recs = ni._recordings(root)
        assert len(recs) == 1, recs
        got = ni.night_entry(root, d, None, recs[0][1])["daytime"]
        assert got is want, f"a start at {hhmmss[:2]}:00 read daytime={got}: {why}"


# ── a UTC-frame read is only visible from a zone that is not UTC ─────────────────────────────────
#
# 🔴 THE RUNNER'S OWN ZONE DECIDES WHETHER THESE MUTANTS CAN BE SEEN. `fromtimestamp(edge, utc)`
# mutated to `fromtimestamp(edge)` is the exact naive-local read this module was fixed to stop, and on
# a UTC runner the two agree for every input — so CI, which runs UTC, cannot kill it from any fixture
# that does not set `TZ` itself. The same run on a box sitting in `America/New_York` killed eight
# mutants CI reported as survivors. A gate's answer here is a fact about the runner as much as about
# the code, which is why each of these pins the zone rather than inheriting it.
_ZONES = ("UTC", "America/New_York", "Asia/Tokyo", "Australia/Sydney")


def test_a_band_edge_names_THE_SAME_DAY_from_every_readers_zone(monkeypatch):
    """`_band_date` is the published night KEY, so the day it names cannot depend on who reads it.

    The edge is chosen for that: 02:30 is 22:30 the PREVIOUS DAY in New York, so a naive read renames
    the night. Tokyo and Sydney are included because they move the hour without moving the date —
    together they separate "reads UTC" from "happens to agree with UTC here"."""
    import time as _time

    edge = 1792290600.0  # 2026-10-18 02:30 floating
    for zone in _ZONES:
        monkeypatch.setenv("TZ", zone)
        _time.tzset()
        assert ni._band_date(edge) == "2026-10-18", f"the band edge was read through {zone}"


def test_the_published_RECORDING_START_is_the_devices_own_wall_clock(tmp_path, monkeypatch):
    """`recording_start` exists so a reader can compare a row against the device's own screen.

    So it must be the components the filename stamp already carries. Read naively it is the reader's
    rendering of an instant instead, which on the box was four hours from what the line says it is
    for — and the published string is the only place that error would ever show."""
    import time as _time

    monkeypatch.setenv("TZ", "America/New_York")
    _time.tzset()
    root = str(tmp_path)
    c = os.path.join(root, "captures")
    _put(c, "2026-10-10", "Polar_H10_0284_20261010220000_ECG.txt", "t\n1\n", "20261010223000")
    recs = ni._recordings(root)
    assert len(recs) == 1, recs
    entry = ni.night_entry(root, os.path.join(c, "2026-10-10"), None, recs[0][1])
    assert entry["recording_start"] == "2026-10-10 22:00", (
        entry["recording_start"],
        "the stamp the filename carries is 22:00:00; anything else is the reader's zone",
    )


def test_a_FLOATING_MTIME_keeps_its_microseconds_to_the_full_SECOND(tmp_path, monkeypatch):
    """The seconds-per-microsecond divisor, asserted where a wrong one is visible.

    `d.microsecond / 1e6` mutated to `/ 1000001.0` is wrong by `us * 1e-12`, which at an epoch of
    1.79e9 is BELOW the float spacing there (2.4e-7) for most microsecond values — so an exact
    assertion on a tidy `.123456` passes over the mutant. 999999 µs puts the gap at 1.0e-6, four
    times the spacing, which is the smallest honest way to see it. The figure is chosen by that
    arithmetic, not by taste: the gap is `us / (d * (d + 1))` and it has to clear the spacing."""
    import time as _time

    monkeypatch.setenv("TZ", "America/New_York")
    _time.tzset()
    p = os.path.join(str(tmp_path), "f.txt")
    with open(p, "w"):
        pass
    os.utime(p, ns=(1792290600_999999000, 1792290600_999999000))
    assert ni._floating_mtime(p, None) == 1792276200.999999
    # And the recorded-offset path, which never reaches the divisor, still answers in the same frame.
    assert ni._floating_mtime(p, {"offset_sec": 14400.0}) == 1792276200.999999
