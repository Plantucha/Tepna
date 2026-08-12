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


# ─── the canary: it must fire on both failures, and stay silent on the ring ──────────────────────

def test_canary_fires_on_a_smeared_floor():
    import alerts
    qc = {"arrival": [{"device": "Polar H10", "meas": "ECG", "floor_ok": False, "floor_spread_ms": 74.2}]}
    got = alerts.arrival_canary(qc, {})
    assert len(got) == 1 and "smeared" in got[0] and "74.2" in got[0], got


def test_canary_fires_on_a_dead_sidecar():
    """The write is wrapped in a bare `except: pass`, so a persistent failure is invisible by
    construction. A device producing samples with a sidecar stuck at zero is the only tell."""
    import alerts
    live = {"Polar H10": {"connected": True, "rows": 40321, "arrival_rows": 0}}
    got = alerts.arrival_canary({}, live)
    assert len(got) == 1 and "no rows" in got[0], got


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
    expected = _T0.timestamp() * 1000.0 - _BASE_NS / 1e6 + 400.0
    assert off["ok"] is True and off["certified"] is True, off
    assert abs(off["offset_ms"] - expected) < 0.05, f"offset {off['offset_ms']} != planted {expected}"
    # nothing was planted to drift, so a rate here is an artefact of the axis and not a clock
    assert abs(off["slope_ppm"]) < 0.5, off


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
