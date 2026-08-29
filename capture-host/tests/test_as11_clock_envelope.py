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
