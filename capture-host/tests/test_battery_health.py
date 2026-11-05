# tepna-capture — tests/test_battery_health.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""Battery ageing pushes (owner, 2026-11-04). Synthetic devices and addresses; every notifier is a stub."""

import asyncio
import datetime as dt
import json

import battery_health as bh
import capture

RING = {"name": "Ring TEST", "model": "O2Ring-S", "address": "AA:BB:CC:DD:EE:01"}
SENSE = {"name": "Sense TEST", "model": "VeritySense", "address": "AA:BB:CC:DD:EE:02"}
STRAP = {"name": "Strap TEST", "model": "H10", "address": "AA:BB:CC:DD:EE:03"}
HDR = "Phone timestamp;device;connected;rssi_dbm;battery_pct;frames_dropped;frames_duplicated;link_epoch;address\n"
T0 = dt.datetime(2026, 9, 1, 22, 0)


def _rows(start, n, pct0, per_row=0.0, step_s=120):
    """`n` rows every `step_s` from `start`, the battery falling `per_row` % each row."""
    return [(start + dt.timedelta(seconds=i * step_s), round(pct0 - i * per_row)) for i in range(n)]


def _write_link(folder, rows, dev, name="Tepna_20260901220000_LINK.csv", connected="1"):
    folder.mkdir(parents=True, exist_ok=True)
    with open(folder / name, "a") as fh:
        if fh.tell() == 0:
            fh.write("# adapter=AA:BB:CC:DD:EE:00 hci=hci0\n" + HDR)
        for t, b in rows:
            fh.write(
                f"{t.isoformat(timespec='milliseconds')};{dev['name']};{connected};-60;{b};0;0;1;{dev['address']}\n"
            )


def _spo2(folder, start, seconds, name=None):
    folder.mkdir(parents=True, exist_ok=True)
    stamp = start.strftime("%Y%m%d%H%M%S")
    with open(folder / (name or f"Wellue_O2Ring-S_TEST0001_{stamp}_SPO2.csv"), "w") as fh:
        fh.write("Time,Oxygen Level,Pulse Rate,Motion\n")
        for s in range(0, seconds, 60):
            fh.write((start + dt.timedelta(seconds=s)).strftime("%H:%M:%S %d/%m/%Y") + ",97,58,0\n")


def _night(caps, day, dev, drain_h, pct0=90):
    """One discharge night 22:00 -> 05:58 at `drain_h` %/h, split over the night's folder and the next."""
    start = dt.datetime(2026, 9, day, 22, 0)
    rows = [(start + dt.timedelta(minutes=2 * i), round(pct0 - drain_h * i / 30)) for i in range(240)]
    folder = caps / start.date().isoformat()
    nxt = caps / (start.date() + dt.timedelta(days=1)).isoformat()
    _write_link(folder, [r for r in rows if r[0].hour >= 22], dev)
    _write_link(nxt, [r for r in rows if r[0].hour < 6], dev, name="Tepna_20260902000000_LINK.csv")


# ── pure rules ──────────────────────────────────────────────────────────────────────────────────────────


def test_is_night_and_the_band():
    assert bh.is_night("2026-09-01") and not bh.is_night("2026-9-1") and not bh.is_night("2026-13-01")
    assert not bh.is_night("stored-old")
    assert bh.in_band(dt.datetime(2026, 9, 1, 22)) and bh.in_band(dt.datetime(2026, 9, 2, 5, 59))
    assert not bh.in_band(dt.datetime(2026, 9, 2, 6)) and not bh.in_band(dt.datetime(2026, 9, 1, 21, 59))
    assert bh.night_of(dt.datetime(2026, 9, 2, 3)) == bh.night_of(dt.datetime(2026, 9, 1, 23)) == "2026-09-01"


def test_max_rise_looks_only_inside_the_window():
    assert bh.max_rise([]) == 0
    assert bh.max_rise([(T0, 50), (T0 + dt.timedelta(seconds=600), 55)]) == 5  # the edge is inside
    assert bh.max_rise([(T0, 50), (T0 + dt.timedelta(seconds=601), 55)]) == 0
    assert bh.max_rise([(T0, 50), (T0 + dt.timedelta(seconds=60), 48), (T0 + dt.timedelta(seconds=120), 53)]) == 5


def test_night_drain_refuses_short_and_charged_nights():
    full = _rows(T0, 181, 90, per_row=1 / 12)  # 6 h at 2.5 %/h: 90 -> 75
    assert bh.night_drain(full) == 2.5
    assert bh.night_drain(full[:19]) is None  # under NIGHT_MIN_ROWS
    assert bh.night_drain(full[:150]) is None  # under NIGHT_MIN_H
    assert bh.night_drain(_rows(T0, 19, 90, step_s=1200)) is None  # 6 h, but one row short
    assert bh.night_drain(_rows(T0, 20, 90, step_s=1200)) == 0.0  # 20 rows over 6.3 h
    assert bh.night_drain(_rows(T0, 20, 90, step_s=1042)) is None  # 20 rows over 5.5 h
    charged = full[:100] + [(full[100][0], full[99][1] + 6)] + full[101:]
    assert bh.night_drain(charged) is None
    assert bh.night_drain(full[:100] + [(full[100][0], full[99][1] + 5)] + full[101:]) is not None


def test_worn_max_rise_reads_only_inside_the_spans():
    rows = [(T0, 50), (T0 + dt.timedelta(seconds=120), 54), (T0 + dt.timedelta(seconds=240), 60)]
    assert bh.worn_max_rise(rows, []) is None
    assert bh.worn_max_rise(rows, [(T0, T0 + dt.timedelta(seconds=130))]) == 4  # the +6 sits outside
    assert bh.worn_max_rise(rows, [(T0, T0 + dt.timedelta(seconds=60))]) is None  # one row is no rise
    assert bh.worn_max_rise(rows, [(T0, T0 + dt.timedelta(seconds=60)), (T0, T0 + dt.timedelta(seconds=250))]) == 10


def test_capacity_and_the_ageing_rule():
    assert bh.capacity_pct(3.0, 4.0) == 75 and bh.capacity_pct(0.0, 4.0) is None and bh.capacity_pct(3.0, 0.0) is None
    nights = {f"2026-08-{d:02d}": 3.2 for d in range(1, 15)}
    late = lambda v, n=7: {f"2026-09-{d:02d}": v for d in range(1, n + 1)}  # noqa: E731
    assert bh.ageing_due({**nights, **late(4.0, 4)}, None) is None  # under RECENT_MIN present nights
    assert bh.ageing_due({**nights, **late(3.99)}, None) is None  # 1.247 x: under the ratio
    assert bh.ageing_due({**nights, **late(4.0)}, None) == (80, 3.2, 4.0)  # exactly 1.25 x
    assert bh.ageing_due({**nights, **late(4.0)}, 80) is None  # that step is pushed
    assert bh.ageing_due({**nights, **late(4.5)}, 80) is None  # 71 %: not a full step lower
    assert bh.ageing_due({**nights, **late(4.6)}, 80) == (70, 3.2, 4.6)
    assert bh.ageing_due({**{k: 0.0 for k in nights}, **late(4.0)}, None) is None  # no baseline to divide
    # the present is the LAST RECENT_NIGHTS: an old high spell no longer counts
    old_high = {f"2026-09-{d:02d}": 9.0 for d in range(1, 8)}
    assert bh.ageing_due({**nights, **old_high, **{f"2026-10-{d:02d}": 3.2 for d in range(1, 8)}}, None) is None


def test_the_texts_are_exact():
    assert bh.ageing_text("D", 80, 3.2, 4.0) == (
        "Tepna: D battery is wearing out",
        "D now uses 4.0 % per hour overnight. Its first nights used 3.2 %. That is about 80 % of its starting capacity.",
    )
    assert bh.noise_text("D", 5) == (
        "Tepna: D battery gauge is unsteady",
        "While worn, the battery reading of D rose 5 % within 10 minutes. The charger rule calls a 6 % rise a "
        "removal, so the night check may soon misread one.",
    )


def test_due_names_each_push_once_per_latch():
    nights = {f"2026-08-{d:02d}": 3.2 for d in range(1, 15)} | {f"2026-09-{d:02d}": 4.0 for d in range(1, 8)}
    state = {"Ring TEST": {"nights": nights, "noise": {"2026-09-01": 5}}, "Sense TEST": "not a record"}
    got = bh.due(state, [RING, SENSE, STRAP])
    assert [(n, k, v) for n, k, _t, _m, v in got] == [
        ("Ring TEST", "alerted_capacity", 80),
        ("Ring TEST", "alerted_noise", 5),
    ]
    state["Ring TEST"].update(alerted_capacity=80, alerted_noise=5)
    assert bh.due(state, [RING]) == []
    assert bh.due({"Ring TEST": {"nights": {}, "noise": {"2026-09-01": 4}}}, [RING]) == []  # under the noise bound
    assert bh.due({"Ring TEST": {}}, [RING]) == []


# ── the reader and the daily update ─────────────────────────────────────────────────────────────────────


def test_update_reads_ageing_devices_by_address_or_name_across_midnight(tmp_path):
    caps = tmp_path / "captures"
    _night(caps, 1, RING, 3.0)
    _night(caps, 1, {**SENSE, "address": ""}, 4.0)  # a row without an address matches on the name
    _night(caps, 1, STRAP, 2.0)  # a coin cell: never read
    _spo2(caps / "2026-09-01", dt.datetime(2026, 9, 1, 22, 30), 3600)
    st = bh.update(str(caps), [RING, {**SENSE, "address": "AA:BB:CC:DD:EE:FF"}, STRAP], dt.date(2026, 9, 3), None)
    # 22:00 -> 05:58 in whole-percent steps: 3.013 and 4.017 %/h
    assert st["Ring TEST"]["nights"] == {"2026-09-01": 3.013} and st["Sense TEST"]["nights"] == {"2026-09-01": 4.017}
    assert "Strap TEST" not in st and st["done"] == ["2026-09-01", "2026-09-02"]
    assert st["Ring TEST"]["noise"] == {"2026-09-01": 0} and st["Sense TEST"]["noise"] == {}
    # an address match is case-blind
    assert bh._device_of("x", "aa:bb:cc:dd:ee:ff", [{**SENSE, "address": "AA:BB:CC:DD:EE:FF"}])["name"] == "Sense TEST"
    assert bh._device_of("x", "AA:BB:CC:DD:EE:FF", [{**SENSE, "address": "aa:bb:cc:dd:ee:ff"}])["name"] == "Sense TEST"


def test_update_skips_unsettled_done_and_foreign_folders_and_reads_each_once(tmp_path):
    caps = tmp_path / "captures"
    _night(caps, 1, RING, 3.0)
    (caps / "stored").mkdir()
    (caps / "2026-09-05").mkdir()  # not settled on 2026-09-03
    st = bh.update(str(caps), [RING], dt.date(2026, 9, 3), {"done": ["2026-09-02"]})
    assert st["done"] == ["2026-09-01", "2026-09-02"]
    assert bh.update(str(caps), [RING], dt.date(2026, 9, 3), st) == st
    assert bh.update(str(caps), [STRAP], dt.date(2026, 9, 3), None) == {"done": []}
    assert bh.update(str(tmp_path / "absent"), [RING], dt.date(2026, 9, 3), {"x": 1}) == {"x": 1}


def test_two_rings_share_one_span_read(tmp_path, monkeypatch):
    caps = tmp_path / "captures"
    ring2 = {**RING, "name": "Ring TWO", "address": "AA:BB:CC:DD:EE:04"}
    _night(caps, 1, RING, 3.0)
    _night(caps, 1, ring2, 3.0)
    calls = []
    real = bh._ring_spans
    monkeypatch.setattr(bh, "_ring_spans", lambda dirs: calls.append(1) or real(dirs))
    bh.update(str(caps), [RING, ring2], dt.date(2026, 9, 2), None)
    assert calls == [1]


def test_the_reader_skips_what_is_not_a_battery_reading(tmp_path, caplog):
    caps = tmp_path / "captures"
    folder = caps / "2026-09-01"
    _night(caps, 1, RING, 3.0)
    _write_link(folder, [(T0, 99)], RING, name="Tepna_20260901220001_LINK.csv", connected="0")
    _write_link(folder, [(T0 + dt.timedelta(hours=-3), 99)], RING, name="Tepna_20260901220002_LINK.csv")
    _write_link(folder, [(dt.datetime(2026, 8, 31, 23), 99)], RING, name="Tepna_20260901220003_LINK.csv")
    _write_link(
        folder, [(T0, 99)], {"name": "Other", "address": "AA:BB:CC:DD:EE:05"}, name="Tepna_20260901220004_LINK.csv"
    )
    with open(folder / "Tepna_20260901220005_LINK.csv", "w") as fh:
        fh.write(
            HDR
            + "2026-09-01T22:01:00.000;Ring TEST;1\n"
            + "2026-09-01T22:01:00.000;Ring TEST;1;-60;;0;0;1;AA:BB:CC:DD:EE:01\n"
        )
        fh.write("not-a-stamp;Ring TEST;1;-60;99;0;0;1;AA:BB:CC:DD:EE:01\n")
    with open(folder / "Tepna_20260901220006_LINK.csv", "w") as fh:
        fh.write("Phone timestamp;device;connected\n2026-09-01T22:01:00.000;Ring TEST;1\n")
    with open(folder / "Tepna_20260901220007_LINK.csv", "w") as fh:  # no connected and no address column
        fh.write("Phone timestamp;device;battery_pct\n")
    (folder / "Tepna_20260901220008_LINK.csv").mkdir()
    st = bh.update(str(caps), [RING], dt.date(2026, 9, 3), None)
    assert st["Ring TEST"]["nights"] == {"2026-09-01": 3.013}
    assert "Tepna_20260901220008_LINK.csv is unreadable" in caplog.text


def test_ring_spans_skip_a_stampless_or_unreadable_spo2_file(tmp_path, caplog):
    d = tmp_path / "2026-09-01"
    _spo2(d, dt.datetime(2026, 9, 1, 22, 30), 600)
    _spo2(d, dt.datetime(2026, 9, 1, 23, 0), 0)  # header only
    (d / "Wellue_O2Ring-S_TEST0001_20260901233000_SPO2.csv").mkdir()
    assert bh._ring_spans([str(d)]) == [(dt.datetime(2026, 9, 1, 22, 30), dt.datetime(2026, 9, 1, 22, 39))]
    assert "is unreadable, so its worn span is absent" in caplog.text


# ── the daemon step ─────────────────────────────────────────────────────────────────────────────────────


class _N:
    def __init__(self, ok=True):
        self.ok, self.sent = ok, []

    async def send(self, title, message, **kw):
        self.sent.append((title, kw["key"]))
        return self.ok


def _aged(caps):
    for d in range(1, 15):
        _night(caps, d, RING, 3.0)
    for d in range(15, 22):
        _night(caps, d, RING, 4.0)


def test_the_step_pushes_once_delivered_and_retries_a_failed_send(tmp_path):
    caps = tmp_path / "captures"
    _aged(caps)
    path = caps / bh.STATE_NAME
    asyncio.run(capture._battery_health_step(str(caps), [RING], None, dt.date(2026, 9, 23)))
    assert "alerted_capacity" not in json.loads(path.read_text())["Ring TEST"]  # no notifier: nothing latched
    bad = _N(ok=False)
    asyncio.run(capture._battery_health_step(str(caps), [RING], bad, dt.date(2026, 9, 23)))
    assert bad.sent == [("Tepna: Ring TEST battery is wearing out", "battery-alerted_capacity-Ring TEST-75")]
    good = _N()
    asyncio.run(capture._battery_health_step(str(caps), [RING], good, dt.date(2026, 9, 23)))
    assert len(good.sent) == 1 and json.loads(path.read_text())["Ring TEST"]["alerted_capacity"] == 75
    again = _N()
    before = path.stat().st_mtime_ns
    asyncio.run(capture._battery_health_step(str(caps), [RING], again, dt.date(2026, 9, 23)))
    assert again.sent == [] and path.stat().st_mtime_ns == before  # nothing changed: nothing written


def test_the_step_reads_a_corrupt_state_as_none(tmp_path):
    caps = tmp_path / "captures"
    caps.mkdir()
    (caps / bh.STATE_NAME).write_text("[1, 2]")
    asyncio.run(capture._battery_health_step(str(caps), [RING], None, dt.date(2026, 9, 3)))
    assert json.loads((caps / bh.STATE_NAME).read_text()) == {"done": []}
