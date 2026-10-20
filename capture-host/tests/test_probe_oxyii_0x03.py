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

import itertools
import json
import re
import asyncio

import pytest

import oxyii
import probe_oxyii_0x03 as probe


def _run(coro):
    return asyncio.run(coro)


def _payload(vals, count=None, trailer=b"", hdr0=0):
    """A real 0x03 reply: the u32 LE header word at [0:4], the u16 LE record count at [4:6], then body.

    `hdr0` defaults to 0 because that is what the ring sends — measured on all 887 replies of the
    2026-10-06 header run. A test that wants a MOVING word passes one, which is the only way to prove
    the probe would see a firmware that started filling the field."""
    n = len(vals) if count is None else count
    return hdr0.to_bytes(4, "little") + n.to_bytes(2, "little") + bytes(vals) + trailer


def _s(counts, dt=0.2, markers=0, iso=0):
    """A per-reply log with one reply every `dt` seconds."""
    return [{"t": i * dt, "count": c, "body_len": c, "markers": markers, "isolated": iso} for i, c in enumerate(counts)]


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
        "the two rates must be reported separately — their disagreement IS the finding"
    )


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

    def __init__(
        self, vals=(10, 156, 20), pr=60, *, bad_crc=False, short_live=False, other_op=False, hdr_advances=False
    ):
        self.vals, self.pr = list(vals), pr
        # A ring whose [0:4] carries a cumulative sample position — the firmware this one is NOT.
        self.hdr_advances = hdr_advances
        self.hdr0 = 0
        self.bad_crc, self.short_live, self.other_op = bad_crc, short_live, other_op
        self.notify = None
        self.notify_char = None
        self.write_chars = []
        self.write_modes = []
        self.frames = []
        self.stopped = False
        self.stop_char = None
        self.sleeps = []
        self.connect_kwargs = None
        self.connected_dev = None
        self.scan_filter = None
        self.scan_kwargs = None
        # `pr` may be one value or a cycle of them — a rounding test needs a mean with decimals.
        self._prs = itertools.cycle(list(pr) if isinstance(pr, (list, tuple)) else [pr])
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
        self.stop_char = _c

    # `response` defaults to a SENTINEL, not to False: the probe writes `response=False` explicitly, and
    # a fake whose default equalled the probe's choice could not see the kwarg being DROPPED (bleak's own
    # default is None, which is a different write mode on some backends). 2026-09-22: four `response=False`
    # -> omitted mutants survived for exactly that reason.
    async def write_gatt_char(self, _c, frame, response="UNSET"):
        self.write_chars.append(_c)
        self.frames.append(bytes(frame))
        # OBSERVED, not merely accepted. `response=False` is a write-without-response, the only mode
        # the ring answers on this characteristic; a fake that takes the argument and drops it lets
        # `response=False` -> `True` pass every test while changing what goes on the wire.
        self.write_modes.append(response)
        op = frame[1]
        if op == probe.OP_SAMPLES_A:
            reply = oxyii.encode(probe.OP_SAMPLES_A, _payload(self.vals, hdr0=self.hdr0))
            if self.hdr_advances:
                self.hdr0 += len(self.vals)
            if self.bad_crc:
                reply = reply[:-1] + bytes([reply[-1] ^ 0xFF])
            self.notify(0, reply)
        elif op == oxyii.OP_LIVE:
            if self.short_live:
                self.notify(0, oxyii.encode(oxyii.OP_LIVE, bytes(10)))
                return
            hdr = bytearray(24)
            hdr[6] = 96  # spo2  (parse_live offset [6])
            hdr[8] = next(self._prs)  # low byte of the u16 PR at [8:10]
            self.notify(0, oxyii.encode(oxyii.OP_LIVE, bytes(hdr)))
        elif self.other_op:
            self.notify(0, oxyii.encode(oxyii.OP_GET_INFO, b"\x01\x02"))


def _install(monkeypatch, ring, device=None, step=0.5):
    # The scanner fake used to swallow its filter and timeout, so `timeout=25` -> `26`, a filter that
    # accepts a stranger's address, or no filter at all were all invisible (2026-09-22: ten survivors on
    # one line). Record what the probe asked the scanner for; a test asserts the filter's behaviour.
    async def find(*a, **k):
        ring.scan_filter = a[0] if a else k.get("filterfunc")
        ring.scan_kwargs = dict(k)
        return device

    monkeypatch.setattr(probe.BleakScanner, "find_device_by_filter", find)

    # `**kw` used to SWALLOW the connection arguments, so `BleakClient(timeout=30)` -> `timeout=31`
    # was invisible to every test. Record them on the ring instead; the fixture now observes what the
    # probe asked the link for.
    def _client(dev, **kw):
        ring.connected_dev = dev
        ring.connect_kwargs = dict(kw)
        return ring

    monkeypatch.setattr(probe, "BleakClient", _client)

    # The no-op sleep DISCARDED its duration, which is why every `sleep(0.4)` -> `sleep(1.4)` mutant
    # survived. Still a no-op — the point is not to wait — but the durations are now recorded, so a
    # settle time is a value a test can assert rather than a number nothing reads.
    async def no_sleep(_s):
        ring.sleeps.append(_s)
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
    ring.services = []  # a device that is not the ring's GATT
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
    args = [oxyii.decode(f)[1] for f in seen if oxyii.decode(f) and oxyii.decode(f)[0] == probe.OP_SAMPLES_A]
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


def test_the_interval_AFTER_an_at_cap_reply_is_excluded_too():
    """The mirror plant. The test above puts EVERY reply at the cap, so each pair has its second
    member saturated and the `b["count"] >= cap` test alone excludes it — mutating only the
    `a["count"] >= cap` endpoint to `>` survived that test (relay check, 2026-09-06). This window
    saturates ONLY the first reply, then goes clean: the pair (250, 50) must be dropped because its
    FIRST member pinned — the docstring's "the interval that follows it" — so only (50, 100) counts."""
    out = probe.summarise(_s([250, 50, 100]))
    assert out["saturated_replies"] == 1
    assert out["unsaturated_span_s"] == 0.2  # one interval, not two
    assert out["rate_unsaturated_hz"] == 500.0  # 100 / 0.2, not 150 / 0.4 = 375


def test_the_span_is_last_MINUS_first_on_a_window_that_does_not_start_at_zero():
    """`with_recs[-1]["t"] - with_recs[0]["t"]` → `+` is invisible when the first reply sits at t=0,
    which every other test here uses. `time.monotonic()` has an arbitrary origin, so on the box the
    first reply never sits at zero and the mutant would inflate the span by the whole boot time."""
    off = [{"t": 1000.0 + i * 0.2, "count": 25, "body_len": 25, "markers": 0, "isolated": 0} for i in range(4)]
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
            ring.notify(0, oxyii.encode(probe.OP_SAMPLES_A, _payload([], count=0, trailer=bytes([probe.BEAT_MARKER]))))
            return
        return await real(c, frame, response=response)

    ring.write_gatt_char = zero_count
    _install(monkeypatch, ring, device=_FakeDevice())
    res = _run(probe.run("D1:98:62:7C:92:B3", 6.0, 5.0, None))
    assert res["summary"]["markers_total"] == 0, "a zero-record reply has no body to find markers in"
    assert all(s["body_hex"] == "" for s in res["samples"] if s["count"] == 0)


def test_the_probe_asks_the_link_for_what_it_needs_and_the_fixture_can_see_it(monkeypatch):
    """The LINK ARGUMENTS are observed, not merely accepted.

    Residue `2026-09-06-probe-mutation-survivors-are-fixture-limited` recorded 446 surviving mutants on
    this probe and argued they were FIXTURE-limited rather than equivalent — distinguishable in
    principle, invisible in practice. Measured 2026-09-20 on three of its named examples, each planted
    into the real source with the suite green at 37 passed:

        asyncio.sleep(0.4)      -> sleep(1.4)    SURVIVED
        BleakClient(timeout=30) -> timeout=31    SURVIVED
        response=False          -> True (x4)     SURVIVED

    The cause was in this file, not in the probe: `_install` bound `BleakClient` to
    `lambda dev, **kw: ring`, so the connection arguments were SWALLOWED, and its `no_sleep` discarded
    the duration it was handed. A fake that takes an argument and drops it is indistinguishable from
    one that checks it, until a mutant changes the value.

    ⚠️ This pins three VALUES, and it does not claim the other 443. Those need the same treatment
    where they are fixture-limited and an honest `no-distinguishing-input` entry where they are not —
    and the row is explicit that filing these as equivalent would be a false claim.
    """
    ring = _FakeRing()
    _install(monkeypatch, ring, device=_FakeDevice())
    _run(probe.run("D1:98:62:7C:92:B3", 6.0, 5.0, None))

    # ANTI-VACUITY: a run that wrote nothing would satisfy every "all(...)" below by emptiness.
    assert ring.write_modes, "the probe must have written to the ring at all"
    assert ring.sleeps, "the settle sleeps must have been taken"

    assert all(m is False for m in ring.write_modes), (
        "every frame goes out write-WITHOUT-response; the ring answers on notify, and a "
        f"write-with-response would change what reaches the wire — saw {set(ring.write_modes)}"
    )
    assert ring.connect_kwargs is not None, "the connection arguments must reach the fixture"
    assert ring.connect_kwargs.get("timeout") == 30, (
        f"the probe asks for a 30 s connect timeout — saw {ring.connect_kwargs}"
    )
    assert 0.4 in ring.sleeps, f"the post-auth and post-setup settles are 0.4 s each — saw {sorted(set(ring.sleeps))}"


# ── run(): what the probe hands the LINK is asserted, not merely accepted ─────────────────────────
# Residue 2026-09-06-probe-mutation-survivors-are-fixture-limited: 63 of run()'s mutants survived a
# whole-module audit on 2026-09-22 (216 module-wide) because the fixture recorded but nothing asserted.
# Each test below names the mutant class it exists to kill; the audit re-run is the evidence, not this
# comment.


def test_the_scan_filter_is_address_only_and_the_scan_and_connect_timeouts_are_the_documented_ones(monkeypatch):
    """Kills: filter -> None, filter accepting any address, `d.address`/`address` -> None, timeout 25 -> 26/None/
    omitted, `BleakClient(None, ...)`, `timeout=30` (already observed) and `stop_notify(None)`."""
    ring = _FakeRing()
    dev = _FakeDevice()
    _install(monkeypatch, ring, device=dev)
    _run(probe.run("D1:98:62:7C:92:B3", 2.0, 5.0, None))
    f = ring.scan_filter
    assert callable(f), "the probe must hand the scanner a filter, not None"
    assert f(_FakeDevice("D1:98:62:7C:92:B3"), None) is True
    assert f(_FakeDevice("AA:BB:CC:DD:EE:FF"), None) is False, (
        "ADDRESS-ONLY: a stranger's ring must be refused by the filter"
    )
    assert ring.scan_kwargs == {"timeout": 25}
    assert ring.connected_dev is dev, "the client must be opened on the device the scan found"
    assert ring.connect_kwargs == {"timeout": 30}
    assert ring.stop_char is ring.notify_char, "notifications are stopped on the characteristic they were started on"


def test_a_client_without_a_services_attribute_is_refused_not_crashed(monkeypatch):
    """Kills `getattr(cl, "services", [])` -> `getattr(cl, "services")` (AttributeError instead of the refusal)."""
    ring = _FakeRing()
    del ring.services
    _install(monkeypatch, ring, device=_FakeDevice())
    with pytest.raises(SystemExit, match="write/notify pair"):
        _run(probe.run("D1:98:62:7C:92:B3", 1.0, 5.0, None))


def test_the_wire_sequence_is_auth_settle_setup_settle_then_requests_with_a_running_seq_byte(monkeypatch):
    """Kills: sleep(0.4) -> 1.4/None, period = 1/hz -> 2/hz, 1*hz, None; `n = 0` -> 1, `n += 1` -> -= 1 / += 2,
    `n & 0xFF` -> `n | 0xFF` / `n & 256` / seq omitted; every `response=False` dropped."""
    ring = _FakeRing()
    _install(monkeypatch, ring, device=_FakeDevice())
    _run(probe.run("D1:98:62:7C:92:B3", 4.0, 2.0, None))
    assert ring.sleeps[:2] == [0.4, 0.4], "auth and setup each settle for 0.4 s"
    assert set(ring.sleeps[2:]) == {0.5}, "the poll period is 1/hz — at 2 Hz, 0.5 s, and only that"
    ops = [fr[1] for fr in ring.frames]
    assert (
        ops[:2] == [oxyii.OP_AUTH, oxyii.OP_SETUP]
        if hasattr(oxyii, "OP_AUTH") and hasattr(oxyii, "OP_SETUP")
        else ops[0] != probe.OP_SAMPLES_A
    )
    seqs = [fr[4] for fr in ring.frames if fr[1] == probe.OP_SAMPLES_A]
    assert len(seqs) >= 3, "the fixture must produce several requests for the sequence to be checkable"
    assert seqs == list(range(len(seqs))), "0x03 requests carry a running seq byte from 0, one per request"
    assert ring.write_modes and all(m is False for m in ring.write_modes), (
        "every write is write-without-response, explicitly"
    )


def test_the_live_poll_rides_alongside_once_per_second_of_requests(monkeypatch):
    """At hz=1 a live frame follows EVERY 0x03 request (n % max(1, 1) == 0). Kills `max(1, ...)` -> `max(2, ...)`
    (halves the polls), `== 0` -> `== 1` (no polls), and `write_gatt_char(None, live_frame)`."""
    ring = _FakeRing()
    _install(monkeypatch, ring, device=_FakeDevice())
    _run(probe.run("D1:98:62:7C:92:B3", 4.0, 1.0, None))
    n_req = sum(1 for fr in ring.frames if fr[1] == probe.OP_SAMPLES_A)
    n_live = sum(1 for fr in ring.frames if fr[1] == oxyii.OP_LIVE)
    assert n_req >= 3 and n_live == n_req, (
        f"at 1 Hz every request is followed by a live poll, got {n_req} requests / {n_live} polls"
    )
    assert all(c.uuid == oxyii.OXYII_WRITE for c in ring.write_chars), (
        "the live poll goes to the WRITE handle like every other frame"
    )


def test_a_zero_second_window_writes_no_request_at_all(monkeypatch):
    """`while monotonic() < end` -> `<=`: with a frozen clock and seconds=0 the strict form never enters the
    loop; the inclusive form spins until the tick budget is exhausted."""
    ring = _FakeRing()
    _install(monkeypatch, ring, device=_FakeDevice(), step=0)
    _run(probe.run("D1:98:62:7C:92:B3", 0.0, 5.0, None))
    assert sum(1 for fr in ring.frames if fr[1] == probe.OP_SAMPLES_A) == 0


def test_the_result_and_every_record_carry_exactly_the_documented_keys(monkeypatch):
    """Kills every JSON-key mutant in run(): a consumer reads these names, so a renamed key is a broken
    contract, not prose."""
    ring = _FakeRing()
    _install(monkeypatch, ring, device=_FakeDevice())
    res = _run(probe.run("D1:98:62:7C:92:B3", 6.0, 5.0, None))
    assert set(res) == {"summary", "samples", "beats"}
    assert set(res["samples"][0]) == {
        "t",
        "count",
        "body_len",
        "payload_len",
        "markers",
        "isolated",
        "body_hex",
        "hdr0",
        "hdr_hex",
    }
    assert set(res["beats"][0]) == {"t", "pr", "spo2"}
    assert res["beats"][0]["spo2"] == 96 and res["beats"][0]["pr"] == 60, (
        "the live fields are read from the parsed header by their names"
    )


def test_reported_pr_mean_rounds_to_one_decimal_and_records_per_beat_to_three(monkeypatch):
    """Kills round(x, 1) -> 2/None/omitted, `/ len` -> `* len`, and the same family on records_per_beat.
    The fixture's PR cycle is chosen so the means have MORE decimals than the rounding keeps; the
    preconditions assert that, so a fixture drift reads as a fixture failure and not as a pass."""
    # Measured 2026-09-22 under the fixture's tick budget: a 6 s window at 1 Hz polls exactly 4 beats,
    # so the cycle (60, 60, 60, 61) gives a mean of 60.25 — two decimals, which round(x, 1) drops.
    ring = _FakeRing(pr=(60, 60, 60, 61))
    _install(monkeypatch, ring, device=_FakeDevice())
    res = _run(probe.run("D1:98:62:7C:92:B3", 6.0, 1.0, None))
    prs = [b["pr"] for b in res["beats"]]
    assert len(prs) == 4, f"fixture geometry moved: expected 4 polled beats, got {len(prs)}"
    mean = sum(prs) / len(prs)
    assert round(mean, 1) != round(mean, 2), f"precondition: the mean {mean} must carry a second decimal"
    s = res["summary"]
    assert s["reported_pr_mean"] == round(mean, 1)
    rpb = s["rate_unsaturated_hz"] * 60.0 / mean
    assert round(rpb, 3) != round(rpb, 4), f"precondition: records/beat {rpb} must carry a fourth decimal"
    assert s["records_per_beat"] == round(rpb, 3)


# ── ABSENCE-SURVEY 0d996418bc7c: a truncated reply is not a reply declaring zero records ────────────
def test_a_TRUNCATED_reply_is_counted_apart_from_a_declared_zero():
    samples = _s([0, 25, 25])
    samples.append({"t": 9.0, "count": None, "body_len": 0})
    out = probe.summarise(samples)
    assert out["replies"] == 4 and out["replies_truncated"] == 1 and out["replies_with_records"] == 2
    assert out["total_records"] == 50


def test_an_all_TRUNCATED_run_says_malformed_not_an_empty_ring():
    out = probe.summarise([{"t": i * 0.2, "count": None, "body_len": 0} for i in range(3)])
    v = probe.verdict_object(out)
    assert v["status"] == "UNKNOWN" and v["result"]["replies_truncated"] == 3
    assert "too short to carry the 0x03 header" in v["reason"] and "empty reply" not in v["reason"]


# ── group 6a diff-scoped survivors: inputs from the Codex reader, each verified against the original ──
def _r(t, count, markers=0):
    return {"t": t, "count": count, "markers": markers, "isolated": 0}


def test_a_reply_declaring_ONE_record_carries_records():
    assert probe.summarise([_r(0, 1)])["replies_with_records"] == 1


def test_summarise_rounds_every_rate_and_span_to_its_stated_digits():
    out = probe.summarise([_r(0, 1), _r(100000, 123456, 123456)], cap=200000)
    assert (out["rate_all_hz"], out["marker_rate_hz"], out["rate_minus_markers_hz"]) == (1.235, 1.235, 0.0)
    assert out["rate_unsaturated_hz"] == 1.235
    out = probe.summarise([_r(0, 1), _r(1.23456, 1)])
    assert (out["span_s"], out["unsaturated_span_s"], out["rate_all_hz"]) == (1.235, 1.235, 0.81)
    out = probe.summarise([_r(i, 10 if i == 0 else 1) for i in range(6)], cap=10)
    assert out["saturated_fraction"] == 0.1667
    # non-integral values, so a digit-less round() cannot pass by landing on the same number
    out = probe.summarise([_r(0, 1), _r(4, 3, 1)])
    assert (out["rate_all_hz"], out["marker_rate_hz"], out["rate_minus_markers_hz"]) == (0.75, 0.25, 0.5)


def test_absent_marker_counts_add_nothing():
    out = probe.summarise([_r(0, 1), _r(1, 1)])
    assert (out["markers_total"], out["markers_isolated"]) == (0, 0)
    assert (out["marker_rate_hz"], out["rate_minus_markers_hz"]) == (0.0, 1.0)


def _B(r):
    return {
        "replies": 2,
        "replies_with_records": 2,
        "replies_truncated": 0,
        "saturated_replies": 0,
        "cap": 250,
        "rate_unsaturated_hz": r,
    }


def test_verdict_band_is_RELATIVE_and_INCLUSIVE_with_a_four_digit_closest_fraction():
    v = probe.verdict_object(_B(125.1))
    assert v["status"] == "PASS" and v["result"]["matched_hz"] == [125.0] and v["result"]["closest_fraction"] == 0.0008
    assert probe.verdict_object(_B(127.5))["status"] == "PASS"  # exactly 2 % above 125: inside the band
    assert probe.verdict_object(_B(125.123))["result"]["closest_fraction"] == 0.001
    v = probe.verdict_object(_B(100))
    assert v["status"] == "FAIL" and "neither 112.9 nor 125.0 Hz" in v["reason"]


def test_the_pulse_rate_mean_publishes_the_n_it_rests_on(monkeypatch):
    """ABSENCE-SURVEY fc45870e8f2f: a poll with no PR is dropped from the mean, so `beats_polled` overstates
    what the mean (and records_per_beat) rests on. `reported_pr_n` is that n."""
    ring = _FakeRing(pr=[60, 0])
    _install(monkeypatch, ring, device=_FakeDevice())
    s = _run(probe.run("D1:98:62:7C:92:B3", 30.0, 5.0, None))["summary"]
    assert s["beats_polled"] >= 2
    assert s["reported_pr_n"] == sum(1 for b in range(s["beats_polled"]) if b % 2 == 0)
    assert s["reported_pr_n"] < s["beats_polled"] and s["reported_pr_mean"] == 60.0


# ── residue 2026-09-22-probe-survivors-outside-run-measured ─────────────────────────────────────────
# The row's table of survivors per function came off a whole-module audit; a second audit reported by
# the API lane (`0035e752`, mutmut 3.8.0, 821 mutants, 124 survivors, 120 outside `run()`) is quoted
# here as ITS measurement, not re-run under the owner's standing stop on mutation sweeps. What the
# tests below rest on needs no sweep: each one is written against a named survivor family and asserts
# what a consumer READS — the emitted object, the printed line, the struct format — not that a line ran.
def test_parse_counts_reads_a_header_only_reply_and_an_unsigned_count():
    """A reply of EXACTLY the 6 header bytes carries a count (of zero body bytes); only a shorter one is
    headerless. And the count is u16: 0xFFFF is 65535 records declared, not -1."""
    assert probe.parse_counts(b"\x00\x00\x00\x00\x07\x00") == (7, 0)
    assert probe.parse_counts(b"\x00\x00\x00\x00\xff\xff") == (65535, 0)
    assert probe.parse_counts(b"\x00\x00\x00\x00\x07") == (None, 0)


def test_marker_stats_judges_position_zero_on_the_neighbour_it_has_and_counts_every_isolated_marker():
    """`i == 0` must mean position ZERO: a marker first in the body is judged against body[1] only, never
    against body[-1] (the wrap-around neighbour). And the isolated count ACCUMULATES."""
    assert probe.marker_stats(bytes([156, 1, 156])) == (2, 2)
    assert probe.marker_stats(bytes([156, 1, 156, 2, 156])) == (3, 3)


def _full(r=125.0):
    return {
        "replies": 9,
        "replies_truncated": 1,
        "replies_with_records": 7,
        "saturated_replies": 2,
        "saturated_fraction": 0.2857,
        "cap": 250,
        "total_records": 1234,
        "rate_all_hz": 126.5,
        "rate_unsaturated_hz": r,
        "span_s": 11.5,
        "unsaturated_span_s": 8.25,
        # The header diagnostic, in the shape measured on the ring: a constant word. The one truncated
        # reply is also the one that carried no header, and it excludes the two pairs it sits between.
        "header_read": 8,
        "header_absent": 1,
        "header_values_distinct": 1,
        "header_min": 0,
        "header_max": 0,
        "header_constant": True,
        "header_pairs": 6,
        "header_pairs_excluded": 2,
        "header_steps_matching_count": 0,
        "header_position_share": 0.0,
        "header_nondecreasing": True,
        "header_reading": "not-a-position",
    }


def test_verdict_object_result_carries_exactly_the_documented_keys_with_the_values_it_was_given():
    v = probe.verdict_object(_full(125.0))
    # `header_min`/`header_max` stay in the per-run log and out of the object — the object answers
    # whether the word MOVED, and the extremes are only readable beside the body they came from.
    expect = {k: v2 for k, v2 in _full(125.0).items() if k not in ("header_min", "header_max")}
    assert v["result"] == {**expect, "matched_hz": [125.0], "closest_fraction": 0.0}
    assert v["evidence"] == ["capture-host/probe_oxyii_0x03.py"]
    assert v["producedBy"]["tool"] == "capture-host/probe_oxyii_0x03.py"
    assert v["population"] == {"checked": 7, "eligible": 9, "excluded": 2}


def test_every_verdict_object_refusal_states_its_reason_in_full():
    zero = {**_full(), "replies_with_records": 0, "replies_truncated": 0, "rate_unsaturated_hz": None}
    v = probe.verdict_object(zero)
    assert v["status"] == "UNKNOWN"
    assert v["reason"] == (
        "the ring returned no 0x03 records — an empty reply and a wrong request "
        "argument are indistinguishable, so nothing was decided"
    )
    trunc = {**zero, "replies": 3, "replies_truncated": 3}
    v = probe.verdict_object(trunc)
    assert v["status"] == "UNKNOWN"
    assert v["reason"] == (
        "3 of 3 replies were too short to carry the 0x03 header — "
        "malformed replies, not an empty ring, so nothing was decided"
    )
    v = probe.verdict_object({**_full(), "rate_unsaturated_hz": None})
    assert v["status"] == "UNDERPOWERED"
    assert v["reason"] == (
        "0 unsaturated reply pairs, minimum 1: 2 of 7 replies pinned at the 250-record cap — "
        "this run measured the polling, not the device"
    )
    v = probe.verdict_object(_full(100.0))
    assert v["status"] == "FAIL"
    assert v["reason"] == "100.0 Hz is within 2% of neither 112.9 nor 125.0 Hz — a third answer"


def test_verdict_sample_is_fifty_one_unmarked_replies_of_25_records_at_5_hz(monkeypatch):
    """The adoption gate reads this object, so its INPUT is the contract: 51 replies 0.2 s apart, 25
    records each, no markers. Intercept the rows (the verdict does not surface the marker fields)."""
    seen = []
    real = probe.summarise
    monkeypatch.setattr(probe, "summarise", lambda rows, *a, **k: (seen.append(rows), real(rows, *a, **k))[1])
    v = probe.verdict_sample()
    assert seen[0] == [{"t": i * 0.2, "count": 25, "markers": 0, "isolated": 0} for i in range(51)]
    assert v["result"]["replies"] == 51 and v["result"]["total_records"] == 1275
    assert (v["result"]["span_s"], v["result"]["unsaturated_span_s"]) == (10.0, 10.0)


def _v(r, **kw):
    return {
        "replies_with_records": 5,
        "saturated_replies": 0,
        "saturated_fraction": 0.0,
        "cap": 250,
        "rate_unsaturated_hz": r,
        "unsaturated_span_s": 4.5,
        "header_read": 5,
        "header_absent": 0,
        "header_min": 0,
        "header_max": 0,
        "header_pairs": 4,
        "header_steps_matching_count": 0,
        "header_position_share": 0.0,
        "header_reading": "not-a-position",
        **kw,
    }


def test_verdict_prose_lines_are_exact_for_every_outcome():
    assert probe.verdict(_v(None, replies_with_records=0)) == [
        "VERDICT: the ring returned NO 0x03 records — worn? correct argument? See --arg.",
        "  An empty reply and a wrong request argument are indistinguishable here.",
    ]
    assert probe.verdict(_v(None, saturated_replies=3, saturated_fraction=1.0)) == [
        "VERDICT: no unsaturated interval — every usable pair had a reply at the cap.",
        "  3/5 replies pinned at 250.  Poll faster (--hz) and re-run; this run measures the POLLING, not the device.",
    ]
    assert probe.verdict(_v(125.0)) == [
        "VERDICT: unsaturated rate 125.0 Hz over 4.5 s",
        "  → consistent with 125.000 Hz (within 2 %)",
        "  [0:4] reads not-a-position: 0/4 steps match the previous declared count (0.0%), against the 95% pre-stated in §P1; values 0..0",
    ]
    assert probe.verdict(_v(112.9, saturated_replies=1, saturated_fraction=0.2)) == [
        "VERDICT: unsaturated rate 112.9 Hz over 4.5 s",
        "  ⚠ 1/5 replies (20.0%) hit the 250-record cap — see the warning "
        "in this file's header; a high fraction makes even the unsaturated rate suspect.",
        "  → consistent with 112.9 Hz (within 2 %)",
        "  [0:4] reads not-a-position: 0/4 steps match the previous declared count (0.0%), against the 95% pre-stated in §P1; values 0..0",
    ]
    assert probe.verdict(_v(100.0)) == [
        "VERDICT: unsaturated rate 100.0 Hz over 4.5 s",
        "  → consistent with NEITHER candidate — a third answer, not a tie-break",
        "  [0:4] reads not-a-position: 0/4 steps match the previous declared count (0.0%), against the 95% pre-stated in §P1; values 0..0",
    ]


def test_verdict_candidate_bands_sit_on_112_9_and_125_not_a_unit_away():
    """Probes placed just inside one candidate's 2 % band and OUTSIDE every shifted copy of it, so a
    candidate nudged by a Hz, or a band widened past 2 %, changes the lines."""

    # Addressed by NAME, not by position: the header diagnostic is the last line now, and an index
    # would have silently started asserting about a different line.
    def _cand(r):
        got = [ln for ln in probe.verdict(_v(r)) if "consistent with" in ln]
        assert len(got) == 1, got
        return got[0]

    inside_low = 112.9 * 0.981  # 1.9 % under 112.9; 2.8 % under 113.9
    assert _cand(inside_low) == "  → consistent with 112.9 Hz (within 2 %)"
    inside_high = 125.0 * 0.981  # 1.9 % under 125; 2.7 % under 126
    assert _cand(inside_high) == "  → consistent with 125.000 Hz (within 2 %)"
    for beyond in (113.9 * 1.019, 126.0 * 1.019):  # not within 2 % of EITHER real candidate
        assert _cand(beyond) == "  → consistent with NEITHER candidate — a third answer, not a tie-break"


def _capture_run(monkeypatch, summary=None):
    seen = {}

    async def fake_run(addr, seconds, hz, arg):
        seen.update(addr=addr, seconds=seconds, hz=hz, arg=arg)
        return {"summary": summary or probe.summarise(_s([25, 25, 25, 25])), "samples": [], "beats": []}

    monkeypatch.setattr(probe, "run", fake_run)
    return seen


def test_main_defaults_and_argument_types_reach_run(monkeypatch):
    seen = _capture_run(monkeypatch)
    assert probe.main([]) == 0
    assert seen == {"addr": "D1:98:62:7C:92:B3", "seconds": 600.0, "hz": 5.0, "arg": None}
    assert isinstance(seen["seconds"], float) and isinstance(seen["hz"], float)
    assert probe.main(["--address", "AA:BB", "--seconds", "3", "--hz", "8", "--arg", "0902"]) == 0
    assert seen == {"addr": "AA:BB", "seconds": 3.0, "hz": 8.0, "arg": "0902"}
    assert isinstance(seen["seconds"], float) and isinstance(seen["hz"], float)


def test_main_help_documents_every_option(monkeypatch, capsys):
    monkeypatch.setenv("COLUMNS", "400")
    with pytest.raises(SystemExit) as e:
        probe.main(["--help"])
    assert e.value.code == 0
    out = capsys.readouterr().out
    # Anchored to the line: a "XX…XX"-wrapped string still CONTAINS the original, so `in` would pass it.
    assert "\nMeasure the 0x03 LIVE_SAMPLES_A record rate (worn ring).\n" in out
    for text in (
        "≥600 recommended (§7.4)",
        "poll rate; higher = less saturation risk",
        "request-argument hex override, e.g. 0701",
        "write the full per-reply log here",
        "print one tepna.verdict/1 object over synthetic replies and exit (the adoption gate reads this)",
    ):
        assert re.search(r"  " + re.escape(text) + r"$", out, re.M), text


def test_main_verdict_sample_prints_the_object_indented_by_one_and_never_touches_the_radio(monkeypatch, capsys):
    fixed = {"gate": "g", "nested": {"a": 1}}
    monkeypatch.setattr(probe, "verdict_sample", lambda: fixed)
    seen = _capture_run(monkeypatch)
    assert probe.main(["--verdict-sample"]) == 0
    assert capsys.readouterr().out == json.dumps(fixed, indent=1) + "\n"
    assert seen == {}, "--verdict-sample must return before run() is reached"


def test_main_without_a_radio_stack_refuses_in_words(monkeypatch):
    monkeypatch.setattr(probe, "BleakScanner", None)
    with pytest.raises(SystemExit) as e:
        probe.main([])
    assert e.value.code == "probe_oxyii_0x03: bleak is not installed — this probe needs a radio stack"


def test_main_prints_each_summary_row_the_verdict_object_and_where_the_log_went(monkeypatch, capsys, tmp_path):
    summary = probe.summarise(_s([25, 25, 25, 25]))
    _capture_run(monkeypatch, summary)
    log = tmp_path / "log.json"
    opened = []
    real_open = open

    def spy_open(*a, **k):
        opened.append((a, k))
        return real_open(*a, **k)

    monkeypatch.setattr(probe, "open", spy_open, raising=False)
    assert probe.main(["--json", str(log)]) == 0
    lines = capsys.readouterr().out.split("\n")
    for k, v in summary.items():
        assert f"  {k:24} {v}" in lines
    obj = json.loads(next(line for line in lines if line.startswith('{"schema"')))
    assert (
        obj["gate"] == probe.VERDICT_GATE and obj["status"] == "PASS" and obj["result"]["rate_unsaturated_hz"] == 125.0
    )
    assert f"per-reply log → {log}" in lines
    assert lines[lines.index(f"per-reply log → {log}") - 1] == ""
    assert [(a[:2], k) for a, k in opened] == [((str(log), "w"), {"encoding": "utf-8"})]
    text = log.read_text(encoding="utf-8")
    assert text == json.dumps(json.loads(text), indent=1)
    assert json.loads(text)["verdict"] == obj


# ── [0:4]: the header word, recorded instead of re-patched ────────────────────────────────────────
# RING-POLL-SPLIT §P1 answered its criterion (b) with a SCRATCH copy of this probe recording
# `payload[:6]`. That copy was never committed, so the measurement behind "[0:4] is not a stream
# position" could not be re-run without writing the patch again. What is covered here is the committed
# reader, its ABSENCE case, the pre-stated share, and — the control that matters — a ring whose word
# DOES advance. Without that control the reader could be hard-wired to the 2026-10-06 constant and
# every test would still pass.
def _hw(words, counts, dt=0.2):
    """A per-reply log carrying one header word per reply. `None` in `words` is a reply never read."""
    return [
        {"t": i * dt, "count": c, "body_len": c or 0, "markers": 0, "isolated": 0, "hdr0": w}
        for i, (w, c) in enumerate(zip(words, counts))
    ]


def test_parse_header_word_reads_the_u32_le_at_zero():
    assert probe.parse_header_word(_payload([1, 2, 3], hdr0=0x04030201)) == 0x04030201


def test_a_header_too_short_to_read_is_none_and_a_measured_zero_is_a_value():
    # ∅ The two must not render alike, because the measured value IS 0: five bytes cannot carry the
    # six-byte header, and reporting 0 there would publish the constant for a reply never read.
    assert probe.parse_header_word(b"\x00\x00\x00\x00\x00") is None
    assert probe.parse_header_word(_payload([7], hdr0=0)) == 0


def test_the_measured_constant_reads_as_not_a_position():
    # P1's shape, worn, 2026-10-06: 887 replies, `[0:4]` zero on every one, and 11 of the 886 steps
    # matching — the replies that had declared 0 records. The share is 1.2 %, not 95 %.
    counts = [0] * 11 + [250] * 876
    s = probe.header_word_stats(_hw([0] * 887, counts))
    assert s["header_read"] == 887
    assert s["header_absent"] == 0
    assert s["header_values_distinct"] == 1
    assert s["header_constant"] is True
    assert (s["header_pairs"], s["header_steps_matching_count"]) == (886, 11)
    assert s["header_position_share"] == 0.0124
    assert s["header_nondecreasing"] is True
    assert s["header_reading"] == "not-a-position"


def test_a_cumulative_word_reads_as_a_position():
    # The control. A firmware whose `[0:4]` carries the stream position must come out the other way,
    # or the reader is a constant dressed as a measurement.
    s = probe.header_word_stats(_hw([0, 10, 20, 30], [10, 10, 10, 10]))
    assert (s["header_pairs"], s["header_steps_matching_count"]) == (3, 3)
    assert s["header_position_share"] == 1.0
    assert s["header_reading"] == "position"
    assert s["header_constant"] is False


def test_the_pre_stated_share_is_the_boundary_and_empty_replies_can_meet_it():
    # 38 of 40 is exactly 0.95, so it reads as a position — off REPLIES THAT DECLARED NOTHING, whose
    # step of 0 matches their count of 0. The criterion was pre-stated with that artifact in it, so it
    # stays; the reading is only honest beside the declared counts, which is why both are published.
    at = probe.header_word_stats(_hw([0] * 41, [0] * 38 + [250] * 3))
    assert (at["header_pairs"], at["header_steps_matching_count"]) == (40, 38)
    assert at["header_position_share"] == 0.95
    assert at["header_reading"] == "position"
    below = probe.header_word_stats(_hw([0] * 41, [0] * 37 + [250] * 4))
    assert below["header_position_share"] == 0.925
    assert below["header_reading"] == "not-a-position"


def test_nothing_read_leaves_every_derived_field_null():
    # ∅ A run whose replies were all too short decided nothing about the field. Only the two counts
    # answer 0; a share of 0.0 or a `False` for `constant` would be an answer nobody measured.
    s = probe.header_word_stats(_hw([None, None, None], [250, 250, 250]))
    assert (s["header_read"], s["header_absent"]) == (0, 3)
    for k in (
        "header_values_distinct",
        "header_min",
        "header_max",
        "header_constant",
        "header_pairs",
        "header_position_share",
        "header_steps_matching_count",
        "header_nondecreasing",
        "header_reading",
    ):
        assert s[k] is None, k
    assert s["header_pairs_excluded"] == 2


def test_an_unreadable_reply_excludes_its_pairs_rather_than_failing_them():
    # The middle reply was never read, so neither pair it belongs to is examinable. Scoring them as
    # mismatches would push a real position below the share by nothing but a truncated link.
    s = probe.header_word_stats(_hw([0, None, 20, 30], [10, 10, 10, 10]))
    assert (s["header_pairs"], s["header_pairs_excluded"]) == (1, 2)
    assert s["header_position_share"] == 1.0


def test_a_reply_declaring_nothing_excludes_the_pair_it_opens():
    # A truncated reply has no declared count, so the step has nothing to be compared against.
    s = probe.header_word_stats(_hw([0, 10, 20], [10, None, 10]))
    assert (s["header_pairs"], s["header_pairs_excluded"]) == (1, 1)
    assert s["header_steps_matching_count"] == 1


def test_a_word_that_goes_backwards_is_reported():
    s = probe.header_word_stats(_hw([30, 20, 10], [10, 10, 10]))
    assert s["header_nondecreasing"] is False
    assert s["header_reading"] == "not-a-position"


def test_summarise_carries_the_header_diagnostic():
    s = probe.summarise(_hw([0, 0, 0], [25, 25, 25]))
    assert s["header_read"] == 3
    assert s["header_reading"] == "not-a-position"
    # The rate is unchanged by the diagnostic riding along.
    assert s["rate_unsaturated_hz"] == 125.0


def test_the_verdict_object_carries_the_reading_and_keeps_the_rate_as_its_status():
    v = probe.verdict_object(probe.summarise(_hw([0] * 51, [25] * 51)))
    assert v["status"] == "PASS"
    assert v["criterion"]["name"] == "rate_within_candidate"
    assert v["result"]["header_reading"] == "not-a-position"
    assert v["result"]["header_constant"] is True


def test_the_prose_states_the_reading_with_the_pre_stated_share():
    line = [ln for ln in probe.verdict(probe.summarise(_hw([0] * 51, [25] * 51))) if "[0:4]" in ln]
    assert len(line) == 1
    assert "not-a-position" in line[0]
    assert "95%" in line[0].replace(" %", "%")
    assert "0/50" in line[0]


def test_the_prose_says_so_when_the_header_has_no_reading():
    rows = [{"t": i * 0.2, "count": 25, "markers": 0, "isolated": 0} for i in range(51)]
    line = [ln for ln in probe.verdict(probe.summarise(rows)) if "[0:4]" in ln]
    assert len(line) == 1
    assert "no examinable pair" in line[0]
    assert "51 absent" in line[0]


def test_run_records_the_header_word_and_the_raw_header_bytes(monkeypatch):
    ring = _FakeRing(vals=(10, 20, 30))
    _install(monkeypatch, ring, device=_FakeDevice())
    res = _run(probe.run("D1:98:62:7C:92:B3", 4.0, 5.0, None))
    assert res["samples"], "the fake ring answered no 0x03 reply"
    for rec in res["samples"]:
        assert rec["hdr0"] == 0
        # The whole six bytes, the declared count included: the count varying is what proves the
        # header was read at all when the word reads a constant.
        assert rec["hdr_hex"] == "000000000300"
    assert res["summary"]["header_reading"] == "not-a-position"


def test_run_sees_a_ring_whose_header_word_advances(monkeypatch):
    # The end-to-end control: same probe, same loop, a firmware that fills the field.
    ring = _FakeRing(vals=(10, 20, 30), hdr_advances=True)
    _install(monkeypatch, ring, device=_FakeDevice())
    res = _run(probe.run("D1:98:62:7C:92:B3", 4.0, 5.0, None))
    words = [rec["hdr0"] for rec in res["samples"]]
    assert words == sorted(words) and words[-1] > 0, words
    assert res["summary"]["header_reading"] == "position"
    assert res["summary"]["header_nondecreasing"] is True
