"""The AS11 clock offset reaching the acquisition envelope.

The measurement has existed since the RTC probe; the envelope has carried a `clock_offset` field the
whole time; the live stream never passed one. So every envelope said UNKNOWN while AS11CLOCK.csv sat
beside the capture holding the answer, and a reconciliation joining a device-stamped EDF to a
host-stamped night read the AS11's ~21 fast minutes as a real gap."""

import acq_evidence as ae
import as11_clock as A
import capture

HDR = "host_wall;host_epoch_s;device_iso;device_epoch_s;offset_s"
H0 = 1_787_000_000.0
AHEAD_S = 1260.0  # the AS11 reads ~21 min FAST — measured on this box


def _sidecar(n=10, ahead=AHEAD_S, step=30.0):
    return "\n".join([HDR] + [f"w;{H0 + i * step};iso;{H0 + i * step + ahead};{-ahead}" for i in range(n)])


def test_THE_SIGN_IS_FLIPPED_and_a_magnitude_only_test_would_not_notice():
    """🔴 The two conventions are opposite and this is the only place they meet.

      · `analyze` returns median(host - device) → NEGATIVE when the device runs ahead.
      · `ClockOffset.offset_sec` is documented POSITIVE when the device reads LATER.

    A consumer doing declare-never-correct with the sign backwards shifts the WRONG WAY and turns a
    21-minute discrepancy into a 42-minute one — which still looks like a plausible clock story. So
    this asserts the sign explicitly; `abs(...) == 1260` would pass under both conventions and is
    exactly the assertion that would let the defect ship."""
    got = A.offset_for_envelope(_sidecar())
    assert got["offset_sec"] == AHEAD_S, "the device reads LATER, so the envelope must be POSITIVE"
    raw = A.analyze([(H0 + i * 30.0, H0 + i * 30.0 + AHEAD_S) for i in range(10)])
    assert raw["offset_s"] == -AHEAD_S, "analyze's own convention changed; the flip here must follow"


def test_a_device_running_SLOW_is_reported_negative():
    """The mirror. Pinned so the flip is a negation, not a hardcoded direction for this one device."""
    assert A.offset_for_envelope(_sidecar(ahead=-45.0))["offset_sec"] == -45.0


def test_measured_at_is_the_NEWEST_anchor_in_FLOATING_ms():
    """Staleness is the consumer's to judge, and it judges against the newest anchor — the oldest
    would make a fresh measurement look stale by the length of the session. Floating per Clock §1: a
    real-UTC value here would be an hour out in summer and read as a plausible clock story."""
    got = A.offset_for_envelope(_sidecar(n=10))
    import datetime as dt

    last = H0 + 9 * 30.0
    t = dt.datetime.fromtimestamp(last)
    want = (
        dt.datetime(
            t.year, t.month, t.day, t.hour, t.minute, t.second, t.microsecond, tzinfo=dt.timezone.utc
        ).timestamp()
        * 1000.0
    )
    assert got["measured_at_ms"] == want
    assert got["reference"] == "host-wall" and got["method"] == "GetDateTime"


def test_TOO_FEW_ANCHORS_is_None_never_a_zero():
    """`analyze` refuses below two anchors, and this must refuse for the same reason. A zero would
    assert a measured agreement that never happened — and `ClockOffset.measured` gates on
    `offset_sec is not None` precisely because 0.0 is a legitimate MEASURED result."""
    assert A.offset_for_envelope(HDR) is None
    assert A.offset_for_envelope("") is None
    assert A.offset_for_envelope(None) is None
    assert A.offset_for_envelope(_sidecar(n=1)) is None


def test_blank_and_torn_rows_are_skipped_not_counted():
    """A failed device read writes a row with a blank device column — it is not an anchor."""
    text = _sidecar(n=3) + f"\nw;{H0 + 200};;;\nw;bad;iso;also-bad;\ntorn"
    got = A.offset_for_envelope(text)
    assert got["offset_sec"] == AHEAD_S


def test_a_refusing_analyze_yields_None_rather_than_a_partial_record():
    assert A.offset_for_envelope(_sidecar(), analyze_fn=lambda _r: {"ok": False}) is None
    assert A.offset_for_envelope(_sidecar(), analyze_fn=lambda _r: {"ok": True, "offset_s": None}) is None


# ── the daemon side ────────────────────────────────────────────────────────────────────────────


def test_the_provider_builds_a_ClockOffset_the_envelope_can_carry(tmp_path):
    (tmp_path / "AS11CLOCK.csv").write_text(_sidecar())
    got = capture._as11_clock_offset(str(tmp_path))
    assert isinstance(got, ae.ClockOffset)
    assert got.offset_sec == AHEAD_S and got.measured is True
    assert got.reference == "host-wall" and got.method == "GetDateTime"


def test_NO_SIDECAR_is_ClockOffset_unknown_not_a_zero(tmp_path):
    """A detector that never ran has measured nothing. `unknown()` says that; a zero would claim the
    clocks were checked and agreed."""
    got = capture._as11_clock_offset(str(tmp_path))
    assert got.offset_sec is None and got.measured is False
    assert got.reference == ae.UNKNOWN and got.method == ae.UNKNOWN


def test_a_sidecar_too_short_to_measure_is_also_unknown(tmp_path):
    (tmp_path / "AS11CLOCK.csv").write_text(_sidecar(n=1))
    assert capture._as11_clock_offset(str(tmp_path)).measured is False


def test_the_envelope_carries_the_offset_end_to_end(tmp_path):
    """The join this whole unit exists for: the assembled envelope reports the measured offset instead
    of UNKNOWN, so a reconciliation reads a known clock difference rather than a 21-minute gap."""
    import acq_evidence_cpap

    (tmp_path / "AS11CLOCK.csv").write_text(_sidecar())
    env = acq_evidence_cpap.assemble_live(
        {"session_id": "s1", "device_id": "AS11", "closed": True},
        clock_offset=capture._as11_clock_offset(str(tmp_path)),
    )
    assert env.clock_offset.offset_sec == AHEAD_S and env.clock_offset.measured is True


def test_WITHOUT_the_offset_the_same_envelope_still_says_unknown(tmp_path):
    """The control for the test above: it must be the offset that changes the envelope, not the
    assembly. Without it, `assemble_live` fills `ClockOffset.unknown()` exactly as it did before."""
    import acq_evidence_cpap

    env = acq_evidence_cpap.assemble_live({"session_id": "s1", "device_id": "AS11", "closed": True})
    assert env.clock_offset.measured is False


def test_a_NON_FINITE_column_is_not_an_anchor():
    """`inf`/`nan` parse as floats but are not measurements. `analyze` drops them for the same reason;
    letting one through here would put a non-finite into the median and poison the offset silently."""
    text = _sidecar(n=3) + f"\nw;inf;iso;{H0};0\nw;{H0};iso;nan;0\nw;-inf;iso;-inf;0"
    got = A.offset_for_envelope(text)
    assert got["offset_sec"] == AHEAD_S, "a non-finite row reached the estimator"


# ── the provider, at the seam where the stream emits its envelope ───────────────────────────────


def test_a_THROWING_provider_records_the_offset_as_UNKNOWN_not_as_a_failure():
    """🔴 The envelope is a REPORT ABOUT the acquisition. A clock measurement we could not read must
    degrade to "not measured" — it must never sink the envelope, and least of all the capture, which
    by then is already on disk."""
    import cpap_stream

    seen = {}

    class _Raw:
        path = None

        @staticmethod
        def acq_facts():
            return {"session_id": "s1", "device_id": "AS11", "closed": True}

        @staticmethod
        def close():
            pass

    class _Counters:
        total_lost = sink_errors = foreign_stream = 0

        @staticmethod
        def summary():
            return {"samples_ok": 10}

    def _boom():
        raise RuntimeError("sidecar unreadable")

    def _out(ev):
        seen["ev"] = ev

    cpap_stream._emit_acq_evidence(_out, [_Raw()], _Counters(), 25.0, True, _boom)
    ev = seen.get("ev")
    assert ev is not None, "a throwing provider suppressed the envelope entirely"
    assert ev.clock_offset.measured is False, "a failed read was recorded as a measurement"


def test_the_controller_FORWARDS_a_provider_when_it_has_one():
    """The additive kwarg must actually arrive — a controller that accepts a provider and drops it is
    invisible, and every envelope would silently say UNKNOWN in production."""
    import asyncio

    import cpap_stream as CS

    seen = {}

    async def pump(
        bus,
        write,
        recv_frame,
        pk,
        cid,
        *,
        channels=None,
        should_stop=None,
        extra_sinks=None,
        acq_evidence_out=None,
        clock_offset_provider=None,
    ):
        seen["prov"] = clock_offset_provider

    async def connect():
        async def write(_f):
            pass

        async def recv_frame():
            await asyncio.sleep(3600)

        async def disconnect():
            pass

        return write, recv_frame, disconnect

    def _prov():
        return None

    async def _drive():
        c = CS.LiveStreamController(
            object(),
            connect,
            lambda: {"masterPairKey": "aa" * 32, "clientId": "cid"},
            dict,
            pump=pump,
            acq_evidence_out=lambda _e: None,
            clock_offset_provider=_prov,
        )
        await c.op("start")
        await asyncio.sleep(0.01)

    asyncio.run(_drive())
    assert seen["prov"] is _prov, "the controller dropped the provider it was given"
