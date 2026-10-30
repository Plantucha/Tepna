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


# ── boundaries and mid-file damage: gaps the diff-scoped mutation gate found ─────────────────────


def test_a_TORN_LINE_MID_FILE_does_not_truncate_the_rest():
    """🔴 `continue` vs `break`. The earlier torn-row test put its bad lines at the END, where the two
    are indistinguishable — the mutation gate caught that. A torn line in the MIDDLE is the case that
    matters: `break` would silently drop every anchor after it and still return a plausible offset
    from the surviving prefix, which is worse than refusing."""
    rows = [f"w;{H0 + i * 30.0};iso;{H0 + i * 30.0 + AHEAD_S};{-AHEAD_S}" for i in range(10)]
    rows.insert(5, "torn")  # too few columns, mid-file
    rows.insert(6, f"w;notanumber;iso;{H0};0")  # unparseable, mid-file
    got = A.offset_for_envelope("\n".join([HDR] + rows))
    # The LAST anchor must still be seen — that is what `break` would have lost.
    assert got["measured_at_ms"] == A._host_epoch_to_floating_ms(H0 + 9 * 30.0)


def test_EXACTLY_TWO_anchors_is_enough_and_one_is_not():
    """The boundary `analyze` sets, pinned on both sides. Requiring three would silently refuse a
    short but perfectly good sidecar, and nothing else in the suite would notice."""
    two = "\n".join(
        [HDR, f"w;{H0};iso;{H0 + AHEAD_S};{-AHEAD_S}", f"w;{H0 + 30.0};iso;{H0 + 30.0 + AHEAD_S};{-AHEAD_S}"]
    )
    assert A.offset_for_envelope(two)["offset_sec"] == AHEAD_S
    one = "\n".join([HDR, f"w;{H0};iso;{H0 + AHEAD_S};{-AHEAD_S}"])
    assert A.offset_for_envelope(one) is None


def test_a_row_with_EXACTLY_FOUR_columns_is_still_an_anchor():
    """The sidecar writes five columns, but only the first four are read. Requiring five would reject
    a row that carries everything this function needs — a guard stricter than the data it guards."""
    four = "\n".join([HDR, f"w;{H0};iso;{H0 + AHEAD_S}", f"w;{H0 + 30.0};iso;{H0 + 30.0 + AHEAD_S}"])
    assert A.offset_for_envelope(four)["offset_sec"] == AHEAD_S
    three = "\n".join([HDR, f"w;{H0};iso", f"w;{H0 + 30.0};iso"])
    assert A.offset_for_envelope(three) is None


def test_SUB_SECOND_host_time_survives_the_floating_conversion():
    """`measured_at_ms` is milliseconds, so dropping the microseconds would quietly round staleness to
    the second. Cheap to keep, and the mutation gate showed nothing was holding it."""
    t = H0 + 0.25
    got = A._host_epoch_to_floating_ms(t)
    assert abs(got - A._host_epoch_to_floating_ms(H0) - 250.0) < 1e-6


def test_the_offset_ACTUALLY_REACHES_the_emitted_envelope():
    """🔴 THE POINT OF THE WHOLE UNIT, and nothing pinned it: the failure-path test alone let
    `clock_offset=clock_offset` be replaced by `clock_offset=None` with every test still green. This
    asserts the SUCCESS path end to end through the emit function."""
    import acq_evidence as ae
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

    offset = ae.ClockOffset(AHEAD_S, 1.0, "host-wall", "GetDateTime")
    cpap_stream._emit_acq_evidence(
        lambda ev: seen.setdefault("ev", ev), [_Raw()], _Counters(), 25.0, True, lambda: offset
    )
    ev = seen.get("ev")
    assert ev is not None
    assert ev.clock_offset.offset_sec == AHEAD_S, "the measured offset never reached the envelope"
    assert ev.clock_offset.measured is True

    # ...and with NO provider at all it is the honest absence, not a fabricated zero.
    seen.clear()
    cpap_stream._emit_acq_evidence(lambda ev: seen.setdefault("ev", ev), [_Raw()], _Counters(), 25.0, True, None)
    assert seen["ev"].clock_offset.measured is False


# ── the session window: the value and its stamp must describe the same anchors ───────────────────


def _walking_sidecar():
    """The box's own file in miniature: an old block, a 60-day gap, then last night's block.

    Shaped from the real measurement (2026-10-29): `AS11CLOCK.csv` held 93,990 anchors over 1562.9 h
    and the RTC had walked −19.8 s end to end, so the whole-file median sat 11.8 s away from the
    newest night's own. The two blocks here carry the same two offsets as the first and last day of
    that file."""
    old = [f"w;{H0 + i * 30.0};iso;{H0 + i * 30.0 + 1276.0};{-1276.0}" for i in range(60)]
    recent_t0 = H0 + 60 * 86400.0
    recent = [f"w;{recent_t0 + i * 30.0};iso;{recent_t0 + i * 30.0 + 1296.0};{-1296.0}" for i in range(60)]
    return "\n".join([HDR] + old + recent), recent_t0


def test_the_OFFSET_IS_THE_NEWEST_SESSION_not_the_whole_file():
    """🔴 THE DEFECT THIS WINDOW EXISTS FOR. The sidecar never rotates, so a whole-file median answers
    "what was the offset on average since August" while `measured_at_ms` says "measured minutes ago".
    A consumer judging staleness from the stamp then trusts a number that spans two months.

    `cpap_edf.device_start_from_host` places an SA2 with this value and a scoreable apnea lasts 10 s,
    so an 11.8 s error puts a desaturation beside the wrong event with both files well-formed."""
    text, _ = _walking_sidecar()
    got = A.offset_for_envelope(text)
    assert got["offset_sec"] == 1296.0, "the window must report the newest session, not the history"
    whole = A.offset_for_envelope(text, window_s=1e12)
    assert whole["offset_sec"] == 1286.0, "the unwindowed read medians across the walk"
    assert abs(whole["offset_sec"] - got["offset_sec"]) == 10.0, "and the two differ by half the walk"


def test_the_POPULATION_travels_with_the_VALUE():
    """A caller that cannot see how many anchors over how long a span produced an offset cannot tell
    a whole session from a single poll — and a single poll carries the device's whole-second quantum."""
    text, recent_t0 = _walking_sidecar()
    got = A.offset_for_envelope(text)
    assert got["anchors"] == 60, "only the newest block is in the window"
    assert got["span_s"] == 59 * 30.0
    assert got["window_s"] == A.ENVELOPE_WINDOW_S
    assert got["measured_at_ms"] == A._host_epoch_to_floating_ms(recent_t0 + 59 * 30.0)


def test_a_LONE_ANCHOR_IN_ITS_WINDOW_refuses_even_though_the_file_is_long():
    """The newest anchor sits a week past everything else: there is no second reading of the current
    offset, so there is nothing to take a median over. `None` is the honest answer and the caller
    renders it `ClockOffset.unknown()` — never a zero, and never the stale history (§∅)."""
    rows = [f"w;{H0 + i * 30.0};iso;{H0 + i * 30.0 + AHEAD_S};{-AHEAD_S}" for i in range(50)]
    lone = H0 + 7 * 86400.0
    rows.append(f"w;{lone};iso;{lone + AHEAD_S};{-AHEAD_S}")
    assert A.offset_for_envelope("\n".join([HDR] + rows)) is None


def test_the_WINDOW_BOUNDARY_is_inclusive_on_both_sides_of_one_step():
    """Pinned because `>` would drop an anchor exactly `window_s` old, and an off-by-one at the edge
    is invisible on a dense file and decides the verdict on a sparse one."""
    inside = "\n".join([HDR, f"w;{H0};iso;{H0 + AHEAD_S}", f"w;{H0 + 100.0};iso;{H0 + 100.0 + AHEAD_S}"])
    assert A.offset_for_envelope(inside, window_s=100.0)["anchors"] == 2
    assert A.offset_for_envelope(inside, window_s=99.0) is None
