# tepna-capture — tests/test_mem_series.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Row 2026-10-13-daemon-mem-block-not-drawn: the daemon's `mem:` journal lines become a per-PID series,
# and /api/mem serves it. Every line here is SYNTHETIC; the shape copies mem_log_line's output.

import asyncio
import datetime as dt
import subprocess
from types import SimpleNamespace

from aiohttp.test_utils import TestClient, TestServer

import mem_series
import telemetry
import webmon

FULL = (
    "2026-01-02T23:28:22-04:00 synthbox python[111]: 2026-01-02 23:28:22,347 INFO mem: VmRSS 161488 kB "
    "RssAnon 135864 kB VmSwap 0 kB · main arena 77320 kB hblkhd 2448 kB uordblks 52630 kB fordblks 24689 kB "
    "keepcost 2892 kB · all arenas heaps 8 system 77320 kB rest 24682 kB mmap 2448 kB · gc counts 340,0,0 "
    "collections 0,36,0 · VmHWM since last line 170000 kB"
)


def _line(pid, hhmmss, rss, zone="-04:00"):
    return (
        f"2026-01-02T{hhmmss}{zone} synthbox python[{pid}]: 2026-01-02 {hhmmss},000 INFO mem: VmRSS {rss} kB "
        f"RssAnon {rss - 1000} kB · main arena 9 kB · all arenas heaps 2 system 9 kB · gc counts 1,0,0 collections 0,1,0"
    )


def test_a_full_line_parses_every_field_with_its_floating_clock():
    r = mem_series.parse_mem_line(FULL)
    assert r["pid"] == 111 and r["offsetMin"] == -240
    assert r["tMs"] == int(dt.datetime(2026, 1, 2, 23, 28, 22, tzinfo=dt.timezone.utc).timestamp() * 1000)
    assert r["rss_kb"] == 161488 and r["rss_anon_kb"] == 135864 and r["swap_kb"] == 0
    assert r["main_arena_kb"] == 77320 and r["system_kb"] == 77320 and r["uordblks_kb"] == 52630
    assert r["hwm_kb"] == 170000 and r["heaps"] == 8 and r["gc_collections"] == [0, 36, 0]


def test_an_absent_or_null_figure_is_None_never_zero():
    """§∅: an older line carries no VmSwap and no VmHWM segment; a `null` figure stays null."""
    r = mem_series.parse_mem_line(_line(5, "01:00:00", 5000).replace("main arena 9", "main arena null"))
    assert r["swap_kb"] is None and r["hwm_kb"] is None and r["main_arena_kb"] is None
    bare = mem_series.parse_mem_line("2026-01-02T01:00:00Z synthbox python[5]: x INFO mem: VmRSS 7 kB")
    assert bare["rss_kb"] == 7 and bare["heaps"] is None and bare["gc_collections"] is None
    assert bare["offsetMin"] == 0


def test_a_zoneless_and_a_positive_zone_stamp():
    assert mem_series.parse_mem_line(_line(5, "01:00:00", 5000, zone=""))["offsetMin"] is None
    assert mem_series.parse_mem_line(_line(5, "01:00:00", 5000, zone="+0530"))["offsetMin"] == 330


def test_a_line_that_is_not_a_mem_line_is_skipped():
    assert mem_series.parse_mem_line("2026-01-02T01:00:00Z synthbox python[5]: INFO connected") is None
    assert mem_series.parse_mem_line("no stamp here INFO mem: VmRSS 7 kB") is None


def test_PLANT_a_restart_opens_a_new_segment_and_no_point_crosses_it():
    lines = [_line(10, "01:00:00", 900), _line(10, "01:01:00", 950), "noise", _line(20, "01:02:00", 100)]
    s = mem_series.series(lines)
    assert [(g["pid"], len(g["points"])) for g in s["segments"]] == [(10, 2), (20, 1)]
    assert s["segments"][1]["points"][0]["rss_kb"] == 100
    assert s["shapes"]["gc_collections"] == "cumulative-per-pid" and s["shapes"]["rss_kb"] == "level"


def test_a_pid_that_returns_after_another_is_a_third_segment():
    lines = [_line(10, "01:00:00", 1), _line(20, "01:01:00", 2), _line(10, "01:02:00", 3)]
    assert [g["pid"] for g in mem_series.series(lines)["segments"]] == [10, 20, 10]


NOW = dt.datetime(2026, 1, 2, 12, 0, 0)


def _run(rc, out="", err=""):
    calls = []

    def run(argv, **kw):
        calls.append(argv)
        return SimpleNamespace(returncode=rc, stdout=out, stderr=err)

    return run, calls


def test_read_passes_the_window_and_returns_the_series():
    run, calls = _run(0, _line(10, "11:00:00", 900) + "\n")
    out = mem_series.read_mem_series(2, now=NOW, run=run)
    assert out["segments"][0]["pid"] == 10
    assert out["window"] == {"hours": 2, "since": "2026-01-02T10:00:00", "until": "2026-01-02T12:00:00"}
    assert calls[0][calls[0].index("--since") + 1] == "2026-01-02 10:00:00"


def test_an_empty_window_is_an_empty_series_not_unreadable():
    run, _ = _run(1, "-- No entries --\n")
    assert mem_series.read_mem_series(1, now=NOW, run=run)["segments"] == []


def test_an_unreadable_journal_is_None_never_an_empty_series():
    assert mem_series.read_mem_series(1, now=NOW, run=_run(1, "", "Failed to open")[0]) is None
    assert mem_series.read_mem_series(1, now=NOW, run=_run(2, "")[0]) is None

    def boom(argv, **kw):
        raise OSError("no journalctl")

    assert mem_series.read_mem_series(1, now=NOW, run=boom) is None

    def slow(argv, **kw):
        raise subprocess.TimeoutExpired(argv, 60)

    assert mem_series.read_mem_series(1, now=NOW, run=slow) is None


def test_read_defaults_to_now_and_the_real_runner(monkeypatch):
    seen = {}

    def fake(argv, **kw):
        seen["kw"] = kw
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake)
    assert mem_series.read_mem_series(1)["segments"] == []
    assert seen["kw"]["timeout"] == 60


# ── /api/memory ──────────────────────────────────────────────────────────────────────────────────────
def _get(tmp_path, path):
    cfg = {"root": str(tmp_path), "clock": {"sudo": False}, "devices": []}
    app = webmon.make_app(
        telemetry.TelemetryBus(), cfg, str(tmp_path / "config.yaml"), "AA:AA:AA:AA:AA:AA", {"devices": {}}, None
    )

    async def go():
        c = TestClient(TestServer(app))
        await c.start_server()
        try:
            r = await c.get(path)
            return r.status, await r.json()
        finally:
            await c.close()

    return asyncio.run(go())


def test_api_mem_clamps_the_window_and_serves_the_series(tmp_path, monkeypatch):
    asked = []
    monkeypatch.setattr(webmon._mem, "read_mem_series", lambda h: asked.append(h) or {"segments": []})
    assert _get(tmp_path, "/api/memory") == (200, {"segments": []})
    _get(tmp_path, "/api/memory?hours=500")
    _get(tmp_path, "/api/memory?hours=0")
    _get(tmp_path, "/api/memory?hours=abc")
    assert asked == [12.0, 72.0, 1.0, 12.0]


def test_api_mem_says_unreadable_with_503_and_null_segments(tmp_path, monkeypatch):
    monkeypatch.setattr(webmon._mem, "read_mem_series", lambda h: None)
    status, body = _get(tmp_path, "/api/memory")
    assert status == 503 and body["segments"] is None
