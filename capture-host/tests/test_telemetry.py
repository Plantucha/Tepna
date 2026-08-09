# tepna-capture — tests/test_telemetry.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# Tests for the in-memory live-sample bus (telemetry.TelemetryBus) — the monitor page's stream fan-out.
# Exercises the SYNCHRONOUS surface (register / meta / push / snapshot / unregister + the ring cap and
# the fabricated-absence guards); the async subscribe/SSE path needs a loop and is left to the runtime.
# telemetry.py is PURE (asyncio stdlib only, no bleak) — was 0% covered.

import telemetry
from tests._srcscan import module_source


def test_default_meta_present_and_inactive_before_data():
    bus = telemetry.TelemetryBus()
    keys = {m["key"] for m in bus.meta()}
    # `ppg` deliberately absent since issue #410 — it is not device-unique (the O2Ring streams a
    # finger pleth too), so it is registered per-device as `ppg_vs` and a placeholder here would paint
    # an idle card no device ever fills.
    assert {"ecg", "spo2", "pr"} <= keys
    assert "ppg" not in keys
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
    # Registers explicitly rather than leaning on a DEFAULT_META entry: `ppg` left that table with
    # issue #410, and the Verity's pleth is now the device-qualified `ppg_vs`. The property under test
    # (a multi-channel frame is ringed as rows of the declared width) is unchanged.
    bus = telemetry.TelemetryBus()
    bus.register("ppg_vs", "PPG (Verity)", "raw", 55, chans=4)
    bus.push("ppg_vs", [[1, 2, 3, 4], [5, 6, 7, 8]])
    snap = bus.snapshot("ppg_vs")
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


def test_a_stream_is_never_judged_WEAK_against_a_rate_it_never_agreed_to():
    """WEAK is `eff_fs < 0.7 * nominal_fs`, so nominal must be the NEGOTIATED rate, not a vendor default.

    capture.py used to register each PMD stream at `pmd.SAMPLE_HZ[meas]` — the rate the hardware ships
    at — and only re-register with `used_fs` after negotiation. In that window the denominator was a
    number nobody had chosen, and the arithmetic below is what the monitor painted. Both cases are
    measured, not invented: vigil's config asks for ACC 25 and MAG 10, and the 2026-08-04 Verity MAG
    file delivered 10.28 Hz over 7.75 h (287,004 samples, max inter-arrival 0.924 s — never once
    silent long enough to be a real stall).
    """
    # The defect, stated as arithmetic: a healthy stream at its negotiated rate, judged against the
    # vendor default, is amber.
    assert telemetry.stream_health(200, 25.0, 0.1) == "weak", "ACC 25 Hz vs SAMPLE_HZ 200 → 0.125"
    assert telemetry.stream_health(50, 10.28, 0.1) == "weak", "MAG 10.28 Hz vs SAMPLE_HZ 50 → 0.21"

    # The fix: register 0 ("irregular / rate unknown") until negotiation lands. 0 routes to the
    # silence-only branch, so an unknown rate can never manufacture WEAK — whatever the stream delivers.
    for eff in (0.0, 10.28, 25.0, 200.0):
        assert telemetry.stream_health(0, eff, 0.1) == "good", f"unknown nominal judged rate at {eff}"

    # Silence is still caught while the rate is unknown — this must not become a blind spot.
    assert telemetry.stream_health(0, 0.0, 10.0) == "stall"


def test_capture_registers_pmd_streams_with_an_UNKNOWN_rate_until_negotiated():
    """Non-vacuity for the test above: it only protects anything while capture.py actually defers.

    Asserted against the source because the registration sits deep inside `run_polar`'s per-connection
    setup, behind a live BLE session that no unit test reaches. A behavioural test here would need the
    device; this reads the one line that has to stay honest.

    Via `module_source`, not a raw read: this is an `X not in src` scan, which is one of the shapes
    that BREAKS against a mutmut-generated capture.py (it emits the forbidden string as a mutation).
    The helper skips there instead of reporting the whole module unmeasurable — see tests/_srcscan.py.
    """
    src = module_source("capture.py")
    initial = [ln for ln in src.splitlines() if "_register(meas_of[s]" in ln]
    assert initial, "the initial PMD stream registration moved — this gate is now blind, not green"
    for ln in initial:
        assert "SAMPLE_HZ" not in ln, (
            "capture.py registers a PMD stream at the vendor default again. Between START and the "
            "`used_fs` re-register, telemetry.stream_health will judge WEAK against a rate the device "
            f"never agreed to. Register 0 (rate unknown) instead: {ln.strip()}")


def test_meta_carries_efffs_and_health():
    bus = telemetry.TelemetryBus()
    m0 = next(x for x in bus.meta() if x["key"] == "ecg")
    # `None`, not 0.0 (DEVICE-RATE-TRUTH §6.3). This assertion used to read `== 0.0`, and that is the
    # defect in miniature: a stream that has never been pushed has not been measured at 0 Hz — it has
    # not been measured. The two read alike until something downstream paints a colour from the number.
    assert m0["health"] == "idle" and m0["effFs"] is None     # declared, never pushed
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


# ── STREAM SHAPE IS AN INVARIANT (VIGIL-PPG-GRID-AUDIT-2026-07-25-BRIEF §2) ────────────────────
# `push()` used to do `m.chans = nch`, silently conforming the DECLARED shape to whatever arrived.
# Channel count is fixed by the hardware (capture.py `_LIVE_META`), so a frame of a different width
# is decoder corruption — and rewriting the metadata to match is the "quietly normalise bad input"
# move this suite forbids. It must be surfaced, and the corrupt frame must not reach the live view.

def test_channel_count_breach_does_not_rewrite_the_declared_shape():
    bus = telemetry.TelemetryBus()
    bus.register("ppg_vs", "PPG (Verity)", "raw", 55, chans=4,
                 labels=("LED1", "LED2", "LED3", "ambient"))
    bus.push("ppg_vs", [[1.0, 2.0, 3.0, 4.0]] * 8, 55)
    assert bus.snapshot("ppg_vs")["chans"] == 4
    bus.push("ppg_vs", [[1.0, 2.0, 3.0]] * 8, 55)          # decoder corruption: 3 channels
    assert bus.snapshot("ppg_vs")["chans"] == 4, "the declared shape must survive a bad frame"


def test_channel_count_breach_is_recorded_and_surfaced():
    bus = telemetry.TelemetryBus()
    bus.register("acc_h10", "ACC (H10)", "mg", 50, chans=3, labels=("X", "Y", "Z"))
    assert bus.shape_errors() == {}
    bus.push("acc_h10", [[1.0, 2.0]] * 4, 50)
    errs = bus.shape_errors()
    assert "acc_h10" in errs and "3" in errs["acc_h10"] and "2" in errs["acc_h10"]
    row = [m for m in bus.meta() if m["key"] == "acc_h10"][0]
    assert "shapeError" in row, "the monitor must be able to see the breach"


def test_healthy_stream_carries_no_shape_error_key():
    """The key's ABSENCE is the all-clear, so it must not appear on a well-formed stream."""
    bus = telemetry.TelemetryBus()
    bus.register("ecg_h10", "ECG", "uV", 130, chans=1)
    bus.push("ecg_h10", [1.0] * 73, 130)
    assert bus.shape_errors() == {}
    assert all("shapeError" not in m for m in bus.meta())


def test_malformed_frame_is_dropped_from_the_live_ring():
    """Ragged rows under one declared `chans` would be mis-plotted as real data."""
    bus = telemetry.TelemetryBus()
    bus.register("ppg_vs", "PPG", "raw", 55, chans=4)
    bus.push("ppg_vs", [[1.0, 2.0, 3.0, 4.0]] * 5, 55)
    bus.push("ppg_vs", [[9.0, 9.0]] * 5, 55)
    rows = bus.snapshot("ppg_vs")["v"]
    assert len(rows) == 5, "the corrupt frame must not be ringed"
    assert all(len(r) == 4 for r in rows), "every ringed row must match the declared width"


def test_shape_error_survives_an_unregister_reregister_cycle():
    """Every reconnect unregisters and re-registers; that must not launder away the evidence."""
    bus = telemetry.TelemetryBus()
    bus.register("ppg_vs", "PPG", "raw", 55, chans=4)
    bus.push("ppg_vs", [[1.0, 2.0]] * 3, 55)
    assert bus.shape_errors()
    bus.unregister("ppg_vs")
    bus.register("ppg_vs", "PPG", "raw", 55, chans=4)
    assert bus.shape_errors(), "a breach recorded against this night must not be clearable"


# ── `ppg` IS NOT A DEVICE-UNIQUE KEY (issue #410) ──────────────────────────────────────────────
# The O2Ring streams a finger pleth, so two devices declare `ppg`. While the Verity kept the bare key,
# monitor.html's deviceForStream() — "first device whose stream list contains this name" — resolved it
# to whichever sensor sorted first, and the Verity's PPG card showed the RING's battery and RSSI.

def test_default_meta_no_longer_claims_a_bare_ppg():
    """A placeholder here would paint a permanently idle PPG card that no device ever fills."""
    assert "ppg" not in telemetry.DEFAULT_META
    assert "ecg" in telemetry.DEFAULT_META, "ECG really is device-unique (only the H10)"


def test_capture_qualifies_ppg_but_not_ecg():
    import importlib
    cap = importlib.import_module("capture")
    assert cap._live_key("ppg", "vs") == "ppg_vs", "two devices stream ppg — it must be qualified"
    assert cap._live_key("ecg", "h10") == "ecg", "only the H10 streams ecg"
    assert cap._live_key("acc", "vs") == "acc_vs"
    assert cap._live_key("acc", "h10") == "acc_h10"


def test_the_two_ppg_streams_get_distinct_keys():
    """The Verity's and the O2Ring's pleth must never collide on one bus key."""
    import importlib
    cap = importlib.import_module("capture")
    assert cap._live_key("ppg", "vs") != "o2ppg"


# ── effFs IS MEASURED ON THE DEVICE CLOCK (DEVICE-RATE-TRUTH §6.3) ─────────────────────────────
# Two defects in one statistic, and they compound:
#
#   1. OFF-BY-ONE. `span` ran from the OLDEST frame's arrival while `total` counted that frame's
#      samples too — so k frames of n samples at spacing T gave `k·n / ((k−1)·T)`, a k/(k−1) bias
#      that is ALWAYS positive and never averages out. With the 5 s window holding ~9 ECG frames
#      that is 130 × 9/8 = 146.25 Hz predicted, against 146.6 observed on the box.
#   2. HOST CLOCK. BLE delivers frames in bursts; several frames arriving in one connection event
#      share an arrival time, so an arrival-time denominator measures the RADIO's batching, not the
#      sensor's rate. The device's own `sensor_ns` is immune by construction.
#
# The fix measures between the first and last frame's device stamps and counts exactly the samples
# produced in that interval (frames[1:]) — an identity, not an estimate. The known-answer test is
# the brief's: frames at exact device spacing, delivered in ARBITRARY bursts, must give
# eff == nominal to ~1 ppm regardless of burst pattern.

_NOMINAL, _PER_FRAME = 130.0, 73          # H10 ECG: 73 samples per PMD frame
_FRAME_NS = int(round(_PER_FRAME / _NOMINAL * 1e9))


def _feed(bus, key, bursts, *, t0_ns=1_000_000_000_000):
    """Push frames at EXACT device spacing, grouped into `bursts` (frames per host wake-up).

    Every frame carries a truthful `dev_ns`; the host clock is left to whatever the wall gives us,
    which is the point — a burst collapses arrival times while device stamps stay evenly spaced.
    """
    ns, i = t0_ns, 0
    for burst in bursts:
        for _ in range(burst):
            i += 1
            bus.push(key, [float(i)] * _PER_FRAME, _NOMINAL, dev_ns=ns)
            ns += _FRAME_NS
    return i


def test_efffs_is_the_device_rate_regardless_of_how_the_radio_batches_it():
    """THE KNOWN ANSWER. Same frames, same device spacing, four different burst patterns."""
    for bursts in ([1] * 12, [4, 4, 4], [1, 1, 10], [12]):
        bus = telemetry.TelemetryBus()
        bus.register("ecg_h10", "ECG", "uV", _NOMINAL, chans=1)
        n = _feed(bus, "ecg_h10", bursts)
        assert n == 12, "the fixture must deliver the same 12 frames every time"
        eff = next(m for m in bus.meta() if m["key"] == "ecg_h10")["effFs"]
        assert abs(eff - _NOMINAL) < 1e-3, (
            f"burst pattern {bursts} gave {eff} Hz, not the device's {_NOMINAL} — effFs is measuring "
            "the radio's batching or carrying the k/(k-1) bias, not the sensor's rate")


def test_the_off_by_one_bias_is_gone_at_its_measured_magnitude():
    """The specific arithmetic the box exhibited: 130 Hz reading 146.25.

    Pinned as a VALUE, not a direction — a fix that merely reduced the bias would still pass a
    `< previous` assertion, and this is the number the brief predicted from first principles and
    then observed at 146.6.
    """
    bus = telemetry.TelemetryBus()
    bus.register("ecg_h10", "ECG", "uV", _NOMINAL, chans=1)
    _feed(bus, "ecg_h10", [1] * 9)                       # 9 frames = the box's 5 s ECG window
    eff = next(m for m in bus.meta() if m["key"] == "ecg_h10")["effFs"]
    assert abs(eff - 146.25) > 10.0, "still reporting the k/(k-1) inflated rate (~146.25 Hz)"
    assert abs(eff - _NOMINAL) < 1e-3, f"expected the device rate {_NOMINAL}, got {eff}"


def test_a_single_frame_cannot_state_a_rate_and_says_None_not_zero():
    """One frame spans no interval. `0.0` is a MEASUREMENT of silence and would read as a stall;
    the honest answer is that there is nothing to measure yet (Clock Contract §2.6, one layer up)."""
    bus = telemetry.TelemetryBus()
    bus.register("ecg_h10", "ECG", "uV", _NOMINAL, chans=1)
    bus.push("ecg_h10", [1.0] * _PER_FRAME, _NOMINAL, dev_ns=1_000_000_000_000)
    row = next(m for m in bus.meta() if m["key"] == "ecg_h10")
    assert row["effFs"] is None, "a single frame must not manufacture a rate"
    assert row["health"] == "good", "…and an unmeasurable rate must never be painted WEAK"


def test_a_stream_with_no_device_stamps_still_gets_a_host_rate_without_the_bias():
    """The O2Ring/SpO2 path pushes no `dev_ns`. It must keep working — and must not keep the bias."""
    bus = telemetry.TelemetryBus()
    bus.register("o2ppg", "O2Ring pleth", "raw", 125.0, chans=1)
    for _ in range(6):
        bus.push("o2ppg", [1.0] * 10, 125.0)             # no dev_ns
    row = next(m for m in bus.meta() if m["key"] == "o2ppg")
    assert row["effFs"] is not None, "a stampless stream must still report something"
    assert row["effFs"] > 0.0


def test_device_clock_wins_over_the_host_clock_when_both_are_available():
    """Non-vacuity for the whole group: if the host clock were still in charge, a burst would show it.

    All 12 frames are pushed back-to-back, so the host span is ~microseconds and an arrival-time
    denominator would report an absurd rate. The device stamps say 130 Hz.
    """
    bus = telemetry.TelemetryBus()
    bus.register("ecg_h10", "ECG", "uV", _NOMINAL, chans=1)
    _feed(bus, "ecg_h10", [12])
    eff = next(m for m in bus.meta() if m["key"] == "ecg_h10")["effFs"]
    assert eff < 1000.0, "a host-clock denominator on a single burst reports thousands of Hz"
    assert abs(eff - _NOMINAL) < 1e-3


def test_a_device_clock_that_went_BACKWARD_falls_back_instead_of_reporting_a_negative_rate():
    """Not theoretical: the H10 resets to a 2019 epoch whenever it leaves the strap.

    DEVICE-RATE-TRUTH §3 measured 24 of our own H10 captures carrying `599616000000000000` ns. A reset
    mid-window makes `devN < dev0`, and dividing by that span would report a NEGATIVE rate — which
    `stream_health` would then read as WEAK, i.e. a strap-removal painted as a failing radio.
    """
    bus = telemetry.TelemetryBus()
    bus.register("ecg_h10", "ECG", "uV", _NOMINAL, chans=1)
    bus.push("ecg_h10", [1.0] * _PER_FRAME, _NOMINAL, dev_ns=900_000_000_000_000)
    bus.push("ecg_h10", [1.0] * _PER_FRAME, _NOMINAL, dev_ns=599_616_000_000_000_000 % 1_000_000)  # reset
    row = next(m for m in bus.meta() if m["key"] == "ecg_h10")
    eff = row["effFs"]
    assert eff is None or eff > 0, f"a backward device clock produced {eff} Hz"
    assert row["health"] in ("good", "weak"), "…and must not crash the health rollup"


def test_the_window_ages_out_to_None_rather_than_to_a_measured_zero():
    """Everything older than the window is pruned. The old code returned 0.0 here — a stream that has
    gone quiet is caught by `age_s` (→ stall), so 0.0 added nothing and claimed a measurement."""
    bus = telemetry.TelemetryBus()
    bus.register("ecg_h10", "ECG", "uV", _NOMINAL, chans=1)
    bus.push("ecg_h10", [1.0] * _PER_FRAME, _NOMINAL, dev_ns=1_000_000_000_000)
    # Reach in and age the single frame past the window, which is what wall-clock time would do.
    bus._win["ecg_h10"][0] = (bus._win["ecg_h10"][0][0] - 600.0, _PER_FRAME, 1_000_000_000_000)
    eff, age, warmup = bus._stream_rate("ecg_h10", __import__("time").monotonic())
    assert eff is None, "an aged-out window has not measured 0 Hz; it has measured nothing"


def test_two_frames_in_the_same_instant_with_no_device_stamp_refuse_rather_than_divide_by_zero():
    """The last branch: a stampless stream whose two frames share an arrival time.

    Real on a burst-delivered O2Ring push (the paths that pass no `dev_ns`) when the monotonic clock
    does not tick between two callbacks. Driven through `_win` directly so it is deterministic rather
    than a race — the property under test is the guard, not the scheduler.
    """
    bus = telemetry.TelemetryBus()
    bus.register("o2ppg", "O2Ring pleth", "raw", 125.0, chans=1)
    bus.push("o2ppg", [1.0] * 10, 125.0)
    t = bus._win["o2ppg"][0][0]
    bus._win["o2ppg"].append((t, 10, None))            # same instant, no device stamp
    eff, _age, _warm = bus._stream_rate("o2ppg", t)
    assert eff is None, "a zero-length interval must refuse, never divide"
