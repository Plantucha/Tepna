# tepna-capture — tests/test_localstamp_dst.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""THE FALL-BACK NIGHT, SYNTHESISED — residue 2026-09-13-dst-fallback-splits-the-host-axis.

The box runs America/New_York; on 2026-11-01 the wall clock passes 01:00–02:00 twice. A naive
`Phone timestamp` from the second pass resolved with `fold=0` reads as the first pass, so the host
axis stepped BACKWARDS by 3600 s inside the series while the device counter marched on. Owner ruling
2026-09-21 (relayed): remedy (a) — resolve the fold locally, by continuity. These tests plant the seam
and drive each consumer through its real entry point; the plant is the −3600 s step the old parse
produces on the same rows.
"""

import os
import time
from datetime import datetime, timedelta
from pathlib import Path

import pytest

import jitterfloor
import localstamp as L
import nightqc

SEAM_NIGHT = datetime(2026, 11, 1, 0, 59, 58)        # EDT; 01:00–02:00 will repeat
DEV0_NS = 843_900_000_000_000_000                    # a plausible 2000-epoch device count


@pytest.fixture
def new_york(monkeypatch):
    """The box's zone, applied to the PROCESS — `datetime.timestamp()` on a naive value reads the C
    library's zone, so `TZ` alone changes nothing until `tzset()`. Restored the same way."""
    before = os.environ.get("TZ")
    monkeypatch.setenv("TZ", "America/New_York")
    time.tzset()
    yield
    if before is None:
        monkeypatch.delenv("TZ", raising=False)
    else:
        monkeypatch.setenv("TZ", before)
    time.tzset()


@pytest.fixture
def utc(monkeypatch):
    monkeypatch.setenv("TZ", "UTC")
    time.tzset()
    yield
    monkeypatch.delenv("TZ", raising=False)
    time.tzset()


def _night_rows(n=3610, step_s=1.0):
    """Wall-clock stamps as the WRITER emits them across the seam: after 01:59:59 EDT the next second
    is 01:00:00 EST, so the naive strings repeat. Built from real instants so the repetition is exactly
    what the OS clock produces, not a hand-written duplicate."""
    import zoneinfo
    from datetime import timezone
    z = zoneinfo.ZoneInfo("America/New_York")
    # ⚠️ Advance in UTC, then convert. Adding a timedelta to an AWARE datetime in the same zone is
    # wall-clock arithmetic and never crosses a transition — a first draft of this rig did that and
    # produced a night with no repeated hour, so the plant "did not reproduce".
    t0 = SEAM_NIGHT.replace(tzinfo=z, fold=0).astimezone(timezone.utc)
    out = []
    for i in range(n):
        inst = (t0 + timedelta(seconds=i * step_s)).astimezone(z)
        naive = inst.replace(tzinfo=None)
        out.append((naive.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3], DEV0_NS + int(i * step_s * 1e9)))
    return out


# ── the resolver itself ───────────────────────────────────────────────────────────────────────────
def test_the_old_parse_STEPS_BACKWARDS_at_the_seam_and_the_resolver_does_not(new_york):
    """THE PLANT. Same rows, two conversions."""
    rows = _night_rows()
    old = [datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%f").timestamp() * 1000.0 for s, _ in rows]
    old_deltas = [b - a for a, b in zip(old, old[1:])]
    assert min(old_deltas) == -3_599_000.0, "the seam did not reproduce: is the zone applied?"
    r = L.LocalStampResolver()
    new = [r.resolve_ms(datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%f"), dev_ms=ns / 1e6) for s, ns in rows]
    new_deltas = {round(b - a) for a, b in zip(new, new[1:])}
    assert new_deltas == {1000}, new_deltas
    # 3610 rows from 00:59:58: 2 before the hour, then 01:00:00..01:59:59 EDT (3600 ambiguous), then
    # 8 seconds of the SECOND pass (also ambiguous) — every stamp whose string falls in 01:xx
    assert r.ambiguous == 3608 and r.ambiguous_unresolved == 0


def test_the_ambiguous_count_is_the_repeated_hour_twice(new_york):
    """Both passes through 01:00–02:00 are ambiguous strings — 7200 stamps at 1 Hz — and a rig that
    only counted the second pass would be counting the wrong thing."""
    rows = _night_rows(n=3 + 7200 + 3)                 # 00:59:57 .. 02:00:02
    r = L.LocalStampResolver()
    for s, ns in rows:
        r.resolve_ms(datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%f"), dev_ms=ns / 1e6)
    assert r.ambiguous == 7200 and r.ambiguous_unresolved == 0


def test_monotonicity_alone_resolves_a_continuous_series_without_a_device_stamp(new_york):
    rows = _night_rows()
    r = L.LocalStampResolver()
    new = [r.resolve_ms(datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%f")) for s, _ in rows]
    assert {round(b - a) for a, b in zip(new, new[1:])} == {1000}


def test_a_file_that_STARTS_inside_the_repeated_hour_takes_fold_0_and_says_so(new_york):
    """Nothing to compare against: the first row's fold is a choice, so it is counted, not hidden."""
    r = L.LocalStampResolver()
    dt = datetime(2026, 11, 1, 1, 30, 0)
    assert r.resolve_ms(dt) == dt.replace(fold=0).timestamp() * 1000.0
    assert r.ambiguous == 1 and r.ambiguous_unresolved == 1


def test_device_continuity_OUTRANKS_monotonicity_across_a_gap_longer_than_the_repeat(new_york):
    """After a >1 h gap both folds are 'forward'; only the device offset can decide, and it does."""
    r = L.LocalStampResolver()
    r.resolve_ms(datetime(2026, 10, 31, 23, 0, 0), dev_ms=0.0)          # establishes the offset
    dt = datetime(2026, 11, 1, 1, 30, 0)                                 # second pass, 3.5 h later
    got = r.resolve_ms(dt, dev_ms=3.5 * 3600 * 1000.0)
    assert got == dt.replace(fold=1).timestamp() * 1000.0


def test_on_a_zone_without_dst_the_resolver_is_exactly_timestamp(utc):
    """The control: outside a repeated hour every rule is a no-op and nothing changes."""
    r = L.LocalStampResolver()
    for s, ns in _night_rows(n=200):
        dt = datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%f")
        assert r.resolve_ms(dt, dev_ms=ns / 1e6) == dt.timestamp() * 1000.0
    assert r.ambiguous == 0


# ── the consumers, through their real entry points ────────────────────────────────────────────────
def test_jitterfloor_parse_pmdarrival_keeps_the_host_axis_continuous_across_the_seam(new_york, tmp_path):
    p = tmp_path / "2026-11-01_PMDARRIVAL.csv"
    p.write_text("Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n" + "\n".join(
        "%s;H10;ecg;%d;%d;73" % (s, ns, ns + 500_000_000) for s, ns in _night_rows()) + "\n")
    streams = jitterfloor.parse_pmdarrival(Path(p))
    hosts = [h for h, _ in streams["H10|ecg"]]
    assert {round(b - a) for a, b in zip(hosts, hosts[1:])} == {1000}, "a −3600 s step survived into the floor"


def test_jitterfloor_resolves_each_stream_on_its_OWN_offset(new_york, tmp_path):
    """Two streams whose device counters differ by hours: one stream's offset must not decide the
    other's fold. Interleaved rows, both continuous."""
    a = _night_rows()
    b = [(s, ns + 5 * 3600 * 10**9) for s, ns in a]
    lines = []
    for (sa, na), (sb, nb) in zip(a, b):
        lines += ["%s;H10;ecg;%d;%d;73" % (sa, na, na + 1), "%s;Verity;acc;%d;%d;52" % (sb, nb, nb + 1)]
    p = tmp_path / "x_PMDARRIVAL.csv"
    p.write_text("Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n" + "\n".join(lines) + "\n")
    streams = jitterfloor.parse_pmdarrival(Path(p))
    for key in ("H10|ecg", "Verity|acc"):
        hosts = [h for h, _ in streams[key]]
        assert {round(b_ - a_) for a_, b_ in zip(hosts, hosts[1:])} == {1000}, key


def test_nightqc_span_walks_the_series_so_an_endpoint_inside_the_seam_is_resolved(new_york, tmp_path):
    """`rtc_drift_summary`'s span used to be `t1 − t0` from two naive endpoints; an endpoint in the
    repeated hour then read an hour early. Walking the series with the monotonicity rule fixes it."""
    p = tmp_path / "x_RTCLOG.csv"
    rows = ["2026-10-31T23:00:00.000;read;1.0;;;;"]
    # a read every 10 min up to and INTO the second pass — the last one at 01:30 EST
    for s, _ in _night_rows(n=3 + 7200 - 1800, step_s=1.0)[::600]:
        rows.append("%s;read;1.0;;;;" % s)
    p.write_text("Phone timestamp;event;offset_s;a;b;c;d\n" + "\n".join(rows) + "\n")
    r = nightqc.rtc_drift_summary(str(p))
    # 23:00 EDT → 01:30 EST is 3.5 h of real time; fold=0 on the endpoint would have said 2.5
    assert r["span_h"] == 3.5, r


# ── nightqc.arrival_quality has its OWN resolver wiring ────────────────────────────────────────────
# The two tests above drive `jitterfloor.parse_pmdarrival`. `nightqc.arrival_quality` reads the same
# sidecars through its own `folds` dict and passes its own device stamp, so neither of those defends
# this path: both lines are reachable only from here.

def _seam_csv(path, rows):
    path.write_text(
        "Phone timestamp;device;meas;first_sensor_ns;last_sensor_ns;n_samples\n"
        + "\n".join("%s;%s;%s;%d;%d;%d" % r for r in rows) + "\n")


def test_nightqc_arrival_quality_resolves_each_stream_on_its_OWN_offset(new_york, tmp_path):
    """One resolver PER (device, meas). The state a resolver carries is the previous host−device offset,
    which is a property of one stream on one connection; shared between streams whose counters sit hours
    apart, each row's fold is then decided by the other stream's offset. Interleaved, both continuous —
    so a −3600 s step inside either axis is the plant, and it is the residue this wiring exists for."""
    a = _night_rows()
    b = [(s, ns + 5 * 3600 * 10**9) for s, ns in a]
    rows = []
    for (sa, na), (sb, nb) in zip(a, b):
        rows += [(sa, "H10", "ecg", na, na + 1, 73), (sb, "Verity", "acc", nb, nb + 1, 52)]
    _seam_csv(tmp_path / "x_PMDARRIVAL.csv", rows)
    out = {r["device"]: r for r in nightqc.arrival_quality(str(tmp_path))}
    assert set(out) == {"H10", "Verity"}, out
    # The plant is ABSOLUTE, not a step: nearly every row of `_night_rows` sits inside the repeated
    # hour, so a resolver that folds a whole stream the wrong way shifts it UNIFORMLY and leaves no
    # step behind for `worst_ms` to see. What it cannot leave alone is the offset itself.
    for dev, truth in (("H10", _truth_offset_ms(0)), ("Verity", _truth_offset_ms(5 * 3600))):
        rec = out[dev]
        assert rec["jitter"]["worst_ms"] < 10.0, (dev, rec["jitter"])
        assert abs(rec["offset"]["offset_ms"] - truth) < 5.0, (dev, truth, rec["offset"])


def _truth_offset_ms(dev_lead_s):
    """The planted host−device offset: every row's host instant is `SEAM_NIGHT + i s` by construction
    and its counter advances the same second, so the difference is a constant the fixture knows."""
    import zoneinfo
    z = zoneinfo.ZoneInfo("America/New_York")
    t0_ms = SEAM_NIGHT.replace(tzinfo=z, fold=0).timestamp() * 1000.0
    return t0_ms - nightqc._POLAR_EPOCH_MS - (DEV0_NS / 1e6 + dev_lead_s * 1000.0)


def test_nightqc_arrival_quality_keys_the_resolver_on_the_DEVICE_too_not_only_the_stream(new_york, tmp_path):
    """Two DEVICES carrying the same `meas`. Keying the resolver on the stream name alone — or on a
    constant — merges them, and then the H10's offset decides the Verity's fold and vice versa. The
    per-stream test above cannot see that: `("", meas)` still separates `ecg` from `acc`, so only a pair
    that shares a measurement name distinguishes the device half of the key. Both devices run `acc`."""
    a = _night_rows()
    b = [(s, ns + 5 * 3600 * 10**9) for s, ns in a]
    rows = []
    for (sa, na), (sb, nb) in zip(a, b):
        rows += [(sa, "H10", "acc", na, na + 1, 52), (sb, "Verity", "acc", nb, nb + 1, 52)]
    _seam_csv(tmp_path / "d_PMDARRIVAL.csv", rows)
    out = {r["device"]: r for r in nightqc.arrival_quality(str(tmp_path))}
    assert set(out) == {"H10", "Verity"}, out
    for dev, truth in (("H10", _truth_offset_ms(0)), ("Verity", _truth_offset_ms(5 * 3600))):
        assert abs(out[dev]["offset"]["offset_ms"] - truth) < 5.0, (dev, truth, out[dev]["offset"])


def test_nightqc_arrival_quality_resolves_the_repeated_hour_by_the_DEVICE_counter(new_york, tmp_path):
    """After a gap longer than the repeated hour BOTH folds are forward, so monotonicity cannot decide
    and only the device counter can. The counter is handed over as an instant in ms from the Unix epoch:
    a null one, a 2000-epoch mirror of it or a scale error puts the whole second pass an hour early."""
    import zoneinfo
    from datetime import timezone
    z = zoneinfo.ZoneInfo("America/New_York")
    t0 = datetime(2026, 11, 1, 3, 0, 0, tzinfo=timezone.utc)        # 23:00 EDT, unambiguous
    rows = []
    for phase_s in (0, int(3.5 * 3600)):                            # ... then 01:30 EST, second pass
        for i in range(150):
            elapsed = phase_s + i
            naive = (t0 + timedelta(seconds=elapsed)).astimezone(z).replace(tzinfo=None)
            rows.append((naive.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3], "H10", "ecg",
                         DEV0_NS + elapsed * 10**9, DEV0_NS + elapsed * 10**9 + 1, 73))
    assert rows[150][0].startswith("2026-11-01T01:30"), rows[150][0]
    _seam_csv(tmp_path / "g_PMDARRIVAL.csv", rows)
    got = nightqc.arrival_quality(str(tmp_path))[0]
    assert got["rows"] == 300, got
    assert got["jitter"]["worst_ms"] < 10.0, got["jitter"]
