# tepna-capture — tests/test_probe_ring_adv.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The advertisement probe with its one hardware seam (the scanner) faked: every row shape, the privacy
# filter, the live label override, the JSONL sink, the run loop's counters and teardown, and the summary
# table. `make_bleak_scanner_factory` / `_or_patterns` / `main` are the pragma'd bleak edge.

import asyncio
import json
import types

import probe_ring_adv as probe

RING = "F2:35:00:00:00:01"


def _adv(**kw):
    base = dict(local_name=None, manufacturer_data={}, service_data={}, service_uuids=[], tx_power=None,
                rssi=-60, platform_data=None)
    base.update(kw)
    return types.SimpleNamespace(**base)


def _dev(address):
    return types.SimpleNamespace(address=address)


# ── platform_extras ────────────────────────────────────────────────────────────────────────────────────


def test_platform_extras_tolerates_every_shape():
    assert probe.platform_extras(None) == {}
    assert probe.platform_extras(("/org/bluez/hci0/dev_X", {})) == {}
    assert probe.platform_extras(("/path", "not-a-dict")) == {}
    assert probe.platform_extras("garbage") == {}


def test_platform_extras_hex_encodes_raw_ad_structures_and_unwraps_variants():
    class V:  # dbus_fast Variant shape
        def __init__(self, value):
            self.value = value

    props = {
        "AdvertisingFlags": V(b"\x06"),
        "AdvertisingData": V({255: b"\x6f\x03\x01\x02", 9: b"O2R"}),
        "AddressType": "public",
        "Connectable": True,
        "Irrelevant": "dropped",
    }
    out = probe.platform_extras(("/path", props))
    assert out == {
        "AdvertisingFlags": "06",
        "AdvertisingData": {"255": "6f030102", "9": "4f3252"},
        "AddressType": "public",
        "Connectable": True,
    }
    # a bare dict works too (tests, other backends)
    assert probe.platform_extras({"TxPower": -4}) == {"TxPower": -4}


# ── decode_sighting / hypotheses / keep_row ────────────────────────────────────────────────────────────


def test_decode_sighting_is_flat_json_safe_and_tags_hypotheses_without_deciding():
    adv = _adv(local_name="O2Ring 2100", manufacturer_data={0xF34E: b"\x01\x02", 0x1234: b"\xff"},
               service_data={"0000180d-0000-1000-8000-00805f9b34fb": b"\x00"}, service_uuids=["180d"],
               tx_power=4, rssi=-55, platform_data=("/p", {"AddressType": "public"}))
    row = probe.decode_sighting(RING.lower(), adv, expected_addr=RING, label="button-pressed",
                                scan_mode="active", host_wall=1_700_000_000.1234567, host_mono=12.3456789)
    assert row["address"] == RING and row["expected"] is True
    assert row["manufacturer_data"] == {"0x1234": "ff", "0xF34E": "0102"}
    assert row["service_data"] == {"0000180d-0000-1000-8000-00805f9b34fb": "00"}
    assert row["hypothesis"] == ["0xF34E: " + probe.MFR_HYPOTHESES[0xF34E]]
    assert row["platform"] == {"AddressType": "public"}
    assert row["host_wall"] == 1_700_000_000.123 and row["host_mono"] == 12.345679
    assert row["label"] == "button-pressed" and row["scan_mode"] == "active"
    json.dumps(row)  # JSON-safe by construction


def test_decode_sighting_survives_a_bare_advert():
    row = probe.decode_sighting("AA:BB:CC:DD:EE:FF", types.SimpleNamespace(), expected_addr=RING, label="x",
                                scan_mode="passive", host_wall=0.0, host_mono=0.0)
    assert row["expected"] is False and row["manufacturer_data"] == {} and row["hypothesis"] == []
    assert row["local_name"] is None and row["rssi"] is None and row["service_uuids"] == []


def test_hypotheses_for_lists_only_the_brief_quoted_ids_in_order():
    assert probe.hypotheses_for({}) == []
    got = probe.hypotheses_for({0xF34E: b"", 0x036F: b"", 0x0001: b""})
    assert [h.split(":")[0] for h in got] == ["0x036F", "0xF34E"]


def test_keep_row_is_the_privacy_filter():
    ring = {"expected": True, "hypothesis": []}
    candidate = {"expected": False, "hypothesis": ["0x036F: …"]}
    stranger = {"expected": False, "hypothesis": []}
    assert probe.keep_row(ring, keep_all=False)
    assert probe.keep_row(candidate, keep_all=False)
    assert not probe.keep_row(stranger, keep_all=False)
    assert probe.keep_row(stranger, keep_all=True)


# ── label reader ───────────────────────────────────────────────────────────────────────────────────────


def test_label_reader_prefers_the_files_first_line_and_falls_back(tmp_path):
    assert probe.label_reader_for("worn", None)() == "worn"
    f = tmp_path / "label"
    read = probe.label_reader_for("worn", str(f))
    assert read() == "worn"                       # missing file → CLI label
    f.write_text("\n", encoding="utf-8")
    assert read() == "worn"                       # empty first line → CLI label
    f.write_text("  removed-idle \nsecond line\n", encoding="utf-8")
    assert read() == "removed-idle"               # first line, stripped, re-read live


# ── sink ───────────────────────────────────────────────────────────────────────────────────────────────


def test_jsonl_sink_appends_one_sorted_row_per_line_and_creates_the_directory(tmp_path):
    path = tmp_path / "deep" / "dir" / "adv.jsonl"
    sink = probe.JsonlSink(str(path))
    sink.write({"b": 1, "a": [1, 2]})
    sink.write({"z": None})
    sink.close()
    assert sink.n == 2
    assert path.read_text(encoding="utf-8") == '{"a":[1,2],"b":1}\n{"z":null}\n'
    # append, not truncate: a second run into the same file keeps the first
    sink2 = probe.JsonlSink(str(path))
    sink2.write({"c": 3})
    sink2.close()
    assert len(probe.load_rows(str(path))) == 3


# ── run_probe ──────────────────────────────────────────────────────────────────────────────────────────


class _Scanner:
    """Fake bleak scanner: `feed` is a list of (address, adv) delivered on start, in order."""

    def __init__(self, callback, feed, log):
        self.cb, self.feed, self.log = callback, feed, log

    async def start(self):
        self.log.append("start")
        for addr, adv in self.feed:
            self.cb(_dev(addr), adv)

    async def stop(self):
        self.log.append("stop")


class _Sink:
    def __init__(self):
        self.rows, self.closed = [], False

    def write(self, row):
        self.rows.append(row)

    def close(self):
        self.closed = True


def _clock(step=1.0):
    t = {"v": 100.0}

    def mono():
        t["v"] += step
        return t["v"]

    return mono


def test_run_probe_writes_ring_and_candidates_counts_strangers_and_stops_at_duration():
    log, sink, shown = [], _Sink(), []
    feed = [
        (RING, _adv(rssi=-50)),                                            # the ring → written
        ("11:22:33:44:55:66", _adv(manufacturer_data={0x036F: b"\x00"})),  # hypothesised id → written
        ("AA:AA:AA:AA:AA:AA", _adv(local_name="Phone")),                   # stranger → counted only
        ("AA:AA:AA:AA:AA:AA", _adv(local_name="Phone")),                   # same stranger → 1 address
        (RING, _adv(rssi=-52)),
    ]
    labels = iter(["worn", "worn", "worn", "removed", "removed"])
    sleeps, t = [], {"v": 100.0}

    async def sleep(s):             # the only thing that advances the fake clock
        sleeps.append(s)
        t["v"] += s

    res = asyncio.run(probe.run_probe(
        scanner_factory=lambda cb: _Scanner(cb, feed, log), expected_addr=RING.lower(), sink=sink,
        duration_s=3.0, label_reader=lambda: next(labels), scan_mode="active",
        mono=lambda: t["v"], wall=lambda: 1.0, sleep=sleep, progress=shown.append))
    assert res == {"written": 3, "dropped": 2, "other_addresses": 1, "expected_seen": 2}
    assert [r["address"] for r in sink.rows] == [RING, "11:22:33:44:55:66", RING]
    assert [r["label"] for r in sink.rows] == ["worn", "worn", "removed"]   # label read per sighting
    assert log == ["start", "stop"] and sink.closed
    assert len(shown) == 3 and "rssi=-50" in shown[0]
    assert sleeps == [1.0, 1.0, 1.0]                                      # bounded by duration, not by feed


def test_run_probe_keep_all_writes_strangers_and_open_ended_runs_until_cancelled():
    log, sink = [], _Sink()
    feed = [("AA:AA:AA:AA:AA:AA", _adv())]

    async def sleep(_s):
        raise asyncio.CancelledError            # the operator's Ctrl-C, one tick in

    async def go():
        try:
            await probe.run_probe(scanner_factory=lambda cb: _Scanner(cb, feed, log), expected_addr=RING,
                                  sink=sink, duration_s=None, label_reader=lambda: "x", scan_mode="passive",
                                  keep_all=True, sleep=sleep)
        except asyncio.CancelledError:
            return "cancelled"

    assert asyncio.run(go()) == "cancelled"
    assert sink.rows and sink.rows[0]["address"] == "AA:AA:AA:AA:AA:AA" and sink.rows[0]["scan_mode"] == "passive"
    assert log == ["start", "stop"] and sink.closed   # teardown runs on the cancel path too


def test_run_probe_without_progress_callback_stays_silent():
    sink = _Sink()
    res = asyncio.run(probe.run_probe(scanner_factory=lambda cb: _Scanner(cb, [(RING, _adv())], []),
                                      expected_addr=RING, sink=sink, duration_s=0.5, label_reader=lambda: "l",
                                      scan_mode="active", mono=_clock(1.0)))
    assert res["written"] == 1 and sink.closed


# ── summarize ──────────────────────────────────────────────────────────────────────────────────────────


def _row(addr, label, mono, rssi=-60, mfr=None, name=None, mode="active", hyp=()):
    return {"address": addr, "label": label, "host_mono": mono, "rssi": rssi, "scan_mode": mode,
            "manufacturer_data": mfr or {}, "local_name": name, "hypothesis": list(hyp)}


def test_summarize_groups_by_address_and_label_with_interval_stats():
    rows = [
        _row(RING, "worn", 10.0, -50, {"0x036F": "01"}, "O2Ring"),
        _row(RING, "worn", 11.0, -55, {"0x036F": "01"}, "O2Ring"),
        _row(RING, "worn", 13.5, -52, {"0x036F": "02"}, None),
        _row(RING, "worn", 13.5, -52, {"0x036F": "02"}, None),        # zero gap dropped from intervals
        _row(RING, "removed", 50.0, -70, hyp=["0xF34E: h"], mode="passive"),
        _row("11:22:33:44:55:66", "removed", 51.0, None),
    ]
    s = probe.summarize(rows)
    assert "LOWER bound" in s["note"]
    g = {(x["address"], x["label"]): x for x in s["groups"]}
    worn = g[(RING, "worn")]
    assert worn["n"] == 4 and worn["span_s"] == 3.5
    assert worn["interval_s"] == {"median": 1.75, "p90": 2.5, "max": 2.5}
    assert worn["rssi"] == {"min": -55, "max": -50}
    assert worn["manufacturer_payloads"] == ['{"0x036F": "01"}', '{"0x036F": "02"}']
    assert worn["local_names"] == ["None", "O2Ring"] and worn["scan_modes"] == ["active"]
    removed = g[(RING, "removed")]
    assert removed["n"] == 1 and removed["span_s"] == 0.0 and removed["interval_s"] is None
    assert removed["hypotheses"] == ["0xF34E: h"] and removed["scan_modes"] == ["passive"]
    other = g[("11:22:33:44:55:66", "removed")]
    assert other["rssi"] is None                                        # a None RSSI is not a number


def test_quantile_clamps_to_the_last_element():
    assert probe._quantile([3.0, 1.0, 2.0], 1.0) == 3.0
    assert probe._quantile([3.0, 1.0, 2.0], 0.0) == 1.0
    assert probe._quantile([5.0], 0.9) == 5.0


def test_load_rows_and_print_summary_round_trip(tmp_path, capsys):
    path = tmp_path / "adv.jsonl"
    path.write_text(json.dumps(_row(RING, "worn", 1.0)) + "\n\n" + json.dumps(_row(RING, "worn", 2.0)) + "\n",
                    encoding="utf-8")
    assert len(probe.load_rows(str(path))) == 2
    assert probe._print_summary(str(path)) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["groups"][0]["n"] == 2 and out["groups"][0]["interval_s"]["median"] == 1.0
