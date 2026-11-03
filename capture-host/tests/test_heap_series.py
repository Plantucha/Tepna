# tepna-capture — tests/test_heap_series.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""The heap probe's rows, on the same axis as the memory journal.

Row `2026-09-25-heap-growth-is-json-retention-not-a-buffer-leak`. The stall was argued over two
quantities that were never measured over one interval: the journal's `RssAnon` at ~21 MB/h and the
probe's `traced_bytes` at +9.2 MiB/h. The writer already put both in one row; nothing read the file.

What these tests pin, in the order each could silently rot:
  · §∅ — an absent or unparseable probe file gives `points: None` and a named reason, NEVER `[]`,
    because an empty list says the probe ran and recorded nothing, which is the opposite finding;
  · a rate needs two rows that both streamed — an uncovered interval is `NOT_APPLICABLE` with its
    figures `None`, never a flat rate presented as a measurement;
  · a figure the row carried as `null` stays `None` through the rate and is NAMED in `absent`;
  · the file's own age travels with the series, because the probe last ran 2026-09-25 and a series
    drawn without its age reads as tonight;
  · the writer's filename and RSS keys are PINNED to this reader's copies: a reader looking at the
    wrong name reports an absent file, which reads exactly like a probe that never ran."""

import datetime as _dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import capture  # noqa: E402
import heap_series  # noqa: E402

NOW = _dt.datetime(2026, 11, 3, 14, 0, 0)


def _row(at="2026-11-03T12:00:00", traced=1000, anon=100, covered=True, **over):
    row = {
        "at": at,
        "traced_bytes": traced,
        "traced_peak_bytes": (traced or 0) + 7,
        "gc_tracked_objects": 42,
        "rss_kb": {"VmRSS": 300, "RssAnon": anon, "RssFile": 20, "VmSwap": 0},
        "covered_capture": covered,
        "status": "OK" if covered else "NOT_APPLICABLE",
        "reason": None if covered else "nothing streamed during this interval",
    }
    row.update(over)
    return row


# ── THE DRIFT PINS ───────────────────────────────────────────────────────────────────────────────────
def test_the_reader_and_the_writer_name_the_same_file_and_the_same_rss_keys():
    """Two copies of a name are two places the axis drifts apart, and the symptom is a false absence."""
    assert heap_series.PROBE_NAME == capture.HEAP_PROBE_NAME
    assert heap_series.RSS_KEYS == capture._RSS_KEYS
    assert heap_series.probe_path("/srv/tepna") == os.path.join("/srv/tepna", "captures", capture.HEAP_PROBE_NAME)


# ── ONE ROW → ONE POINT ──────────────────────────────────────────────────────────────────────────────
def test_a_row_becomes_a_point_on_the_floating_axis():
    p = heap_series.probe_point(_row())
    assert p["tMs"] == 1793707200000 and p["offsetMin"] is None  # 2026-11-03T12:00:00 as if UTC
    assert p["traced_bytes"] == 1000 and p["rss_kb"]["RssAnon"] == 100
    assert p["covered_capture"] is True and p["status"] == "OK"


def test_a_row_this_cannot_stamp_is_dropped_rather_than_placed_at_the_time_of_the_read():
    assert heap_series.probe_point(_row(at="whenever")) is None
    assert heap_series.probe_point(_row(at="2026-02-30T00:00:00")) is None  # a shape, not a calendar day
    assert heap_series.probe_point("not a row") is None


def test_a_figure_the_row_did_not_carry_is_None_and_never_zero():
    p = heap_series.probe_point(_row(traced=None, rss_kb="not a dict", covered_capture="maybe", status=7, reason=7))
    assert p["traced_bytes"] is None and p["rss_kb"] is None
    assert p["covered_capture"] is None and p["status"] is None and p["reason"] is None


def test_a_boolean_is_not_a_byte_count():
    """`True` is an `int` in Python, so a naive isinstance check reads it as one traced byte."""
    assert heap_series.probe_point(_row(traced=True))["traced_bytes"] is None


# ── THE RATES: BOTH QUANTITIES OVER ONE INTERVAL ─────────────────────────────────────────────────────
def test_both_rates_are_read_over_the_same_span():
    """The point of the row: one interval, both quantities, so each is finally evidence about the other."""
    pts = [heap_series.probe_point(_row(at="2026-11-03T12:00:00", traced=1_000_000, anon=100))]
    pts.append(heap_series.probe_point(_row(at="2026-11-03T13:00:00", traced=10_600_000, anon=21100)))
    (pair,) = heap_series.rates(pts)
    assert pair["spanMs"] == 3600000 and pair["status"] == "OK" and pair["reason"] is None
    assert pair["traced_bytes_per_hour"] == 9600000.0 and pair["rss_anon_kb_per_hour"] == 21000.0
    assert pair["absent"] == []


def test_an_interval_that_did_not_stream_is_NOT_APPLICABLE_rather_than_a_flat_rate():
    pts = [
        heap_series.probe_point(_row(at="2026-11-03T12:00:00", covered=False)),
        heap_series.probe_point(_row(at="2026-11-03T13:00:00", traced=9999)),
    ]
    (pair,) = heap_series.rates(pts)
    assert pair["status"] == "NOT_APPLICABLE" and "absence of capture" in pair["reason"]
    assert pair["traced_bytes_per_hour"] is None and pair["rss_anon_kb_per_hour"] is None
    assert pair["absent"] == ["traced_bytes_per_hour", "rss_anon_kb_per_hour"]


def test_two_rows_at_one_stamp_give_no_rate():
    pts = [heap_series.probe_point(_row()), heap_series.probe_point(_row())]
    (pair,) = heap_series.rates(pts)
    assert pair["spanMs"] == 0 and pair["status"] == "NOT_APPLICABLE" and "zero or negative span" in pair["reason"]


def test_an_absent_figure_is_named_rather_than_counted_as_no_growth():
    pts = [
        heap_series.probe_point(_row(at="2026-11-03T12:00:00", traced=None)),
        heap_series.probe_point(_row(at="2026-11-03T13:00:00", rss_kb=None)),
    ]
    (pair,) = heap_series.rates(pts)
    assert pair["status"] == "OK"  # the interval applied; the figures are what is absent
    assert pair["traced_bytes_per_hour"] is None and pair["rss_anon_kb_per_hour"] is None
    assert pair["absent"] == ["traced_bytes_per_hour", "rss_anon_kb_per_hour"]


def test_one_point_is_no_pair():
    assert heap_series.rates([heap_series.probe_point(_row())]) == []


# ── THE DOCUMENT ─────────────────────────────────────────────────────────────────────────────────────
def test_points_come_back_in_time_order_and_unreadable_rows_are_counted():
    out = heap_series.series(
        {"rows": [_row(at="2026-11-03T13:00:00"), _row(at="nonsense"), _row(at="2026-11-03T12:00:00")]}
    )
    assert [p["tMs"] for p in out["points"]] == [1793707200000, 1793710800000]
    assert out["rowsUnreadable"] == 1 and out["schema"] == "tepna.heap-series/1"
    assert out["shapes"]["traced_bytes"] == "level"


def test_a_document_with_no_rows_list_is_not_an_empty_series():
    for doc in ({"schema": "tepna.heap-probe/1"}, {"rows": "later"}, "not a document"):
        out = heap_series.series(doc)
        assert out["points"] is None and out["rates"] is None and out["rowsUnreadable"] is None
        assert "not an empty series" in out["reason"]


# ── THE READ, AND THE FILE'S OWN STATE ───────────────────────────────────────────────────────────────
def test_the_series_carries_the_file_age_so_a_stale_probe_is_never_drawn_as_tonight(tmp_path):
    f = tmp_path / capture.HEAP_PROBE_NAME
    f.write_text(json.dumps({"schema": "tepna.heap-probe/1", "rows": [_row(at="2026-11-03T12:00:00")]}))
    out = heap_series.read_heap_series(str(f), now=NOW)
    assert out["file"]["state"] == "read" and out["file"]["reason"] is None
    assert out["file"]["lastRunTMs"] == 1793707200000 and out["file"]["ageHours"] == 2.0
    assert len(out["points"]) == 1


def test_a_file_with_no_readable_row_has_no_age_rather_than_an_age_of_zero(tmp_path):
    f = tmp_path / capture.HEAP_PROBE_NAME
    f.write_text(json.dumps({"rows": [_row(at="nonsense")]}))
    out = heap_series.read_heap_series(str(f), now=NOW)
    assert out["points"] == [] and out["rowsUnreadable"] == 1
    assert out["file"]["lastRunTMs"] is None and out["file"]["ageHours"] is None


def test_an_absent_probe_is_absent_and_not_an_empty_series(tmp_path):
    out = heap_series.read_heap_series(str(tmp_path / "never-written.json"))
    assert out["file"]["state"] == "absent" and "opt-in on the box" in out["file"]["reason"]
    assert out["points"] is None and out["rates"] is None and out["reason"] == out["file"]["reason"]


def test_a_file_that_cannot_be_read_says_so(tmp_path):
    def boom(_path):
        raise PermissionError("nope")

    out = heap_series.read_heap_series(str(tmp_path / "x.json"), read=boom)
    assert out["file"]["state"] == "unreadable" and "PermissionError" in out["file"]["reason"]
    assert out["points"] is None


def test_a_file_that_is_not_JSON_is_unreadable_rather_than_empty(tmp_path):
    f = tmp_path / capture.HEAP_PROBE_NAME
    f.write_text("{not json")
    out = heap_series.read_heap_series(str(f))
    assert out["file"]["state"] == "unreadable" and "not JSON" in out["file"]["reason"]
    assert out["points"] is None and out["file"]["ageHours"] is None


def test_the_age_is_read_against_the_wall_clock_when_no_reference_is_given(tmp_path):
    """The default path, so the one call a monitor makes is the one the tests exercise."""
    f = tmp_path / capture.HEAP_PROBE_NAME
    f.write_text(json.dumps({"rows": [_row(at=_dt.datetime.now().isoformat(timespec="seconds"))]}))
    out = heap_series.read_heap_series(str(f))
    assert out["file"]["ageHours"] is not None and abs(out["file"]["ageHours"]) < 0.1
