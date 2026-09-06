# tepna-capture — tests/test_probe_oxyii_0x03.py
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
#
# The worn-ring 0x03 rate probe (O2RING-RAW-DUAL-WAVELENGTH-FOLLOWUPS §7.4 — is channel A 112.9 Hz or
# the 125.000 Hz the ADC nominally runs at?). It is a hand-run tool, but its ARITHMETIC is the part
# that produces a published number, so what is covered here is what decides a verdict: saturation
# exclusion, the two rate estimates, marker isolation, and — above all — the refusals.
#
# A probe that prints a confident wrong rate is worse than one that prints nothing, which is why the
# negative cases carry the weight: no records, every reply pinned at the cap, a zero span. On the
# sibling opcode 0x05 a saturated drain WAS read as a device rate for months (282 402 of 284 420
# buffers pinned at the cap), and the number it produced looked entirely reasonable.

import asyncio

import pytest

import oxyii
import probe_oxyii_0x03 as probe


def _run(coro):
    return asyncio.run(coro)


def _payload(vals, count=None, trailer=b""):
    """A real 0x03 reply: 4 opaque header bytes, u16 LE record count at [4:6], then the 8-bit body."""
    n = len(vals) if count is None else count
    return b"\x00\x00\x00\x00" + n.to_bytes(2, "little") + bytes(vals) + trailer


def _s(counts, dt=0.2, markers=0, iso=0):
    """A per-reply log with one reply every `dt` seconds."""
    return [{"t": i * dt, "count": c, "body_len": c, "markers": markers, "isolated": iso}
            for i, c in enumerate(counts)]


# ── parse_counts: the declared count and the body length, kept distinct ─────────────────────────────
def test_parse_counts_reads_the_declared_u16_and_the_body_length():
    assert probe.parse_counts(_payload([1, 2, 3])) == (3, 3)


def test_a_payload_too_short_for_the_header_declares_NOTHING_not_zero():
    """`None` and `0` are different facts — "no header to read" versus "a reply declaring no records" —
    and `summarise` counts only the latter. Merging them would let a truncated stream read as an idle
    one, which is the absent-versus-zero error this project keeps paying for."""
    assert probe.parse_counts(b"\x01\x02") == (None, 0)


def test_a_trailer_does_not_change_the_declared_count():
    """The count is read, never inferred from the length: a reply carrying padding past the body would
    otherwise inflate the record count by however many bytes the ring appended."""
    cnt, body_len = probe.parse_counts(_payload([1, 2], trailer=b"\xff\xff"))
    assert cnt == 2 and body_len == 4


# ── marker_stats: isolation is the discriminator, not the value ─────────────────────────────────────
def test_an_isolated_marker_counts_as_isolated():
    assert probe.marker_stats(bytes([10, 156, 20])) == (1, 1)


def test_a_RUN_of_markers_counts_as_PRESENT_but_not_isolated():
    """Two adjacent 156s on a 0-255 waveform are samples that happen to equal the marker value, not two
    beats. Counting them as beats is how a marker rate becomes a heart rate that is not one."""
    assert probe.marker_stats(bytes([10, 156, 156, 20])) == (2, 0)


def test_markers_at_the_reply_edges_are_judged_on_the_neighbour_they_have():
    """A reply boundary is an edge, not evidence. Demanding both neighbours would silently drop every
    marker that landed first or last in a buffer — a systematic undercount, not a rounding one."""
    assert probe.marker_stats(bytes([156, 10])) == (1, 1)
    assert probe.marker_stats(bytes([10, 156])) == (1, 1)


def test_marker_stats_finds_nothing_in_a_clean_body():
    assert probe.marker_stats(bytes([1, 2, 3])) == (0, 0)


# ── summarise: the two rates, and what each one excludes ────────────────────────────────────────────
def test_the_rate_excludes_the_first_replys_records_because_they_predate_the_window():
    """Those records were buffered BEFORE the window opened, so they did not arrive during it — and the
    shorter the run, the worse counting them is. Four replies of 25 across 0.6 s of ELAPSED span is
    125 Hz; counting all 100 records against that span would say 167 Hz."""
    out = probe.summarise(_s([25, 25, 25, 25]))
    assert out["span_s"] == 0.6
    assert out["rate_all_hz"] == 125.0


def test_a_saturated_reply_takes_the_interval_AFTER_it_down_too():
    """A reply at the cap says the buffer was full at some unknown earlier moment, so its records did
    not all arrive in that interval — and the next reply started from a drained buffer, so neither did
    its own. Dropping only the saturated reply would leave the rate biased."""
    out = probe.summarise(_s([25, 250, 25, 25, 25]))
    assert out["saturated_replies"] == 1
    assert out["rate_unsaturated_hz"] == 125.0
    assert out["rate_all_hz"] != out["rate_unsaturated_hz"], (
        "the two rates must be reported separately — their disagreement IS the finding")


def test_every_reply_at_the_cap_yields_NO_rate_at_all():
    """The 0x05 failure, refused instead of reported: with no unsaturated interval the number would be
    `cap / poll period` — a property of the polling, not of the device."""
    out = probe.summarise(_s([250, 250, 250]))
    assert out["rate_unsaturated_hz"] is None
    assert out["saturated_fraction"] == 1.0


def test_replies_declaring_no_records_are_counted_but_do_not_enter_the_rate():
    out = probe.summarise(_s([0, 0, 25, 25]))
    assert out["replies"] == 4 and out["replies_with_records"] == 2


def test_an_empty_run_reports_absence_rather_than_zero():
    out = probe.summarise([])
    assert out["replies"] == 0
    assert out["rate_all_hz"] is None and out["span_s"] is None
    assert out["saturated_fraction"] is None and out["markers_total"] == 0


def test_a_single_record_bearing_reply_yields_no_span_and_no_rate():
    """One reply is one observation of a buffer, not an interval. There is nothing to divide by, and
    inventing a span from the poll period would produce exactly the poll-cadence artifact above."""
    out = probe.summarise(_s([25]))
    assert out["replies_with_records"] == 1
    assert out["span_s"] is None and out["rate_all_hz"] is None


def test_replies_that_share_a_timestamp_give_no_rate_rather_than_dividing_by_zero():
    """A degenerate span, not an impossible one: two replies drained under a coarse monotonic clock can
    carry the same `t`. The guard must refuse rather than raise — and must not then report a marker
    rate over that same zero span."""
    out = probe.summarise(_s([25, 25], dt=0.0))
    assert out["span_s"] == 0.0 and out["rate_all_hz"] is None
    assert "marker_rate_hz" not in out


def test_marker_totals_and_the_marker_corrected_rate_are_reported_SEPARATELY():
    """Separately, never instead of: which of the two IS the sample rate is the open question, so
    collapsing them answers it by assumption. On 0x05 the corrected rate recovered the 125.000 ADC from
    a 126.06 row rate — the same code has to be able to state both numbers."""
    out = probe.summarise(_s([25, 25, 25, 25], markers=1, iso=1))
    assert out["markers_total"] == 4 and out["markers_isolated"] == 4
    assert out["marker_rate_hz"] == 5.0
    assert out["rate_minus_markers_hz"] == 120.0


# ── verdict: what the numbers support, including "nothing" ──────────────────────────────────────────
def test_the_verdict_names_a_run_that_returned_no_records():
    lines = probe.verdict(probe.summarise([]))
    assert "NO 0x03 records" in lines[0]
    assert any("wrong request argument" in ln for ln in lines)


def test_the_verdict_refuses_a_rate_when_every_interval_was_saturated():
    lines = probe.verdict(probe.summarise(_s([250, 250, 250])))
    assert "no unsaturated interval" in lines[0]
    assert any("measures the POLLING" in ln for ln in lines)


def test_the_verdict_names_the_candidate_the_rate_matches():
    lines = probe.verdict(probe.summarise(_s([25, 25, 25, 25])))
    assert any("125.000" in ln for ln in lines)
    assert not any("NEITHER" in ln for ln in lines)


def test_the_other_candidate_is_named_when_the_rate_matches_IT():
    """113 records per 1 s interval. Both candidates must be reachable, or the probe can only ever
    confirm the one it happens to be tested against."""
    lines = probe.verdict(probe.summarise(_s([113, 113, 113], dt=1.0)))
    assert any("112.9" in ln for ln in lines)


def test_a_rate_matching_NEITHER_candidate_is_said_to_match_neither():
    """A tie-break that always picks a side is not a measurement. 40 records per 0.2 s is 200 Hz."""
    lines = probe.verdict(probe.summarise(_s([40, 40, 40, 40])))
    assert any("NEITHER" in ln for ln in lines)


def test_a_partly_saturated_run_still_carries_its_saturation_warning():
    lines = probe.verdict(probe.summarise(_s([25, 250, 25, 25, 25])))
    assert any("hit the 250-record cap" in ln for ln in lines)


# ── run(): the device path, driven by a fake ring answering real oxyii-encoded frames ───────────────
class _FakeDevice:
    def __init__(self, addr="D1:98:62:7C:92:B3"):
        self.address, self.name = addr, "S8-AW 2100"


class _FakeChar:
    def __init__(self, uuid):
        self.uuid = uuid


class _FakeService:
    def __init__(self, uuids=(oxyii.OXYII_WRITE, oxyii.OXYII_NOTIFY)):
        self.characteristics = [_FakeChar(u) for u in uuids]


class _FakeRing:
    """Answers 0x03 writes with a real encoded reply and 0x04 writes with a live header carrying a PR.

    The flags reproduce the three things that arrive on a real link and are not a 0x03 record: a frame
    that fails CRC, a reply of some other opcode, and a live header too short to parse.
    """

    def __init__(self, vals=(10, 156, 20), pr=60, *, bad_crc=False, short_live=False,
                 other_op=False):
        self.vals, self.pr = list(vals), pr
        self.bad_crc, self.short_live, self.other_op = bad_crc, short_live, other_op
        self.notify = None
        self.notify_char = None
        self.write_chars = []
        self.stopped = False
        self.services = [_FakeService()]
        self.mtu_size = 247

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def start_notify(self, _c, cb):
        # WHICH characteristic, not just that one was passed. A fake that ignores the argument cannot
        # tell the write and notify handles apart, so it accepts a probe that resolved them SWAPPED
        # and reports green — the resolution loop is then untested however wrong it is.
        self.notify_char = _c
        self.notify = cb

    async def stop_notify(self, _c):
        self.stopped = True

    async def write_gatt_char(self, _c, frame, response=False):
        self.write_chars.append(_c)
        op = frame[1]
        if op == probe.OP_SAMPLES_A:
            reply = oxyii.encode(probe.OP_SAMPLES_A, _payload(self.vals))
            if self.bad_crc:
                reply = reply[:-1] + bytes([reply[-1] ^ 0xFF])
            self.notify(0, reply)
        elif op == oxyii.OP_LIVE:
            if self.short_live:
                self.notify(0, oxyii.encode(oxyii.OP_LIVE, bytes(10)))
                return
            hdr = bytearray(24)
            hdr[6] = 96                               # spo2  (parse_live offset [6])
            hdr[8] = self.pr                          # low byte of the u16 PR at [8:10]
            self.notify(0, oxyii.encode(oxyii.OP_LIVE, bytes(hdr)))
        elif self.other_op:
            self.notify(0, oxyii.encode(oxyii.OP_GET_INFO, b"\x01\x02"))


def _install(monkeypatch, ring, device=None, step=0.5):
    async def find(*a, **k):
        return device
    monkeypatch.setattr(probe.BleakScanner, "find_device_by_filter", find)
    monkeypatch.setattr(probe, "BleakClient", lambda dev, **kw: ring)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(probe.asyncio, "sleep", no_sleep)
    # A monotonic clock advancing a fixed step per READ, so the poll loop terminates on a count of
    # clock reads rather than on how fast this machine happens to run the test.
    ticks = iter([i * step for i in range(4000)])
    monkeypatch.setattr(probe.time, "monotonic", lambda: next(ticks))


def test_run_refuses_when_the_ring_never_advertises(monkeypatch):
    _install(monkeypatch, _FakeRing(), device=None)
    with pytest.raises(SystemExit, match="not advertising"):
        _run(probe.run("D1:98:62:7C:92:B3", 1.0, 5.0, None))


def test_run_collects_records_markers_and_the_reported_pulse_rate(monkeypatch):
    ring = _FakeRing()
    _install(monkeypatch, ring, device=_FakeDevice())
    res = _run(probe.run("D1:98:62:7C:92:B3", 6.0, 5.0, None))
    s = res["summary"]
    assert s["replies_with_records"] > 0
    assert s["markers_total"] > 0, "the isolated 156 in each body must be counted"
    assert s["beats_polled"] == 1 and s["reported_pr_mean"] == 60.0
    assert s["records_per_beat"] is not None
    assert res["samples"][0]["body_hex"], "the raw body is kept so the LAYOUT stays checkable"
    assert ring.stopped, "notifications must be stopped rather than left running on the ring"


def test_run_refuses_a_gatt_that_does_not_expose_the_oxyii_pair(monkeypatch):
    ring = _FakeRing()
    ring.services = []                                # a device that is not the ring's GATT
    _install(monkeypatch, ring, device=_FakeDevice())
    with pytest.raises(SystemExit, match="write/notify"):
        _run(probe.run("D1:98:62:7C:92:B3", 1.0, 5.0, None))


def test_run_honours_an_explicit_request_argument(monkeypatch):
    """`--arg` exists because an empty reply and a wrong request argument are indistinguishable, so the
    override has to reach the wire — otherwise trying a different argument proves nothing."""
    seen = []
    ring = _FakeRing()
    real = ring.write_gatt_char

    async def spy(c, frame, response=False):
        seen.append(frame)
        return await real(c, frame, response=response)

    ring.write_gatt_char = spy
    _install(monkeypatch, ring, device=_FakeDevice())
    _run(probe.run("D1:98:62:7C:92:B3", 4.0, 5.0, "0902"))
    args = [oxyii.decode(f)[1] for f in seen
            if oxyii.decode(f) and oxyii.decode(f)[0] == probe.OP_SAMPLES_A]
    assert args and all(a == b"\x09\x02" for a in args)


def test_a_frame_that_fails_crc_and_a_reply_of_another_opcode_are_both_dropped(monkeypatch):
    """Neither is a 0x03 record, and the difference matters: a corrupt frame must not be counted as an
    empty one. The run then honestly reports no records at all rather than a rate over garbage.

    The live poll is untouched here, which is the point of the last assertion — a reported PR arrives,
    and `records_per_beat` is still WITHHELD, because a records-per-beat needs both halves. Publishing
    it from the PR alone would put a number beside a rate that does not exist."""
    ring = _FakeRing(bad_crc=True, other_op=True)
    _install(monkeypatch, ring, device=_FakeDevice())
    s = _run(probe.run("D1:98:62:7C:92:B3", 6.0, 5.0, None))["summary"]
    assert s["replies_with_records"] == 0
    assert s["rate_unsaturated_hz"] is None
    assert s["reported_pr_mean"] == 60.0
    assert "records_per_beat" not in s


def test_a_live_header_too_short_to_parse_is_not_counted_as_a_beat(monkeypatch):
    ring = _FakeRing(short_live=True)
    _install(monkeypatch, ring, device=_FakeDevice())
    s = _run(probe.run("D1:98:62:7C:92:B3", 6.0, 5.0, None))["summary"]
    assert s["replies_with_records"] > 0, "the 0x03 side must be unaffected"
    assert s["beats_polled"] == 0 and s["reported_pr_mean"] is None


# ── main(): the CLI wrapper ─────────────────────────────────────────────────────────────────────────
def test_main_prints_the_verdict_and_the_summary_and_writes_the_log(monkeypatch, capsys, tmp_path):
    async def fake_run(addr, seconds, hz, arg):
        return {"summary": probe.summarise(_s([25, 25, 25, 25])), "samples": [], "beats": []}

    monkeypatch.setattr(probe, "run", fake_run)
    out_json = tmp_path / "log.json"
    assert probe.main(["--seconds", "1", "--json", str(out_json)]) == 0
    out = capsys.readouterr().out
    assert "VERDICT" in out and "rate_unsaturated_hz" in out
    assert out_json.exists(), "--json must write the per-reply log it promises"


def test_main_runs_without_a_json_log(monkeypatch, capsys):
    async def fake_run(addr, seconds, hz, arg):
        return {"summary": probe.summarise([]), "samples": [], "beats": []}

    monkeypatch.setattr(probe, "run", fake_run)
    assert probe.main([]) == 0
    assert "NO 0x03 records" in capsys.readouterr().out


# ── Holes the mutation run found that 100 % statement+branch coverage did not ────────────────────────
# Every test below was written against a specific surviving mutant. Coverage says these lines RAN;
# these say the lines were also OBSERVED, which is the difference the 0x05 saturation bug turned on.

def test_a_reply_exactly_AT_the_cap_counts_as_saturated(monkeypatch):
    """THE mutant worth the whole exercise: `count >= cap` → `count > cap`.

    A buffer that pinned at exactly the cap is the saturation signature — it is what 282 402 of 0x05's
    284 420 buffers looked like. Off-by-one here readmits the entire §7.4 defect while every other test
    still passes, because a reply one record BELOW the cap behaves identically under both versions."""
    at_cap = probe.summarise(_s([250, 250, 250]))
    assert at_cap["saturated_replies"] == 3 and at_cap["rate_unsaturated_hz"] is None
    # One record under the cap is a real, usable reply — the boundary must fall between these two.
    under = probe.summarise(_s([249, 249, 249]))
    assert under["saturated_replies"] == 0 and under["rate_unsaturated_hz"] == 1245.0


def test_the_span_is_last_MINUS_first_on_a_window_that_does_not_start_at_zero():
    """`with_recs[-1]["t"] - with_recs[0]["t"]` → `+` is invisible when the first reply sits at t=0,
    which every other test here uses. `time.monotonic()` has an arbitrary origin, so on the box the
    first reply never sits at zero and the mutant would inflate the span by the whole boot time."""
    off = [{"t": 1000.0 + i * 0.2, "count": 25, "body_len": 25, "markers": 0, "isolated": 0}
           for i in range(4)]
    out = probe.summarise(off)
    assert out["span_s"] == 0.6, "span must be the elapsed window, not the clock's origin"
    assert out["rate_all_hz"] == 125.0


def test_a_rate_exactly_on_the_2_percent_boundary_matches_and_is_not_ALSO_called_neither():
    """`<= 0.02` paired with `> 0.02`: mutate the second to `>=` and a boundary rate is reported as
    matching 125.000 AND as matching neither candidate, in the same verdict. Contradictory output is
    worse than either answer alone, and only a rate sitting exactly on the boundary can see it.
    51 records per 0.4 s = 127.5 Hz = 125.000 + exactly 2 %."""
    lines = probe.verdict(probe.summarise(_s([51, 51, 51], dt=0.4)))
    assert any("125.000" in ln for ln in lines)
    assert not any("NEITHER" in ln for ln in lines)


def test_records_per_beat_divides_by_the_pulse_rate(monkeypatch):
    """`rate * 60.0 / mean_pr` → `* mean_pr` leaves a plausible-looking number with no assertion on
    its VALUE to catch it. At 3 records/s and 60 bpm the answer is 3 records per beat; the mutant
    gives 10 800."""
    ring = _FakeRing()
    _install(monkeypatch, ring, device=_FakeDevice())
    s = _run(probe.run("D1:98:62:7C:92:B3", 6.0, 5.0, None))["summary"]
    assert s["reported_pr_mean"] == 60.0
    assert s["records_per_beat"] == round(s["rate_unsaturated_hz"] * 60.0 / 60.0, 3)
    assert s["records_per_beat"] < 100, "a records-per-beat in the thousands is a multiply, not a rate"


def test_the_probe_writes_to_the_WRITE_handle_and_subscribes_on_the_NOTIFY_handle(monkeypatch):
    """`u == OXYII_WRITE` → `!=` does NOT leave a characteristic unresolved — it resolves BOTH names to
    the notify handle, so the None-guard still passes and the probe talks to the wrong one all session.
    A fake that ignores which handle it was called on cannot see that, which is why this asserts the
    uuids rather than the call count."""
    ring = _FakeRing()
    _install(monkeypatch, ring, device=_FakeDevice())
    _run(probe.run("D1:98:62:7C:92:B3", 4.0, 5.0, None))
    assert ring.notify_char.uuid == oxyii.OXYII_NOTIFY
    assert ring.write_chars, "the probe must actually write"
    assert {c.uuid for c in ring.write_chars} == {oxyii.OXYII_WRITE}


def test_a_gatt_missing_EITHER_half_of_the_pair_is_refused(monkeypatch):
    """`wch is None or nch is None` → `and` still refuses a device exposing NEITHER, so the existing
    empty-services test passes under the mutant. Only a GATT with exactly one of the two separates
    them — and a half-resolved GATT is the realistic failure, not a bare one."""
    for uuids in ((oxyii.OXYII_WRITE,), (oxyii.OXYII_NOTIFY,)):
        ring = _FakeRing()
        ring.services = [_FakeService(uuids)]
        _install(monkeypatch, ring, device=_FakeDevice())
        with pytest.raises(SystemExit, match="write/notify"):
            _run(probe.run("D1:98:62:7C:92:B3", 1.0, 5.0, None))


def test_a_reply_declaring_zero_records_reads_no_body_at_all(monkeypatch):
    """`payload[HDR:HDR + (cnt or 0)]` → `or 1`. A reply that declares zero records still carries
    bytes, and slicing one of them means a marker gets counted for a reply that reported nothing.
    The declared count is the authority on how much body there is — never the payload's length."""
    ring = _FakeRing()
    # Declares 0 records, but the byte after the header is the beat marker.
    ring.vals = []
    real = ring.write_gatt_char

    async def zero_count(c, frame, response=False):
        if frame[1] == probe.OP_SAMPLES_A:
            ring.write_chars.append(c)
            ring.notify(0, oxyii.encode(probe.OP_SAMPLES_A,
                                        _payload([], count=0, trailer=bytes([probe.BEAT_MARKER]))))
            return
        return await real(c, frame, response=response)

    ring.write_gatt_char = zero_count
    _install(monkeypatch, ring, device=_FakeDevice())
    res = _run(probe.run("D1:98:62:7C:92:B3", 6.0, 5.0, None))
    assert res["summary"]["markers_total"] == 0, "a zero-record reply has no body to find markers in"
    assert all(s["body_hex"] == "" for s in res["samples"] if s["count"] == 0)
