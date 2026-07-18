# tepna-capture — tests/test_telemetry.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Tests for the in-memory live-sample bus (telemetry.TelemetryBus) — the monitor page's stream fan-out.
# Exercises the SYNCHRONOUS surface (register / meta / push / snapshot / unregister + the ring cap and
# the fabricated-absence guards); the async subscribe/SSE path needs a loop and is left to the runtime.
# telemetry.py is PURE (asyncio stdlib only, no bleak) — was 0% covered.

import telemetry


def test_default_meta_present_and_inactive_before_data():
    bus = telemetry.TelemetryBus()
    keys = {m["key"] for m in bus.meta()}
    assert {"ecg", "ppg", "spo2", "pr"} <= keys
    assert all(m["active"] is False for m in bus.meta())  # nothing has produced data yet


def test_register_adds_a_device_qualified_stream():
    bus = telemetry.TelemetryBus()
    bus.register("acc_h10", "ACC (Polar H10)", "g", 200, chans=3, labels=("X", "Y", "Z"))
    m = next(x for x in bus.meta() if x["key"] == "acc_h10")
    assert m["chans"] == 3 and m["labels"] == ["X", "Y", "Z"] and m["fs"] == 200


def test_push_scalar_marks_active_and_snapshots():
    bus = telemetry.TelemetryBus()
    bus.push("spo2", [97, 98, 97])
    snap = bus.snapshot("spo2")
    assert snap["v"] == [97.0, 98.0, 97.0] and snap["chans"] == 1
    assert next(m for m in bus.meta() if m["key"] == "spo2")["active"] is True


def test_push_multichannel_syncs_channel_count():
    bus = telemetry.TelemetryBus()
    bus.push("ppg", [[1, 2, 3, 4], [5, 6, 7, 8]])
    snap = bus.snapshot("ppg")
    assert snap["chans"] == 4
    assert snap["v"] == [(1.0, 2.0, 3.0, 4.0), (5.0, 6.0, 7.0, 8.0)]


def test_ring_caps_at_max_of_64_or_window():
    # ring_seconds=1, fs=130 → cap = max(64, 130) = 130; push 200 → oldest dropped to 130.
    bus = telemetry.TelemetryBus(ring_seconds=1.0)
    bus.push("ecg", list(range(200)), fs=130)
    v = bus.snapshot("ecg")["v"]
    assert len(v) == 130 and v[-1] == 199.0 and v[0] == 70.0  # kept the newest 130


def test_slow_stream_keeps_min_64_window():
    bus = telemetry.TelemetryBus(ring_seconds=1.0)
    bus.push("spo2", list(range(100)), fs=1)  # cap = max(64, 1) = 64
    assert len(bus.snapshot("spo2")["v"]) == 64


def test_empty_push_is_a_noop():
    bus = telemetry.TelemetryBus()
    bus.push("ecg", [])
    assert bus.snapshot("ecg")["v"] == []
    assert next(m for m in bus.meta() if m["key"] == "ecg")["active"] is False


def test_unregister_drops_stream_everywhere():
    bus = telemetry.TelemetryBus()
    bus.register("gyro_verity", "GYRO", "dps", 52, chans=3)
    bus.push("gyro_verity", [[1, 2, 3]])
    bus.unregister("gyro_verity")
    assert "gyro_verity" not in {m["key"] for m in bus.meta()}
    assert bus.snapshot("gyro_verity")["v"] == []  # ring gone


def test_snapshot_of_unknown_stream_is_empty_not_error():
    bus = telemetry.TelemetryBus()
    snap = bus.snapshot("nope")
    assert snap["v"] == [] and snap["fs"] == 0 and snap["chans"] == 1


# ── Link health (weak-signal warning, stream-rate side) ──────────────────────────────────────────────
def test_stream_health_idle_when_no_sample_yet():
    assert telemetry.stream_health(130, 0.0, None) == "idle"


def test_waveform_health_stall_weak_good():
    # nominal 130 Hz waveform
    assert telemetry.stream_health(130, 0.0, 10.0) == "stall"          # silent > stall_s
    assert telemetry.stream_health(130, 50.0, 0.5) == "weak"           # 50 < 0.7·130
    assert telemetry.stream_health(130, 125.0, 0.1) == "good"          # near nominal
    assert telemetry.stream_health(130, 5.0, 0.1, warmup=True) == "good"  # too early to judge weak


def test_event_stream_only_stalls_never_weak():
    # slow ~1 Hz stream (spo2/pr): a low "rate" is meaningless, only silence matters
    assert telemetry.stream_health(1, 0.2, 2.0) == "good"
    assert telemetry.stream_health(1, 0.0, 8.0) == "stall"
    # irregular event stream (ppi/rr, nominal 0) uses the stall floor
    assert telemetry.stream_health(0, 0.0, 3.0) == "good"
    assert telemetry.stream_health(0, 0.0, 10.0) == "stall"


def test_meta_carries_efffs_and_health():
    bus = telemetry.TelemetryBus()
    m0 = next(x for x in bus.meta() if x["key"] == "ecg")
    assert m0["health"] == "idle" and m0["effFs"] == 0.0     # declared, never pushed
    bus.push("ecg", list(range(130)), fs=130)
    m1 = next(x for x in bus.meta() if x["key"] == "ecg")
    assert "effFs" in m1 and m1["health"] == "good"          # a just-pushed stream is warmup→good, never idle


# ── push() broadcast + subscriber-queue coverage (FOLLOWUPS §2) ─────────────────────────────────────
# The ring/snapshot are covered, but the SSE broadcast msg shape, the drop-oldest-when-full queue
# logic, and the rate fallback were unpinned. asyncio.Queue put/get_nowait are synchronous, so no loop.
def test_push_broadcasts_msg_with_correct_shape_to_subscriber():
    bus = telemetry.TelemetryBus()
    q = bus.subscribe()
    bus.push("spo2", [97, 98], fs=1)
    msg = q.get_nowait()
    assert msg["stream"] == "spo2" and msg["fs"] == 1
    assert msg["v"] == [97.0, 98.0] and msg["chans"] == 1
    assert len(msg["t"].split(":")) == 3          # HH:MM:SS wall-clock stamp present


def test_full_subscriber_queue_drops_oldest_keeps_newest():
    bus = telemetry.TelemetryBus()
    q = bus.subscribe(maxsize=2)
    for i in range(4):
        bus.push("spo2", [i], fs=1)               # 4 pushes into a size-2 queue
    got = []
    while not q.empty():
        got.append(q.get_nowait()["v"][0])
    assert got == [2.0, 3.0]                        # oldest (0,1) evicted, newest kept — never blocks


def test_push_rate_falls_back_to_one_for_unmetered_stream():
    bus = telemetry.TelemetryBus()
    q = bus.subscribe()
    bus.push("nosuchstream", [5], fs=None)         # no meta, no fs → rate = 1 (not 0)
    assert q.get_nowait()["fs"] == 1
