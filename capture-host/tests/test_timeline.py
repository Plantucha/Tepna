# tepna-capture — tests/test_timeline.py
# Copyright 2026 Michal Planicka
# SPDX-License-Identifier: Apache-2.0
"""Per-stream capture timeline + per-device signal trace.

The strip's whole value is that it distinguishes WHY there is no data. So the tests weigh heaviest on
the states that accuse the box of a fault — `wedged` most of all, because a red bar says "your adapter
died" and both of its false-positive modes were found on real data before they were fixed.
"""
import datetime as dt

import timeline


def _ts(h, m, s=0):
    return dt.datetime(2026, 7, 25, h, m, s).timestamp()


def _f(name, stream, rows):
    return {"file": name, "stream": stream, "rows": rows, "bytes": rows * 20, "mtime": 0, "session": 0}


# ── stream intervals come from ROWS, not mtime ────────────────────────────────────────────────
def test_interval_duration_is_rows_over_rate_not_mtime():
    """mtime is when the last flush landed — for a killed or still-open session that is not where the
    data ends. Rows are the data."""
    files = [_f("Polar_H10_02849638_20260725223000_ECG.txt", "ECG", 130 * 600)]
    iv = timeline.stream_intervals(files, "02849638", "ECG", 130)
    assert len(iv) == 1
    assert round(iv[0][1] - iv[0][0]) == 600, "130 Hz x 78000 rows = 600 s"


def test_a_file_for_another_device_is_ignored():
    files = [_f("Polar_H10_02849638_20260725223000_ECG.txt", "ECG", 1300),
             _f("Polar_VeritySense_0C301E3F_20260725223000_ECG.txt", "ECG", 1300)]
    assert len(timeline.stream_intervals(files, "02849638", "ECG", 130)) == 1


def test_a_header_only_file_contributes_nothing():
    assert timeline.stream_intervals(
        [_f("Polar_H10_02849638_20260725223000_ECG.txt", "ECG", 0)], "02849638", "ECG", 130) == []


# ── bucketing ─────────────────────────────────────────────────────────────────────────────────
def test_full_coverage_is_captured_and_no_coverage_is_idle():
    t0, t1 = _ts(22, 0), _ts(23, 0)
    assert timeline.bucket_stream([(t0, t1)], t0, t1, 10, 130) == ["captured"] * 10
    assert timeline.bucket_stream([], t0, t1, 10, 130) == ["idle"] * 10


def test_partial_coverage_reads_degraded_not_captured():
    t0, t1 = _ts(22, 0), _ts(23, 0)
    mid = t0 + (t1 - t0) * 0.2          # covers 20 % of a single bucket
    st = timeline.bucket_stream([(t0, mid)], t0, t1, 5, 130)
    assert st[0] == "captured" and st[1] == "idle"
    st2 = timeline.bucket_stream([(t0, t0 + (t1 - t0) * 0.1)], t0, t1, 5, 130)
    assert st2[0] == "degraded", "half a bucket is not a clean capture"


# ── the two wedge false positives, both found on real data ────────────────────────────────────
def test_a_device_that_never_connects_cannot_vote_a_wedge():
    """THE first false positive. The COOSPO is an optional backup that was never present, so it cast a
    permanent `disconnected` vote — and any bucket where a real sensor was still bonding then read as
    'every device down = adapter wedge'. It painted the first ~20 min of 2026-07-25 red."""
    t0, t1 = _ts(22, 0), _ts(23, 0)
    link = {
        "AA": [(t0 + i * 60, 1, -60.0) for i in range(60)],      # a real sensor, up throughout
        "BB": [(t0 + i * 60, 0, None) for i in range(60)],       # never present
    }
    assert not any(timeline.wedge_buckets(link, t0, t1, 20))


def test_no_wedge_before_the_first_successful_connection():
    """THE second false positive. Before anything connects every device is naturally down — that is the
    daemon scanning and bonding, not a fault. You cannot lose an adapter you never had."""
    t0, t1 = _ts(22, 0), _ts(23, 0)
    half = t0 + (t1 - t0) / 2
    link = {  # both devices down for the first half, then both up
        "AA": [(t0 + i * 60, 1 if t0 + i * 60 >= half else 0, -60.0) for i in range(60)],
        "BB": [(t0 + i * 60, 1 if t0 + i * 60 >= half else 0, -70.0) for i in range(60)],
    }
    w = timeline.wedge_buckets(link, t0, t1, 20)
    assert not any(w[:10]), "the pre-connection stretch is startup, not a wedge"


def test_a_real_simultaneous_dropout_IS_a_wedge():
    """The detector must still fire — two devices that were both working going down together is the
    adapter, and that is the one fault the box itself caused."""
    t0, t1 = _ts(22, 0), _ts(23, 0)
    def conn(t):
        return 0 if _ts(22, 30) <= t < _ts(22, 40) else 1
    link = {"AA": [(t0 + i * 60, conn(t0 + i * 60), -60.0) for i in range(60)],
            "BB": [(t0 + i * 60, conn(t0 + i * 60), -70.0) for i in range(60)]}
    assert any(timeline.wedge_buckets(link, t0, t1, 20)), "a genuine joint dropout must still show"


def test_a_single_device_can_never_prove_a_wedge():
    """With one sensor there is no way to separate its own dropout from an adapter fault, and guessing
    would pick the more alarming of the two."""
    t0, t1 = _ts(22, 0), _ts(23, 0)
    link = {"AA": [(t0 + i * 60, 0, None) for i in range(60)]}
    assert not any(timeline.wedge_buckets(link, t0, t1, 20))


# ── layering: bytes on disk outrank the link poll ─────────────────────────────────────────────
def test_link_state_never_overrides_a_bucket_that_actually_wrote():
    states = ["captured", "degraded", "idle", "idle"]
    out = timeline.apply_link_states(states, [0, 0, 0, None], [False, False, False, True])
    assert out[0] == "captured" and out[1] == "degraded", "written bytes outrank a 34 s poll"
    assert out[2] == "nosignal"
    assert out[3] == "wedged"


def test_idle_stays_idle_when_the_link_was_simply_not_sampled():
    """No sample is not the same as disconnected — nothing was recording, and that is not a loss."""
    assert timeline.apply_link_states(["idle"], [None], [False]) == ["idle"]


# ── the signal trace ──────────────────────────────────────────────────────────────────────────
def test_rssi_bucket_is_a_median_and_gaps_stay_none():
    t0, t1 = _ts(22, 0), _ts(22, 10)
    s = [(t0 + 1, 1, -60.0), (t0 + 2, 1, -80.0), (t0 + 3, 1, -70.0)]
    conn, rssi = timeline.bucket_link(s, t0, t1, 10)
    assert rssi[0] == -70.0, "median, so one spike does not move the trace"
    assert rssi[5] is None and conn[5] is None, "an unsampled bucket must not carry a value forward"


def test_link_samples_are_keyed_on_address_when_present(tmp_path):
    """A rename split one sensor across two keys on 2026-07-25; the MAC cannot be edited."""
    p = tmp_path / "Tepna_20260725220000_LINK.csv"
    p.write_text(
        "Phone timestamp;device;connected;rssi_dbm;battery_pct;frames_dropped;"
        "frames_duplicated;link_epoch;address\n"
        "2026-07-25T22:00:01.000;Polar Verity Sense;1;-61;94;;;3;24:AC:AC:0C:30:1E\n"
        "2026-07-25T22:00:35.000;Polar Sense 0C301E3F;1;-63;94;;;3;24:AC:AC:0C:30:1E\n")
    got = timeline.read_link_samples(str(tmp_path))
    assert list(got) == ["24:AC:AC:0C:30:1E"], "two names, one device"
    assert len(got["24:AC:AC:0C:30:1E"]) == 2


def test_a_pre_address_sidecar_still_parses_by_name(tmp_path):
    """Historical nights have no address column — they must not silently yield nothing."""
    p = tmp_path / "Tepna_20260720220000_LINK.csv"
    p.write_text("Phone timestamp;device;connected;rssi_dbm;battery_pct;frames_dropped;"
                 "frames_duplicated;link_epoch\n"
                 "2026-07-20T22:00:01.000;Polar H10;1;-55;80;;;2\n")
    got = timeline.read_link_samples(str(tmp_path))
    assert got and list(got) == ["Polar H10"]


def test_build_on_an_empty_night_is_not_an_error(tmp_path):
    out = timeline.build(str(tmp_path), [{"name": "X", "device_id": "1", "address": "AA",
                                          "streams": ["ecg"]}])
    assert out["buckets"] == 0 and out["devices"] == []
