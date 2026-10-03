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
    assert timeline.bucket_stream([(0.0, 5.0)], t0, t1, n) == []


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
    body = (
        "short;row\n"
        "notatimestamp;H10;1;-60;;;;1;AA\n"
        "2026-07-25T22:00:05.000;H10;1;notanumber;;;;1;24:AC:AC:02:84:96\n"
        "2026-07-25T22:00:10.000;H10;1;-61;;;;1;24:AC:AC:02:84:96\n"
    )
    _link(tmp_path, body=body)
    out = timeline.read_link_samples(str(tmp_path))
    samples = [s for v in out.values() for s in v]
    assert len(samples) == 2, samples  # the two parseable rows survived
    assert any(s[2] is None for s in samples)  # bad RSSI became absent, not 0.0
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
    outside = {"H10": [(1000.0, 1, -60.0)], "Verity": [(1001.0, 1, -55.0)]}
    assert timeline.wedge_buckets(outside, 0.0, 10.0, 5) == [False] * 5


# ── 2026-09-28, three defects one night surfaced ──────────────────────────────────────────────────
def _f(name, rows, **kw):
    """A session-file record as `timeline` reads them. `stream` is the FILE TAG, which is the thing
    E4 is about: the ring writes `_ACCRAW.` where the H10 writes `_ACC.`, for one configured stream."""
    return {"file": name, "stream": kw.pop("stream", "ACC"), "rows": rows, **kw}


def test_E4_the_rings_ACCRAW_is_FOUND_under_the_acc_stream():
    """2026-09-28: the ring's 10 137 042-byte `_ACCRAW.txt` matched nothing and its whole night was
    painted `idle` — the one state that reads as a finding rather than a miss. `timeline` compared the
    file tag against `s.upper()` alone; `nightqc.stream_file_tags('acc')` has always returned BOTH."""
    import nightqc

    tags = nightqc.stream_file_tags("acc")
    assert "ACCRAW" in tags and "ACC" in tags, tags
    ring = [_f("Polar_VeritySense_0C301E3F_20260928213651_ACCRAW.txt", 900, stream="ACCRAW", span_sec=60.0)]
    assert timeline.stream_intervals(ring, "0C301E3F", tags, 50.0) != [], "the ring's file must be placed"
    assert timeline.stream_intervals(ring, "0C301E3F", "ACC", 50.0) == [], "…and the single-tag call is what missed it"


def test_E4_accepting_both_tags_cannot_let_one_device_cover_for_another():
    """The UNION is safe only because the id filter is independent of the tag — asserted, not assumed,
    since that is the whole reason nightqc could make it a union rather than a per-device mapping."""
    import nightqc

    mixed = [
        _f("Polar_VeritySense_0C301E3F_20260928213651_ACCRAW.txt", 900, stream="ACCRAW", span_sec=60.0),
        _f("Polar_H10_02849638_20260928213612_ACC.txt", 900, stream="ACC", span_sec=60.0),
    ]
    only_ring = timeline.stream_intervals(mixed, "0C301E3F", nightqc.stream_file_tags("acc"), 50.0)
    assert len(only_ring) == 1, "the other device's file is excluded by ID, not by tag"


def test_E5_a_dropping_stream_is_measured_by_its_OWN_host_stamps_not_by_received_samples():
    """2026-09-28: the Verity ACC ran to 04:20:39 and the bar stopped at ~03:52 — 28 min of real
    recording painted as nothing. `rows / fs` measures RECEIVED SAMPLES, so a link that drops packets
    writes fewer rows than the clock says elapsed, and the old order reached for it before the host
    stamps. Here: 3600 s of wall time at 50 Hz would be 180 000 rows; 90 000 arrived."""
    dropping = [
        _f("Polar_VeritySense_0C301E3F_20260928213651_ACCRAW.txt", 90_000, stream="ACCRAW", host_span_sec=3600.0)
    ]
    iv = timeline.stream_intervals(dropping, "0C301E3F", ("ACCRAW",), 50.0)
    assert len(iv) == 1
    assert iv[0][1] - iv[0][0] == 3600.0, "the host stamps say an hour; received samples would say half"


def test_E5_the_device_clock_still_wins_when_the_file_carries_one():
    """§A4c is untouched: `span_sec` is the file's own device clock and outranks everything."""
    both = [
        _f(
            "Polar_VeritySense_0C301E3F_20260928213651_ACCRAW.txt",
            90_000,
            stream="ACCRAW",
            span_sec=1234.0,
            host_span_sec=3600.0,
        )
    ]
    iv = timeline.stream_intervals(both, "0C301E3F", ("ACCRAW",), 50.0)
    assert iv[0][1] - iv[0][0] == 1234.0


def test_E5_rows_over_fs_is_still_there_for_a_file_with_neither():
    """Last, not gone — a file with no clock of its own and no host span is still measurable."""
    bare = [_f("Polar_H10_02849638_20260928213612_ACC.txt", 6000)]
    iv = timeline.stream_intervals(bare, "02849638", ("ACC",), 50.0)
    assert iv[0][1] - iv[0][0] == 120.0


def test_E5_no_basis_at_all_is_a_REFUSAL_and_counted_as_unmeasurable():
    """§∅ — `None`, not a zero, and `unmeasurable_files` is what lets a percentage say so."""
    nothing = [_f("Polar_H10_02849638_20260928213612_ACC.txt", 6000)]
    assert timeline.stream_intervals(nothing, "02849638", ("ACC",), 0.0) == []
    assert timeline.unmeasurable_files(nothing, "02849638", ("ACC",), 0.0) == 1


def test_E6_bucket_stream_takes_no_rate_because_it_never_read_one():
    """`fs` sat in the signature and appeared nowhere in the body — a parameter that states a
    dependency the function does not have. Removed rather than wired, because nothing in bucketing
    covered intervals across a window needs a sample rate."""
    import inspect

    assert "fs" not in inspect.signature(timeline.bucket_stream).parameters
    t0, t1 = 0.0, 100.0
    assert timeline.bucket_stream([(t0, t1)], t0, t1, 10) == ["captured"] * 10
