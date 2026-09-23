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
