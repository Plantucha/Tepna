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


# ══ ADVERSARIAL PASS 2026-07-26 ═══════════════════════════════════════════════════════════════
# Four findings, each reproduced against real box conditions before being fixed. The bug class hunted
# here is the one that survives review: output that is WRONG but PLAUSIBLE. A strip that says a
# sensor recorded nothing, or blames the adapter, is believed — nobody cross-checks it against the
# files, which is the entire reason the strip exists.

# ── F1 · device_id matched as a bare substring ────────────────────────────────────────────────
def test_a_device_id_that_is_a_substring_of_another_does_not_steal_its_files():
    """`device_id in filename` is a substring test, so a shorter id inside a longer one claims the
    other device's data. Polar ids are zero-padded serials, which is exactly how you get one id
    contained in another."""
    files = [_f("Polar_H10_02849638_20260725223000_ECG.txt", "ECG", 130 * 600),
             _f("Polar_H10_2849638_20260725223000_ECG.txt", "ECG", 130 * 600)]
    assert len(timeline.stream_intervals(files, "2849638", "ECG", 130)) == 1, \
        "'2849638' must not also match the device whose id is '02849638'"
    assert len(timeline.stream_intervals(files, "02849638", "ECG", 130)) == 1


def test_the_device_id_is_read_as_a_field_not_found_anywhere_in_the_name():
    """The id is the token before the 14-digit stamp. A vendor or model containing the id's text
    must not create a match — and vendor/model may themselves contain underscores."""
    files = [_f("Polar_VeritySense_AC0C301E_20260725223000_PPG.txt", "PPG", 55 * 600)]
    assert timeline.stream_intervals(files, "AC0C301E", "PPG", 55), "its own id must match"
    assert not timeline.stream_intervals(files, "VeritySense", "PPG", 55), \
        "a model name is not a device id"
    assert not timeline.stream_intervals(files, "0C301E3F", "PPG", 55), \
        "a DIFFERENT id must not match, even one that overlaps textually"


# ── F2 · coverage over 100 % ──────────────────────────────────────────────────────────────────
def test_overlapping_sessions_cannot_report_more_than_100_percent_coverage():
    """`covered` summed interval lengths without merging them. Sessions overlap whenever rows/fs
    over-estimates a session's duration — which happens as soon as the configured rate is below the
    rate the device actually ran at. '104.8% captured' is not a number anyone can act on."""
    t0 = _ts(22, 0)
    hour = 3600.0
    iv = [(t0, t0 + hour * 1.1), (t0 + hour, t0 + hour * 2.1)]
    covered = timeline.covered_seconds(iv)
    span = (t0 + hour * 2.1) - t0
    assert covered <= span, f"covered {covered:.0f}s exceeds the {span:.0f}s span it sits in"
    assert round(100 * covered / span, 1) <= 100.0


def test_covered_seconds_still_counts_disjoint_sessions_in_full():
    """Merging overlaps must not quietly swallow real, separate capture."""
    t0 = _ts(22, 0)
    assert timeline.covered_seconds([(t0, t0 + 600), (t0 + 1200, t0 + 1800)]) == 1200


# ── F3 · the third wedge false positive ───────────────────────────────────────────────────────
def test_taking_every_sensor_off_at_the_end_of_the_night_is_not_an_adapter_fault():
    """THE third false positive, and the one that would fire on essentially every night. When the
    night ends you take the strap off and dock the armband; both links drop within a bucket or two of
    each other, and 'every device down at once' is the adapter's signature. It is not — it is you
    going about your morning. The leading edge already had this guard ('you cannot lose an adapter
    you never had'); the trailing edge needs the mirror of it."""
    t0, t1 = _ts(22, 0), _ts(23, 0)
    off = _ts(22, 50)
    link = {"AA": [(t0 + i * 60, 1 if t0 + i * 60 < off else 0, -60.0) for i in range(60)],
            "BB": [(t0 + i * 60, 1 if t0 + i * 60 < off else 0, -70.0) for i in range(60)]}
    assert not any(timeline.wedge_buckets(link, t0, t1, 12)), \
        "a dropout the devices never come back from is the night ending, not a wedge"


def test_a_dropout_the_devices_RECOVER_from_is_still_a_wedge():
    """The trailing guard must not disarm the detector. An adapter that died and came back is the
    real thing, and it is the case that actually cost 110 minutes on 2026-07-23."""
    t0, t1 = _ts(22, 0), _ts(23, 0)
    def conn(t):
        return 0 if _ts(22, 20) <= t < _ts(22, 35) else 1
    link = {"AA": [(t0 + i * 60, conn(t0 + i * 60), -60.0) for i in range(60)],
            "BB": [(t0 + i * 60, conn(t0 + i * 60), -70.0) for i in range(60)]}
    assert any(timeline.wedge_buckets(link, t0, t1, 12)), \
        "a joint dropout followed by recovery is exactly what a wedge looks like"


# ── F4 · a sample just before the window ──────────────────────────────────────────────────────
def test_a_link_sample_before_the_window_is_not_folded_into_bucket_zero():
    """`int((ts-t0)/width)` truncates toward zero, so a sample up to one bucket BEFORE t0 yields
    index 0 and passes the `0 <= i` guard. A stale disconnected sample then paints the first bucket
    nosignal."""
    t0, t1 = _ts(22, 0), _ts(23, 0)
    conn, rssi = timeline.bucket_link([(t0 - 1.0, 0, -99.0)], t0, t1, 60)
    assert conn[0] is None and rssi[0] is None, "a sample outside [t0,t1) must not be bucketed"


def test_a_sample_exactly_at_t0_still_lands_in_bucket_zero():
    """The boundary must stay inclusive at the start — fixing the underflow must not drop real data."""
    t0, t1 = _ts(22, 0), _ts(23, 0)
    conn, _ = timeline.bucket_link([(t0, 1, -55.0)], t0, t1, 60)
    assert conn[0] == 1


# ══ LINK IDENTITY — the sidecar half of the same split (2026-07-26) ═══════════════════════════
# The signal trace covered one hour of an eleven-hour night and nobody could tell, because a short
# flat trace looks like a quiet night rather than a missing one.
#
# The LINK sidecar gained an `address` column mid-corpus (#413, deployed 08:44), so one night's file
# is half name-keyed and half address-keyed: 1238 name rows and 158 address rows for the same H10.
# build() asked `link.get(addr) or link.get(name)` — `or`, so the first non-empty bucket WON and the
# other 87 % was discarded. Whichever key you look up, you lose the rest.

def _link_csv(tmp_path, rows, with_address=True):
    p = tmp_path / f"Tepna_2026072600000{len(list(tmp_path.iterdir()))}_LINK.csv"
    head = ("Phone timestamp;device;connected;rssi_dbm;battery_pct;frames_dropped;frames_duplicated;"
            "link_epoch" + (";address\n" if with_address else "\n"))
    p.write_text(head + "".join(rows))
    return p


def test_a_name_keyed_row_folds_onto_the_address_when_the_night_shows_the_mapping(tmp_path):
    """Rows written after the address column arrived carry BOTH name and address, which is enough to
    place the earlier name-only rows on the same device — no config, no guessing."""
    _link_csv(tmp_path, ["2026-07-26T01:00:00.000;Polar H10 02849638;1;-70;80;;;1\n"],
              with_address=False)
    _link_csv(tmp_path, ["2026-07-26T09:00:00.000;Polar H10 02849638;1;-72;80;;;1;24:AC:AC:02:84:96\n"])
    got = timeline.read_link_samples(str(tmp_path))
    assert list(got) == ["24:AC:AC:02:84:96"], f"expected one device, got {list(got)}"
    assert len(got["24:AC:AC:02:84:96"]) == 2, "the pre-address row must fold onto the address"


def test_an_unmappable_name_is_left_under_its_name_and_not_guessed_at(tmp_path):
    """If the night never shows that name beside an address, inventing a mapping would be fabrication.
    It stays addressable by name so an explicit alias can still claim it."""
    _link_csv(tmp_path, ["2026-07-26T01:00:00.000;Polar Sense 0C301E3F;1;-61;94;;;3\n"],
              with_address=False)
    got = timeline.read_link_samples(str(tmp_path))
    assert list(got) == ["Polar Sense 0C301E3F"]


def test_merge_link_samples_takes_every_key_not_the_first_that_answers(tmp_path):
    """THE bug: `or` picked one bucket. A device's history can be spread over its address, its current
    name and the name it had before a rename — all of it is the same radio."""
    link = {"24:AC:AC:0C:30:1E": [(200.0, 1, -60.0)],
            "Polar Verity Sense": [(300.0, 1, -61.0)],
            "Polar Sense 0C301E3F": [(100.0, 1, -62.0)]}
    got = timeline.merge_link_samples(
        link, ["24:AC:AC:0C:30:1E", "Polar Verity Sense", "Polar Sense 0C301E3F"])
    assert [t for t, _, _ in got] == [100.0, 200.0, 300.0], "merged AND time-ordered"


def test_merge_link_samples_ignores_blanks_and_repeats_a_key_once(tmp_path):
    link = {"AA": [(1.0, 1, -50.0)]}
    assert len(timeline.merge_link_samples(link, ["AA", "AA", None, "", "missing"])) == 1


def test_build_gathers_a_renamed_device_via_its_name_alias(tmp_path):
    """End to end, on the shape the box actually has: pre-rename name rows, plus address rows written
    after both the rename and the address column landed."""
    _link_csv(tmp_path, [f"2026-07-26T0{h}:00:00.000;Polar Sense 0C301E3F;1;-6{h};94;;;3\n"
                         for h in range(1, 6)], with_address=False)
    _link_csv(tmp_path, ["2026-07-26T09:00:00.000;Polar Verity Sense;1;-60;94;;;3;24:AC:AC:0C:30:1E\n"])
    out = timeline.build(str(tmp_path), [{
        "name": "Polar Verity Sense", "device_id": "0C301E3F",
        "name_aliases": ["Polar Sense 0C301E3F"],
        "address": "24:AC:AC:0C:30:1E", "streams": []}], buckets=12)
    pts = [r for r in out["devices"][0]["rssi"] if r is not None]
    assert len(pts) >= 5, f"the pre-rename hours must appear in the trace, got {len(pts)} points"


def test_build_without_an_alias_still_gets_the_address_and_current_name(tmp_path):
    """The common case needs no configuration at all — that is what the auto-fold is for."""
    _link_csv(tmp_path, ["2026-07-26T01:00:00.000;Polar H10 02849638;1;-70;80;;;1\n"],
              with_address=False)
    _link_csv(tmp_path, ["2026-07-26T09:00:00.000;Polar H10 02849638;1;-72;80;;;1;24:AC:AC:02:84:96\n"])
    out = timeline.build(str(tmp_path), [{"name": "Polar H10 02849638", "device_id": "02849638",
                                          "address": "24:AC:AC:02:84:96", "streams": []}], buckets=12)
    pts = [r for r in out["devices"][0]["rssi"] if r is not None]
    assert len(pts) == 2, f"both halves of the night must show, got {len(pts)}"


def test_the_final_sample_sits_on_t1_and_must_still_be_counted():
    """build() derives t1 from the samples, so the newest reading is ALWAYS exactly on the boundary.
    Excluding it drops the current RSSI from every live card."""
    t0, t1 = _ts(22, 0), _ts(23, 0)
    conn, rssi = timeline.bucket_link([(t0, 1, -55.0), (t1, 1, -80.0)], t0, t1, 10)
    assert conn[0] == 1 and rssi[0] == -55.0
    assert conn[-1] == 1 and rssi[-1] == -80.0, "the sample on t1 belongs in the last bucket"


def test_a_sample_beyond_t1_is_still_rejected():
    """Clamping the boundary must not turn into accepting anything after it."""
    t0, t1 = _ts(22, 0), _ts(23, 0)
    conn, _ = timeline.bucket_link([(t1 + 60, 0, -99.0)], t0, t1, 10)
    assert all(c is None for c in conn)


# ── the card→stream mapping in the monitor ────────────────────────────────────────────────────
def _tl_base_mapper():
    """Apply monitor.html's OWN `base` rewrite chain, extracted from the file.

    Re-typing the chain here would only prove the test agrees with the test; this runs the shipped
    one. JS and Python regex agree on everything it uses (anchors, alternation, groups)."""
    import re as _re
    html = open(__file__.replace("tests/test_timeline.py", "monitor.html"), encoding="utf-8").read()
    # There are two `const base = key…` lines — deviceForStream has its own. Anchor on the one inside
    # tlForStream, or the test silently measures the wrong function.
    body = html.split("function tlForStream(")[1]
    # Read the whole STATEMENT, not one line: the chain is long enough to wrap, and a line-based
    # reader silently drops whatever sits past the newline — which is how this test first passed
    # against a mapping it could not see.
    stmt = body[body.index("const base = key"):]
    stmt = stmt[:stmt.index(";")]
    pairs = _re.findall(r"\.replace\(/(.+?)/\s*,\s*'([^']*)'\)", stmt)
    assert pairs, f"could not read the rewrite chain from: {stmt.strip()}"

    def base(key):
        for pat, repl in pairs:
            key = _re.sub(pat, repl, key)
        return key
    return base


def test_pulse_rate_and_motion_resolve_to_the_file_that_actually_carries_them():
    """`pr` and `motion` are COLUMNS of the O2Ring's SpO2 sidecar — its header is
    `Time,Oxygen Level,Pulse Rate,Motion` — and no _PR or _MOTION file is ever written. Looking up a
    stream that cannot exist left both cards with an empty strip and no percentage, which reads as
    'not captured' for data captured continuously. They share the SpO2 file, so they share its
    intervals exactly."""
    base = _tl_base_mapper()
    assert base("pr") == "spo2"
    assert base("motion_o2") == "spo2"


def test_the_mappings_that_already_worked_are_unchanged():
    base = _tl_base_mapper()
    assert base("o2ppg") == "ppg"      # the finger pleth is the ring's PPG file
    assert base("bpm_h10") == "hr"
    assert base("acc_vs") == "acc"
    assert base("gyro_vs") == "gyro"
    assert base("ecg") == "ecg"
    assert base("spo2") == "spo2"
