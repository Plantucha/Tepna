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


def _flaky_listdir(monkeypatch, night, exc):
    real_listdir = os.listdir
    def flaky(path):
        if path.endswith(night):
            raise exc                                          # the inner per-night scan explodes
        return real_listdir(path)
    monkeypatch.setattr(diskguard.os, "listdir", flaky)


def test_active_nights_vanished_night_is_not_active(tmp_path, monkeypatch):
    """A night that genuinely disappeared mid-scan is not being written to. Never a crash."""
    cap = tmp_path / "captures"
    _mk_nights(str(cap), ["2026-07-19"])
    _flaky_listdir(monkeypatch, "2026-07-19", FileNotFoundError("gone"))
    assert diskguard.active_nights(str(cap), 600) == set()


def test_active_nights_unreadable_night_is_PROTECTED_not_skipped(tmp_path, monkeypatch):
    """Changed deliberately 2026-07-25 (VIGIL-HARDENING-II §1.2). This asserted `== set()` for a bare
    OSError, i.e. it PINNED a fail-open: the only consumer of this set is the protect-list for pruning,
    so an unreadable night looked settled and therefore prunable — the doubt licensed the delete.
    EACCES/EIO/EMFILE all land here, and EIO on a failing disk is exactly when this runs hot."""
    cap = tmp_path / "captures"
    _mk_nights(str(cap), ["2026-07-19"])
    for exc in (PermissionError("denied"), OSError("EIO"), OSError(24, "Too many open files")):
        _flaky_listdir(monkeypatch, "2026-07-19", exc)
        assert diskguard.active_nights(str(cap), 600) == {"2026-07-19"}, (
            f"an unreadable night must be protected, not swept ({exc!r})")


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


# ── mutation-audit leads, 2026-08-02 (tools/mutate.py) ───────────────────────────────────────────────
# diskguard.py measured 73/106 mutants killed at 100% statement+branch coverage. The survivor below is
# the one that matters: it is the flag the low-disk alert reads, and the alert is what tells an operator
# the box is about to stop recording.

def test_low_is_FALSE_when_a_threshold_is_set_and_the_disk_is_healthy(tmp_path):
    """Kills `min_free_gb > 0 and free_gb < min_free_gb` → `or`.

    The two existing low-flag tests cover both outcomes and still miss this: one uses the DEFAULT
    threshold of 0.0 (so `min_free_gb > 0` is False either way) and the other uses 1e9 (so it is True
    either way). Neither exercises the only configuration the box actually runs — `min_free_gb: 2`
    against a disk with plenty free. Under the mutant `low` is True whenever a threshold is set at all,
    i.e. the low-disk alert fires on every poll, forever, and the suite cannot see it."""
    r = diskguard.disk_report(str(tmp_path), min_free_gb=0.001)   # a threshold no real disk trips
    assert r["free_gb"] > 0.001, "precondition: this filesystem has room"
    assert r["low"] is False, "a healthy disk with a threshold set must not read as low"


def test_free_gb_keeps_two_decimals(tmp_path):
    """Kills `round(free_gb, 2)` → `round(free_gb, None)`, which returns an int.

    Small, but `free_gb` is a SURFACED number — it goes into status.json, the storage card and the
    low-disk alert text. Nothing asserted its shape, so the suite would not notice it losing its
    fractional part."""
    r = diskguard.disk_report(str(tmp_path))
    assert isinstance(r["free_gb"], float), f"free_gb must stay fractional, got {r['free_gb']!r}"
    assert round(r["free_gb"], 2) == r["free_gb"]


# ── disk_report: the walk-up, the rounding, and the low flag ────────────────────────────────────────
# The box writes ~1.5 GB/night and a full filesystem makes fsync fail while the daemon still looks
# alive, so this report is the only thing standing between "running" and "silently not recording".
# 19 tests asserted what it returns for paths that EXIST; nothing observed the walk-up that makes a
# not-yet-created root reportable, or the threshold arithmetic.

def test_a_path_that_does_not_exist_yet_reports_the_filesystem_it_will_live_on(tmp_path):
    """`while probe and not exists(probe): probe = dirname(probe) or "/"`. The archive root is
    configured before it is created, so a report that raised (or answered about "/") would either
    crash the caller or describe the wrong disk — and "the wrong disk has room" is how a full capture
    volume goes unnoticed."""
    deep = tmp_path / "not" / "created" / "yet"
    r = diskguard.disk_report(str(deep))
    here = diskguard.disk_report(str(tmp_path))
    assert r["total_gb"] == here["total_gb"], \
        "the walk-up must land on the real parent's filesystem, not on / and not on nothing"
    assert r["free_gb"] > 0


def test_a_relative_path_bottoms_out_rather_than_looping(tmp_path, monkeypatch):
    """`dirname("x")` is `""`, which is falsy — without the `or "/"` the loop would spin on an empty
    string forever. The guard runs inside the capture daemon; a hang here is the daemon gone."""
    monkeypatch.chdir(tmp_path)
    r = diskguard.disk_report("no-such-relative-dir")
    assert r["total_gb"] > 0 and r["free_gb"] > 0


def test_the_low_flag_needs_a_threshold_and_a_shortfall(tmp_path):
    """`min_free_gb > 0 and free_gb < min_free_gb`. The default of 0.0 means "no threshold configured"
    and must never flag — an always-low guard is one the operator learns to ignore, which is worse
    than no guard. And the comparison is strict: exactly at the threshold is not yet low."""
    r = diskguard.disk_report(str(tmp_path))
    assert diskguard.disk_report(str(tmp_path))["low"] is False, "no threshold configured -> never low"
    assert diskguard.disk_report(str(tmp_path), min_free_gb=0.0)["low"] is False

    huge = r["free_gb"] + 1000
    assert diskguard.disk_report(str(tmp_path), min_free_gb=huge)["low"] is True
    tiny = max(0.01, r["free_gb"] / 1000)
    assert diskguard.disk_report(str(tmp_path), min_free_gb=tiny)["low"] is False


def test_the_report_is_rounded_for_display_not_left_raw(tmp_path):
    """These land straight in webmon's Storage card. `round(x, None)` returns an int, so a 0.4 GB
    remainder renders as `0` — and free space that reads as a whole number of GB is the one figure an
    operator eyeballs to decide whether tonight will fit."""
    r = diskguard.disk_report(str(tmp_path))
    for k in ("free_gb", "total_gb", "free_pct"):
        assert isinstance(r[k], float), f"{k} must stay a float — an int here hides the remainder"
    assert round(r["free_gb"], 2) == r["free_gb"], "free_gb is 2dp"
    assert round(r["free_pct"], 1) == r["free_pct"], "free_pct is 1dp"


def test_a_zero_total_reports_zero_percent_rather_than_dividing_by_it(monkeypatch, tmp_path):
    """A pseudo-filesystem can report total=0. Without the guard this is a ZeroDivisionError out of the
    daemon's health check — the check that exists to notice trouble becoming the trouble."""
    class U:
        free, total, used = 0, 0, 0

    monkeypatch.setattr(diskguard.shutil, "disk_usage", lambda p: U())
    r = diskguard.disk_report(str(tmp_path))
    assert r["free_pct"] == 0.0 and r["total_gb"] == 0.0
