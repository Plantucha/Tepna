# tepna-capture — tests/test_diskguard.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
import os

import diskguard


def test_disk_report_reports_free_and_total(tmp_path):
    r = diskguard.disk_report(str(tmp_path))
    assert r["total_gb"] > 0 and 0 <= r["free_pct"] <= 100 and r["low"] is False


def test_disk_report_low_flag(tmp_path):
    r = diskguard.disk_report(str(tmp_path), min_free_gb=1e9)   # no disk has an exabyte free
    assert r["low"] is True


def test_disk_report_walks_up_to_an_existing_parent(tmp_path):
    missing = tmp_path / "not" / "yet" / "here"                 # nonexistent → walks up to tmp_path
    r = diskguard.disk_report(str(missing))
    assert r["total_gb"] > 0


def test_disk_report_relative_path_bottoms_out_at_root():
    r = diskguard.disk_report("nonexistent-relative-xyz/a/b")   # relative + absent → resolves to "/"
    assert r["total_gb"] > 0


def _mk_nights(cap, names):
    for n in names:
        os.makedirs(os.path.join(cap, n), exist_ok=True)


def test_list_nights_only_returns_date_dirs(tmp_path):
    cap = tmp_path / "captures"
    _mk_nights(str(cap), ["2026-07-01", "2026-07-03", "2026-07-02"])
    os.makedirs(str(cap / "incoming"), exist_ok=True)          # a non-date sibling must be ignored
    os.makedirs(str(cap / "stored"), exist_ok=True)
    (cap / "2026-07-01" / "f.txt").write_text("x")             # a file inside is fine
    (cap / "notadate.txt").write_text("x")                     # a stray file, not a dir
    assert diskguard.list_nights(str(cap)) == ["2026-07-01", "2026-07-02", "2026-07-03"]


def test_list_nights_missing_dir_is_empty():
    assert diskguard.list_nights("/no/such/captures/dir") == []


def test_active_nights_flags_only_recently_written(tmp_path):
    cap = tmp_path / "captures"
    _mk_nights(str(cap), ["2026-07-17", "2026-07-18", "2026-07-19"])
    (cap / "2026-07-17" / "old.txt").write_text("x")           # aged well past the settle window
    os.utime(cap / "2026-07-17" / "old.txt", (0, 1000.0))
    (cap / "2026-07-19" / "live.txt").write_text("x")          # freshly written → active
    # 2026-07-18 has NO files at all → never active
    now = os.path.getmtime(cap / "2026-07-19" / "live.txt") + 1
    assert diskguard.active_nights(str(cap), 600, _now=lambda: now) == {"2026-07-19"}


def test_active_nights_cross_midnight_returns_both(tmp_path):
    cap = tmp_path / "captures"
    _mk_nights(str(cap), ["2026-07-18", "2026-07-19"])
    for n in ("2026-07-18", "2026-07-19"):
        (cap / n / "live.txt").write_text("x")                 # both just written → both active
    now = max(os.path.getmtime(cap / n / "live.txt") for n in ("2026-07-18", "2026-07-19")) + 1
    assert diskguard.active_nights(str(cap), 600, _now=lambda: now) == {"2026-07-18", "2026-07-19"}


def test_active_nights_skips_a_night_that_cannot_be_listed(tmp_path, monkeypatch):
    """A night that vanishes (or denies listing) mid-scan is simply 'not active', never a crash."""
    cap = tmp_path / "captures"
    _mk_nights(str(cap), ["2026-07-19"])
    real_listdir = os.listdir
    def flaky(path):
        if path.endswith("2026-07-19"):
            raise OSError("gone")                              # the inner per-night scan explodes
        return real_listdir(path)
    monkeypatch.setattr(diskguard.os, "listdir", flaky)
    assert diskguard.active_nights(str(cap), 600) == set()


def test_active_nights_missing_dir_is_empty():
    assert diskguard.active_nights("/no/such/captures", 600) == set()


def test_plan_prune_keeps_the_newest_n():
    nights = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"]
    assert diskguard.plan_prune(nights, keep_nights=2) == ["2026-07-01", "2026-07-02"]


def test_plan_prune_disabled_when_keep_is_zero_or_negative():
    nights = ["2026-07-01", "2026-07-02", "2026-07-03"]
    assert diskguard.plan_prune(nights, keep_nights=0) == []
    assert diskguard.plan_prune(nights, keep_nights=-1) == []


def test_plan_prune_noop_when_under_the_limit():
    assert diskguard.plan_prune(["2026-07-01", "2026-07-02"], keep_nights=5) == []


def test_plan_prune_never_touches_a_protected_night():
    nights = ["2026-07-01", "2026-07-02", "2026-07-03"]
    # keep 1 → 07-01 and 07-02 are stale, but 07-01 is protected (e.g. an active pull), so only 07-02 goes
    assert diskguard.plan_prune(nights, keep_nights=1, protect={"2026-07-01"}) == ["2026-07-02"]


def test_prune_old_nights_removes_the_stale_dirs(tmp_path):
    cap = tmp_path / "captures"
    _mk_nights(str(cap), ["2026-07-01", "2026-07-02", "2026-07-03"])
    removed = diskguard.prune_old_nights(str(cap), keep_nights=1)
    assert removed == ["2026-07-01", "2026-07-02"]
    assert diskguard.list_nights(str(cap)) == ["2026-07-03"]


def test_prune_old_nights_swallows_a_delete_error(tmp_path):
    cap = tmp_path / "captures"
    _mk_nights(str(cap), ["2026-07-01", "2026-07-02", "2026-07-03"])
    def boom(_p): raise OSError("busy")
    removed = diskguard.prune_old_nights(str(cap), keep_nights=1, _rm=boom)
    assert removed == []                                        # nothing removed, nothing raised
    assert diskguard.list_nights(str(cap)) == ["2026-07-01", "2026-07-02", "2026-07-03"]
