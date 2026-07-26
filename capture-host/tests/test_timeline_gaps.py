"""timeline.py gap-fill — the degrade-gracefully branches.

The timeline is read from whatever the night left on disk, so every parse here has to survive a torn
row, an unreadable directory and a filename that is not a capture. The rule throughout is the module's
own: a value it cannot prove is left absent, never guessed — an invented link state reads as evidence.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import timeline  # noqa: E402

HDR = "Phone timestamp;device;connected;rssi_dbm;battery_pct;frames_dropped;frames_duplicated;link_epoch;address\n"


def _link(dirpath, name="Tepna_20260725_LINK.csv", header=HDR, body=""):
    p = os.path.join(str(dirpath), name)
    with open(p, "w") as fh:
        fh.write(header + body)
    return p


# ── _stamp_ms ───────────────────────────────────────────────────────────────────────────────────────
def test_stamp_ms_none_when_the_name_carries_no_stamp():
    assert timeline._stamp_ms("README.md") is None


def test_stamp_ms_none_when_the_stamp_is_not_a_real_instant():
    """Shape-matches but is not a date — month 13. Refuse it rather than let strptime raise up into the
    timeline build, which would take the whole night's view down over one stray filename."""
    assert timeline._stamp_ms("Polar_H10_1_20261345225058_ECG.txt") is None


# ── bucketing guards ────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("n,t0,t1", [(0, 0.0, 10.0), (-1, 0.0, 10.0), (4, 10.0, 10.0), (4, 10.0, 5.0)])
def test_bucket_stream_refuses_a_degenerate_window(n, t0, t1):
    """A zero/negative bucket count or a non-advancing window has no honest rendering — return empty
    rather than divide by zero or emit buckets spanning backwards time."""
    assert timeline.bucket_stream([(0.0, 5.0)], t0, t1, n, 25.0) == []


@pytest.mark.parametrize("n,t0,t1", [(0, 0.0, 10.0), (4, 10.0, 10.0)])
def test_bucket_link_refuses_a_degenerate_window(n, t0, t1):
    assert timeline.bucket_link([(1.0, 1, -60.0)], t0, t1, n) == ([], [])


# ── read_link_samples: torn rows and unreadable paths ───────────────────────────────────────────────
def test_read_link_samples_skips_an_unlistable_directory(tmp_path):
    """A night folder that vanished mid-read (retention pruning, an unmounted archive) must not abort
    the whole timeline — the other folders still have a story to tell."""
    good = tmp_path / "a"
    good.mkdir()
    _link(good, body="2026-07-25T22:00:00.000;H10;1;-60;;;;1;24:AC:AC:02:84:96\n")
    out = timeline.read_link_samples([str(good), str(tmp_path / "gone")])
    assert out and any(v for v in out.values())


def test_read_link_samples_tolerates_short_bad_and_unreadable_rows(tmp_path):
    """One torn row must cost one row, not the file. Rows here: too few columns, an unparseable
    timestamp, a non-numeric RSSI (kept, with rssi absent), and one good row."""
    body = ("short;row\n"
            "notatimestamp;H10;1;-60;;;;1;AA\n"
            "2026-07-25T22:00:05.000;H10;1;notanumber;;;;1;24:AC:AC:02:84:96\n"
            "2026-07-25T22:00:10.000;H10;1;-61;;;;1;24:AC:AC:02:84:96\n")
    _link(tmp_path, body=body)
    out = timeline.read_link_samples(str(tmp_path))
    samples = [s for v in out.values() for s in v]
    assert len(samples) == 2, samples                      # the two parseable rows survived
    assert any(s[2] is None for s in samples)              # bad RSSI became absent, not 0.0
    assert any(s[2] == -61.0 for s in samples)


def test_read_link_samples_skips_a_file_it_cannot_open(tmp_path, monkeypatch):
    _link(tmp_path, body="2026-07-25T22:00:00.000;H10;1;-60;;;;1;AA\n")
    real = timeline.open if hasattr(timeline, "open") else open

    def boom(path, *a, **k):
        if str(path).endswith("_LINK.csv"):
            raise OSError("EIO")
        return real(path, *a, **k)
    monkeypatch.setattr("builtins.open", boom)
    assert timeline.read_link_samples(str(tmp_path)) == {}


# ── link_adapter: the provenance header ─────────────────────────────────────────────────────────────
def test_link_adapter_reads_the_header_comment(tmp_path):
    _link(tmp_path, header="# adapter=AC:A7:F1:29:9D:1D hci=hci0\n" + HDR)
    out = timeline.link_adapter(str(tmp_path))
    assert "adapter=AC:A7:F1:29:9D:1D" in next(iter(out.values()))


def test_link_adapter_skips_unlistable_dirs_and_unopenable_files(tmp_path, monkeypatch):
    assert timeline.link_adapter([str(tmp_path / "missing")]) == {}
    _link(tmp_path, header="# adapter=x hci=hci0\n" + HDR)
    real = open

    def boom(path, *a, **k):
        if str(path).endswith("_LINK.csv"):
            raise OSError("EIO")
        return real(path, *a, **k)
    monkeypatch.setattr("builtins.open", boom)
    assert timeline.link_adapter(str(tmp_path)) == {}


# ── wedge_buckets ───────────────────────────────────────────────────────────────────────────────────
def test_wedge_buckets_returns_empty_for_no_buckets():
    assert timeline.wedge_buckets({}, 0.0, 10.0, 0) == []
    assert timeline.wedge_buckets({}, 0.0, 10.0, -3) == []


def test_wedge_buckets_needs_two_devices_to_call_it_an_adapter_fault():
    """One sensor dropping is range; all of them dropping together is the radio. With fewer than two
    devices ever connected there is no way to tell those apart, and guessing would report the more
    alarming of the two."""
    one = {"H10": [(1.0, 1, -60.0), (2.0, 0, None)]}
    assert timeline.wedge_buckets(one, 0.0, 10.0, 5) == [False] * 5


def test_wedge_buckets_reports_nothing_before_the_radio_ever_worked():
    """Both devices connected at SOME point — so they pass the two-device gate — but not inside the
    rendered window, leaving no bucket where the radio was demonstrably up. Wedge detection starts only
    after a first confirmed connection, so flagging this stretch would report startup as a fault."""
    outside = {"H10":    [(1000.0, 1, -60.0)],
               "Verity": [(1001.0, 1, -55.0)]}
    assert timeline.wedge_buckets(outside, 0.0, 10.0, 5) == [False] * 5
