# tepna-capture — tests/test_coverage_gap_fill_ii.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Coverage gap-fill II — the pure modules, to 100% statement AND branch.

Sibling of test_coverage_gap_fill.py, and the same rule: every case is a real failure mode the module
already guards, that nothing exercised. The theme running through most of them is FAIL-SAFE — an
unreadable directory, a truncated row, a file with no parseable clock. Those handlers all exist because
the alternative is a wrong answer rather than a crash, which is exactly the kind of code that stays
uncovered until someone goes looking: it never runs on a healthy box, and it is what runs on a sick one.
"""
import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nightarchive  # noqa: E402
import nightqc  # noqa: E402
import ppg_grid_check as pgc  # noqa: E402
import storage_targets  # noqa: E402
import timeline  # noqa: E402


def _only_for(target: str, real, exc=OSError("simulated I/O failure")):
    """A monkeypatch shim that fails for ONE path and delegates everywhere else. Blanket-patching
    os.scandir/os.stat for a whole test breaks pytest's own bookkeeping; the failures under test are
    per-path anyway (one unreadable directory, not a dead filesystem)."""
    def shim(path, *a, **kw):
        if os.path.abspath(str(path)) == os.path.abspath(target):
            raise exc
        return real(path, *a, **kw)
    return shim


# ── nightarchive: the fail-safe arms of the mirror checks ───────────────────────────────────────────
# Both functions answer a question whose wrong answer DELETES DATA — `_grew_since_marker` says "this
# mirror is stale", `_mirror_matches` says "a second copy exists". Every unreadable case therefore has
# to resolve toward "not safe to prune", and that direction is what these pin.
def test_grew_since_marker_is_true_when_the_marker_cannot_be_stated(tmp_path):
    """No marker at all (never mirrored) reads as grown — the night still needs a copy."""
    night = tmp_path / "2026-07-25"
    night.mkdir()
    (night / "x_ECG.txt").write_text("data")
    assert nightarchive._grew_since_marker(str(night), ".archived") is True


def test_grew_since_marker_is_true_when_the_directory_cannot_be_listed(tmp_path, monkeypatch):
    """A night dir that scandir refuses is UNKNOWN, and unknown must not read as 'mirror still good'.
    Fails toward a re-offer, which costs only the files that differ."""
    night = tmp_path / "2026-07-25"
    night.mkdir()
    (night / ".archived").write_text("")
    monkeypatch.setattr(os, "scandir", _only_for(str(night), os.scandir))
    assert nightarchive._grew_since_marker(str(night), ".archived") is True


def test_grew_since_marker_is_true_when_one_entry_cannot_be_stated(tmp_path, monkeypatch):
    """The per-ENTRY guard, distinct from the per-directory one: the listing succeeded and a single file
    inside it is unreadable. A file whose mtime cannot be compared cannot be shown to be older than the
    marker, so it counts as grown."""
    night = tmp_path / "2026-07-25"
    night.mkdir()
    (night / ".archived").write_text("")
    (night / "x_ECG.txt").write_text("data")

    # Retargeted 2026-08-01 (audit F1): the guard still exists and still means the same thing, but it now
    # lives on the `os.stat` of each walked path rather than on a scandir entry's `is_file()` — the walk
    # is shared with archive_night so the copier and the confirmer cannot disagree. Faking `os.stat` for
    # this one file exercises the real guard; the old fake returned a plain list where os.walk expects a
    # scandir context manager, i.e. it pinned an implementation detail rather than the behaviour.
    real_stat = os.stat
    target = os.path.abspath(str(night / "x_ECG.txt"))

    def flaky_stat(p, *a, **k):
        if os.path.abspath(str(p)) == target:
            raise OSError("simulated stat failure")
        return real_stat(p, *a, **k)

    monkeypatch.setattr(os, "stat", flaky_stat)
    assert nightarchive._grew_since_marker(str(night), ".archived") is True


def test_grew_since_marker_is_false_when_every_file_predates_the_marker(tmp_path):
    """The negative case, so the guards above are not passing for the trivial reason that the function
    always says True — a genuinely complete mirror must still release its night."""
    night = tmp_path / "2026-07-25"
    night.mkdir()
    (night / "x_ECG.txt").write_text("data")
    os.utime(night / "x_ECG.txt", (1_700_000_000, 1_700_000_000))
    (night / ".archived").write_text("")
    assert nightarchive._grew_since_marker(str(night), ".archived") is False


def test_mirror_matches_is_false_when_the_source_cannot_be_read(tmp_path, monkeypatch):
    """An unconfirmed mirror must never license a delete. The destination existing and being readable is
    not enough — if the SOURCE cannot be enumerated there is nothing to confirm it against."""
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.mkdir(), dst.mkdir()
    (src / "a_ECG.txt").write_text("data")
    (dst / "a_ECG.txt").write_text("data")
    assert nightarchive._mirror_matches(str(src), str(dst), ".archived") is True   # sanity: it matches
    monkeypatch.setattr(os, "scandir", _only_for(str(src), os.scandir))
    assert nightarchive._mirror_matches(str(src), str(dst), ".archived") is False


# ── nightqc.file_span_sec: the file that cannot state its own duration ────────────────────
# Every None here is the honest answer that makes `rows / fs` the fallback. The alternative — inventing
# a span — is one of the three mechanisms that put coverage_pct at 196.7 % on real corpus (§A4c).
def _hdr(extra=""):
    return "Phone timestamp;sensor timestamp [ns];channel 0" + extra


def test_span_is_none_when_the_first_data_row_has_no_parseable_clock(tmp_path):
    p = tmp_path / "f.txt"
    p.write_text(_hdr() + "\n2026-07-25T02:00:00.000;not-a-number;1\n")
    assert nightqc.file_span_sec(str(p)) is None


def test_span_is_none_when_the_file_cannot_be_opened(tmp_path):
    assert nightqc.file_span_sec(str(tmp_path / "absent.txt")) is None


def test_span_is_none_when_no_tail_row_parses_or_goes_forward(tmp_path):
    """The backwards walk exists because the LAST line of a still-open file is often a partial write.
    When it runs off the top without finding a row that both parses AND is not before the first, the
    honest answer is None — not a negative span, and not the partial line's garbage."""
    p = tmp_path / "f.txt"
    # The tail read is the last 8 KB, so the file has to be bigger than that or the first row is itself
    # in the tail and trivially satisfies `last >= first`. 400 rows puts it comfortably over.
    # First row's device clock is AHEAD of every row after it — a clock that went backwards is not a
    # duration — and the final line is a partial write, the case the backwards walk exists for.
    body = "".join(f"2026-07-25T02:00:{i % 60:02d}.000;1000000000;1\n" for i in range(400))
    p.write_text(_hdr() + "\n2026-07-25T02:00:00.000;999000000000;1\n" + body
                 + "2026-07-25T02:07:00.000;truncat")
    assert os.path.getsize(p) > (1 << 13), "the fixture must exceed the tail window to test the walk"
    assert nightqc.file_span_sec(str(p)) is None


def test_span_is_measured_from_the_device_clock_when_the_file_can_state_it(tmp_path):
    """The positive control for the three Nones above."""
    p = tmp_path / "f.txt"
    p.write_text(_hdr() + "\n2026-07-25T02:00:00.000;0;1\n2026-07-25T02:00:30.000;30000000000;1\n")
    assert nightqc.file_span_sec(str(p)) == pytest.approx(30.0)


def test_ns_at_returns_none_on_a_non_integer_field(tmp_path):
    """Directly, because the tail walk swallows it: a half-written final line splits into the right
    number of fields with a truncated number in the clock column."""
    assert nightqc._ns_at("2026-07-25T02:00:00.000;12e9;1", 1) is None
    assert nightqc._ns_at("2026-07-25T02:00:00.000;12000;1", 1) == 12000
    assert nightqc._ns_at("too;short", 5) is None


# ── timeline ───────────────────────────────────────────────────────────────────────────────────────
def _f(name, stream, rows, **kw):
    d = {"file": name, "stream": stream, "rows": rows, "bytes": rows * 20, "mtime": 0, "session": 0}
    d.update(kw)
    return d


def test_a_file_with_no_span_and_no_usable_rate_contributes_no_interval():
    """`rows / fs` is the fallback for a file whose own clock column is absent — and it needs an `fs`.
    A stream with no configured or nominal rate (fs 0) has no way to turn rows into seconds, so the file
    is dropped rather than given a fabricated duration."""
    files = [_f("Polar_H10_02849638_20260725223000_ECG.txt", "ECG", 1300)]
    assert timeline.stream_intervals(files, "02849638", "ECG", 0) == []
    # ...but a file that carries its OWN span needs no rate at all
    files2 = [_f("Polar_H10_02849638_20260725223000_ECG.txt", "ECG", 1300, span_sec=10.0)]
    assert len(timeline.stream_intervals(files2, "02849638", "ECG", 0)) == 1


def test_a_bucket_whose_samples_all_lack_rssi_reports_connected_but_no_median():
    """Connectedness and signal strength are separate facts. The LINK sidecar records rows with an empty
    `rssi_dbm` (the read failed, or the poller had no value yet); those still prove the link was up, so
    the bucket must report connected 1 with rssi None rather than dropping the bucket."""
    t0 = dt.datetime(2026, 7, 25, 22, 0).timestamp()
    t1 = t0 + 600
    conn, rssi = timeline.bucket_link([(t0 + 1, 1, None), (t0 + 2, 1, None)], t0, t1, 4)
    assert conn[0] == 1 and rssi[0] is None
    conn2, rssi2 = timeline.bucket_link([(t0 + 1, 1, -70.0), (t0 + 2, 1, -60.0)], t0, t1, 4)
    assert conn2[0] == 1 and rssi2[0] == -60.0


def _link_csv(path, rows, head="Phone timestamp;device;connected;rssi_dbm"):
    path.write_text(head + "\n" + "\n".join(rows) + "\n")


def test_link_rows_with_a_blank_rssi_column_are_kept_without_one(tmp_path):
    """A blank `rssi_dbm` is not a broken row — it is a read that had no value. Dropping the row would
    lose the connectedness it does carry."""
    night = tmp_path / "2026-07-25"
    night.mkdir()
    _link_csv(night / "a_LINK.csv",
              ["2026-07-25T22:00:00;H10;1;", "2026-07-25T22:00:34;H10;1;-71"])
    out = timeline.read_link_samples(str(night))
    assert [r[2] for r in out["H10"]] == [None, -71.0]


def test_a_link_row_with_neither_a_device_nor_an_address_is_dropped(tmp_path):
    """The key is address → learned-alias → name. A row that yields none of them cannot be attributed to
    any device, and bucketing it under the empty string would invent a phantom device on the timeline."""
    night = tmp_path / "2026-07-25"
    night.mkdir()
    _link_csv(night / "a_LINK.csv",
              ["2026-07-25T22:00:00;;1;-70", "2026-07-25T22:00:34;H10;1;-71"])
    out = timeline.read_link_samples(str(night))
    assert set(out) == {"H10"}, "the nameless row must not create a device"
    assert "" not in out


def test_build_does_not_pool_a_previous_day_folder_that_is_not_there(tmp_path):
    """The cross-midnight pooling looks for yesterday's folder. On the FIRST night a box ever records —
    or after retention pruned yesterday — that folder does not exist, and the timeline must build from
    tonight alone rather than fail."""
    night = tmp_path / "2026-07-25"
    night.mkdir()
    # a session starting just after midnight is what arms the pooling gate
    (night / "Polar_H10_02849638_20260725000500_ECG.txt").write_text(
        "Phone timestamp;sensor timestamp [ns];channel 0\n"
        + "".join(f"2026-07-25T00:05:{i:02d}.000;{i}000000000;1\n" for i in range(60)))
    assert not (tmp_path / "2026-07-24").exists()
    out = timeline.build(str(night), [{"name": "H10", "device_id": "02849638", "model": "H10",
                                       "streams": ["ecg"]}])
    assert out["night"] == "2026-07-25"


def test_build_falls_back_to_the_link_sidecar_when_nothing_recorded(tmp_path):
    """A device that connected and never streamed has no session window of its own. The sidecar is the
    only evidence the box was awake, so it is the window — this is the 'connected but silent' view, and
    dropping it would take that view away."""
    night = tmp_path / "2026-07-25"
    night.mkdir()
    _link_csv(night / "a_LINK.csv",
              ["2026-07-25T22:00:00;H10;1;-70", "2026-07-25T23:00:00;H10;0;"])
    out = timeline.build(str(night), [{"name": "H10", "device_id": "02849638", "model": "H10",
                                       "streams": ["ecg"]}])
    assert out["buckets"] > 0, "the sidecar alone must still produce a timeline"


def test_build_ignores_a_session_file_whose_name_carries_no_stamp(tmp_path):
    """The window is built from file START stamps. A file whose name has no parseable stamp contributes
    no endpoint — including it as 0 would stretch the window back to 1970 and render the whole night
    idle."""
    night = tmp_path / "2026-07-25"
    night.mkdir()
    rows = "".join(f"2026-07-25T22:00:{i:02d}.000;{i}000000000;1\n" for i in range(60))
    hdr = "Phone timestamp;sensor timestamp [ns];channel 0\n"
    (night / "Polar_H10_02849638_20260725220000_ECG.txt").write_text(hdr + rows)
    (night / "Polar_H10_02849638_nostamp_ACC.txt").write_text(hdr + rows)
    out = timeline.build(str(night), [{"name": "H10", "device_id": "02849638", "model": "H10",
                                       "streams": ["ecg", "acc"]}])
    # 2026-07-25 22:00 must still be where the window opens
    assert out["t0"] >= dt.datetime(2026, 7, 25, 0, 0).timestamp()


# ── storage_targets: the mount unit defends its own output ─────────────────────────────────────────
def test_mount_unit_refuses_a_host_that_would_be_pasted_as_root():
    """§C6. This text is pasted AS ROOT and the unit body interpolates the fields raw, so a target
    persisted before validate() gained its charset check (46a43f7) must be re-refused here rather than
    trusted. The reachable trigger is an upgrade, not a hand-edit."""
    tgt = {"protocol": "nfs", "mountpoint": "/srv/tepna/archive", "host": "nas; rm -rf /",
           "share": "/export/tepna"}
    with pytest.raises(storage_targets.StorageError, match="invalid host"):
        storage_targets.mount_unit(tgt)


# ── ppg_grid_check ─────────────────────────────────────────────────────────────────────────────────
FS = 125.738
STEP = int(1e9 / FS)


def _ppg(dirpath, name, *, rows, wall_s, step_ns=STEP, t0=None):
    """An O2Ring PPG file the way the box writes one — constant ns step, phone clock spread across
    `wall_s`. Same shape as tests/test_ppg_grid_check.py's writer, minus the gap injection this file
    does not need."""
    t0 = t0 or dt.datetime(2026, 7, 25, 2, 7, 23)
    lines = ["Phone timestamp;sensor timestamp [ns];channel 0"]
    ns = 0
    for i in range(rows):
        f = i / (rows - 1) if rows > 1 else 0.0
        ph = t0 + dt.timedelta(seconds=f * wall_s)
        lines.append(f"{ph.strftime('%Y-%m-%dT%H:%M:%S.')}{ph.microsecond // 1000:03d};{ns};1234")
        ns += step_ns
    (dirpath / name).write_text("\n".join(lines) + "\n")


def test_scan_skips_a_matching_file_it_cannot_judge(tmp_path):
    """"A file that cannot be judged is skipped rather than reported as clean" — the docstring's promise.
    A header-only PPG file matches the filename pattern but has no two rows to measure between, and
    reporting it as ok would be the tool asserting something it did not measure."""
    night = tmp_path / "2026-07-25"
    night.mkdir()
    (night / "Wellue_O2Ring-S_S8AW2100_20260725020723_PPG.txt").write_text(
        "Phone timestamp;sensor timestamp [ns];channel 0\n")
    assert pgc.scan(str(tmp_path)) == [], "unjudgeable is not clean, and not a crash either"


def test_the_rescalable_list_is_truncated_with_a_count_of_the_rest(tmp_path, capsys):
    """The per-file `scale x…` lines are an operator's repair list. Past ten it prints a count instead —
    a box that ran the mis-calibrated grid for weeks has one file per night, and dumping ninety lines
    buries the summary above them."""
    night = tmp_path / "2026-07-26"
    night.mkdir()
    rows = int(61 * FS)
    grid_s = (rows - 1) * STEP / 1e9
    for i in range(11):                       # 11 uniform-stretch files ⇒ one over the cut
        # the stamp must stay exactly 14 digits or the scanner's filename pattern skips the file
        _ppg(night, f"Wellue_O2Ring-S_S8AW2100_20260726{i:02d}0000_PPG.txt",
             rows=rows, wall_s=grid_s / 1.00244, t0=dt.datetime(2026, 7, 26, i, 0, 0))
    assert pgc.main([str(tmp_path)]) == 1
    out = capsys.readouterr().out
    assert "UNIFORM RATE ERROR (11 file(s)" in out
    assert out.count("scale x") == 10, "exactly ten repair lines, then a count"
    assert "… and 1 more" in out
