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


# ── 2026-09-28: a dropping stream was measured by the samples it RECEIVED ────────────────────────
VERITY_ACC = "Polar_VeritySense_0C301E3F_20260928213651_ACCRAW.txt"
H10_ACC = "Polar_H10_02849638_20260928213612_ACC.txt"


def _f(name, rows, stream="ACC", **kw):
    """A session-file record as `timeline._placed` reads them: the filename carries the stamp and the
    device id, `stream` is the file tag, `rows` is what arrived, and the duration keys are whichever
    bases that file actually has."""
    return {"file": name, "stream": stream, "rows": rows, **kw}


def _start(iv):
    assert len(iv) == 1, iv
    return iv[0][0]


def test_a_dropping_stream_is_measured_by_its_OWN_host_stamps_not_by_received_samples():
    """2026-09-28: the Verity ACC ran to 04:20:39 and the bar stopped at ~03:52 — 28 min of real
    recording painted as nothing. `rows / fs` measures RECEIVED SAMPLES, so a link that drops packets
    writes fewer rows than the clock says elapsed, and the old order reached for it before the host
    stamps. Here 3600 s of wall time at 50 Hz would be 180 000 rows; 90 000 arrived."""
    dropping = [_f(VERITY_ACC, 90_000, stream="ACCRAW", host_span_sec=3600.0)]
    iv = timeline.stream_intervals(dropping, "0C301E3F", "ACCRAW", 50.0)
    assert len(iv) == 1
    assert iv[0][1] - iv[0][0] == 3600.0, "the host stamps say an hour; received samples would say half"


def test_the_device_clock_still_wins_when_the_file_carries_one():
    """§A4c is untouched: `span_sec` is the file's own device clock and outranks both others."""
    both = [_f(VERITY_ACC, 90_000, stream="ACCRAW", span_sec=1234.0, host_span_sec=3600.0)]
    iv = timeline.stream_intervals(both, "0C301E3F", "ACCRAW", 50.0)
    assert iv[0][1] - iv[0][0] == 1234.0


def test_rows_over_fs_is_still_there_for_a_file_with_neither():
    """Last, not gone — a file with no clock of its own and no host span is still measurable."""
    iv = timeline.stream_intervals([_f(H10_ACC, 6000)], "02849638", "ACC", 50.0)
    assert iv[0][1] - iv[0][0] == 120.0


def test_no_basis_at_all_is_a_REFUSAL_and_counted_as_unmeasurable():
    """§∅ — `None`, not a zero, and `unmeasurable_files` is what lets a percentage say so."""
    nothing = [_f(H10_ACC, 6000)]
    assert timeline.stream_intervals(nothing, "02849638", "ACC", 0.0) == []
    assert timeline.unmeasurable_files(nothing, "02849638", "ACC", 0.0) == 1


# ── `offset_sec` is the frame, and every branch of it is observed ────────────────────────────────
# ⚠️ THESE THREE EXIST BECAUSE THE MUTATION GATE SAID SO, and they are the whole reason the carve-out
# was worth making. `_placed` adds `offset_sec` to the floating stamp, and nothing in the suite looked
# at the result: the default, the explicit `None` and the sign of the addition were all unobserved, so
# a mutant could default it to 1.0, treat `None` as 1.0, or SUBTRACT the offset and stay green
# (`timeline.x__placed__mutmut_1 / _34 / _36 / _37`, survivors in run 36618574693). The three
# assertions below are about the FRAME, which is a Clock-Contract fact (§🔒 §1: the stamp is floating
# and `offset_sec` is what raises it into the caller's), not about the duration this PR reorders.
def test_the_start_is_the_bare_floating_stamp_when_no_offset_is_given():
    """The default is 0.0 — "already one frame", which is what every synthetic file list here is."""
    stamp = timeline._stamp_ms(VERITY_ACC)
    assert stamp is not None, "the fixture filename must carry a readable stamp or this proves nothing"
    iv = timeline.stream_intervals([_f(VERITY_ACC, 900, stream="ACCRAW", span_sec=60.0)], "0C301E3F", "ACCRAW", 50.0)
    assert _start(iv) == stamp


def test_an_explicit_None_offset_raises_the_stamp_by_nothing_rather_than_by_one_second():
    """`None` means "the caller has no frame to add", which is 0.0 and not 1.0 — the distinction a
    mutant erased, and the one that would silently shift a whole night's bar by a second."""
    stamp = timeline._stamp_ms(VERITY_ACC)
    iv = timeline.stream_intervals(
        [_f(VERITY_ACC, 900, stream="ACCRAW", span_sec=60.0)], "0C301E3F", "ACCRAW", 50.0, offset_sec=None
    )
    assert _start(iv) == stamp


def test_an_offset_is_ADDED_to_the_stamp_and_the_sign_is_observed():
    """`build` passes the writer's recovered UTC offset here, so the sign is the difference between a
    night rendered in the writer's frame and one rendered two offsets away from it."""
    stamp = timeline._stamp_ms(VERITY_ACC)
    iv = timeline.stream_intervals(
        [_f(VERITY_ACC, 900, stream="ACCRAW", span_sec=60.0)], "0C301E3F", "ACCRAW", 50.0, offset_sec=7200.0
    )
    assert _start(iv) == stamp + 7200.0
