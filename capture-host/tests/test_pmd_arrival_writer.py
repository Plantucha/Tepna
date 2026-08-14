"""PACKET-ARRIVAL SIDECAR — the pairing that makes the inter-device offset measurable.

Every wearable pair here is separated by a per-connection BLE buffering delay of hundreds of ms
(measured Verity-minus-H10 across nights: -867 to +1321), while PAT needs ~10 ms. The obvious estimator
— the minimum of (host - device), since buffering is one-sided — FAILS on the signal files, because the
per-sample `phone` stamps StreamWriter records are back-timed across each packet from a single arrival.
The lower edge is therefore a smear the width of the packet, not an edge: measured, the minimum sits
27-115 ms below the 1st percentile.

This sidecar records the TRUE arrival beside the device stamp of the packet's first sample, so the
minimum has a real floor. These tests pin the properties that make it usable, not merely that it writes.
"""
import datetime as _dt
import os

from writers import PmdArrivalLogWriter
from tests._srcscan import module_source

_T0 = _dt.datetime(2026, 8, 11, 22, 0, 0)


def _read(path):
    with open(path) as fh:
        return [ln.rstrip("\n") for ln in fh if ln.strip()]


def _bell(n, centre=400.0, sd=25.0, seed=12345):
    """A deterministic BELL-shaped draw — a genuine soft tail, which is what smears an edge.

    Two earlier fixtures failed here and both failed the same way: a uniform spread and a sum of
    modular terms each have a HARD lower edge (the modular one repeats its minimum a dozen times), so
    the estimator correctly reported spread ~0 and the test read that as a bug in the estimator. What
    makes an edge un-findable is that the extreme low values are RARE, so an LCG + central-limit sum is
    used rather than arithmetic that looks random but is periodic.
    """
    out, st = [], seed
    for _ in range(n):
        acc = 0.0
        for _ in range(12):
            st = (st * 1103515245 + 12345) & 0x7FFFFFFF
            acc += st / 0x7FFFFFFF
        out.append(centre + (acc - 6.0) * sd)
    return out

def test_header_and_one_row(tmp_path):
    p = os.path.join(tmp_path, "Tepna_20260811220000_PMDARRIVAL.csv")
    w = PmdArrivalLogWriter(p, fsync=False)
    w.write(_T0, "Polar H10 02849638", "ECG", 839728574462147086, 839728574531147086, 10)
    w.close()
    rows = _read(p)
    assert rows[0] == "Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples"
    f = rows[1].split(";")
    assert f[1] == "Polar H10 02849638" and f[2] == "ECG"
    # the device stamps must survive as EXACT integers — a float would lose ns resolution at 8.4e17,
    # which is the whole quantity being recorded
    assert f[3] == "839728574462147086" and f[4] == "839728574531147086"
    assert f[5] == "10"


def test_arrival_is_recorded_not_derived(tmp_path):
    """Two packets arriving 8 ms apart must be distinguishable in the file.

    The failure this sidecar exists to fix is a SMEARED lower edge; if arrivals were rounded or reused
    the floor would smear again here, so the stamps must differ at millisecond resolution.
    """
    p = os.path.join(tmp_path, "a.csv")
    w = PmdArrivalLogWriter(p, fsync=False)
    w.write(_T0, "d", "ECG", 1_000_000_000, 1_069_000_000, 10)
    w.write(_T0 + _dt.timedelta(milliseconds=8), "d", "ECG", 1_077_000_000, 1_146_000_000, 10)
    w.close()
    a, b = (r.split(";")[0] for r in _read(p)[1:])
    assert a != b, "two arrivals 8 ms apart collapsed to one stamp — the floor would smear again"


def test_none_fields_are_blank_never_zero(tmp_path):
    """A missing device stamp must read as absent, not as 0.

    A fabricated 0 would sit far below every real value and BECOME the minimum — silently defining the
    offset as whatever the gap was. Blank cannot be mistaken for a measurement.
    """
    p = os.path.join(tmp_path, "b.csv")
    w = PmdArrivalLogWriter(p, fsync=False)
    w.write(_T0, "d", "ACC", None, None, 0)
    w.close()
    f = _read(p)[1].split(";")
    assert f[3] == "" and f[4] == "", "absent device stamp fabricated as 0 — it would become the min"


def test_rows_counted_and_close_is_idempotent(tmp_path):
    p = os.path.join(tmp_path, "c.csv")
    w = PmdArrivalLogWriter(p, fsync=False)
    for i in range(5):
        w.write(_T0 + _dt.timedelta(milliseconds=8 * i), "d", "PPG", 1_000 + i, 1_050 + i, 7)
    assert w.rows == 5
    w.close()
    w.close()          # every sibling writer swallows a double close; this one must too
    assert len(_read(p)) == 6


def test_min_filter_has_a_floor_on_this_layout(tmp_path):
    """The property the whole sidecar is for, asserted end to end.

    Planted: a constant offset of 400 ms plus one-sided buffering delay. The minimum of
    (arrival - device) must recover the offset, and must sit CLOSE to the 1st percentile — that
    closeness is exactly what the back-timed per-sample stamps do not have.
    """
    p = os.path.join(tmp_path, "d.csv")
    w = PmdArrivalLogWriter(p, fsync=False)
    base_ns = 500_000_000_000
    delays = [0, 3, 5, 9, 14, 21, 30, 44, 61, 90] * 20      # one-sided: never negative
    for i, extra in enumerate(delays):
        dev_ns = base_ns + i * 77_000_000                    # 77 ms between packets
        arrival = _T0 + _dt.timedelta(milliseconds=(dev_ns - base_ns) / 1e6 + 400 + extra)
        w.write(arrival, "d", "ECG", dev_ns, dev_ns + 69_000_000, 10)
    w.close()
    diffs = []
    for r in _read(p)[1:]:
        f = r.split(";")
        t = _dt.datetime.fromisoformat(f[0])
        diffs.append((t - _T0).total_seconds() * 1000 - (int(f[3]) - base_ns) / 1e6)
    diffs.sort()
    p01 = diffs[len(diffs) // 100]
    assert abs(diffs[0] - 400) < 2, f"min-filter did not recover the planted 400 ms offset: {diffs[0]}"
    assert p01 - diffs[0] < 5, f"minimum is {p01 - diffs[0]:.1f} ms below p01 — that is a smear, not a floor"


# ─── floor_ms: the estimator, and its refusal to answer when it cannot ───────────────────────────

def test_floor_ms_reports_estimate_and_spread():
    """A one-sided distribution: the estimate lands at the floor and the spread is small."""
    diffs = [400 + d for d in [0, 1, 2, 4, 7, 11, 18, 29, 47, 76] * 30]
    est, spread = PmdArrivalLogWriter.floor_ms(diffs)
    assert abs(est - 400) < 6, est
    assert spread < 6, f"one-sided data should give a tight floor, got {spread}"


def test_floor_ms_exposes_a_smear_rather_than_hiding_it():
    """The case this sidecar exists to detect: a SYMMETRIC spread has no edge.

    The back-timed per-sample stamps produced exactly this, and the failure mode was reporting the
    minimum anyway. `spread` must come back large so a caller can refuse it.
    """
    # A UNIFORM spread is NOT a smear — it has a hard lower edge, and the estimator correctly reports
    # spread 2 on one. What smears an edge is a soft TAIL, so the fixture must be bell-shaped: a sum of
    # uniforms, deterministic so the gate cannot flake.
    diffs = _bell(3000)
    est, spread = PmdArrivalLogWriter.floor_ms(diffs)
    assert spread > 10, f"a smeared edge must report a large spread, got {spread}"


def test_floor_ms_refuses_on_too_few_points():
    """An unknown is not a pass. Too few samples cannot have an edge, so it answers None."""
    assert PmdArrivalLogWriter.floor_ms([400.0] * 20) == (None, None)


def test_floor_ms_is_robust_to_one_early_outlier():
    """A single anomalously early arrival — a scheduling artifact, a clock step — must not become the
    answer. That is precisely why the estimate is a low quantile and not the bare minimum."""
    diffs = [400 + d for d in [0, 1, 2, 4, 7, 11, 18, 29, 47, 76] * 30]
    diffs.append(-2000.0)
    est, _ = PmdArrivalLogWriter.floor_ms(diffs)
    assert abs(est - 400) < 10, f"one outlier moved the estimate to {est}"


# ─── nightqc.arrival_quality: judged where judgeable, silent where not ───────────────────────────

def _write_sidecar(path, meas, diffs_ms, base_ns=500_000_000_000):
    w = PmdArrivalLogWriter(path, fsync=False)
    for i, extra in enumerate(diffs_ms):
        dev_ns = base_ns + i * 77_000_000
        arr = _T0 + _dt.timedelta(milliseconds=(dev_ns - base_ns) / 1e6 + extra)
        w.write(arr, "dev", meas, dev_ns, dev_ns + 69_000_000, 10)
    w.close()


def test_arrival_quality_passes_a_real_floor(tmp_path):
    import nightqc
    _write_sidecar(os.path.join(tmp_path, "Tepna_1_PMDARRIVAL.csv"), "ECG",
                   [400 + d for d in [0, 1, 2, 4, 7, 11, 18, 29, 47, 76] * 30])
    rows = nightqc.arrival_quality(str(tmp_path))
    assert len(rows) == 1 and rows[0]["floor_ok"] is True, rows


def test_arrival_quality_flags_a_smear(tmp_path):
    import nightqc
    _write_sidecar(os.path.join(tmp_path, "Tepna_2_PMDARRIVAL.csv"), "ECG",
                   _bell(3000))
    rows = nightqc.arrival_quality(str(tmp_path))
    assert rows[0]["floor_ok"] is False, rows
    assert rows[0]["floor_spread_ms"] > 5


def test_arrival_quality_does_not_floor_judge_the_quantised_ring(tmp_path):
    """The ring's `duration` is 1 s quantised, so a minimum returns the quantum, not an edge.

    Judging it by the floor rule would manufacture a failure every single night — so it must report
    `floor_ok: None` (unjudged), never False.
    """
    import nightqc
    _write_sidecar(os.path.join(tmp_path, "Tepna_3_PMDARRIVAL.csv"), "OXYLIVE_DURATION_S",
                   [400 + 1000 * (i % 3) for i in range(600)])
    rows = nightqc.arrival_quality(str(tmp_path))
    assert rows[0]["quantised"] is True
    assert rows[0]["floor_ok"] is None, "a quantised counter must be unjudged, not failed"


def test_arrival_quality_survives_a_missing_directory():
    import nightqc
    assert nightqc.arrival_quality("/nonexistent/night/dir") == []


# ─── the canary: it must fire on the DEAD sidecar, and on nothing that fires nightly ─────────────

def test_canary_no_longer_fires_on_a_smeared_floor():
    """RETIRED ARM — it fired on EVERY stream of the first real night (2026-08-11).

    `floor_ok` wanted the minimum within 5 ms of the 1st percentile. Measured, true arrivals smear
    29.3 / 42.0 ms (H10 acc / ecg) and 155.1 / 590.6 ms (Verity ppg / acc), because BLE callback
    scheduling jitter is tens of milliseconds — the premise was unreachable, not the captures faulty.
    And it did not matter: the H10 certified at `agree = 4.5 ms` DESPITE a 42 ms smear, since the
    lower envelope needs no sharp edge. An alert that fires nightly is one nobody reads, which is what
    the canary's own docstring said before it shipped one. `floor_spread_ms` survives as a diagnostic.
    """
    import alerts
    qc = {"arrival": [{"device": "Polar H10", "meas": "ECG", "floor_ok": False, "floor_spread_ms": 74.2}]}
    assert alerts.arrival_canary(qc, {}) == []


def test_canary_fires_on_a_dead_sidecar():
    """The write is wrapped in a bare `except: pass`, so a persistent failure is invisible by
    construction. A device producing samples with a sidecar stuck at zero is the only tell."""
    import alerts
    live = {"Polar H10": {"connected": True, "rows": 40321, "arrival_rows": 0}}
    got = alerts.arrival_canary({}, live)
    assert len(got) == 1 and "no rows" in got[0], got


def test_canary_keeps_scanning_past_a_disconnected_device():
    """A device that is DOWN must not stop the scan — `continue`, never `break`.

    The DEAD arm is now the canary's only arm, so it is the sole thing that can notice the swallowed
    `except: pass` in the write path. If a disconnected device aborted the loop, a later device whose
    sidecar had died would go unreported, and the failure this alert exists for would be silent again.

    That ordering is what makes the difference visible, and no existing case had it: the other tests
    either carry one device, or put the disconnected one where a `break` changes nothing. Dict order
    is insertion order, so the down device is deliberately FIRST.
    """
    import alerts
    live = {
        "Polar Verity": {"connected": False, "rows": 0, "arrival_rows": 0},   # down, not a fault
        "Polar H10": {"connected": True, "rows": 40321, "arrival_rows": 0},   # writing, sidecar dead
    }
    got = alerts.arrival_canary({}, live)
    assert len(got) == 1 and "Polar H10" in got[0] and "no rows" in got[0], got


def test_canary_is_silent_on_the_quantised_ring():
    """`floor_ok: None` is UNJUDGED, not failed. The ring's counter is 1 s quantised so its offset is
    fitted, not min-filtered; firing here would page someone every night and the alert would be
    ignored — which is worse than not having one."""
    import alerts
    qc = {"arrival": [{"device": "Wellue O2Ring-S", "meas": "OXYLIVE_DURATION_S",
                       "floor_ok": None, "floor_spread_ms": None, "quantised": True}]}
    assert alerts.arrival_canary(qc, {}) == []


def test_canary_is_silent_when_healthy_and_when_unknown():
    import alerts
    qc = {"arrival": [{"device": "Polar H10", "meas": "ECG", "floor_ok": True, "floor_spread_ms": 1.2}]}
    live = {"Polar H10": {"connected": True, "rows": 40321, "arrival_rows": 40321},
            "Polar Verity": {"connected": False, "rows": 0, "arrival_rows": 0},   # down, not a fault
            "COOSPO": {"connected": True, "rows": 12}}                            # non-PMD, no sidecar
    assert alerts.arrival_canary(qc, live) == []


# ─── arrival_quality: the malformed-input paths must skip, never guess ───────────────────────────

def test_arrival_quality_skips_blank_and_malformed_rows(tmp_path):
    """A blank device stamp and an unparseable timestamp are SKIPPED, not defaulted.

    Both matter for the same reason: a fabricated value here would sit somewhere in the distribution
    and could become the minimum, silently defining the offset as an artefact of bad input.
    """
    import nightqc
    p = os.path.join(tmp_path, "Tepna_x_PMDARRIVAL.csv")
    with open(p, "w") as fh:
        fh.write("Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n")
        fh.write(";dev;ECG;1000;2000;10\n")                       # no timestamp
        fh.write("2026-08-11T22:00:00.000;dev;ECG;;;10\n")         # no device stamp
        fh.write("not-a-timestamp;dev;ECG;1000;2000;10\n")         # unparseable
        for i in range(150):                                       # enough real rows to be judgeable
            fh.write(f"2026-08-11T22:00:{i // 10:02d}.{(i % 10) * 100:03d};dev;ECG;{i * 1000};{i * 1000};10\n")
    rows = nightqc.arrival_quality(str(tmp_path))
    assert len(rows) == 1 and rows[0]["rows"] == 150, rows


def test_arrival_quality_survives_an_unreadable_file(tmp_path):
    """An unreadable sidecar is skipped, never fatal — QC must still judge the rest of the night."""
    import nightqc
    p = os.path.join(tmp_path, "Tepna_y_PMDARRIVAL.csv")
    with open(p, "w") as fh:
        fh.write("Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n")
    os.chmod(p, 0o000)
    try:
        assert nightqc.arrival_quality(str(tmp_path)) == []
    finally:
        os.chmod(p, 0o644)


def test_arrival_quality_never_opens_a_stream_on_a_row_it_skipped(tmp_path):
    """A row missing EITHER column is skipped BEFORE that stream's bucket exists.

    The guard has to be `or`, and it is the only thing standing between a half-blank row and a crash.
    The parse that raises sits in the ARGUMENT of `per.setdefault(...).append(...)`, so the bucket has
    already been created by the time it fails and the `except` cannot take it back. A `(device, meas)`
    seen ONLY on such a row would then reach the reporting loop carrying zero pairs — an empty stream
    that was never measured, in a summary whose whole job is to say what WAS measured.
    """
    import nightqc
    p = os.path.join(tmp_path, "Tepna_h_PMDARRIVAL.csv")
    with open(p, "w") as fh:
        fh.write("Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n")
        fh.write("2026-08-11T22:00:00.000;ghost;ECG;;;10\n")             # parseable stamp, no device stamp
        fh.write("2026-08-11T22:00:01.000;real;ECG;1000000;2000000;10\n")
    assert [r["device"] for r in nightqc.arrival_quality(str(tmp_path))] == ["real"]


def test_arrival_quality_keeps_reading_the_night_after_an_unreadable_sidecar(tmp_path):
    """An unreadable sidecar costs that FILE, never the ones after it.

    Sidecars are walked in name order, so abandoning the walk on the first OSError would silently drop
    every device later in the alphabet — the H10 lost because the Verity's sidecar had bad permissions.
    Partial blindness that still returns a plausible list is exactly what QC exists to prevent.
    """
    import nightqc
    bad = os.path.join(tmp_path, "Tepna_a_PMDARRIVAL.csv")
    with open(bad, "w") as fh:
        fh.write("Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n")
    os.chmod(bad, 0o000)
    _write_sidecar(os.path.join(tmp_path, "Tepna_b_PMDARRIVAL.csv"), "ECG", [400.0, 401.0, 403.0])
    try:
        rows = nightqc.arrival_quality(str(tmp_path))
    finally:
        os.chmod(bad, 0o644)
    assert [r["file"] for r in rows] == ["Tepna_b_PMDARRIVAL.csv"], rows


def test_arrival_quality_reads_a_quoted_field_verbatim(tmp_path):
    """A quoted field's bytes survive the read — which is the whole reason for `newline=""`.

    The csv module documents that a file it reads must be opened with `newline=""`; without it Python's
    universal-newline translation rewrites a CR *inside a quoted field* before the parser ever sees it.
    `device` is the key this row is joined on — against the LINK sidecar, against the capture filenames
    — so a silently rewritten one is a device that no longer matches itself. The house writer cannot
    emit a quoted field, but a hand-repaired or foreign sidecar can, and QC reads whatever is on disk.
    """
    import nightqc
    p = os.path.join(tmp_path, "Tepna_q_PMDARRIVAL.csv")
    with open(p, "w", newline="") as fh:
        fh.write("Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n")
        fh.write('2026-08-11T22:00:00.000;"Polar H10\r\n02849638";ECG;1000000;2000000;10\n')
    assert [r["device"] for r in nightqc.arrival_quality(str(tmp_path))] == ["Polar H10\r\n02849638"]


# ─── arrival_quality: the offset estimate, its units, and its time axis ──────────────────────────

_BASE_NS = 500_000_000_000       # a device counter, not an epoch — 500 s since the sensor powered on
_CADENCE_MS = 5000               # a PPI packet lands about every 5 s
_ONE_SIDED = [0, 3, 5, 9, 14, 21, 30, 44, 61, 90] * 60      # 600 packets, never early


def _write_long_sidecar(path, offset_ms=400.0, delays=_ONE_SIDED):
    """~50 min of packets: a CONSTANT `offset_ms` plus one-sided buffering, and no planted skew.

    Long on purpose. `clock_offset.SPAN_MIN_SEC` is 2400 s, and every property below that names a UNIT
    or an ORIGIN is invisible on the 23 s fixtures above — a 0.1 % error in the time axis moves a 23 s
    span by 0.02 s, which rounds clean away.
    """
    w = PmdArrivalLogWriter(path, fsync=False)
    for i, extra in enumerate(delays):
        dev_ns = _BASE_NS + i * _CADENCE_MS * 1_000_000
        arr = _T0 + _dt.timedelta(milliseconds=i * _CADENCE_MS + offset_ms + extra)
        w.write(arr, "dev", "PPI", dev_ns, dev_ns + 1_000_000, 5)
    w.close()


def test_arrival_quality_recovers_the_planted_offset(tmp_path):
    """The estimate comes back as a VALUE, at the planted offset, in milliseconds.

    PAT's budget is 10 ms, so every conversion between the CSV column and `clock_offset.estimate`
    matters at well under one millisecond — and both columns are the kind that hide a scale error:
    the device stamp is NANOseconds against a 5e11 counter, the host stamp is seconds-since-epoch
    against 1.79e9. A divisor or multiplier off by one part per million moves this number by ~0.5 ms
    and ~1.8e6 ms respectively, and neither shows up as anything but a still-plausible float. The
    expectation is computed here from the plant, not read back off the row.
    """
    import nightqc
    _write_long_sidecar(os.path.join(tmp_path, "Tepna_o_PMDARRIVAL.csv"))
    off = nightqc.arrival_quality(str(tmp_path))[0]["offset"]
    # The pairing is against the LAST sample in the packet, so the planted offset is measured from
    # there — `_write_long_sidecar` spans each packet 1 ms, and that 1 ms is not part of the link.
    expected = _T0.timestamp() * 1000.0 - (_BASE_NS + 1_000_000) / 1e6 + 400.0
    assert off["ok"] is True and off["certified"] is True, off
    assert abs(off["offset_ms"] - expected) < 0.05, f"offset {off['offset_ms']} != planted {expected}"
    # nothing was planted to drift, so a rate here is an artefact of the axis and not a clock
    assert abs(off["slope_ppm"]) < 0.5, off


def test_two_streams_of_one_device_agree_despite_different_packet_spans(tmp_path):
    """THE PACKET-FILL TERM — the bug this pairing was changed to fix, pinned.

    A BLE packet carries many samples and is delivered once, so its arrival stamp follows its LAST
    sample. Pairing against the FIRST therefore adds the packet's fill duration to every delay, and
    that duration belongs to the STREAM — its rate and frame size — not to the link. Two streams of one
    device then disagree by exactly the difference in their fill times, while sharing one radio and one
    clock and therefore one true offset.

    Measured on the first real night: the H10's fill times were 689.9 ms (acc) and 553.8 ms (ecg), a
    136.1 ms difference, and the first-based offsets differed by 135.1 ms — the anomaly WAS the fill
    term, to within a millisecond. Switching to the last sample collapsed that spread to 0.7 ms and
    took the Verity from certifying on neither stream to certifying on both.

    Here the two spans differ 20-fold on identical link timing, so a first-based pairing is wrong by
    ~1.9 s and no tolerance hides it.
    """
    import nightqc
    p = os.path.join(tmp_path, "Tepna_pair_PMDARRIVAL.csv")
    w = PmdArrivalLogWriter(p, fsync=False)
    for meas, span_ms in (("ECG", 100), ("ACC", 2000)):
        for i, extra in enumerate(_ONE_SIDED):
            dev_ns = _BASE_NS + i * _CADENCE_MS * 1_000_000
            # the packet ENDS at dev_ns + span; the link delay after that instant is identical for both
            arr = _T0 + _dt.timedelta(milliseconds=i * _CADENCE_MS + span_ms + 400.0 + extra)
            w.write(arr, "dev", meas, dev_ns, dev_ns + span_ms * 1_000_000, 5)
    w.close()

    rows = {r["meas"]: r["offset"] for r in nightqc.arrival_quality(str(tmp_path))}
    assert set(rows) == {"ECG", "ACC"}, rows
    for meas, off in rows.items():
        assert off["ok"] is True and off["certified"] is True, (meas, off)
    gap = abs(rows["ECG"]["offset_ms"] - rows["ACC"]["offset_ms"])
    assert gap < 1.0, f"two streams of one device disagree by {gap:.1f} ms — the fill term leaked in"


def test_arrival_quality_fits_on_seconds_since_this_streams_first_packet(tmp_path):
    """The t handed to the estimator is SECONDS ELAPSED FROM THIS STREAM'S FIRST PACKET.

    Unit, origin and sign are all load-bearing and NONE of them shows up in `offset_ms`: the fit is
    origin-independent (a line's residuals do not move when the coordinate origin does), so a wrong
    origin leaves the offset looking perfect and corrupts only the quantity that ships so a consumer
    can RECONSTRUCT the line — `t_ref_sec`, the t the offset is quoted at. The absolute host epoch as
    the origin (1.79e9 s), the *second* packet as the origin (5 s late), or milliseconds left unscaled
    all land here and nowhere else. `span_sec` pins the scale independently of the origin.
    """
    import nightqc
    _write_long_sidecar(os.path.join(tmp_path, "Tepna_t_PMDARRIVAL.csv"))
    off = nightqc.arrival_quality(str(tmp_path))[0]["offset"]
    hs = [i * _CADENCE_MS + extra for i, extra in enumerate(_ONE_SIDED)]   # arrivals, ms from the first
    t_ref = sum(h - hs[0] for h in hs) / len(hs) / 1000.0
    assert abs(off["t_ref_sec"] - t_ref) < 0.06, f"{off['t_ref_sec']} is not {t_ref} s past packet 1"
    assert abs(off["span_sec"] - (hs[-1] - hs[0]) / 1000.0) < 0.06, off   # the field is rounded to 0.1 s
    # ~2995 s clears SPAN_MIN_SEC, so the rate is quotable — a mis-scaled axis flips this too
    assert off["skew_quotable"] is True, off


def test_arrival_quality_refuses_an_estimate_from_a_single_packet(tmp_path):
    """A stream that delivered one packet is still REPORTED, and its offset is an explicit refusal.

    `clock_offset` needs MIN_POINTS before a lower edge exists at all, and the refusal contract is
    `hostAxis`'s: a reason and NO estimate, so a consumer cannot read a silent zero out of a
    measurement that was declined. The row itself must survive, or a stream that died after its first
    packet vanishes from QC — and one packet is also the narrowest input the reader ever sees, where
    the only pair there is to anchor t on is `pairs[0]`.
    """
    import nightqc
    p = os.path.join(tmp_path, "Tepna_s_PMDARRIVAL.csv")
    w = PmdArrivalLogWriter(p, fsync=False)
    w.write(_T0, "dev", "ECG", _BASE_NS, _BASE_NS + 69_000_000, 10)
    w.close()
    rows = nightqc.arrival_quality(str(tmp_path))
    assert len(rows) == 1 and rows[0]["rows"] == 1, rows
    assert rows[0]["offset"] == {"ok": False, "reason": "too-few", "n": 1}, rows


# ── the canary is WIRED, not merely correct ─────────────────────────────────────────────────────────

def _alert_loop_code() -> str:
    """`capture.py`'s source with COMMENTS STRIPPED.

    ⚠️ A source-scan test that reads comments asserts the documentation, not the code. Learned the hard
    way on 2026-08-14: a check for `--uid=vigil` in a shell helper passed against the sentence explaining
    why `--uid=vigil` mattered, while the command itself said `--uid=root`. The block these assertions
    cover carries a long comment naming `arrival_canary`, so without this strip they would pass on prose."""
    import io
    import tokenize
    src = module_source("capture.py")
    # tokenize + untokenize, NOT a line prefix and NOT a hand-rolled join. Two drafts failed here:
    #   · dropping lines whose lstrip() starts with "#" leaves a TRAILING comment intact, and
    #     `for _msg in []:  # alerts.arrival_canary(` then satisfied every assertion below;
    #   · joining the surviving tokens with "" welds `if notifier:` into `ifnotifier:`, so a search for
    #     a multi-token phrase silently matches nothing — a false PASS in the other direction.
    # `untokenize` pads from the original positions, so spacing survives and only comments go.
    toks = [t for t in tokenize.generate_tokens(io.StringIO(src).readline)
            if t.type != tokenize.COMMENT]
    return tokenize.untokenize(toks)


def test_arrival_canary_is_CALLED_by_the_alert_loop():
    """It was called by nothing outside its own tests — a correct answer with no consumer, the same
    class as the charging veto that shipped unreachable behind 24 passing assertions (#1245). Its own
    docstring names the failure it alone can see: the sidecar write is wrapped in a bare `except: pass`
    so telemetry cannot disturb the data callback, which makes a persistent failure invisible BY
    CONSTRUCTION."""
    assert "alerts.arrival_canary(" in _alert_loop_code(), "the alert loop must actually invoke it"


def test_the_canary_warns_even_with_no_webhook_configured():
    """The journal is the only alerting surface a box without a webhook has, and this failure otherwise
    leaves no trace in it at all. Mirrors the frozen-sensor alert's own rule, a few lines up."""
    code = _alert_loop_code()
    seg = code[code.index("alerts.arrival_canary("):]
    seg = seg[:seg.index("if notifier:")]
    assert "log.warning(" in seg, "a WARNING must precede the optional notifier, not depend on it"


def test_the_canary_is_deduped_per_night_so_it_cannot_page_every_tick():
    """`alert_loop` re-runs on a timer; an undeduped warning would repeat for the whole night. The
    frozen-sensor alert beside it keys on night:device for exactly this reason."""
    code = _alert_loop_code()
    assert "canary_alerted" in code
    seg = code[code.index("alerts.arrival_canary("):][:900]
    assert "canary_alerted.add(" in seg and "continue" in seg
