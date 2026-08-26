# tepna-capture — tests/test_acq_evidence_cpap.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
"""acq_evidence_cpap — the CPAP adapter for the Acquisition Evidence Contract (Phase B).

The three contract invariants are tested as PLANTED CONTROLS, not as incidental assertions: each one
names a value the adapter must NOT produce, so the test fails if the invariant is ever quietly relaxed.

  §5  UNKNOWN ≠ ABSENT      — absent accounting is UNKNOWN, never 0. `0` means "counted, none happened".
  §6  VALID ≠ COMPLETE      — the two axes are asserted in all four combinations, never collapsed.
  §4  ACQUISITION ≠ SCIENCE — nothing here reads or writes an evidence tier.

Plus the §18 EXECUTION WITNESS: the envelope is assembled by the real pump on the real production
seam (ARMED → TRIGGERED → SIDE EFFECT → ARTIFACT → ACQUISITION EVIDENCE), not merely by calling the
assembler directly — including on the interrupted path, which is when it matters most.
"""
import asyncio
import logging
import collections
import json

import acq_evidence as ae
import acq_evidence_cpap as cpap
import as11_link as L
import cpap_record
import cpap_stream as CS

PAIR_KEY = b"K" * 32
NONCE = bytes.fromhex("00112233445566778899aabbccddeeff")


def _facts(**over):
    f = {"session_id": "20260825T013000Z-abc123", "device_id": "AS11-01",
         "path": "/tmp/cpap-raw-x.jsonl", "records": 42, "closed": True, "size": 8192,
         "first_device_start": None}
    f.update(over)
    return f


def _counters(**over):
    c = {"frames_ok": 100, "samples_ok": 5000, "foreign_stream": 0, "malformed": 0, "overflow": 0,
         "stalls": 0, "post_drop_tail": 0, "sink_errors": 0, "total_lost": 0}
    c.update(over)
    return c


# ── §5 UNKNOWN ≠ ABSENT — the planted controls ─────────────────────────────────
def test_absent_gap_accounting_is_unknown_not_zero():
    """THE control for §5. With no counters at all the gap fields must be UNKNOWN — a 0 here would
    assert "we counted, and nothing was lost" about a stream nobody counted."""
    ev = cpap.assemble_live(_facts(), counters=None)
    assert ev.transport_gaps == ae.UNKNOWN and ev.decode_gaps == ae.UNKNOWN
    assert ev.transport_gaps != 0 and ev.decode_gaps != 0, "absent accounting must not read as zero loss"
    assert ev.sample_count is None, "no counters ⇒ no sample count; None, never 0"


def test_present_gap_accounting_of_zero_is_zero_not_unknown():
    """The mirror control: a real all-zero count is a MEASUREMENT and must stay 0. Without this, an
    adapter that returned UNKNOWN for everything would pass the test above."""
    ev = cpap.assemble_live(_facts(), counters=_counters())
    assert ev.transport_gaps == 0 and ev.decode_gaps == 0
    assert ev.sample_count == 5000


def test_expected_sample_count_is_unknown_without_an_observed_interval():
    ev = cpap.assemble_live(_facts(), counters=_counters(), observed_duration_s=600)
    assert ev.expected_sample_count == ae.UNKNOWN and ev.expected_sample_count != 0


def test_expected_sample_count_derives_from_the_observed_interval():
    """Derived from the DEVICE's observed interval, never the requested nominal (cpap_stream §2)."""
    ev = cpap.assemble_live(_facts(), counters=_counters(), observed_duration_s=600,
                            observed_interval_ms=40)
    assert ev.expected_sample_count == 15000


def test_unobserved_device_state_is_unknown_not_standby():
    """An unread supervisor is UNKNOWN — never "the device was not in therapy" (§5)."""
    ev = cpap.assemble_live(_facts(), counters=_counters())
    assert ev.device_state == ae.UNKNOWN


def test_observed_device_state_is_carried_through():
    ev = cpap.assemble_live(_facts(), counters=_counters(), device_state="Therapy")
    assert ev.device_state == "Therapy"


def test_a_never_opened_record_is_unknown_not_valid_and_not_invalid():
    """`closed` False must not become INVALID: a torn or unwritten record is un-VERIFIED, and calling
    that "invalid" is precisely the §5 negative conclusion drawn from missing information."""
    ev = cpap.assemble_live(_facts(closed=False), counters=_counters())
    assert ev.validation == ae.UNKNOWN and ev.validation_depth is None
    assert ev.validation != ae.INVALID


# ── §6 VALIDATION ⟂ COMPLETENESS — all four combinations ───────────────────────
def test_valid_and_complete():
    ev = cpap.assemble_live(_facts(), counters=_counters(), stopped_cleanly=True)
    assert (ev.validation, ev.completeness) == (ae.VALID, ae.COMPLETE)
    assert ev.validation_depth == cpap.DEPTH_JSONL_CLOSED


def test_valid_but_partial_when_frames_were_lost():
    """The §6 case that matters: intact, cleanly-closed bytes describing an INCOMPLETE acquisition."""
    ev = cpap.assemble_live(_facts(), counters=_counters(overflow=7, total_lost=7), stopped_cleanly=True)
    assert (ev.validation, ev.completeness) == (ae.VALID, ae.PARTIAL)
    assert ev.transport_gaps == 7


def test_valid_but_partial_when_the_durable_sink_failed():
    """`sink_errors` is INV9 loss — the batch reached the bus but not the authoritative record. It is
    deliberately outside GapCounters.total_lost, so completeness must count it separately or a night
    that lost its durable copy would read COMPLETE."""
    ev = cpap.assemble_live(_facts(), counters=_counters(sink_errors=3), stopped_cleanly=True)
    assert ev.completeness == ae.PARTIAL


def test_invalid_but_complete():
    """A whole session whose artifact failed verification — INVALID + COMPLETE, never collapsed."""
    ev = cpap.assemble_live(_facts(), counters=_counters(), stopped_cleanly=True, artifact_valid=False)
    assert (ev.validation, ev.completeness) == (ae.INVALID, ae.COMPLETE)


def test_unknown_and_unknown():
    ev = cpap.assemble_live(_facts(closed=False), counters=None)
    assert (ev.validation, ev.completeness) == (ae.UNKNOWN, ae.UNKNOWN)


def test_an_uncleanly_stopped_session_is_partial():
    ev = cpap.assemble_live(_facts(), counters=_counters(), stopped_cleanly=False)
    assert ev.completeness == ae.PARTIAL and ev.validation == ae.VALID


# ── the duration_check analog: the DEVICE's own verdict vs what streamed ───────
def test_device_declared_duration_disagreeing_makes_it_partial():
    """LastTherapyUseDateTime says the device ran 3600 s; only 1800 s streamed. The artifact is whole
    and valid, but it is half the therapy session — PARTIAL, with the disagreement first-class."""
    ev = cpap.assemble_live(_facts(), counters=_counters(), stopped_cleanly=True,
                            device_declared_duration_s=3600, observed_duration_s=1800)
    assert ev.duration_check.delta_s == 1800, "sign convention: stored - observed"
    assert ev.duration_check.agrees is False
    assert (ev.validation, ev.completeness) == (ae.VALID, ae.PARTIAL)


def test_one_sided_duration_makes_no_comparison():
    ev = cpap.assemble_live(_facts(), counters=_counters(), observed_duration_s=1800)
    assert ev.duration_check.agrees is None and ev.duration_check.delta_s is None


def test_end_time_derives_only_from_an_observed_duration():
    ev = cpap.assemble_live(_facts(), counters=_counters(), start_time_ms=1000.0,
                            observed_duration_s=60)
    assert ev.end_time_ms == 61000.0
    assert cpap.assemble_live(_facts(), start_time_ms=1000.0).end_time_ms is None


# ── artifact identity: the durable record, never the derived EDF (INV9) ────────
def test_the_artifact_is_the_raw_record_and_the_edf_is_provenance():
    ev = cpap.assemble_live(_facts(), counters=_counters(), edf_path="/tmp/night/x_BRP.edf")
    assert ev.artifact_path == "/tmp/cpap-raw-x.jsonl", "the authoritative copy is the artifact"
    assert ev.provenance["edf_artifact"] == "/tmp/night/x_BRP.edf"
    assert ev.source == ae.SOURCE_LIVE and ev.signal == cpap.SIGNAL_BRP


def test_full_counters_ride_in_provenance_unprojected():
    """transport/decode are a LOSSY view; the forensic record must survive intact (§8)."""
    c = _counters(foreign_stream=4, stalls=2)
    ev = cpap.assemble_live(_facts(), counters=c)
    assert ev.provenance["gap_counters"] == c


def test_a_foreign_frame_is_not_counted_as_loss():
    """A frame for another streamId was never ours — it is neither transport nor decode loss."""
    ev = cpap.assemble_live(_facts(), counters=_counters(foreign_stream=9), stopped_cleanly=True)
    assert ev.transport_gaps == 0 and ev.decode_gaps == 0 and ev.completeness == ae.COMPLETE


def test_no_hash_is_invented():
    assert cpap.assemble_live(_facts(), counters=_counters()).artifact_sha256 is None


# ── the STORED spool source — never merged with live (§10) ─────────────────────
def _row(status="NO_MORE_DATA", seq=1, sha="a" * 64, nbytes=100):
    return {"device": "AS11-01", "session": "s1", "spool_type": "brp",
            "committed_cursor": "2026-08-25T01:00:00", "round_seq": seq,
            "round": {"from": "2026-08-25T00:00:00", "bytes": nbytes, "sha256": sha, "status": status}}


def test_spool_is_a_distinct_source_from_live():
    ev = cpap.assemble_spool([_row()])
    assert ev.source == ae.SOURCE_STORED_SPOOL and ev.source != ae.SOURCE_LIVE


def test_spool_no_more_data_is_complete_and_promote_verified():
    ev = cpap.assemble_spool([_row(seq=1, nbytes=100), _row(seq=2, nbytes=50)])
    assert (ev.validation, ev.completeness) == (ae.VALID, ae.COMPLETE)
    assert ev.validation_depth == cpap.DEPTH_SPOOL_PROMOTE
    assert ev.artifact_size == 150 and ev.provenance["rounds"] == 2


def test_spool_more_data_pending_is_valid_but_partial():
    ev = cpap.assemble_spool([_row(status="MORE_DATA_PENDING")])
    assert (ev.validation, ev.completeness) == (ae.VALID, ae.PARTIAL)


def test_spool_unknown_status_is_unknown_completeness():
    ev = cpap.assemble_spool([_row(status="SOMETHING_ELSE")])
    assert ev.completeness == ae.UNKNOWN


def test_an_empty_spool_ledger_is_unknown_not_a_complete_valid_acquisition():
    """THE §5 control for the stored path: no rows is UNKNOWN, not an empty successful pull."""
    ev = cpap.assemble_spool([], committed_dir="/spool/committed")
    assert ev.validation == ae.UNKNOWN and ev.completeness == ae.UNKNOWN
    assert ev.validation != ae.VALID and ev.completeness != ae.COMPLETE
    assert ev.artifact_size is None, "no rows ⇒ unknown size, never 0 bytes"
    assert ev.provenance["rounds"] == 0


def test_spool_invents_no_combined_hash():
    """Each round has its own sha; a hash over the set would be the second hashing system §12 forbids."""
    ev = cpap.assemble_spool([_row(sha="a" * 64), _row(sha="b" * 64)])
    assert ev.artifact_sha256 is None
    assert ev.provenance["round_sha256"] == ["a" * 64, "b" * 64]


def test_spool_does_not_fabricate_sample_or_gap_accounting():
    """A byte transfer has no frames — every stream-shaped field must be None/UNKNOWN, never 0."""
    ev = cpap.assemble_spool([_row()])
    assert ev.sample_count is None and ev.expected_sample_count == ae.UNKNOWN
    assert ev.transport_gaps == ae.UNKNOWN and ev.decode_gaps == ae.UNKNOWN
    assert ev.start_time_ms is None and ev.end_time_ms is None, "cursors are the consumer's to localise"


def test_spool_identity_falls_back_to_the_ledger_then_honours_an_override():
    assert cpap.assemble_spool([_row()]).device_id == "AS11-01"
    assert cpap.assemble_spool([_row()], device_id="OVERRIDE").device_id == "OVERRIDE"


# ── cpap_record.acq_facts — the seam the envelope reads ────────────────────────
def test_acq_facts_reports_a_clean_close(tmp_path):
    p = tmp_path / "rec.jsonl"
    sink = cpap_record.RawRecordSink(str(p), device_id="AS11-01", session_id="s1",
                                     provenance={}, wall=lambda: "2026-08-25T00:00:00Z")
    sink.open({}, 25.0)
    sink.on_batch({"streamId": 1, "channels": {"PatientFlow": [1.0]}})
    sink.close()
    f = sink.acq_facts()
    assert f["closed"] is True and f["records"] == 1 and f["size"] > 0
    assert f["session_id"] == "s1" and f["device_id"] == "AS11-01" and f["path"] == str(p)


def test_acq_facts_on_a_never_opened_sink_is_not_closed(tmp_path):
    """_CLOSED is also the never-opened state. Without the explicit flag this reports a clean close for
    a record that was never written — which the envelope would read as VALID."""
    sink = cpap_record.RawRecordSink(str(tmp_path / "never.jsonl"), device_id="d", session_id="s",
                                     provenance={})
    f = sink.acq_facts()
    assert f["closed"] is False and f["records"] == 0
    assert f["size"] is None, "an absent file is unknown size, never 0"
    assert cpap.assemble_live(f).validation == ae.UNKNOWN


def test_acq_facts_mid_session_is_not_closed(tmp_path):
    p = tmp_path / "open.jsonl"
    sink = cpap_record.RawRecordSink(str(p), device_id="d", session_id="s", provenance={},
                                     wall=lambda: "2026-08-25T00:00:00Z")
    sink.open({}, 25.0)
    try:
        assert sink.acq_facts()["closed"] is False
    finally:
        sink.close()


# ── §18 EXECUTION WITNESS — the real pump, the real seam ───────────────────────
def _identity_factory(session_key):
    return (lambda p: p), (lambda w: w)


def _enc(obj):
    return (L.VCID_ENC_RX, json.dumps(obj).encode())


def _plain(obj):
    return (L.VCID_PLAIN_RX, json.dumps(obj).encode())


def _handshake():
    return [
        _plain({"id": 10, "result": {"challenge": (b"chal-16-bytes!!!").hex(), "nonce": NONCE.hex()}}),
        _plain({"id": 11, "result": {"confirmation": True}}),
    ]


def _ack():
    return _enc({"id": 16, "result": {
        "dataIds": [{"dataId": "PatientFlow", "valid": True}, {"dataId": "MaskPressure", "valid": True}],
        "streamId": 1}})


def _data():
    return _enc({"jsonrpc": "2.0", "method": "StreamData", "params": {
        "data": [{"PatientFlow": [0.1, 0.2]}, {"MaskPressure": [5.0, 5.1]}],
        "intervalMs": 40, "startTime": "2026-08-23T01:30:28.730Z", "streamId": 1}})


class _FakeDev:
    def __init__(self, frames):
        self._f = collections.deque(frames)

    async def write(self, frame):
        pass

    async def recv_frame(self):
        return self._f.popleft()


class _FakeBus:
    def register(self, *a, **k):
        pass

    def push(self, *a, **k):
        pass


class _FakeEdf:
    """Stands in for EdfSink: exposes `path`, has no `acq_facts` — the discriminator the pump uses."""

    path = "/tmp/night/x_BRP.edf"

    def open(self, channels, fs):
        pass

    def on_batch(self, batch):
        pass

    def close(self):
        pass


class _FakeRaw:
    def __init__(self):
        self.closed = False

    def open(self, channels, fs):
        pass

    def on_batch(self, batch):
        pass

    def close(self):
        self.closed = True

    def acq_facts(self):
        return _facts(closed=self.closed)


def test_the_production_pump_emits_the_envelope_after_the_sinks_close():
    """ARMED → TRIGGERED → SIDE EFFECT → ARTIFACT → ACQUISITION EVIDENCE, through the real pump."""
    got = []
    raw = _FakeRaw()
    dev = _FakeDev(_handshake() + [_ack(), _data(), _data()])
    n = asyncio.run(CS.stream_to_bus(_FakeBus(), dev.write, dev.recv_frame, PAIR_KEY, "cid",
                                    cipher_factory=_identity_factory, max_batches=2,
                                    extra_sinks=[raw, _FakeEdf()], acq_evidence_out=got.append))
    assert n == 2
    assert len(got) == 1, "exactly one envelope per session"
    ev = got[0]
    # it describes the REAL artifact, and was assembled AFTER the close (else validation is UNKNOWN)
    assert ev.validation == ae.VALID, "assembled after the sink closed"
    assert ev.completeness == ae.COMPLETE
    assert ev.artifact_path == "/tmp/cpap-raw-x.jsonl"
    assert ev.provenance["edf_artifact"] == "/tmp/night/x_BRP.edf"
    assert ev.provenance["observed_interval_ms"] == 40, "the DEVICE's observed interval reached it"
    # 2 batches x (2 flow + 2 pressure): samples_ok counts SAMPLES across channels, not frames — the
    # number the pump actually accepted, not one this test assumed.
    assert ev.sample_count == 8
    assert ev.schema == ae.SCHEMA


def test_an_interrupted_session_still_emits_and_is_partial():
    """The control that makes the witness meaningful: a dropped link is exactly when the envelope
    matters, and it must NOT claim a clean stop."""
    got = []
    dev = _FakeDev(_handshake() + [_ack(), _data()])   # frames run out mid-stream → the link "drops"
    try:
        asyncio.run(CS.stream_to_bus(_FakeBus(), dev.write, dev.recv_frame, PAIR_KEY, "cid",
                                     cipher_factory=_identity_factory,
                                     extra_sinks=[_FakeRaw()], acq_evidence_out=got.append))
    except Exception:  # noqa: BLE001 — the drop is the point; the envelope is what we assert on
        pass
    assert len(got) == 1, "an interrupted night still gets its evidence"
    assert got[0].provenance["stopped_cleanly"] is False
    assert got[0].completeness == ae.PARTIAL


def test_no_evidence_callback_leaves_the_pump_unchanged():
    dev = _FakeDev(_handshake() + [_ack(), _data()])
    n = asyncio.run(CS.stream_to_bus(_FakeBus(), dev.write, dev.recv_frame, PAIR_KEY, "cid",
                                    cipher_factory=_identity_factory, max_batches=1,
                                    extra_sinks=[_FakeRaw()]))
    assert n == 1


def test_a_failing_evidence_writer_never_sinks_the_acquisition():
    """The report must not destroy the thing it reports on."""
    def _boom(_ev):
        raise RuntimeError("sidecar disk full")

    dev = _FakeDev(_handshake() + [_ack(), _data()])
    n = asyncio.run(CS.stream_to_bus(_FakeBus(), dev.write, dev.recv_frame, PAIR_KEY, "cid",
                                    cipher_factory=_identity_factory, max_batches=1,
                                    extra_sinks=[_FakeRaw()], acq_evidence_out=_boom))
    assert n == 1, "the pump still reports its delivered count"


def test_no_raw_record_means_no_envelope():
    """With only a derived EDF there is no authoritative artifact to describe — emitting one would be
    a fabricated acquisition fact."""
    got = []
    dev = _FakeDev(_handshake() + [_ack(), _data()])
    asyncio.run(CS.stream_to_bus(_FakeBus(), dev.write, dev.recv_frame, PAIR_KEY, "cid",
                                cipher_factory=_identity_factory, max_batches=1,
                                extra_sinks=[_FakeEdf()], acq_evidence_out=got.append))
    assert got == []


# ── §4 ACQUISITION ⟂ SCIENCE ───────────────────────────────────────────────────
def _values(obj):
    """Every scalar VALUE in a nested dict/list, as lowercase strings."""
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _values(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _values(v)
    elif obj is not None:
        yield str(obj).lower()


def test_the_envelope_carries_no_scientific_evidence_tier():
    """Acquisition integrity must never leak into the science ladder (measured/validated/...).

    Scans VALUES, not the raw blob. A tier leaks in as a GRADE — i.e. as a value — whereas a KEY may
    legitimately contain a tier word: `clock_offset.measured_at_ms` is a timestamp saying when a clock
    comparison was taken, not a claim that anything is `measured`-tier. The blob-wide scan this
    replaced flagged exactly that, which is a false positive on the field name rather than a finding.
    The value scan is also the STRONGER check for the real hazard: `{"evidence": "measured"}` is caught
    either way, but only the value scan stays true as honest field names accumulate."""
    ev = cpap.assemble_live(_facts(), counters=_counters(), stopped_cleanly=True)
    vals = list(_values(ev.to_dict()))
    for tier in ("measured", "validated", "emerging", "experimental", "heuristic"):
        assert tier not in vals, f"acquisition evidence must not carry the {tier} science tier"


def test_the_tier_control_still_catches_a_real_leak():
    """Guard the guard — the value scan must still fire on a tier appearing as a GRADE. Without this,
    narrowing the scan above could have quietly disabled the control it was meant to preserve."""
    leaked = {"validation": "VALID", "provenance": {"evidence": "measured"}}
    vals = list(_values(leaked))
    assert "measured" in vals, "the control must catch a tier that leaks in as a value"


# ── the capture.py production wiring: the sidecar writer ───────────────────────
def test_the_sidecar_writer_lands_the_envelope_beside_the_raw_record(tmp_path):
    """The Phase B side effect: one `<raw-record>.meta.json` in the SAME shape and placement the
    O2Ring `.dat` path already uses, so one reader handles both devices."""
    import capture

    rec = tmp_path / "cpap-raw-s1.jsonl"
    rec.write_text("{}\n")
    ev = cpap.assemble_live(_facts(path=str(rec)), counters=_counters(), stopped_cleanly=True)
    capture._cpap_acq_evidence_writer()(ev)

    blob = json.loads((tmp_path / "cpap-raw-s1.jsonl.meta.json").read_text())
    assert blob["acquisition_evidence"]["schema"] == ae.SCHEMA
    assert blob["acquisition_evidence"]["source"] == ae.SOURCE_LIVE
    assert blob["acquisition_evidence"]["validation"] == ae.VALID


def test_the_sidecar_writer_writes_nothing_without_an_artifact_path(tmp_path):
    import capture

    capture._cpap_acq_evidence_writer()(cpap.assemble_live(_facts(path=None)))
    assert list(tmp_path.iterdir()) == []


def test_a_failing_sidecar_write_is_logged_not_raised(tmp_path):
    """The raw record is already durable; losing the REPORT must not look like losing the capture."""
    import capture

    # a path whose parent does not exist — the open() raises OSError inside the writer
    ev = cpap.assemble_live(_facts(path=str(tmp_path / "absent-dir" / "rec.jsonl")))
    capture._cpap_acq_evidence_writer()(ev)   # must not raise


def test_the_controller_is_armed_with_a_writer_only_when_a_raw_record_exists(tmp_path):
    """The ARMED half of the §18 witness. With no raw_record_dir there is no authoritative artifact,
    so there must be no writer — an envelope about nothing is a fabricated acquisition fact."""
    import capture

    armed = capture._build_cpap_controller(
        object(), {"cpap": {"ble_stream": {"raw_record_dir": str(tmp_path)}}},
        str(tmp_path / "config.yaml"))
    assert armed._acq_evidence_out is not None

    unarmed = capture._build_cpap_controller(object(), {"cpap": {}}, str(tmp_path / "config.yaml"))
    assert unarmed._acq_evidence_out is None


def test_the_controller_forwards_the_writer_to_the_pump():
    """The link between ARMED and TRIGGERED: the controller must actually hand the writer to the pump.
    Without this, a controller that accepts `acq_evidence_out` and quietly drops it is invisible — the
    envelope would simply never be emitted in production while every assembler test stayed green."""
    seen = {}

    async def pump(bus, write, recv_frame, pk, cid, *, channels=None, should_stop=None,
                   extra_sinks=None, acq_evidence_out=None):
        seen["out"] = acq_evidence_out
        seen["called"] = True

    async def connect():
        async def write(_f):
            pass

        async def recv_frame():
            await asyncio.sleep(3600)

        async def disconnect():
            pass
        return write, recv_frame, disconnect

    def _writer(_ev):
        pass

    async def _drive(out):
        c = CS.LiveStreamController(
            object(), connect, lambda: {"masterPairKey": "aa" * 32, "clientId": "cid"},
            dict, pump=pump, acq_evidence_out=out)
        await c.op("start")
        await asyncio.sleep(0.01)

    asyncio.run(_drive(_writer))
    assert seen["out"] is _writer, "the controller must forward the writer it was given"

    seen.clear()
    asyncio.run(_drive(None))
    assert seen.get("out") is None, "and must not invent one when none was configured"


# ── v1.1.0 · the measured clock offset (CPAPDEX-STR-SUMMARY-INGEST's clock box) ──
def test_absent_clock_offset_is_the_honest_absence_record_not_a_zero():
    """THE control for this field. An unmeasured offset must not read as "the clocks agreed" — that is
    a measurement nobody made, and a consumer would apply 0 s of correction believing it was checked."""
    ev = cpap.assemble_live(_facts())
    assert ev.clock_offset.offset_sec is None
    assert ev.clock_offset.offset_sec != 0 and ev.clock_offset.offset_sec != 0.0
    assert ev.clock_offset.measured is False
    assert ev.clock_offset.reference == ae.UNKNOWN and ev.clock_offset.method == ae.UNKNOWN


def test_a_measured_ZERO_offset_is_measured():
    """The mirror control, and the reason `measured` exists instead of truthiness: 0.0 s is a REAL
    result (the device agreed with the reference) and is falsy. `if offset_sec:` would discard it."""
    z = ae.ClockOffset(0.0, 1.0, "host-stratum1", "GetDateTime")
    assert z.measured is True
    assert bool(z.offset_sec) is False, "0.0 is falsy — which is exactly why callers must gate on .measured"


def test_a_supplied_offset_rides_the_envelope_with_its_provenance():
    """An offset without WHEN and AGAINST-WHAT is a bare number nobody can responsibly apply — a device
    crystal drifts, so last week's offset is not tonight's. The provenance is a field, not a comment."""
    off = ae.ClockOffset(-2520.0, 1755000000000.0, "host-stratum1", "GetDateTime")
    ev = cpap.assemble_live(_facts(), clock_offset=off)
    assert ev.clock_offset.offset_sec == -2520.0
    assert ev.clock_offset.measured_at_ms == 1755000000000.0
    assert ev.clock_offset.reference == "host-stratum1"
    assert ev.clock_offset.method == "GetDateTime"
    # and it survives serialisation, since the sidecar is what a Dex will read
    assert json.loads(json.dumps(ev.to_dict()))["clock_offset"]["offset_sec"] == -2520.0


def test_the_sign_convention_is_pinned():
    """POSITIVE = the DEVICE reads LATER than the reference. Unpinned, a consumer has a 50 % chance of
    correcting in the wrong direction — and a doubled error looks like a plausible offset."""
    ev = cpap.assemble_live(_facts(), clock_offset=ae.ClockOffset(-2520.0, 1.0, "host-stratum1", "GetDateTime"))
    assert ev.clock_offset.offset_sec < 0, "the AS11 runs BEHIND the host, so its offset is negative"


def test_the_spool_path_carries_the_offset_too():
    ev = cpap.assemble_spool([_row()], clock_offset=ae.ClockOffset(-2520.0, 1.0, "host-stratum1", "GetDateTime"))
    assert ev.clock_offset.offset_sec == -2520.0
    assert cpap.assemble_spool([]).clock_offset.measured is False, "an empty ledger measures no clock"


def test_the_field_is_additive_and_the_schema_version_moved():
    """A new FIELD moves the version (unlike SOURCE_STORED_SPOOL, which added a VALUE to an open
    vocabulary). And every pre-existing caller keeps working without passing it."""
    assert ae.SCHEMA_VERSION == "1.1.0"
    ev = cpap.assemble_live(_facts(), counters=_counters(), stopped_cleanly=True)
    assert ev.validation == ae.VALID and ev.completeness == ae.COMPLETE, "unchanged by the addition"
    assert "clock_offset" in ev.to_dict()


# ── PASS-THROUGH IDENTITY — every field the assembler forwards, pinned ─────────
def test_assemble_live_forwards_every_field_it_is_given():
    """Diff-scoped mutation showed the assembler could return `None` for session_id, device_id,
    artifact_size, artifact_sha256, clock_status, start_time_ms and provenance.records with the suite
    still green: the Phase B tests asserted the DERIVED axes (validation/completeness/gaps) thoroughly
    and never checked that the CARRIED values arrive. A field silently blanked here is an envelope that
    describes the wrong acquisition, which is worse than one that refuses."""
    off = ae.ClockOffset(-2520.0, 1.0, "host-stratum1", "GetDateTime")
    ev = cpap.assemble_live(
        _facts(), counters=_counters(), clock_status="device+host", start_time_ms=1000.0,
        observed_duration_s=60, artifact_sha256="deadbeef", clock_offset=off, edf_path="/e.edf",
        observed_interval_ms=40, device_state="Therapy", stopped_cleanly=True,
    )
    assert ev.session_id == "20260825T013000Z-abc123"
    assert ev.device_id == "AS11-01"
    assert ev.artifact_path == "/tmp/cpap-raw-x.jsonl"
    assert ev.artifact_size == 8192
    assert ev.artifact_sha256 == "deadbeef"
    assert ev.clock_status == "device+host"
    assert ev.start_time_ms == 1000.0
    assert ev.device_state == "Therapy"
    assert ev.provenance["records"] == 42
    assert ev.provenance["edf_artifact"] == "/e.edf"
    assert ev.provenance["observed_interval_ms"] == 40
    assert ev.provenance["stopped_cleanly"] is True
    assert ev.clock_offset.offset_sec == -2520.0


def test_the_gap_categories_read_the_RIGHT_counters():
    """`_counter(counters, "overflow", "post_drop_tail")` mutated to drop or None-ify a key survived —
    nothing pinned WHICH counters feed which category. Distinct values per key make a swap visible."""
    c = _counters(overflow=3, post_drop_tail=5, malformed=7, foreign_stream=11)
    ev = cpap.assemble_live(_facts(), counters=c)
    assert ev.transport_gaps == 8, "transport = overflow(3) + post_drop_tail(5), and NOTHING else"
    assert ev.decode_gaps == 7, "decode = malformed(7) alone"
    # the foreign frames (11) appear in NEITHER — they were never ours
    assert ev.transport_gaps != 19 and ev.decode_gaps != 18


def test_sink_errors_ADD_to_total_lost_they_do_not_subtract():
    """`lost = total_lost + sink_errors` mutated to `-` survived. With equal values the subtraction
    yields 0 and the night reads COMPLETE — a durable-record loss erased by an arithmetic flip."""
    ev = cpap.assemble_live(_facts(), counters=_counters(total_lost=3, sink_errors=3), stopped_cleanly=True)
    assert ev.completeness == ae.PARTIAL, "3 lost + 3 sink errors is loss; 3 - 3 = 0 would read COMPLETE"


def test_complete_requires_BOTH_a_clean_stop_AND_accounting():
    """`stopped_cleanly is True and counters` mutated to `or` survived: with `or`, a clean stop and NO
    accounting reports COMPLETE — asserting completeness from a stream nobody counted."""
    ev = cpap.assemble_live(_facts(), counters=None, stopped_cleanly=True)
    assert ev.completeness == ae.UNKNOWN, "a clean stop without counters is UNKNOWN, never COMPLETE"


def test_validation_depth_is_named_on_the_explicit_verdict_path():
    """`validation_depth = DEPTH_JSONL_CLOSED` mutated to None survived on the artifact_valid branch —
    a verdict with no stated depth is a bare boolean, which is what `validation_depth` exists to prevent."""
    ev = cpap.assemble_live(_facts(), counters=_counters(), artifact_valid=True)
    assert ev.validation == ae.VALID and ev.validation_depth == cpap.DEPTH_JSONL_CLOSED


def test_assemble_spool_forwards_its_ledger_fields():
    """The spool mirror of the pass-through gap: signal, artifact_path, committed_cursor and
    round_seq_last could all blank out with the suite green."""
    ev = cpap.assemble_spool([_row(seq=7)], committed_dir="/spool/committed")
    assert ev.signal == "brp", "the spool_type IS the signal name"
    assert ev.artifact_path == "/spool/committed"
    assert ev.provenance["committed_cursor"] == "2026-08-25T01:00:00"
    assert ev.provenance["round_seq_last"] == 7
    assert ev.provenance["status"] == "NO_MORE_DATA"
    assert ev.session_id == "s1" and ev.device_id == "AS11-01"


def test_the_empty_ledger_record_is_pinned_FIELD_BY_FIELD():
    """The empty-ledger branch returns a whole literal record, and mutation showed most of its fields
    could change with the suite green — the earlier test asserted only validation/completeness/rounds.
    An honest-absence record is exactly the thing that must be pinned field by field: every one of these
    is a claim of "we do not know", and any of them flipping to a value would fabricate knowledge."""
    ev = cpap.assemble_spool([], device_id="AS11-01", session_id="s9", committed_dir="/spool/committed")
    assert ev.source == ae.SOURCE_STORED_SPOOL
    assert ev.session_id == "s9" and ev.device_id == "AS11-01", "the caller's identity is still carried"
    assert ev.signal is None
    assert ev.start_time_ms is None and ev.end_time_ms is None
    assert ev.sample_count is None and ev.expected_sample_count == ae.UNKNOWN
    assert ev.transport_gaps == ae.UNKNOWN and ev.decode_gaps == ae.UNKNOWN
    assert ev.artifact_path == "/spool/committed"
    assert ev.artifact_size is None and ev.artifact_sha256 is None
    assert ev.validation == ae.UNKNOWN and ev.validation_depth is None
    assert ev.completeness == ae.UNKNOWN
    assert ev.device_state == ae.UNKNOWN
    assert ev.clock_offset.measured is False
    assert ev.duration_check.agrees is None and ev.duration_check.source == ae.UNKNOWN
    assert ev.provenance == {"rounds": 0, "committed_cursor": None}


def test_device_state_is_carried_on_BOTH_paths_and_defaults_to_unknown():
    """`device_state if device_state is not None else UNKNOWN` survived four mutations — nothing pinned
    that a SUPPLIED state is carried on the spool path, nor that an empty string is carried rather than
    swallowed by a truthiness test."""
    assert cpap.assemble_spool([_row()], device_state="Therapy").device_state == "Therapy"
    assert cpap.assemble_spool([], device_state="Standby").device_state == "Standby"
    assert cpap.assemble_live(_facts(), device_state="Standby").device_state == "Standby"
    # None ⇒ UNKNOWN, but "" is a supplied value and must NOT become UNKNOWN (an `or` would swallow it)
    assert cpap.assemble_live(_facts(), device_state="").device_state == ""
    assert cpap.assemble_spool([_row()], device_state="").device_state == ""


def test_the_spool_duration_check_is_the_unknown_record():
    """A spool pull compares no durations; the record must be the honest-absence one, not a fabricated
    agreement."""
    dc = cpap.assemble_spool([_row()]).duration_check
    assert dc.stored_s is None and dc.observed_s is None
    assert dc.delta_s is None and dc.agrees is None and dc.source == ae.UNKNOWN


def test_spool_artifact_size_sums_every_round_not_just_the_last():
    """`total_bytes = sum(...)` — a mutation that returns only one round's bytes would still look
    plausible on a single-round ledger, so this uses THREE distinct sizes."""
    ev = cpap.assemble_spool([_row(nbytes=100), _row(nbytes=20), _row(nbytes=3)])
    assert ev.artifact_size == 123, "100 + 20 + 3 — distinct so any single-round answer is visible"


def test_lost_starts_at_zero_so_no_counters_means_no_fabricated_loss():
    """`lost = 0` mutated to None survived. With None the completeness branch would raise or misread;
    with counters absent the honest answer is UNKNOWN, reached without inventing a loss count."""
    ev = cpap.assemble_live(_facts(), counters=None, stopped_cleanly=False)
    assert ev.completeness == ae.PARTIAL, "an unclean stop is PARTIAL even with no accounting at all"


def test_clock_facts_are_carried_on_BOTH_spool_paths():
    """`clock_status` and `clock_offset` are carried on the populated AND the empty-ledger branch —
    mutation showed each could blank out independently, and the empty branch is the one a reader is
    most likely to forget, because "no rounds" feels like "nothing to say"."""
    off = ae.ClockOffset(-2520.0, 1.0, "host-stratum1", "GetDateTime")
    populated = cpap.assemble_spool([_row()], clock_status="device+host", clock_offset=off)
    assert populated.clock_status == "device+host" and populated.clock_offset.offset_sec == -2520.0
    empty = cpap.assemble_spool([], clock_status="host", clock_offset=off)
    assert empty.clock_status == "host", "an empty ledger still knows which clocks were involved"
    assert empty.clock_offset.offset_sec == -2520.0, "and still carries a measured offset"


def test_a_round_with_no_byte_count_contributes_ZERO_not_one():
    """`(… or 0)` mutated to `(… or 1)` survived: with every round well-formed the fallback never
    fires, so the suite never saw it. A malformed round must add nothing to the artifact size —
    inventing a byte per unreadable round is a small fabrication that scales with the ledger."""
    rows = [_row(nbytes=100), {"device": "d", "session": "s", "spool_type": "brp", "round": {}}]
    assert cpap.assemble_spool(rows).artifact_size == 100, "the byte-less round adds 0, not 1"


# ── the acquisition START — what makes an envelope JOINABLE to a night ────────
def test_the_envelope_carries_the_acquisition_start_so_it_can_be_joined():
    """WHY THIS FIELD MATTERS: a CPAP night is built from SD EDFs, whose filenames carry no host
    session id — so a Dex cannot join an envelope to a night the way OxyDex does (by filename). The
    join has to be by DAY, which needs a time. Before this, every production CPAP envelope had
    `start_time_ms: null` and was joinable to nothing at all."""
    raw = _facts(first_device_start="2026-08-23T01:30:28.730Z")
    ms = __import__("cpap_edf_writer").device_stamp_to_tms(raw["first_device_start"])
    ev = cpap.assemble_live(raw, counters=_counters(), start_time_ms=ms)
    assert ev.start_time_ms == ms and ev.start_time_ms is not None


def test_an_undatable_stamp_leaves_the_start_ABSENT_never_now():
    """§2.6 — a stamp that cannot be parsed is null, never today's date. A fabricated start would join
    the envelope to the WRONG night, which is worse than joining to none."""
    import cpap_edf_writer as w

    assert w.device_stamp_to_tms("nonsense") is None
    assert w.device_stamp_to_tms(None) is None
    assert w.device_stamp_to_tms("") is None
    assert cpap.assemble_live(_facts(), start_time_ms=None).start_time_ms is None


def test_a_calendar_invalid_stamp_is_refused_not_rolled():
    """Clock Contract §2.7 — Date arithmetic silently ROLLS Feb 30 onto March. The parser must refuse."""
    import cpap_edf_writer as w

    assert w.device_stamp_to_tms("2026-02-30T00:00:00Z") is None
    assert w.device_stamp_to_tms("2026-13-01T00:00:00Z") is None
    assert w.device_stamp_to_tms("2026-08-23T25:00:00Z") is None


def test_a_zoned_stamp_resolves_to_local_civil_not_utc_verbatim():
    """The device's live stamp is UTC ('…Z') but its own SD recording and OSCAR use local civil, so
    writing the UTC components verbatim mis-dates by the UTC offset. The two forms must NOT agree."""
    import cpap_edf_writer as w

    zoned = w.device_stamp_to_tms("2026-08-23T01:30:28.730Z")
    floating = w.device_stamp_to_tms("2026-08-23 01:30:28")
    assert zoned is not None and floating is not None
    assert zoned != floating, "a zoned stamp is CONVERTED; taking its components verbatim would mis-date"


def test_the_raw_sink_captures_the_FIRST_batch_stamp_and_keeps_it(tmp_path):
    """The FIRST batch is the acquisition's start; later batches must not overwrite it, or the envelope
    would report the last stamp seen and drift later as the night ran."""
    p = tmp_path / "rec.jsonl"
    sink = cpap_record.RawRecordSink(str(p), device_id="d", session_id="s", provenance={},
                                     wall=lambda: "2026-08-25T00:00:00Z")
    sink.open({}, 25.0)
    try:
        assert sink.acq_facts()["first_device_start"] is None, "nothing streamed yet ⇒ absent, not a date"
        sink.on_batch({"streamId": 1, "startTime": "2026-08-23T01:30:28.730Z", "channels": {}})
        sink.on_batch({"streamId": 1, "startTime": "2026-08-23T05:59:59.000Z", "channels": {}})
    finally:
        sink.close()
    assert sink.acq_facts()["first_device_start"] == "2026-08-23T01:30:28.730Z", "FIRST, not last"


def test_the_pump_actually_passes_the_start_through(monkeypatch):
    """The wiring witness. `_emit_acq_evidence` converting the stamp but not FORWARDING it would leave
    every envelope unjoinable while every assembler test stayed green — the same unpinned-wiring shape
    as the controller hand-off (#1784)."""
    got = []

    class _RawWithStamp(_FakeRaw):
        def acq_facts(self):
            f = _facts(closed=self.closed)
            f["first_device_start"] = "2026-08-23T01:30:28.730Z"
            return f

    dev = _FakeDev(_handshake() + [_ack(), _data()])
    asyncio.run(CS.stream_to_bus(_FakeBus(), dev.write, dev.recv_frame, PAIR_KEY, "cid",
                                cipher_factory=_identity_factory, max_batches=1,
                                extra_sinks=[_RawWithStamp()], acq_evidence_out=got.append))
    assert len(got) == 1
    import cpap_edf_writer as w

    assert got[0].start_time_ms == w.device_stamp_to_tms("2026-08-23T01:30:28.730Z")
    assert got[0].start_time_ms is not None, "the envelope must leave the pump JOINABLE"


def test_the_start_conversion_yields_an_ABSOLUTE_ms_value():
    """Every other test here compares two outputs of the SAME function, so a uniform scaling error
    (`* 1000` → `/ 1000`, or `* 1001`) passes them all — the relationship survives while the value is
    wrong. Only an absolute known-answer catches that, so this pins one stamp to its exact epoch ms."""
    import calendar

    import cpap_edf_writer as w

    # a stamp with no zone is already floating local civil, so its tMs is timegm of the components
    expect = calendar.timegm((2026, 8, 23, 1, 30, 28, 0, 0, 0)) * 1000.0
    got = w.device_stamp_to_tms("2026-08-23 01:30:28")
    assert got == expect
    assert got == 1787448628000.0, "an exact epoch-ms known answer — not a relationship between outputs"
    assert got > 1e12, "milliseconds, not seconds — a /1000 slip lands near 1.79e9 and still 'looks like' a time"


def test_the_record_header_carries_the_provenance_it_was_given(tmp_path):
    """`self._provenance = provenance` mutated to None survived — nothing read the header back."""
    p = tmp_path / "rec.jsonl"
    sink = cpap_record.RawRecordSink(str(p), device_id="AS11-01", session_id="s1",
                                     provenance={"unit": "cpap_stream", "wiring": "P1+P3"},
                                     wall=lambda: "2026-08-25T00:00:00Z")
    sink.open({}, 25.0)
    sink.close()
    header = json.loads(p.read_text().splitlines()[0])
    assert header["provenance"] == {"unit": "cpap_stream", "wiring": "P1+P3"}
    assert header["session_id"] == "s1" and header["device_id"] == "AS11-01"


class _RawAndPath(_FakeRaw):
    """A sink with BOTH `path` and `acq_facts` — the discriminating shape for the EDF picker, which
    must select the sink that is NOT the raw record. With `and` → `or` this one would be mistaken for
    the EDF and its path reported as the derived artifact."""

    path = "/tmp/not-the-edf"


def test_the_edf_picker_excludes_the_raw_record_even_when_it_exposes_a_path():
    got = []
    dev = _FakeDev(_handshake() + [_ack(), _data()])
    asyncio.run(CS.stream_to_bus(_FakeBus(), dev.write, dev.recv_frame, PAIR_KEY, "cid",
                                cipher_factory=_identity_factory, max_batches=1,
                                extra_sinks=[_RawAndPath(), _FakeEdf()], acq_evidence_out=got.append))
    assert len(got) == 1
    assert got[0].provenance["edf_artifact"] == "/tmp/night/x_BRP.edf", "the RAW record is never the EDF"


def test_no_raw_sink_returns_CLEANLY_rather_than_raising_into_the_handler(caplog):
    """`next(…, None)` mutated to drop the default survived: with no raw sink it raises StopIteration,
    the blanket handler swallows it, and the observable result — no envelope — is identical. The
    difference is that one path is a clean early return and the other is a caught crash that logs an
    exception every session. Asserting the LOG distinguishes them; asserting the envelope cannot."""
    got = []
    dev = _FakeDev(_handshake() + [_ack(), _data()])
    with caplog.at_level(logging.ERROR, logger="tepna.cpap"):
        asyncio.run(CS.stream_to_bus(_FakeBus(), dev.write, dev.recv_frame, PAIR_KEY, "cid",
                                    cipher_factory=_identity_factory, max_batches=1,
                                    extra_sinks=[_FakeEdf()], acq_evidence_out=got.append))
    assert got == [], "no raw record ⇒ no envelope"
    assert not [r for r in caplog.records if "acquisition-evidence emit failed" in r.message], (
        "a missing raw sink is an expected shape, not a failure to log — it must return, not raise"
    )
