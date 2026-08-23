# tepna-capture — tests/test_cpap_record.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# CPAP hardening P1 — the durable raw record sink. Pure I/O logic, 100% branch.
import json
import os

import pytest
from cpap_record import RawRecordSink, _channel_meta, _iso_utc, _truncate_torn_tail

CHANNELS = {"6": ("cpap_flow", "Flow", "L/s"), "7": ("cpap_pressure", "Pressure", "cmH2O")}


def _batch(start, iv, flow=(0.1, 0.2), press=(5.0, 5.1), stream_id=1):
    b = {"startTime": start, "streamId": stream_id, "channels": {"6": list(flow), "7": list(press)}}
    if iv is not None:
        b["interval_ms"] = iv
    return b


def _sink(path, **kw):
    kw.setdefault("device_id", "AS11-01")
    kw.setdefault("session_id", "sess-abc")
    kw.setdefault("provenance", {"code": "test"})
    kw.setdefault("mono", lambda: 123.5)
    kw.setdefault("wall", lambda: "2026-08-23T22:00:00.000Z")
    return RawRecordSink(str(path), **kw)


def _lines(path):
    return [json.loads(ln) for ln in open(path, encoding="utf-8").read().splitlines()]


# ── the happy path ──────────────────────────────────────────────────────────────────────────────────

def test_open_writes_a_header_then_batches_append(tmp_path):
    p = tmp_path / "sess.jsonl"
    s = _sink(p)
    s.open(CHANNELS, 25.0)
    s.on_batch(_batch("2026-08-23T22:00:01.000Z", 40))
    s.on_batch(_batch("2026-08-23T22:00:02.000Z", 40))
    s.close()
    rows = _lines(p)
    assert rows[0]["record"] == "cpap-raw" and rows[0]["v"] == 1
    assert rows[0]["session_id"] == "sess-abc" and rows[0]["device_id"] == "AS11-01"
    assert rows[0]["fs"] == 25.0
    assert rows[0]["channels"]["6"] == {"key": "cpap_flow", "label": "Flow", "unit": "L/s"}
    assert [r["seq"] for r in rows[1:]] == [1, 2]                 # seq monotonic from 1


def test_device_start_and_samples_are_verbatim(tmp_path):
    """INV3/INV4 — the device stamp and the raw samples are written exactly as received, unconverted."""
    p = tmp_path / "s.jsonl"
    s = _sink(p)
    s.open(CHANNELS, 25.0)
    s.on_batch(_batch("2026-08-23T22:00:01.730Z", 40, flow=(0.11, 0.22)))
    s.close()
    row = _lines(p)[1]
    assert row["device_start"] == "2026-08-23T22:00:01.730Z"     # verbatim, not a parsed tMs
    assert row["samples"]["6"] == [0.11, 0.22]                    # verbatim samples
    assert row["stream_id"] == 1


def test_observed_interval_is_recorded_and_none_when_absent(tmp_path):
    """INV5 — the device's OWN interval is stored; when it omits it, we record null, never the requested."""
    p = tmp_path / "s.jsonl"
    s = _sink(p)
    s.open(CHANNELS, 25.0)
    s.on_batch(_batch("2026-08-23T22:00:01.000Z", 20))           # observed 20 ms (50 Hz)
    s.on_batch(_batch("2026-08-23T22:00:02.000Z", None))          # device omitted it
    s.close()
    rows = _lines(p)
    assert rows[1]["device_interval_ms"] == 20
    assert rows[2]["device_interval_ms"] is None


def test_host_clocks_are_recorded_beside_the_device_clock(tmp_path):
    p = tmp_path / "s.jsonl"
    s = _sink(p, mono=lambda: 999.25, wall=lambda: "2026-08-23T22:05:00.500Z")
    s.open(CHANNELS, 25.0)
    s.on_batch(_batch("2026-08-23T22:00:01.000Z", 40))
    s.close()
    row = _lines(p)[1]
    assert row["host_mono"] == 999.25 and row["host_wall"] == "2026-08-23T22:05:00.500Z"
    assert row["device_start"] == "2026-08-23T22:00:01.000Z"     # device clock still primary, untouched


# ── durability / resume ───────────────────────────────────────────────────────────────────────────────

def test_a_torn_tail_is_truncated_before_reopen(tmp_path):
    p = tmp_path / "s.jsonl"
    s = _sink(p)
    s.open(CHANNELS, 25.0)
    s.on_batch(_batch("2026-08-23T22:00:01.000Z", 40))
    s.close()
    # simulate a crash mid-append: a partial final line with no newline
    with open(p, "a", encoding="utf-8") as f:
        f.write('{"seq":2,"stream_id":1,"device_st')
    s2 = _sink(p)
    s2.open(CHANNELS, 25.0)                                       # reopen truncates the torn tail
    s2.on_batch(_batch("2026-08-23T22:00:03.000Z", 40))
    s2.close()
    rows = _lines(p)                                              # every line parses — no fused record
    assert all(isinstance(r, dict) for r in rows)
    assert rows[-1]["device_start"] == "2026-08-23T22:00:03.000Z"


def test_truncate_torn_tail_handles_missing_empty_and_clean_files(tmp_path):
    _truncate_torn_tail(str(tmp_path / "nope.jsonl"))            # missing → no error
    empty = tmp_path / "empty.jsonl"; empty.write_text("")
    _truncate_torn_tail(str(empty)); assert empty.read_text() == ""
    clean = tmp_path / "clean.jsonl"; clean.write_text('{"a":1}\n')
    _truncate_torn_tail(str(clean)); assert clean.read_text() == '{"a":1}\n'
    # a torn tail with NO earlier newline truncates to empty
    torn = tmp_path / "torn.jsonl"; torn.write_text('{"partial')
    _truncate_torn_tail(str(torn)); assert torn.read_text() == ""


# ── state guards ──────────────────────────────────────────────────────────────────────────────────────

def test_open_twice_raises(tmp_path):
    s = _sink(tmp_path / "s.jsonl"); s.open(CHANNELS, 25.0)
    with pytest.raises(RuntimeError, match="open called twice"):
        s.open(CHANNELS, 25.0)
    s.close()


def test_on_batch_before_open_raises(tmp_path):
    s = _sink(tmp_path / "s.jsonl")
    with pytest.raises(RuntimeError, match="before open"):
        s.on_batch(_batch("2026-08-23T22:00:01.000Z", 40))


def test_close_before_open_and_double_close_are_noops(tmp_path):
    p = tmp_path / "s.jsonl"
    s = _sink(p)
    s.close()                                                     # never opened → no-op, no file
    assert not p.exists()
    s.open(CHANNELS, 25.0); s.close(); s.close()                  # double close → second is a no-op


# ── helpers ───────────────────────────────────────────────────────────────────────────────────────────

def test_channel_meta_handles_empty_and_none():
    assert _channel_meta(None) == {}
    assert _channel_meta({}) == {}
    assert _channel_meta({"6": ("k", "l", "u")}) == {"6": {"key": "k", "label": "l", "unit": "u"}}


def test_iso_utc_is_millisecond_utc():
    assert _iso_utc(0) == "1970-01-01T00:00:00.000Z"
    assert _iso_utc(1_600_000_000.5) == "2020-09-13T12:26:40.500Z"


def test_default_wall_is_the_real_host_clock(tmp_path):
    """Cover the default wall lambda (no injection) — it produces a Z-stamped string."""
    p = tmp_path / "s.jsonl"
    s = RawRecordSink(str(p), device_id="d", session_id="s", provenance={}, mono=lambda: 1.0)
    s.open(CHANNELS, 25.0)
    s.on_batch(_batch("2026-08-23T22:00:01.000Z", 40))
    s.close()
    assert _lines(p)[1]["host_wall"].endswith("Z")
